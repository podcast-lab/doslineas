import type { CutCandidate, Cast } from "./cut-generators.js";
import { PRIORITY, outputLength } from "./cut-generators.js";
import type { Discard, Segment } from "./edl.js";
import type { EditProfile, SwitchingMode } from "./profile.js";

export interface SolveOptions {
  readonly profile: EditProfile;
  readonly discards: readonly Discard[];
  readonly durationSeconds: number;
  readonly cast: Cast;
  readonly mode?: SwitchingMode;
}

export function advanceByOutput(from: number, amount: number, discards: readonly Discard[]): number {
  let t = from;
  let remaining = amount;

  for (const discard of discards) {
    if (discard.tEnd <= t) continue;
    const gap = Math.max(0, discard.tIn - t);
    if (gap >= remaining) return t + remaining;
    remaining -= gap;
    t = discard.tEnd;
  }

  return t + remaining;
}

function byTimeThenPriority(a: CutCandidate, b: CutCandidate): number {
  return a.t === b.t ? b.priority - a.priority : a.t - b.t;
}

function dropSimultaneous(cuts: readonly CutCandidate[]): CutCandidate[] {
  const kept: CutCandidate[] = [];
  for (const cut of cuts) {
    const previous = kept.at(-1);
    if (previous !== undefined && Math.abs(previous.t - cut.t) < 1e-6) continue;
    kept.push(cut);
  }
  return kept;
}

function dropRepeatedInput(cuts: readonly CutCandidate[]): CutCandidate[] {
  const kept: CutCandidate[] = [];
  for (const cut of cuts) {
    const previous = kept.at(-1);
    if (previous !== undefined && previous.input === cut.input) continue;
    kept.push(cut);
  }
  return kept;
}

function enforceMinimumShot(cuts: readonly CutCandidate[], options: SolveOptions): CutCandidate[] {
  const kept: CutCandidate[] = [];

  for (const cut of cuts) {
    const previous = kept.at(-1);
    if (previous === undefined) {
      kept.push(cut);
      continue;
    }

    if (outputLength(previous.t, cut.t, options.discards) >= options.profile.shot.minSeconds) {
      kept.push(cut);
      continue;
    }

    if (cut.priority > previous.priority && kept.length > 1) {
      kept.pop();
      kept.push(cut);
    }
  }

  return kept;
}

function enforceMaximumShot(cuts: readonly CutCandidate[], options: SolveOptions): CutCandidate[] {
  const { profile, discards, durationSeconds, cast } = options;
  const filled: CutCandidate[] = [];
  let alternate = 0;

  for (let index = 0; index < cuts.length; index += 1) {
    const cut = cuts[index]!;
    filled.push(cut);

    const nextT = cuts[index + 1]?.t ?? durationSeconds;
    let from = cut.t;

    let previousInput = cut.input;

    while (outputLength(from, nextT, discards) > profile.shot.maxSeconds) {
      const at = advanceByOutput(from, profile.shot.targetSeconds, discards);
      if (at >= nextT || outputLength(at, nextT, discards) < profile.shot.minSeconds) break;

      const choices = [cast.wide, ...cast.people].filter((input) => input !== previousInput);
      const destination = choices[alternate % Math.max(1, choices.length)] ?? cast.wide;
      alternate += 1;
      filled.push({ t: at, input: destination, reason: "forced", priority: PRIORITY.forced });
      previousInput = destination;
      from = at;
    }
  }

  return filled.sort(byTimeThenPriority);
}

function cutsPerMinute(cuts: readonly CutCandidate[], options: SolveOptions): number {
  const duration = outputLength(0, options.durationSeconds, options.discards);
  if (duration <= 0) return 0;
  return (Math.max(0, cuts.length - 1) / duration) * 60;
}

function respectsMaximum(cuts: readonly CutCandidate[], options: SolveOptions): boolean {
  for (let index = 0; index < cuts.length; index += 1) {
    const nextT = cuts[index + 1]?.t ?? options.durationSeconds;
    if (outputLength(cuts[index]!.t, nextT, options.discards) > options.profile.shot.maxSeconds + 1e-6) return false;
  }
  return true;
}

function thinToTargetDensity(cuts: readonly CutCandidate[], options: SolveOptions): CutCandidate[] {
  const { profile, discards, durationSeconds } = options;
  const ceiling = profile.cuts.perMinuteTarget + profile.cuts.perMinuteTolerance;
  const blocked = new Set<number>();
  let kept = [...cuts];

  while (cutsPerMinute(kept, options) > ceiling) {
    let victim = -1;
    let shortest = Infinity;

    for (let index = 1; index < kept.length; index += 1) {
      const cut = kept[index]!;
      if (cut.reason !== "refresh" || blocked.has(cut.t)) continue;

      const nextT = kept[index + 1]?.t ?? durationSeconds;
      const length = outputLength(cut.t, nextT, discards);
      if (length < shortest) {
        shortest = length;
        victim = index;
      }
    }

    if (victim < 0) break;

    const attempt = dropRepeatedInput(kept.filter((_, index) => index !== victim));
    if (respectsMaximum(attempt, options)) kept = attempt;
    else blocked.add(kept[victim]!.t);
  }

  return kept;
}

export function solveCuts(candidates: readonly CutCandidate[], options: SolveOptions): CutCandidate[] {
  const ordered = dropSimultaneous([...candidates].sort(byTimeThenPriority));
  const distinct = dropRepeatedInput(ordered);

  if (options.mode === "speaker") {
    return dropRepeatedInput(enforceMinimumShot(distinct, options));
  }

  const withMinimum = enforceMinimumShot(distinct, options);
  const withMaximum = enforceMaximumShot(withMinimum, options);
  const settled = enforceMinimumShot(dropRepeatedInput(withMaximum), options);
  const filled = enforceMaximumShot(settled, options);
  return thinToTargetDensity(dropRepeatedInput(filled), options);
}

export function cutsToSegments(cuts: readonly CutCandidate[], options: SolveOptions): Segment[] {
  const segments: Segment[] = [];
  let tOut = 0;

  for (let index = 0; index < cuts.length; index += 1) {
    const cut = cuts[index]!;
    const nextT = cuts[index + 1]?.t ?? options.durationSeconds;
    const dur = outputLength(cut.t, nextT, options.discards);
    if (dur <= 0) continue;
    segments.push({ tOut, dur, input: cut.input, tIn: cut.t, reason: cut.reason });
    tOut += dur;
  }

  return segments;
}
