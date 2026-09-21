import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database } from "./sqlite.js";
import { DatabaseSync } from "./sqlite.js";

export const ALERT_KINDS = [
  "incomplete-session",
  "step-failed",
  "lease-expired",
  "delivery-ready",
  "raw-removed"
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface Alert {
  readonly id: number;
  readonly studio: string;
  readonly session: string;
  readonly kind: AlertKind;
  readonly message: string;
  readonly at: number;
  readonly acknowledgedAt: number | null;
}

export interface NewAlert {
  readonly studio: string;
  readonly session: string;
  readonly kind: AlertKind;
  readonly message: string;
}

export interface AlertStore {
  raise(alert: NewAlert): Alert | null;
  list(options?: { readonly pending?: boolean }): readonly Alert[];
  acknowledge(id: number): void;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  studio TEXT NOT NULL,
  session TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  at INTEGER NOT NULL,
  acknowledged_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS alerts_pending ON alerts (acknowledged_at, at);
`;

function toAlert(row: Record<string, unknown>): Alert {
  const acknowledged = row["acknowledged_at"];
  return {
    id: Number(row["id"]),
    studio: String(row["studio"]),
    session: String(row["session"]),
    kind: String(row["kind"]) as AlertKind,
    message: String(row["message"]),
    at: Number(row["at"]),
    acknowledgedAt: typeof acknowledged === "number" ? acknowledged : null
  };
}

export interface SqliteAlertStoreOptions {
  readonly now?: () => number;
}

export class SqliteAlertStore implements AlertStore {
  private readonly db: Database;
  private readonly now: () => number;

  constructor(file: string, options: SqliteAlertStoreOptions = {}) {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec(SCHEMA);
    this.now = options.now ?? Date.now;
  }

  raise(alert: NewAlert): Alert | null {
    const standing = this.db
      .prepare(
        `SELECT * FROM alerts
          WHERE studio = ? AND session = ? AND kind = ? AND message = ? AND acknowledged_at IS NULL`
      )
      .get(alert.studio, alert.session, alert.kind, alert.message);
    if (standing !== undefined) return null;

    const at = this.now();
    const changes = this.db
      .prepare("INSERT INTO alerts (studio, session, kind, message, at) VALUES (?, ?, ?, ?, ?)")
      .run(alert.studio, alert.session, alert.kind, alert.message, at);
    const row = this.db.prepare("SELECT * FROM alerts WHERE id = ?").get(Number(changes.lastInsertRowid));
    return row === undefined ? null : toAlert(row);
  }

  list(options: { readonly pending?: boolean } = {}): readonly Alert[] {
    const where = options.pending === true ? " WHERE acknowledged_at IS NULL" : "";
    return this.db
      .prepare(`SELECT * FROM alerts${where} ORDER BY at DESC`)
      .all()
      .map(toAlert);
  }

  acknowledge(id: number): void {
    this.db.prepare("UPDATE alerts SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL").run(this.now(), id);
  }

  close(): void {
    this.db.close();
  }
}

export class MemoryAlertStore implements AlertStore {
  private readonly alerts: Alert[] = [];
  private next = 1;

  raise(alert: NewAlert): Alert | null {
    const standing = this.alerts.some(
      (existing) =>
        existing.acknowledgedAt === null &&
        existing.studio === alert.studio &&
        existing.session === alert.session &&
        existing.kind === alert.kind &&
        existing.message === alert.message
    );
    if (standing) return null;

    const raised: Alert = { ...alert, id: this.next++, at: Date.now(), acknowledgedAt: null };
    this.alerts.push(raised);
    return raised;
  }

  list(options: { readonly pending?: boolean } = {}): readonly Alert[] {
    const all = [...this.alerts].reverse();
    return options.pending === true ? all.filter((alert) => alert.acknowledgedAt === null) : all;
  }

  acknowledge(id: number): void {
    const index = this.alerts.findIndex((alert) => alert.id === id);
    const found = this.alerts[index];
    if (found !== undefined) this.alerts[index] = { ...found, acknowledgedAt: Date.now() };
  }

  close(): void {}
}
