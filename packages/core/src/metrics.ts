import type { Edl } from "./edl.js";
import { outputDuration } from "./edl.js";

export interface EditMetrics {
  readonly durationSeconds: number;
  readonly cuts: number;
  readonly cutsPerMinute: number;
  readonly medianShot: number;
  readonly shotP10: number;
  readonly shotP90: number;
  readonly countByReason: Record<string, number>;
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const a = sorted[lower] ?? 0;
  const b = sorted[upper] ?? a;
  return a + (b - a) * (position - lower);
}

export function measureEdit(edl: Edl): EditMetrics {
  const durations = edl.segments.map((s) => s.dur);
  const durationSeconds = outputDuration(edl);
  const cuts = Math.max(0, edl.segments.length - 1);
  const countByReason: Record<string, number> = {};
  for (const segment of edl.segments) {
    countByReason[segment.reason] = (countByReason[segment.reason] ?? 0) + 1;
  }

  return {
    durationSeconds,
    cuts,
    cutsPerMinute: durationSeconds > 0 ? (cuts / durationSeconds) * 60 : 0,
    medianShot: percentile(durations, 0.5),
    shotP10: percentile(durations, 0.1),
    shotP90: percentile(durations, 0.9),
    countByReason
  };
}
