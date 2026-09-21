import type { Discard, CutReason } from "./edl.js";
import type { EditProfile, Input } from "./profile.js";

export interface SpeechInterval {
  readonly input: Input;
  readonly start: number;
  readonly end: number;
}

export interface CutCandidate {
  readonly t: number;
  readonly input: Input;
  readonly reason: CutReason;
  readonly priority: number;
}

export const PRIORITY = {
  initial: 4,
  forced: 3,
  turn: 2,
  refresh: 1
} as const;

export interface Cast {
  readonly wide: Input;
  readonly people: readonly Input[];
}

export function outputLength(from: number, to: number, discards: readonly Discard[]): number {
  const removed = discards.reduce((total, discard) => {
    const start = Math.max(from, discard.tIn);
    const end = Math.min(to, discard.tEnd);
    return total + Math.max(0, end - start);
  }, 0);
  return Math.max(0, to - from - removed);
}

export function turnCuts(speech: readonly SpeechInterval[]): CutCandidate[] {
  return speech.map((interval) => ({
    t: interval.start,
    input: interval.input,
    reason: "turn" as const,
    priority: PRIORITY.turn
  }));
}

export function refreshCuts(
  speech: readonly SpeechInterval[],
  profile: EditProfile,
  cast: Cast,
  discards: readonly Discard[]
): CutCandidate[] {
  const cuts: CutCandidate[] = [];
  let preferenceIndex = 0;

  for (const interval of speech) {
    let t = interval.start;

    while (true) {
      const away = t + profile.refresh.afterSeconds;
      const back = away + profile.refresh.minHoldSeconds;
      if (outputLength(back, interval.end, discards) < profile.shot.minSeconds) break;

      const preference = profile.refresh.preference[preferenceIndex % profile.refresh.preference.length] ?? "wide";
      preferenceIndex += 1;
      const listener = cast.people.find((input) => input !== interval.input);
      const destination = preference === "listening" ? listener ?? cast.wide : cast.wide;

      cuts.push({ t: away, input: destination, reason: "refresh", priority: PRIORITY.refresh });
      cuts.push({ t: back, input: interval.input, reason: "refresh", priority: PRIORITY.refresh });
      t = back;
    }
  }

  return cuts;
}

export function gapCuts(
  speech: readonly SpeechInterval[],
  profile: EditProfile,
  cast: Cast,
  discards: readonly Discard[],
  durationSeconds: number
): CutCandidate[] {
  const cuts: CutCandidate[] = [];
  let previousEnd = 0;

  for (const interval of [...speech, { input: cast.wide, start: durationSeconds, end: durationSeconds }]) {
    if (outputLength(previousEnd, interval.start, discards) >= profile.shot.minSeconds && previousEnd > 0) {
      cuts.push({ t: previousEnd, input: cast.wide, reason: "refresh", priority: PRIORITY.turn });
    }
    previousEnd = Math.max(previousEnd, interval.end);
  }

  return cuts;
}

export function openingCut(
  speech: readonly SpeechInterval[],
  profile: EditProfile,
  cast: Cast,
  discards: readonly Discard[]
): CutCandidate {
  const first = speech[0];
  const startsTalking = first !== undefined && outputLength(0, first.start, discards) < profile.shot.minSeconds;
  return {
    t: 0,
    input: startsTalking ? first.input : cast.wide,
    reason: "initial",
    priority: PRIORITY.initial
  };
}

export interface Overlap {
  readonly start: number;
  readonly end: number;
}

function speakingAt(speech: readonly SpeechInterval[], seconds: number): Input | null {
  const found = speech.find((interval) => seconds >= interval.start && seconds < interval.end);
  return found?.input ?? null;
}

export function turnsOf(speech: readonly SpeechInterval[], minSeconds: number): SpeechInterval[] {
  const runs: SpeechInterval[] = [];

  for (const interval of speech) {
    const previous = runs.at(-1);
    if (previous !== undefined && previous.input === interval.input) {
      runs[runs.length - 1] = { input: previous.input, start: previous.start, end: interval.end };
      continue;
    }
    runs.push(interval);
  }

  const long = runs.filter((run) => run.end - run.start >= minSeconds);
  const merged: SpeechInterval[] = [];

  for (const run of long) {
    const previous = merged.at(-1);
    if (previous !== undefined && previous.input === run.input) {
      merged[merged.length - 1] = { input: previous.input, start: previous.start, end: run.end };
      continue;
    }
    merged.push(run);
  }

  return merged;
}

export function speakerCuts(
  speech: readonly SpeechInterval[],
  overlaps: readonly Overlap[],
  cast: Cast,
  minShotSeconds: number,
  withoutWide: readonly Overlap[] = []
): CutCandidate[] {
  const turns = turnsOf(speech, minShotSeconds);
  const cuts: CutCandidate[] = [
    ...turns.map((interval) => ({
      t: interval.start,
      input: interval.input,
      reason: "turn" as const,
      priority: PRIORITY.turn
    }))
  ];

  for (const overlap of overlaps) {
    const muted = withoutWide.some((span) => overlap.start >= span.start && overlap.start < span.end);
    if (muted) continue;
    cuts.push({ t: overlap.start, input: cast.wide, reason: "forced", priority: PRIORITY.forced });
    const back = speakingAt(turns, overlap.end);
    if (back !== null) cuts.push({ t: overlap.end, input: back, reason: "turn", priority: PRIORITY.turn });
  }

  const first = turns[0];
  cuts.push({
    t: 0,
    input: first?.input ?? cast.wide,
    reason: "initial",
    priority: PRIORITY.initial
  });

  return cuts;
}
