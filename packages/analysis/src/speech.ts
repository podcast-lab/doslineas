import type { EditProfile, Input, SpeechInterval } from "@doslineas/core";
import type { Envelope } from "./envelope.js";
import { noiseFloorDb, secondsAt, windowsPerSecond } from "./envelope.js";

export type { SpeechInterval };

export interface SpeechAnalysis {
  readonly intervals: readonly SpeechInterval[];
  readonly noiseFloorDb: ReadonlyMap<Input, number>;
}

interface OpenInterval {
  input: Input;
  startWindow: number;
}

export function dominantInput(
  levels: ReadonlyMap<Input, number>,
  floors: ReadonlyMap<Input, number>,
  dominanceMarginDb: number,
  aboveNoiseMarginDb: number
): Input | null {
  let best: Input | null = null;
  let bestLevel = -Infinity;
  let runnerUpLevel = -Infinity;

  for (const [input, level] of levels) {
    if (level > bestLevel) {
      runnerUpLevel = bestLevel;
      bestLevel = level;
      best = input;
    } else if (level > runnerUpLevel) {
      runnerUpLevel = level;
    }
  }

  if (best === null) return null;
  const floor = floors.get(best) ?? -Infinity;
  if (bestLevel - floor < aboveNoiseMarginDb) return null;
  if (Number.isFinite(runnerUpLevel) && bestLevel - runnerUpLevel < dominanceMarginDb) return null;
  return best;
}

export function detectSpeech(
  envelopes: ReadonlyMap<Input, Envelope>,
  profile: EditProfile,
  inputs: readonly Input[]
): SpeechAnalysis {
  const tracked = inputs.filter((input) => envelopes.has(input));
  const reference = envelopes.get(tracked[0] ?? -1 as Input);
  if (tracked.length === 0 || reference === undefined) {
    return { intervals: [], noiseFloorDb: new Map() };
  }

  const floors = new Map<Input, number>(
    tracked.map((input) => [input, noiseFloorDb(envelopes.get(input)!, profile.voice.calibrationSeconds)])
  );
  const windows = Math.min(...tracked.map((input) => envelopes.get(input)!.db.length));
  const perSecond = windowsPerSecond(reference);
  const openWindows = Math.max(1, Math.round((profile.voice.openHysteresisMs / 1000) * perSecond));
  const closeWindows = Math.max(1, Math.round((profile.voice.closeHysteresisMs / 1000) * perSecond));

  const intervals: SpeechInterval[] = [];
  let open: OpenInterval | null = null;
  let pending: Input | null = null;
  let pendingRun = 0;
  let quietRun = 0;

  const close = (endWindow: number): void => {
    if (open === null) return;
    const start = secondsAt(reference, open.startWindow);
    const end = secondsAt(reference, endWindow);
    if (end > start) intervals.push({ input: open.input, start, end });
    open = null;
  };

  for (let window = 0; window < windows; window += 1) {
    const levels = new Map<Input, number>(tracked.map((input) => [input, envelopes.get(input)!.db[window] ?? -Infinity]));
    const candidate = dominantInput(levels, floors, profile.voice.dominanceMarginDb, profile.voice.aboveNoiseMarginDb);

    if (candidate !== null && open !== null && candidate === open.input) {
      quietRun = 0;
      pending = null;
      pendingRun = 0;
      continue;
    }

    if (candidate === null) {
      pending = null;
      pendingRun = 0;
      if (open !== null) {
        quietRun += 1;
        if (quietRun >= closeWindows) close(window - quietRun + 1);
      }
      continue;
    }

    pendingRun = pending === candidate ? pendingRun + 1 : 1;
    pending = candidate;

    if (pendingRun >= openWindows) {
      const startWindow = window - pendingRun + 1;
      close(startWindow);
      open = { input: candidate, startWindow };
      pending = null;
      pendingRun = 0;
      quietRun = 0;
    }
  }

  close(windows - quietRun);

  return { intervals, noiseFloorDb: floors };
}

export function speakerAt(intervals: readonly SpeechInterval[], seconds: number): Input | null {
  const found = intervals.find((interval) => seconds >= interval.start && seconds < interval.end);
  return found?.input ?? null;
}

export interface OverlapInterval {
  readonly start: number;
  readonly end: number;
}

export function detectOverlaps(
  envelopes: ReadonlyMap<Input, Envelope>,
  profile: EditProfile,
  inputs: readonly Input[]
): OverlapInterval[] {
  const tracked = inputs.filter((input) => envelopes.has(input));
  const reference = envelopes.get(tracked[0] ?? (-1 as Input));
  if (tracked.length < 2 || reference === undefined) return [];

  const floors = new Map<Input, number>(
    tracked.map((input) => [input, noiseFloorDb(envelopes.get(input)!, profile.voice.calibrationSeconds)])
  );
  const windows = Math.min(...tracked.map((input) => envelopes.get(input)!.db.length));
  const perSecond = windowsPerSecond(reference);
  const openWindows = Math.max(1, Math.round((profile.voice.openHysteresisMs / 1000) * perSecond));
  const closeWindows = Math.max(1, Math.round((profile.voice.closeHysteresisMs / 1000) * perSecond));

  const intervals: OverlapInterval[] = [];
  let startWindow: number | null = null;
  let busyRun = 0;
  let quietRun = 0;

  for (let window = 0; window < windows; window += 1) {
    const heard = tracked
      .map((input) => envelopes.get(input)!.db[window] ?? -Infinity)
      .filter((level, index) => level - (floors.get(tracked[index] as Input) ?? -Infinity) >= profile.voice.aboveNoiseMarginDb)
      .sort((a, b) => b - a);

    const together = heard.length >= 2 && (heard[0] as number) - (heard[1] as number) < profile.voice.dominanceMarginDb;

    if (together) {
      quietRun = 0;
      busyRun += 1;
      if (busyRun >= openWindows && startWindow === null) startWindow = window - busyRun + 1;
      continue;
    }

    busyRun = 0;
    if (startWindow === null) continue;

    quietRun += 1;
    if (quietRun < closeWindows) continue;

    const start = secondsAt(reference, startWindow);
    const end = secondsAt(reference, window - quietRun + 1);
    if (end > start) intervals.push({ start, end });
    startWindow = null;
    quietRun = 0;
  }

  if (startWindow !== null) {
    const start = secondsAt(reference, startWindow);
    const end = secondsAt(reference, windows - quietRun);
    if (end > start) intervals.push({ start, end });
  }

  return intervals;
}
