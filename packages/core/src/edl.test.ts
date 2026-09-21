import { describe, expect, it } from "vitest";
import type { Edl, Segment } from "./edl.js";
import { outputDuration, parseEdl, validateEdl } from "./edl.js";
import { measureEdit } from "./metrics.js";

function edlOf(segments: readonly Segment[]): Edl {
  return {
    version: 1,
    session: "2026-08-20-test",
    fps: 25,
    profile: "podcast-v1",
    sources: [
      { input: 1, role: "wide", video: "iso1.mp4", audio: null, durationSeconds: 600 },
      { input: 2, role: "speaker1", video: "iso2.mp4", audio: "iso2.wav", durationSeconds: 600 },
      { input: 3, role: "speaker2", video: "iso3.mp4", audio: "iso3.wav", durationSeconds: 600 }
    ],
    segments: [...segments],
    discards: [],
    audio: { source: "program", gains: {} }
  };
}

const healthyEdit: Segment[] = [
  { tOut: 0, dur: 4, input: 2, tIn: 10, reason: "initial" },
  { tOut: 4, dur: 5, input: 3, tIn: 14, reason: "turn" },
  { tOut: 9, dur: 3, input: 1, tIn: 19, reason: "refresh" }
];

describe("EDL", () => {
  it("accepts a contiguous, well formed edit", () => {
    expect(validateEdl(edlOf(healthyEdit))).toEqual([]);
    expect(outputDuration(edlOf(healthyEdit))).toBe(12);
  });

  it("catches a gap in the output timeline", () => {
    const withGap = [...healthyEdit.slice(0, 2), { ...healthyEdit[2]!, tOut: 9.5 }];
    const problems = validateEdl(edlOf(withGap));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toContain("segment 2");
  });

  it("catches an overlap in the output timeline", () => {
    const withOverlap = [...healthyEdit.slice(0, 2), { ...healthyEdit[2]!, tOut: 8 }];
    expect(validateEdl(edlOf(withOverlap))).toHaveLength(1);
  });

  it("catches a segment pointing at an input that is not in sources", () => {
    const withGhostInput = [{ ...healthyEdit[0]!, input: 4 as const }, ...healthyEdit.slice(1)];
    const problems = validateEdl(edlOf(withGhostInput));
    expect(problems.some((p) => p.message.includes("not in sources"))).toBe(true);
  });

  it("catches a segment reading past the end of its source", () => {
    const outOfRange = [{ ...healthyEdit[0]!, tIn: 599 }, ...healthyEdit.slice(1)];
    const problems = validateEdl(edlOf(outOfRange));
    expect(problems.some((p) => p.message.includes("reads up to"))).toBe(true);
  });

  it("catches overlapping discards", () => {
    const edl: Edl = {
      ...edlOf(healthyEdit),
      discards: [
        { tIn: 5, tEnd: 7, reason: "silence" },
        { tIn: 6, tEnd: 9, reason: "silence" }
      ]
    };
    expect(validateEdl(edl).some((p) => p.message.includes("overlaps"))).toBe(true);
  });

  it("parseEdl rejects an inconsistent EDL even when the schema fits", () => {
    const withGap = [...healthyEdit.slice(0, 2), { ...healthyEdit[2]!, tOut: 9.5 }];
    expect(() => parseEdl(edlOf(withGap))).toThrow(/inconsistent EDL/);
  });
});

describe("edit metrics", () => {
  it("measures cuts per minute and shot length the way annex A does", () => {
    const metrics = measureEdit(edlOf(healthyEdit));
    expect(metrics.cuts).toBe(2);
    expect(metrics.durationSeconds).toBe(12);
    expect(metrics.cutsPerMinute).toBeCloseTo(10, 5);
    expect(metrics.medianShot).toBe(4);
    expect(metrics.countByReason).toEqual({ initial: 1, turn: 1, refresh: 1 });
  });

  it("does not divide by zero on an empty EDL", () => {
    const metrics = measureEdit(edlOf([]));
    expect(metrics.cutsPerMinute).toBe(0);
    expect(metrics.medianShot).toBe(0);
  });
});
