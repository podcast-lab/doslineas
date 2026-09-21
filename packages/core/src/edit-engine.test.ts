import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SpeechInterval } from "./cut-generators.js";
import { outputLength } from "./cut-generators.js";
import type { Discard, Edl, Source } from "./edl.js";
import { validateEdl } from "./edl.js";
import type { EditProfile, Input } from "./profile.js";
import { parseProfile } from "./profile.js";
import { measureEdit } from "./metrics.js";
import { buildEdl, castOf } from "./edit-engine.js";

const profilePath = fileURLToPath(new URL("../../../config/edit-profile.json", import.meta.url));
const profile: EditProfile = parseProfile({
  ...JSON.parse(readFileSync(profilePath, "utf8")),
  inputs: { "1": "wide", "2": "speaker1", "3": "speaker2", "4": "variable" }
});

const SESSION_SECONDS = 600;

function sources(durationSeconds = SESSION_SECONDS): Source[] {
  return ([1, 2, 3, 4] as Input[]).map((input) => ({
    input,
    role: input === 1 ? "wide" : input === 2 ? "speaker1" : input === 3 ? "speaker2" : "screen",
    video: `iso${input}.mp4`,
    audio: input === 1 ? "program.wav" : null,
    durationSeconds
  }));
}

function conversation(durationSeconds = SESSION_SECONDS): SpeechInterval[] {
  const speech: SpeechInterval[] = [];
  const turnLengths = [12, 4, 25, 7, 3, 18, 9, 32, 5, 14];
  let t = 1.5;
  let index = 0;

  while (t < durationSeconds - 5) {
    const length = turnLengths[index % turnLengths.length]!;
    const end = Math.min(t + length, durationSeconds - 1);
    speech.push({ input: index % 2 === 0 ? 2 : 3, start: t, end });
    t = end + (index % 3 === 0 ? 1.8 : 0.4);
    index += 1;
  }

  return speech;
}

function silences(speech: readonly SpeechInterval[]): Discard[] {
  const discards: Discard[] = [];
  for (let index = 0; index + 1 < speech.length; index += 1) {
    const gap = speech[index + 1]!.start - speech[index]!.end;
    if (gap < profile.silence.thresholdSeconds) continue;
    const start = speech[index]!.end + profile.silence.paddingSeconds;
    const end = speech[index + 1]!.start - profile.silence.paddingSeconds;
    if (end > start) discards.push({ tIn: start, tEnd: end, reason: "silence" });
  }
  return discards;
}

function edlOfConversation(overrides: Partial<Parameters<typeof buildEdl>[0]> = {}): Edl {
  const speech = conversation();
  return buildEdl({
    session: "2026-08-20-ep12",
    fps: 25,
    profile,
    sources: sources(),
    speech,
    discards: silences(speech),
    durationSeconds: SESSION_SECONDS,
    input4Role: "screen",
    ...overrides
  });
}

const studioProfile = (inputs: Record<string, string>) => parseProfile({ ...profile, inputs });

describe("cast", () => {
  it("leaves input 4 out of the people when it carries a screen", () => {
    expect(castOf(profile, sources(), "screen")).toEqual({ wide: 1, people: [2, 3] });
  });

  it("brings input 4 in when it carries a third guest", () => {
    expect(castOf(profile, sources(), "guest3")).toEqual({ wide: 1, people: [2, 3, 4] });
  });

  it("follows the profile when the studio wires the wide shot to another input", () => {
    const wired = studioProfile({ "1": "speaker1", "2": "speaker2", "3": "wide", "4": "variable" });
    expect(castOf(wired, sources(), "screen")).toEqual({ wide: 3, people: [1, 2] });
  });
});

