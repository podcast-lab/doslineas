import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ClipProfile } from "./clip-profile.js";
import { parseClipProfile } from "./clip-profile.js";
import type { Edl } from "./edl.js";
import { parseEdl } from "./edl.js";
import type { Highlight } from "./highlights.js";
import { planShorts, shortCaptionFile, shortFile } from "./shorts.js";
import type { Transcript, TranscriptWord } from "./transcript.js";

const profilePath = fileURLToPath(new URL("../../../config/clip-profile.json", import.meta.url));

const PROFILE: ClipProfile = parseClipProfile({
  ...JSON.parse(readFileSync(profilePath, "utf8")),
  clip: { minSeconds: 4, maxSeconds: 12, targetSeconds: 8, count: 2 },
  padding: { leadSeconds: 0, tailSeconds: 0 },
  anchors: { "1": 0.5, "2": 0.3, "3": 0.7, "4": 0.5 }
});

const EDL: Edl = parseEdl({
  version: 1,
  session: "2026-08-20-ep12",
  fps: 25,
  profile: "podcast-v1",
  sources: [1, 2, 3, 4].map((input) => ({
    input,
    role: input === 1 ? "wide" : input === 2 ? "speaker1" : input === 3 ? "speaker2" : "guest3",
    video: `iso${input}.mp4`,
    audio: input === 1 ? "program.wav" : null,
    durationSeconds: 60
  })),
  segments: [
    { tOut: 0, dur: 5, input: 2, tIn: 0, reason: "initial" },
    { tOut: 5, dur: 6, input: 3, tIn: 5, reason: "turn" },
    { tOut: 11, dur: 4, input: 2, tIn: 11, reason: "turn" },
    { tOut: 15, dur: 5, input: 1, tIn: 15, reason: "refresh" }
  ],
  discards: [],
  audio: { source: "program", gains: {} }
});

function speech(from: number, to: number, speaker: string, text: string): TranscriptWord[] {
  const pieces = text.split(" ");
  const step = (to - from) / pieces.length;
  return pieces.map((word, index) => ({
    text: word,
    startSeconds: Number((from + index * step).toFixed(3)),
    endSeconds: Number((from + (index + 1) * step).toFixed(3)),
    speaker
  }));
}

const TRANSCRIPT: Transcript = {
  version: 1,
  session: "2026-08-20-ep12",
  language: "es",
  words: [
    ...speech(0, 5, "Ana Ruiz", "hola y bienvenidos al programa de hoy"),
    ...speech(5.5, 10.5, "Luis Vega", "la clave esta en medir lo que importa"),
    ...speech(11, 15, "Ana Ruiz", "el error fue creer que era el precio")
  ]
};

const HIGHLIGHT: Highlight = {
  startSeconds: 5.5,
  endSeconds: 14,
  startUtterance: 1,
  endUtterance: 2,
  title: "La clave",
  reason: "afirmacion fuerte",
  score: 0.8,
  source: "llm"
};

