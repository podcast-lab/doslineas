import { resolve } from "node:path";

export interface PipelineConfig {
  readonly studio: string;
  readonly sessionsRoot: string;
  readonly deliveryRoot: string;
  readonly database: string;
  readonly repoRoot: string;
  readonly quietSeconds: number;
  readonly scanSeconds: number;
  readonly leaseMs: number;
  readonly heartbeatMs: number;
  readonly idleMs: number;
  readonly maxAttempts: number;
  readonly port: number;
  readonly transcriber: "deepgram" | "mock";
}

function number(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number, not ${raw}`);
  return value;
}

function text(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const raw = env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw.trim();
}

function transcriber(env: NodeJS.ProcessEnv): "deepgram" | "mock" {
  const raw = text(env, "DOSLINEAS_TRANSCRIBER", "deepgram");
  if (raw !== "deepgram" && raw !== "mock") throw new Error(`DOSLINEAS_TRANSCRIBER must be deepgram or mock, not ${raw}`);
  return raw;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): PipelineConfig {
  const repoRoot = resolve(text(env, "DOSLINEAS_REPO", process.cwd()));

  return {
    studio: text(env, "DOSLINEAS_STUDIO", "doslineas"),
    sessionsRoot: resolve(text(env, "DOSLINEAS_SESSIONS", resolve(repoRoot, "sessions"))),
    deliveryRoot: resolve(text(env, "DOSLINEAS_DELIVERY", resolve(repoRoot, "delivered"))),
    database: resolve(text(env, "DOSLINEAS_DB", resolve(repoRoot, "state", "jobs.db"))),
    repoRoot,
    quietSeconds: number(env, "DOSLINEAS_QUIET_SECONDS", 120),
    scanSeconds: number(env, "DOSLINEAS_SCAN_SECONDS", 30),
    leaseMs: number(env, "DOSLINEAS_LEASE_MINUTES", 5) * 60_000,
    heartbeatMs: number(env, "DOSLINEAS_HEARTBEAT_SECONDS", 60) * 1_000,
    idleMs: number(env, "DOSLINEAS_IDLE_SECONDS", 5) * 1_000,
    maxAttempts: number(env, "DOSLINEAS_MAX_ATTEMPTS", 2),
    port: number(env, "DOSLINEAS_PORT", 4310),
    transcriber: transcriber(env)
  };
}
