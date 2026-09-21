import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildEdl } from "./edit-engine.js";
import { mergeDiscards } from "./edl.js";
import { findIntroStart } from "./intro.js";
import { normaliseWord } from "./phrases.js";
import { parseProfile } from "./profile.js";
import type { EditProfile, Input, Source, Transcript } from "./index.js";

const base = parseProfile(JSON.parse(readFileSync(resolve("config/edit-profile.json"), "utf8")));
const profile: EditProfile = { ...base, switching: { mode: "speaker" } };

const sources: Source[] = ([1, 2, 3, 4] as Input[]).map((input) => ({
  input,
  role: input === 1 ? "speaker1" : input === 2 ? "speaker2" : input === 3 ? "wide" : "screen",
  video: `iso-${input}.mp4`,
  audio: null,
  durationSeconds: 120
}));

function edlOf(
  speech: readonly { input: Input; start: number; end: number }[],
  overlaps: readonly { start: number; end: number }[],
  screenSpans: readonly { start: number; end: number }[] = []
) {
  return buildEdl({
    session: "speaker-mode",
    fps: 25,
    profile,
    sources,
    speech,
    overlaps,
    screenSpans,
    discards: [],
    durationSeconds: 120,
    input4Role: "screen"
  });
}

describe("switching driven only by who is talking", () => {
  it("holds the camera of whoever is talking for as long as they talk", () => {
    const edl = edlOf(
      [
        { input: 1, start: 0, end: 40 },
        { input: 2, start: 40, end: 120 }
      ],
      []
    );

    expect(edl.segments.map((segment) => segment.input)).toEqual([1, 2]);
    expect(edl.segments[0]?.dur).toBeCloseTo(40, 3);
  });

  it("never shows the wide shot while a single person is talking", () => {
    const edl = edlOf([{ input: 1, start: 0, end: 120 }], []);
    expect(edl.segments.every((segment) => segment.input === 1)).toBe(true);
  });

  it("does not hand a long turn to a half-second blip of the other mic", () => {
    const edl = edlOf(
      [
        { input: 2, start: 0, end: 20 },
        { input: 1, start: 20, end: 20.5 },
        { input: 2, start: 20.5, end: 120 }
      ],
      []
    );

    expect(edl.segments.map((segment) => segment.input)).toEqual([2]);
  });

  it("keeps a turn together when the dominance flickers inside it", () => {
    const edl = edlOf(
      [
        { input: 1, start: 0, end: 30 },
        { input: 2, start: 30, end: 30.4 },
        { input: 1, start: 30.4, end: 60 },
        { input: 2, start: 60, end: 120 }
      ],
      []
    );

    expect(edl.segments.map((segment) => segment.input)).toEqual([1, 2]);
    expect(edl.segments[0]?.dur).toBeCloseTo(60, 3);
  });

  it("goes wide exactly while both talk at once, and comes back to whoever holds the floor", () => {
    const edl = edlOf(
      [
        { input: 1, start: 0, end: 30 },
        { input: 2, start: 50, end: 120 }
      ],
      [{ start: 30, end: 50 }]
    );

    expect(edl.segments.map((segment) => segment.input)).toEqual([1, 3, 2]);
    expect(edl.segments[1]?.tIn).toBeCloseTo(30, 3);
    expect(edl.segments[1]?.dur).toBeCloseTo(20, 3);
  });

  it("keeps the wide shot out while the slide is up, even when both talk at once", () => {
    const edl = edlOf(
      [
        { input: 1, start: 0, end: 30 },
        { input: 2, start: 50, end: 120 }
      ],
      [{ start: 30, end: 50 }],
      [{ start: 20, end: 120 }]
    );

    expect(edl.segments.some((segment) => segment.input === 3)).toBe(false);
  });
});

describe("trimming the head up to the opening line", () => {
  const transcript: Transcript = {
    version: 1,
    session: "s",
    language: "es",
    words: [
      { text: "eh", startSeconds: 1.0, endSeconds: 1.2, speaker: "A" },
      { text: "¿grabando?", startSeconds: 2.0, endSeconds: 2.4, speaker: "A" },
      { text: "Muy", startSeconds: 9.0, endSeconds: 9.3, speaker: "A" },
      { text: "buenas,", startSeconds: 9.3, endSeconds: 9.8, speaker: "A" },
      { text: "hoy", startSeconds: 9.8, endSeconds: 10.1, speaker: "A" }
    ]
  };

  it("finds where the opening line starts", () => {
    expect(findIntroStart(transcript, ["muy buenas"])).toBeCloseTo(9.0, 3);
  });

  it("ignores accents, case and punctuation", () => {
    expect(normaliseWord("¿Bienvenidos!")).toBe("bienvenidos");
    expect(findIntroStart(transcript, ["MUY BUENAS,"])).toBeCloseTo(9.0, 3);
  });

  it("says nothing when no phrase is heard", () => {
    expect(findIntroStart(transcript, ["bienvenidos"])).toBeNull();
  });

  it("swallows the silence the head trim already covers", () => {
    const merged = mergeDiscards([
      { tIn: 0, tEnd: 12.7, reason: "manual" },
      { tIn: 2.0, tEnd: 10.4, reason: "silence" },
      { tIn: 40.0, tEnd: 46.0, reason: "silence" }
    ]);

    expect(merged).toEqual([
      { tIn: 0, tEnd: 12.7, reason: "manual" },
      { tIn: 40.0, tEnd: 46.0, reason: "silence" }
    ]);
  });
});