describe("the edit engine against annex A", () => {
  const edl = edlOfConversation();
  const metrics = measureEdit(edl);

  it("produces an EDL a render will not choke on", () => {
    expect(validateEdl(edl)).toEqual([]);
    expect(edl.segments.length).toBeGreaterThan(0);
  });

  it("lands inside the measured range of cuts per minute", () => {
    const { perMinuteTarget, perMinuteTolerance } = profile.cuts;
    expect(metrics.cutsPerMinute).toBeGreaterThan(perMinuteTarget - perMinuteTolerance - 2);
    expect(metrics.cutsPerMinute).toBeLessThanOrEqual(perMinuteTarget + perMinuteTolerance);
  });

  it("keeps the median shot in the 4-5 s the references showed", () => {
    expect(metrics.medianShot).toBeGreaterThanOrEqual(3.5);
    expect(metrics.medianShot).toBeLessThanOrEqual(6.5);
  });

  it("never breaks the minimum or the maximum shot length", () => {
    for (const segment of edl.segments) {
      expect(segment.dur).toBeGreaterThanOrEqual(profile.shot.minSeconds - 1e-6);
      expect(segment.dur).toBeLessThanOrEqual(profile.shot.maxSeconds + 1e-6);
    }
  });

  it("cuts mostly mid-turn, which is the finding that shaped the design", () => {
    const midTurn = (metrics.countByReason["refresh"] ?? 0) + (metrics.countByReason["forced"] ?? 0);
    expect(midTurn).toBeGreaterThan(metrics.countByReason["turn"] ?? 0);
  });

  it("never cuts to input 4 while it carries a screen", () => {
    expect(edl.segments.some((segment) => segment.input === 4)).toBe(false);
  });

  it("uses input 4 once it carries a third guest who talks", () => {
    const speech = conversation();
    const withGuest = [...speech, { input: 4 as Input, start: 300, end: 330 }].sort((a, b) => a.start - b.start);
    const guestEdl = buildEdl({
      session: "with-guest",
      fps: 25,
      profile,
      sources: sources(),
      speech: withGuest,
      discards: [],
      durationSeconds: SESSION_SECONDS,
      input4Role: "guest3"
    });
    expect(guestEdl.segments.some((segment) => segment.input === 4)).toBe(true);
  });

  it("never shows a talking head that is not the one talking for a whole turn", () => {
    const speech = conversation();
    for (const turn of speech.slice(0, 12)) {
      const covering = edl.segments.filter((s) => s.tIn < turn.end && s.tIn + s.dur > turn.start);
      expect(covering.some((s) => s.input === turn.input)).toBe(true);
    }
  });

  it("drops exactly the silence it was told to drop", () => {
    const discards = edl.discards;
    const expected = outputLength(0, SESSION_SECONDS, discards);
    expect(measureEdit(edl).durationSeconds).toBeCloseTo(expected, 3);
  });
});

describe("the edit engine on the edges", () => {
  it("opens on the wide shot when nobody talks at the start", () => {
    const edl = edlOfConversation({ speech: [{ input: 2, start: 30, end: 40 }] });
    expect(edl.segments[0]!.input).toBe(1);
    expect(edl.segments[0]!.reason).toBe("initial");
  });

  it("opens on the speaker when someone is already talking", () => {
    const edl = edlOfConversation({ speech: [{ input: 3, start: 0.2, end: 40 }] });
    expect(edl.segments[0]!.input).toBe(3);
  });

  it("opens on the speaker when the leading silence is trimmed away", () => {
    const edl = edlOfConversation({
      speech: [{ input: 2, start: 1.5, end: 40 }],
      discards: [{ tIn: 0.3, tEnd: 1.2, reason: "silence" }]
    });
    expect(edl.segments[0]!.input).toBe(2);
    expect(edl.segments[0]!.reason).toBe("initial");
  });

  it("survives a session where nobody talks at all", () => {
    const edl = edlOfConversation({ speech: [], discards: [] });
    expect(validateEdl(edl)).toEqual([]);
    expect(edl.segments[0]!.input).toBe(1);
    expect(edl.segments.some((segment) => segment.input === 4)).toBe(false);
    for (const segment of edl.segments) {
      expect(segment.dur).toBeLessThanOrEqual(profile.shot.maxSeconds + 1e-6);
    }
  });

  it("holds the maximum shot even through a monologue", () => {
    const edl = edlOfConversation({ speech: [{ input: 2, start: 0, end: SESSION_SECONDS }], discards: [] });
    expect(validateEdl(edl)).toEqual([]);
    for (const segment of edl.segments) {
      expect(segment.dur).toBeLessThanOrEqual(profile.shot.maxSeconds + 1e-6);
    }
    expect(new Set(edl.segments.map((s) => s.input)).size).toBeGreaterThan(1);
  });
});
