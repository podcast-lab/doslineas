import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database } from "./sqlite.js";
import { DatabaseSync } from "./sqlite.js";
import type { Job, JobState, NewJob, SessionStatus, StepName } from "./jobs.js";
import { toSessionStatus } from "./jobs.js";
import type { JobFilter, JobQueue } from "./queue.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  studio TEXT NOT NULL,
  session TEXT NOT NULL,
  directory TEXT NOT NULL,
  step TEXT NOT NULL,
  position INTEGER NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  max_attempts INTEGER NOT NULL,
  owner TEXT,
  lease_expires_at INTEGER,
  note TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  UNIQUE (studio, session, step)
) STRICT;
CREATE INDEX IF NOT EXISTS jobs_by_state ON jobs (state, position);
CREATE INDEX IF NOT EXISTS jobs_by_session ON jobs (studio, session, position);
`;

type Row = Record<string, unknown>;

function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`column ${column} is not text`);
  return value;
}

function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value === "bigint") return Number(value);
  if (typeof value !== "number") throw new Error(`column ${column} is not an integer`);
  return value;
}

function nullableText(row: Row, column: string): string | null {
  const value = row[column];
  return typeof value === "string" ? value : null;
}

function nullableInteger(row: Row, column: string): number | null {
  const value = row[column];
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : null;
}

function toJob(row: Row): Job {
  return {
    id: integer(row, "id"),
    studio: text(row, "studio"),
    session: text(row, "session"),
    directory: text(row, "directory"),
    step: text(row, "step") as StepName,
    position: integer(row, "position"),
    state: text(row, "state") as JobState,
    attempts: integer(row, "attempts"),
    maxAttempts: integer(row, "max_attempts"),
    owner: nullableText(row, "owner"),
    leaseExpiresAt: nullableInteger(row, "lease_expires_at"),
    note: nullableText(row, "note"),
    createdAt: integer(row, "created_at"),
    updatedAt: integer(row, "updated_at"),
    startedAt: nullableInteger(row, "started_at"),
    finishedAt: nullableInteger(row, "finished_at")
  };
}

export interface SqliteJobQueueOptions {
  readonly now?: () => number;
}

export class SqliteJobQueue implements JobQueue {
  private readonly db: Database;
  private readonly now: () => number;

  constructor(file: string, options: SqliteJobQueueOptions = {}) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(SCHEMA);
    this.now = options.now ?? Date.now;
  }

  enqueue(jobs: readonly NewJob[]): readonly Job[] {
    const at = this.now();
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO jobs
         (studio, session, directory, step, position, state, attempts, max_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)`
    );

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const job of jobs) {
        insert.run(job.studio, job.session, job.directory, job.step, job.position, job.maxAttempts, at, at);
      }
      this.db.exec("COMMIT");
    } catch (failure) {
      this.rollback();
      throw failure;
    }

    const first = jobs[0];
    return first === undefined ? [] : this.jobs({ studio: first.studio, session: first.session });
  }

  lease(owner: string, leaseMs: number): Job | null {
    const at = this.now();
    let leased: number | null = null;

    this.db.exec("BEGIN IMMEDIATE");
    try {
      const candidate = this.db
        .prepare(
          `SELECT * FROM jobs AS j
            WHERE j.state = 'pending'
              AND NOT EXISTS (
                SELECT 1 FROM jobs AS earlier
                 WHERE earlier.studio = j.studio AND earlier.session = j.session
                   AND earlier.position < j.position
                   AND earlier.state NOT IN ('done', 'skipped')
              )
              AND NOT EXISTS (
                SELECT 1 FROM jobs AS busy
                 WHERE busy.studio = j.studio AND busy.session = j.session AND busy.state = 'leased'
              )
            ORDER BY j.created_at, j.position
            LIMIT 1`
        )
        .get();

      if (candidate !== undefined) {
        leased = integer(candidate, "id");
        this.db
          .prepare(
            `UPDATE jobs
                SET state = 'leased', owner = ?, lease_expires_at = ?, attempts = attempts + 1,
                    updated_at = ?, started_at = COALESCE(started_at, ?), note = NULL
              WHERE id = ?`
          )
          .run(owner, at + leaseMs, at, at, leased);
      }
      this.db.exec("COMMIT");
    } catch (failure) {
      this.rollback();
      throw failure;
    }

    return leased === null ? null : this.require(leased);
  }

  heartbeat(id: number, owner: string, leaseMs: number): void {
    const at = this.now();
    const changes = this.db
      .prepare("UPDATE jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND owner = ? AND state = 'leased'")
      .run(at + leaseMs, at, id, owner);
    if (Number(changes.changes) === 0) throw new Error(`job ${id} is no longer leased by ${owner}`);
  }

  complete(id: number, owner: string, note?: string): void {
    this.finish(id, owner, "done", note ?? null);
  }

  skip(id: number, owner: string, note: string): void {
    this.finish(id, owner, "skipped", note);
  }

  fail(id: number, owner: string, error: string): Job {
    const at = this.now();
    const job = this.require(id);
    if (job.owner !== owner || job.state !== "leased") throw new Error(`job ${id} is not leased by ${owner}`);

    const exhausted = job.attempts >= job.maxAttempts;
    this.db
      .prepare(
        `UPDATE jobs
            SET state = ?, owner = NULL, lease_expires_at = NULL, note = ?, updated_at = ?, finished_at = ?
          WHERE id = ?`
      )
      .run(exhausted ? "failed" : "pending", error, at, exhausted ? at : null, job.id);
    return this.require(id);
  }

  retry(studio: string, session: string, step?: StepName): number {
    const at = this.now();
    const changes =
      step === undefined
        ? this.db
            .prepare(
              `UPDATE jobs SET state = 'pending', attempts = 0, owner = NULL, lease_expires_at = NULL,
                      note = NULL, finished_at = NULL, updated_at = ?
                WHERE studio = ? AND session = ? AND state = 'failed'`
            )
            .run(at, studio, session)
        : this.db
            .prepare(
              `UPDATE jobs SET state = 'pending', attempts = 0, owner = NULL, lease_expires_at = NULL,
                      note = NULL, finished_at = NULL, updated_at = ?
                WHERE studio = ? AND session = ? AND step = ? AND state IN ('failed', 'done', 'skipped')`
            )
            .run(at, studio, session, step);
    return Number(changes.changes);
  }

  reclaimExpired(): readonly Job[] {
    const at = this.now();
    const expired = this.db
      .prepare("SELECT * FROM jobs WHERE state = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?")
      .all(at)
      .map(toJob);

    for (const job of expired) {
      const exhausted = job.attempts >= job.maxAttempts;
      this.db
        .prepare(
          `UPDATE jobs SET state = ?, owner = NULL, lease_expires_at = NULL, note = ?, updated_at = ?, finished_at = ?
            WHERE id = ?`
        )
        .run(
          exhausted ? "failed" : "pending",
          `the lease of ${job.owner ?? "a worker"} expired while running ${job.step}`,
          at,
          exhausted ? at : null,
          job.id
        );
    }

    return expired.map((job) => this.require(job.id));
  }

  job(id: number): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
    return row === undefined ? null : toJob(row);
  }

  jobs(filter: JobFilter = {}): readonly Job[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (filter.studio !== undefined) {
      clauses.push("studio = ?");
      values.push(filter.studio);
    }
    if (filter.session !== undefined) {
      clauses.push("session = ?");
      values.push(filter.session);
    }
    if (filter.state !== undefined) {
      clauses.push("state = ?");
      values.push(filter.state);
    }
    const where = clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
    return this.db
      .prepare(`SELECT * FROM jobs${where} ORDER BY created_at, position`)
      .all(...values)
      .map(toJob);
  }

  sessions(studio?: string): readonly SessionStatus[] {
    const all = studio === undefined ? this.jobs() : this.jobs({ studio });
    const grouped = new Map<string, Job[]>();
    for (const job of all) {
      const key = JSON.stringify([job.studio, job.session]);
      const bucket = grouped.get(key);
      if (bucket === undefined) grouped.set(key, [job]);
      else bucket.push(job);
    }
    return [...grouped.values()]
      .map(toSessionStatus)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0) || a.session.localeCompare(b.session));
  }

  session(studio: string, session: string): SessionStatus | null {
    const steps = this.jobs({ studio, session });
    return steps.length === 0 ? null : toSessionStatus(steps);
  }

  knownSessions(): readonly string[] {
    return this.db
      .prepare("SELECT DISTINCT directory FROM jobs")
      .all()
      .map((row) => text(row, "directory"));
  }

  close(): void {
    this.db.close();
  }

  private finish(id: number, owner: string, state: JobState, note: string | null): void {
    const at = this.now();
    const changes = this.db
      .prepare(
        `UPDATE jobs SET state = ?, owner = NULL, lease_expires_at = NULL, note = ?, updated_at = ?, finished_at = ?
          WHERE id = ? AND owner = ? AND state = 'leased'`
      )
      .run(state, note, at, at, id, owner);
    if (Number(changes.changes) === 0) throw new Error(`job ${id} is not leased by ${owner}`);
  }

  private rollback(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch {
      return;
    }
  }

  private require(id: number): Job {
    const job = this.job(id);
    if (job === null) throw new Error(`job ${id} disappeared`);
    return job;
  }
}
