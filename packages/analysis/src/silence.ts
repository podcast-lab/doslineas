import type { Discard, EditProfile } from "@doslineas/core";
import type { Envelope } from "./envelope.js";
import { secondsAt } from "./envelope.js";

export interface SilenceInterval {
  readonly start: number;
  readonly end: number;
}

export function detectSilences(envelope: Envelope, profile: EditProfile): SilenceInterval[] {
  const intervals: SilenceInterval[] = [];
  let runStart: number | null = null;

  const closeRun = (endWindow: number): void => {
    if (runStart === null) return;
    const start = secondsAt(envelope, runStart);
    const end = secondsAt(envelope, endWindow);
    if (end - start >= profile.silence.thresholdSeconds) intervals.push({ start, end });
    runStart = null;
  };

  for (let window = 0; window < envelope.db.length; window += 1) {
    const quiet = (envelope.db[window] ?? 0) <= profile.silence.thresholdDb;
    if (quiet && runStart === null) runStart = window;
    if (!quiet) closeRun(window);
  }
  closeRun(envelope.db.length);

  return intervals;
}

export function silencesToDiscards(silences: readonly SilenceInterval[], profile: EditProfile): Discard[] {
  const discards: Discard[] = [];

  for (const silence of silences) {
    const start = silence.start + profile.silence.paddingSeconds;
    const end = silence.end - profile.silence.paddingSeconds;
    if (end - start <= 0) continue;
    discards.push({ tIn: start, tEnd: end, reason: "silence" });
  }

  return discards;
}
