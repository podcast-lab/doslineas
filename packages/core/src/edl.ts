import { z } from "zod";
import { InputSchema, InputRoleSchema } from "./profile.js";

export const EPSILON_SECONDS = 1e-6;

export const CutReasonSchema = z.enum(["initial", "turn", "refresh", "forced"]);
export type CutReason = z.infer<typeof CutReasonSchema>;

export const DiscardReasonSchema = z.enum(["silence", "manual"]);
export type DiscardReason = z.infer<typeof DiscardReasonSchema>;

export const SourceSchema = z.object({
  input: InputSchema,
  role: InputRoleSchema,
  video: z.string().min(1),
  audio: z.string().min(1).nullable(),
  durationSeconds: z.number().positive()
});
export type Source = z.infer<typeof SourceSchema>;

export const SegmentSchema = z.object({
  tOut: z.number().nonnegative(),
  dur: z.number().positive(),
  input: InputSchema,
  tIn: z.number().nonnegative(),
  reason: CutReasonSchema
});
export type Segment = z.infer<typeof SegmentSchema>;

export const DiscardSchema = z.object({
  tIn: z.number().nonnegative(),
  tEnd: z.number().positive(),
  reason: DiscardReasonSchema
});
export type Discard = z.infer<typeof DiscardSchema>;

export function snapDiscards(discards: readonly Discard[], fps: number): Discard[] {
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`cannot snap discards to a grid of ${fps} fps`);
  const snapped: Discard[] = [];

  for (const discard of discards) {
    const first = Math.round(discard.tIn * fps);
    const last = Math.round(discard.tEnd * fps);
    if (last <= first) continue;
    snapped.push({ ...discard, tIn: first / fps, tEnd: last / fps });
  }

  return snapped;
}

export function mergeDiscards(discards: readonly Discard[]): Discard[] {
  const ordered = [...discards].sort((a, b) => a.tIn - b.tIn);
  const merged: Discard[] = [];

  for (const discard of ordered) {
    const previous = merged.at(-1);
    if (previous !== undefined && discard.tIn <= previous.tEnd) {
      merged[merged.length - 1] = { ...previous, tEnd: Math.max(previous.tEnd, discard.tEnd) };
      continue;
    }
    merged.push({ ...discard });
  }

  return merged;
}

export const EdlSchema = z.object({
  version: z.literal(1),
  session: z.string().min(1),
  fps: z.number().positive(),
  profile: z.string().min(1),
  sources: z.array(SourceSchema).min(1),
  segments: z.array(SegmentSchema),
  discards: z.array(DiscardSchema),
  audio: z.object({
    source: z.enum(["program", "mix"]),
    gains: z.record(z.string(), z.number())
  })
});
export type Edl = z.infer<typeof EdlSchema>;

export interface EdlProblem {
  readonly index: number | null;
  readonly message: string;
}

export function parseEdl(raw: unknown): Edl {
  const edl = EdlSchema.parse(raw);
  const problems = validateEdl(edl);
  if (problems.length > 0) {
    throw new Error(`inconsistent EDL:\n${problems.map((p) => `  - ${p.message}`).join("\n")}`);
  }
  return edl;
}

export function validateEdl(edl: Edl): EdlProblem[] {
  const problems: EdlProblem[] = [];
  const availableInputs = new Set(edl.sources.map((s) => s.input));
  const durationByInput = new Map(edl.sources.map((s) => [s.input, s.durationSeconds]));

  let expected = 0;
  edl.segments.forEach((segment, index) => {
    if (Math.abs(segment.tOut - expected) > EPSILON_SECONDS) {
      problems.push({
        index,
        message: `segment ${index}: starts at ${segment.tOut.toFixed(3)} s but the output timeline is at ${expected.toFixed(3)} s`
      });
    }
    if (!availableInputs.has(segment.input)) {
      problems.push({ index, message: `segment ${index}: uses input ${segment.input}, which is not in sources` });
    }
    const sourceDuration = durationByInput.get(segment.input);
    if (sourceDuration !== undefined && segment.tIn + segment.dur > sourceDuration + EPSILON_SECONDS) {
      problems.push({
        index,
        message: `segment ${index}: reads up to ${(segment.tIn + segment.dur).toFixed(3)} s of a ${sourceDuration.toFixed(3)} s source`
      });
    }
    expected = segment.tOut + segment.dur;
  });

  let previousEnd = -Infinity;
  edl.discards.forEach((discard, index) => {
    if (discard.tEnd <= discard.tIn) {
      problems.push({ index, message: `discard ${index}: tEnd (${discard.tEnd}) is not past tIn (${discard.tIn})` });
    }
    if (discard.tIn < previousEnd - EPSILON_SECONDS) {
      problems.push({ index, message: `discard ${index}: overlaps or is out of order against the previous one` });
    }
    previousEnd = discard.tEnd;
  });

  return problems;
}

export function outputDuration(edl: Edl): number {
  const last = edl.segments.at(-1);
  return last === undefined ? 0 : last.tOut + last.dur;
}

export function sourceFor(edl: Edl, input: Segment["input"]): Source | undefined {
  return edl.sources.find((s) => s.input === input);
}
