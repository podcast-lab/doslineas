import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EditProfile, Input } from "@doslineas/core";
import { parseProfile } from "@doslineas/core";
import type { Envelope } from "./envelope.js";
import { detectOverlaps } from "./speech.js";

const profile: EditProfile = parseProfile(JSON.parse(readFileSync(resolve("config/edit-profile.json"), "utf8")));
const WINDOW_MS = profile.voice.windowMs;
const PER_SECOND = 1000 / WINDOW_MS;

function envelope(levels: readonly (readonly [number, number])[]): Envelope {
  const db: number[] = [];
  for (const [seconds, level] of levels) {
    for (let window = 0; window < Math.round(seconds * PER_SECOND); window += 1) db.push(level);
  }
  return { windowMs: WINDOW_MS, sampleRate: 48_000, db: Float32Array.from(db) };
}

const QUIET = -60;
const LOUD = -20;

function envelopes(one: Envelope, two: Envelope): Map<Input, Envelope> {
  return new Map<Input, Envelope>([
    [1, one],
    [2, two]
  ]);
}

describe("hearing both people talk at once", () => {
  it("finds nothing while they take turns", () => {
    const overlaps = detectOverlaps(
      envelopes(
        envelope([
          [10, LOUD],
          [10, QUIET]
        ]),
        envelope([
          [10, QUIET],
          [10, LOUD]
        ])
      ),
      profile,
      [1, 2]
    );

    expect(overlaps).toEqual([]);
  });

  it("marks the stretch where both are loud at the same time", () => {
    const overlaps = detectOverlaps(
      envelopes(
        envelope([
          [5, LOUD],
          [10, LOUD],
          [5, QUIET]
        ]),
        envelope([
          [5, QUIET],
          [10, LOUD],
          [5, QUIET]
        ])
      ),
      profile,
      [1, 2]
    );

    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]?.start).toBeCloseTo(5, 1);
    expect(overlaps[0]?.end).toBeCloseTo(15, 1);
  });

  it("ignores a crossing shorter than the hysteresis asks for", () => {
    const overlaps = detectOverlaps(
      envelopes(
        envelope([
          [10, LOUD],
          [0.1, LOUD],
          [5, QUIET]
        ]),
        envelope([
          [10, QUIET],
          [0.1, LOUD],
          [5, LOUD]
        ])
      ),
      profile,
      [1, 2]
    );

    expect(overlaps).toEqual([]);
  });

  it("is not fooled by two mics with very different gain", () => {
    const overlaps = detectOverlaps(
      envelopes(
        envelope([
          [5, -55],
          [50, -36],
          [5, -55]
        ]),
        envelope([
          [5, -75],
          [50, -51],
          [5, -75]
        ])
      ),
      profile,
      [1, 2]
    );

    expect(overlaps).toEqual([]);
  });

  it("stays silent when only one input is tracked", () => {
    expect(detectOverlaps(new Map([[1, envelope([[10, LOUD]])]]), profile, [1])).toEqual([]);
  });
});
