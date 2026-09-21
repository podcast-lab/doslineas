export const STEP_NAMES = ["edit", "brand", "transcribe", "captions", "clips", "explainer", "deliver"] as const;
export type StepName = (typeof STEP_NAMES)[number];

export const JOB_STATES = ["pending", "leased", "done", "skipped", "failed"] as const;
export type JobState = (typeof JOB_STATES)[number];

export const TERMINAL_STATES: readonly JobState[] = ["done", "skipped"];

export interface Job {
  readonly id: number;
  readonly studio: string;
  readonly session: string;
  readonly directory: string;
  readonly step: StepName;
  readonly position: number;
  readonly state: JobState;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly owner: string | null;
  readonly leaseExpiresAt: number | null;
  readonly note: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

export interface NewJob {
  readonly studio: string;
  readonly session: string;
  readonly directory: string;
  readonly step: StepName;
  readonly position: number;
  readonly maxAttempts: number;
}

export interface SessionStatus {
  readonly studio: string;
  readonly session: string;
  readonly directory: string;
  readonly state: "waiting" | "running" | "delivered" | "failed";
  readonly steps: readonly Job[];
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

export function sessionState(steps: readonly Job[]): SessionStatus["state"] {
  if (steps.some((job) => job.state === "failed")) return "failed";
  if (steps.some((job) => job.state === "leased")) return "running";
  if (steps.every((job) => TERMINAL_STATES.includes(job.state))) return "delivered";
  if (steps.some((job) => TERMINAL_STATES.includes(job.state))) return "running";
  return "waiting";
}

export function toSessionStatus(steps: readonly Job[]): SessionStatus {
  const first = steps[0];
  if (first === undefined) throw new Error("a session status needs at least one step");

  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const started = ordered.map((job) => job.startedAt).filter((at): at is number => at !== null);
  const finished = ordered.every((job) => TERMINAL_STATES.includes(job.state))
    ? ordered.map((job) => job.finishedAt).filter((at): at is number => at !== null)
    : [];

  return {
    studio: first.studio,
    session: first.session,
    directory: first.directory,
    state: sessionState(ordered),
    steps: ordered,
    startedAt: started.length === 0 ? null : Math.min(...started),
    finishedAt: finished.length === 0 ? null : Math.max(...finished)
  };
}