describe("planning the verticals", () => {
  it("keeps the moment in the timeline of the master", () => {
    const plan = planShorts(EDL, TRANSCRIPT, PROFILE, [HIGHLIGHT]);
    const short = plan.shorts[0];
    expect(short?.masterStartSeconds).toBe(5.5);
    expect(short?.masterEndSeconds).toBe(14);
    expect(short?.durationSeconds).toBeCloseTo(8.5, 6);
    expect(short?.width).toBe(1080);
    expect(short?.height).toBe(1920);
  });

  it("follows the camera that is on screen, rebased to the clip", () => {
    const plan = planShorts(EDL, TRANSCRIPT, PROFILE, [HIGHLIGHT]);
    const crops = plan.shorts[0]?.crops ?? [];
    expect(crops).toHaveLength(2);
    expect(crops[0]).toEqual({ atSeconds: 0, durationSeconds: 5.5, input: 3, anchor: 0.7 });
    expect(crops[1]).toEqual({ atSeconds: 5.5, durationSeconds: 3, input: 2, anchor: 0.3 });
  });

  it("without wide anchors, drops the wide two-shot and borrows the neighbouring speaker camera", () => {
    const plan = planShorts(EDL, TRANSCRIPT, PROFILE, [{ ...HIGHLIGHT, startSeconds: 5.5, endSeconds: 18 }]);
    const crops = plan.shorts[0]?.crops ?? [];
    expect(crops.some((crop) => crop.input === 1)).toBe(false);
    expect(crops).toEqual([
      { atSeconds: 0, durationSeconds: 5.5, input: 3, anchor: 0.7 },
      { atSeconds: 5.5, durationSeconds: 7, input: 2, anchor: 0.3 }
    ]);
  });

  it("with wide anchors, keeps the wide shot but frames it on the speaker who was talking", () => {
    const withWide = parseClipProfile({
      ...JSON.parse(readFileSync(profilePath, "utf8")),
      clip: { minSeconds: 4, maxSeconds: 12, targetSeconds: 8, count: 2 },
      padding: { leadSeconds: 0, tailSeconds: 0 },
      anchors: { "1": 0.5, "2": 0.3, "3": 0.7, "4": 0.5 },
      wideAnchors: { "1": 0.82, "2": 0.18 }
    });
    const plan = planShorts(EDL, TRANSCRIPT, withWide, [{ ...HIGHLIGHT, startSeconds: 5.5, endSeconds: 18 }]);
    expect(plan.shorts[0]?.crops).toEqual([
      { atSeconds: 0, durationSeconds: 5.5, input: 3, anchor: 0.7 },
      { atSeconds: 5.5, durationSeconds: 4, input: 2, anchor: 0.3 },
      { atSeconds: 9.5, durationSeconds: 3, input: 1, anchor: 0.82 }
    ]);
  });

  it("borrows the upcoming speaker camera when the clip opens on the wide shot", () => {
    const opensWide = parseEdl({
      ...EDL,
      segments: [
        { tOut: 0, dur: 4, input: 1, tIn: 0, reason: "refresh" },
        { tOut: 4, dur: 6, input: 2, tIn: 4, reason: "turn" }
      ]
    });
    const plan = planShorts(opensWide, TRANSCRIPT, PROFILE, [{ ...HIGHLIGHT, startSeconds: 0, endSeconds: 10 }]);
    expect(plan.shorts[0]?.crops).toEqual([{ atSeconds: 0, durationSeconds: 10, input: 2, anchor: 0.3 }]);
  });

  it("merges consecutive shots that use the same camera", () => {
    const straight = parseEdl({
      ...EDL,
      segments: [
        { tOut: 0, dur: 5, input: 2, tIn: 0, reason: "initial" },
        { tOut: 5, dur: 5, input: 2, tIn: 5, reason: "refresh" }
      ]
    });
    const plan = planShorts(straight, TRANSCRIPT, PROFILE, [
      { ...HIGHLIGHT, startSeconds: 0, endSeconds: 10 }
    ]);
    expect(plan.shorts[0]?.crops).toEqual([{ atSeconds: 0, durationSeconds: 10, input: 2, anchor: 0.3 }]);
  });

  it("rebases the captions so the clip starts at zero", () => {
    const plan = planShorts(EDL, TRANSCRIPT, PROFILE, [HIGHLIGHT]);
    const lines = plan.shorts[0]?.lines ?? [];
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]?.startSeconds).toBeCloseTo(0, 6);
    for (const line of lines) {
      expect(line.startSeconds).toBeGreaterThanOrEqual(0);
      expect(line.endSeconds).toBeLessThanOrEqual(8.5 + 1e-6);
      for (const word of line.words) {
        expect(word.startSeconds).toBeGreaterThanOrEqual(0);
        expect(word.endSeconds).toBeLessThanOrEqual(8.5 + 1e-6);
      }
    }
  });

  it("clamps the padding to the ends of the master", () => {
    const padded = parseClipProfile({
      ...JSON.parse(readFileSync(profilePath, "utf8")),
      clip: { minSeconds: 4, maxSeconds: 12, targetSeconds: 8, count: 2 },
      padding: { leadSeconds: 30, tailSeconds: 30 }
    });
    const plan = planShorts(EDL, TRANSCRIPT, padded, [HIGHLIGHT]);
    expect(plan.shorts[0]?.masterStartSeconds).toBe(0);
    expect(plan.shorts[0]?.masterEndSeconds).toBe(20);
  });

  it("warns when it planned fewer clips than asked", () => {
    const plan = planShorts(EDL, TRANSCRIPT, PROFILE, [HIGHLIGHT]);
    expect(plan.warnings.some((warning) => warning.includes("planned 1"))).toBe(true);
  });

  it("names the files by their position", () => {
    expect(shortFile(0)).toBe("clip-1.mp4");
    expect(shortCaptionFile(2)).toBe("clip-3-captions.webm");
  });
});
