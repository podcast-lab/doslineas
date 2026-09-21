import type { Job, JobState, NewJob, SessionStatus, StepName } from "./jobs.js";

export interface JobFilter {
  readonly studio?: string;
  readonly session?: string;
  readonly state?: JobState;
}

export interface JobQueue {
  enqueue(jobs: readonly NewJob[]): readonly Job[];
  lease(owner: string, leaseMs: number): Job | null;
  heartbeat(id: number, owner: string, leaseMs: number): void;
  complete(id: number, owner: string, note?: string): void;
  skip(id: number, owner: string, note: string): void;
  fail(id: number, owner: string, error: string): Job;
  retry(studio: string, session: string, step?: StepName): number;
  reclaimExpired(): readonly Job[];
  job(id: number): Job | null;
  jobs(filter?: JobFilter): readonly Job[];
  sessions(studio?: string): readonly SessionStatus[];
  session(studio: string, session: string): SessionStatus | null;
  knownSessions(): readonly string[];
  close(): void;
}
