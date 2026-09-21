import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SpeechInterval } from "./cut-generators.js";
import type { Discard, Source } from "./edl.js";
import type { EditProfile, Input } from "./profile.js";
import { parseProfile } from "./profile.js";
import { buildEdl } from "./edit-engine.js";
import { measureEdit } from "./metrics.js";

const profilePath = fileURLToPath(new URL("../../../config/edit-profile.json", import.meta.url));
const profile: EditProfile = parseProfile({
  ...JSON.parse(readFileSync(profilePath, "utf8")),
  inputs: { "1": "wide", "2": "speaker1", "3": "speaker2", "4": "variable" }
});

const SOURCES: Source[] = ([1, 2, 3, 4] as Input[]).map((input) => ({
  input,
  role: input === 1 ? "wide" : input === 2 ? "speaker1" : input === 3 ? "speaker2" : "screen",
  video: `iso${input}.mp4`,
  audio: input === 1 ? "program.mp4" : null,
  durationSeconds: 120
}));

const SPEECH: SpeechInterval[] = [
  { input: 2, start: 1.5, end: 13.5 },
  { input: 3, start: 13.9, end: 17.9 },
  { input: 2, start: 19.7, end: 44.7 },
  { input: 3, start: 45.0, end: 52.0 },
  { input: 2, start: 54.4, end: 57.4 },
  { input: 3, start: 57.9, end: 75.9 },
  { input: 2, start: 76.3, end: 85.3 },
  { input: 3, start: 87.7, end: 119.0 }
];

const DISCARDS: Discard[] = [
  { tIn: 0.3, tEnd: 1.2, reason: "silence" },
  { tIn: 18.2, tEnd: 19.4, reason: "silence" },
  { tIn: 52.3, tEnd: 54.1, reason: "silence" },
  { tIn: 85.6, tEnd: 87.4, reason: "silence" }
];

describe("golden EDL", () => {
  const edl = buildEdl({
    session: "golden",
    fps: 25,
    profile,
    sources: SOURCES,
    speech: SPEECH,
    discards: DISCARDS,
    durationSeconds: 120,
    input4Role: "screen"
  });

  it("the edit does not move unless somebody moves it", () => {
    const shots = edl.segments.map((segment) => ({
      input: segment.input,
      reason: segment.reason,
      tIn: Number(segment.tIn.toFixed(2)),
      tOut: Number(segment.tOut.toFixed(2)),
      dur: Number(segment.dur.toFixed(2))
    }));
    expect(shots).toMatchSnapshot();
  });

  it("its measurements do not move either", () => {
    const metrics = measureEdit(edl);
    expect({
      cuts: metrics.cuts,
      cutsPerMinute: Number(metrics.cutsPerMinute.toFixed(2)),
      medianShot: Number(metrics.medianShot.toFixed(2)),
      shotP10: Number(metrics.shotP10.toFixed(2)),
      shotP90: Number(metrics.shotP90.toFixed(2)),
      durationSeconds: Number(metrics.durationSeconds.toFixed(2)),
      countByReason: metrics.countByReason
    }).toMatchSnapshot();
  });
});
