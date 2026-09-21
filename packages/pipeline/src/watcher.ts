import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { findSessionDirectories, inspectSession } from "@doslineas/media";
import type { AlertStore } from "./alerts.js";
import type { JobQueue } from "./queue.js";
import { plannedJobs } from "./steps.js";

export interface Candidate {
  readonly session: string;
  readonly directory: string;
  readonly quiet: boolean;
  readonly ready: boolean;
  readonly lastChangeAt: number;
  readonly problems: readonly string[];
}

export interface ScanOptions {
  readonly root: string;
  readonly quietSeconds: number;
  readonly skip?: ReadonlySet<string>;
  readonly now?: () => number;
}

async function newestChange(directories: readonly string[]): Promise<number> {
  let newest = 0;

  for (const directory of directories) {
    let names: readonly string[];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }

    for (const name of names) {
      try {
        newest = Math.max(newest, (await stat(join(directory, name))).mtimeMs);
      } catch {
        continue;
      }
    }
  }

  return newest;
}

export async function scanRoot(options: ScanOptions): Promise<readonly Candidate[]> {
  const now = (options.now ?? Date.now)();
  const skip = options.skip ?? new Set<string>();
  const entries = await readdir(options.root, { withFileTypes: true });
  const candidates: Candidate[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const found = await findSessionDirectories(join(options.root, entry.name));
    const directory = found[0];
    if (directory === undefined || skip.has(directory)) continue;

    const lastChangeAt = await newestChange(found);
    const quiet = now - lastChangeAt >= options.quietSeconds * 1000;
    if (!quiet) {
      candidates.push({ session: entry.name, directory, quiet: false, ready: false, lastChangeAt, problems: [] });
      continue;
    }

    if (found.length > 1) {
      const names = found.map((path) => basename(path)).join(", ");
      candidates.push({
        session: entry.name,
        directory,
        quiet: true,
        ready: false,
        lastChangeAt,
        problems: [`${entry.name} holds ${found.length} recordings (${names}); one session per directory`]
      });
      continue;
    }

    const inspection = await inspectSession(directory);
    candidates.push({
      session: entry.name,
      directory,
      quiet: true,
      ready: inspection.problems.length === 0,
      lastChangeAt,
      problems: inspection.problems
    });
  }

  return candidates.sort((a, b) => a.lastChangeAt - b.lastChangeAt);
}

export interface WatcherOptions {
  readonly root: string;
  readonly studio: string;
  readonly quietSeconds: number;
  readonly maxAttempts: number;
  readonly now?: () => number;
}

export interface WatchRound {
  readonly accepted: readonly Candidate[];
  readonly incomplete: readonly Candidate[];
  readonly settling: readonly Candidate[];
}

export class FolderWatcher {
  constructor(
    private readonly queue: JobQueue,
    private readonly alerts: AlertStore,
    private readonly options: WatcherOptions
  ) {}

  async round(): Promise<WatchRound> {
    const candidates = await scanRoot({
      root: this.options.root,
      quietSeconds: this.options.quietSeconds,
      skip: new Set(this.queue.knownSessions()),
      ...(this.options.now === undefined ? {} : { now: this.options.now })
    });

    const accepted: Candidate[] = [];
    const incomplete: Candidate[] = [];
    const settling: Candidate[] = [];

    for (const candidate of candidates) {
      if (!candidate.quiet) {
        settling.push(candidate);
        continue;
      }

      if (!candidate.ready) {
        incomplete.push(candidate);
        this.alerts.raise({
          studio: this.options.studio,
          session: candidate.session,
          kind: "incomplete-session",
          message: `${candidate.session} stopped changing but is not complete: ${candidate.problems.join("; ")}`
        });
        continue;
      }

      this.queue.enqueue(
        plannedJobs(this.options.studio, candidate.session, candidate.directory, this.options.maxAttempts)
      );
      accepted.push(candidate);
    }

    return { accepted, incomplete, settling };
  }
}
