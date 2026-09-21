import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { EditProfile, Input } from "@doslineas/core";
import { parseProfile } from "@doslineas/core";
import type { SessionScript } from "@doslineas/media";
import { BASE_SCRIPT, SAMPLE_RATE, microphoneTrack, mixTracks } from "@doslineas/media";
import type { Envelope } from "./envelope.js";
import { envelopeDb, noiseFloorDb } from "./envelope.js";
import { detectSpeech, speakerAt } from "./speech.js";
import { detectSilences, silencesToDiscards } from "./silence.js";

const profilePath = fileURLToPath(new URL("../../../config/edit-profile.json", import.meta.url));
const rawProfile = JSON.parse(readFileSync(profilePath, "utf8"));
const profile: EditProfile = parseProfile(rawProfile);
const shortSilenceProfile: EditProfile = parseProfile({
  ...rawProfile,
  silence: { ...rawProfile.silence, thresholdSeconds: 1.0 }
});

const script: SessionScript = {
  ...BASE_SCRIPT,
  session: "speech-truth",
  durationSeconds: 40,
  utterances: [
    { input: 2, start: 2.0, dur: 6.0 },
    { input: 3, start: 9.0, dur: 5.0 },
    { input: 2, start: 15.0, dur: 3.0 },
    { input: 3, start: 19.0, dur: 8.0 },
    { input: 2, start: 28.0, dur: 4.0 },
    { input: 3, start: 33.0, dur: 5.0 }
  ]
};

function envelopesOf(from: SessionScript, inputs: readonly Input[]): Map<Input, Envelope> {
  return new Map(inputs.map((input) => [input, envelopeDb(microphoneTrack(from, input), SAMPLE_RATE, profile.voice.windowMs)]));
}

function truthSpeakerAt(from: SessionScript, seconds: number): Input | null {
  const utterance = from.utterances.find((u) => seconds >= u.start && seconds < u.start + u.dur);
  return utterance?.input ?? null;
}

function accuracy(from: SessionScript, intervals: ReturnType<typeof detectSpeech>["intervals"], guardSeconds = 0.35): number {
  let checked = 0;
  let hits = 0;

  for (let seconds = 0; seconds < from.durationSeconds; seconds += 0.02) {
    const truth = truthSpeakerAt(from, seconds);
    const nearBoundary = from.utterances.some(
      (u) => Math.abs(seconds - u.start) < guardSeconds || Math.abs(seconds - (u.start + u.dur)) < guardSeconds
    );
    if (nearBoundary) continue;
    checked += 1;
    if (speakerAt(intervals, seconds) === truth) hits += 1;
  }

  return hits / Math.max(1, checked);
}

describe("noise floor calibration", () => {
  it("lands near the noise the session was built with", () => {
    const envelope = envelopeDb(microphoneTrack(script, 2), SAMPLE_RATE, profile.voice.windowMs);
    const floor = noiseFloorDb(envelope, profile.voice.calibrationSeconds);
    expect(floor).toBeGreaterThan(script.noiseDb - 8);
    expect(floor).toBeLessThan(script.noiseDb + 8);
  });

  it("is not fooled by a session that starts with someone already talking", () => {
    const talkative: SessionScript = { ...script, utterances: [{ input: 2, start: 0, dur: 12 }, ...script.utterances.slice(1)] };
    const envelope = envelopeDb(microphoneTrack(talkative, 2), SAMPLE_RATE, profile.voice.windowMs);
    expect(noiseFloorDb(envelope, profile.voice.calibrationSeconds)).toBeLessThan(script.noiseDb + 8);
  });
});

describe("who is talking, measured against the ground truth", () => {
  it("gets the speaker right over 95% of the session at -18 dB of bleed", () => {
    const analysis = detectSpeech(envelopesOf(script, [2, 3]), profile, [2, 3]);
    expect(accuracy(script, analysis.intervals)).toBeGreaterThan(0.95);
  });

  it("still holds up with severe bleed at -8 dB", () => {
    const leaky: SessionScript = { ...script, bleedDb: -8 };
    const analysis = detectSpeech(envelopesOf(leaky, [2, 3]), profile, [2, 3]);
    expect(accuracy(leaky, analysis.intervals)).toBeGreaterThan(0.9);
  });

  it("gives up rather than guessing when bleed swallows the dominance margin", () => {
    const drowned: SessionScript = { ...script, bleedDb: -2 };
    const analysis = detectSpeech(envelopesOf(drowned, [2, 3]), profile, [2, 3]);
    const wrong = analysis.intervals.filter((interval) => truthSpeakerAt(drowned, (interval.start + interval.end) / 2) !== interval.input);
    expect(wrong).toHaveLength(0);
  });

  it("finds one interval per turn and attributes it to the right input", () => {
    const analysis = detectSpeech(envelopesOf(script, [2, 3]), profile, [2, 3]);
    expect(analysis.intervals).toHaveLength(script.utterances.length);

    analysis.intervals.forEach((interval, index) => {
      const utterance = script.utterances[index]!;
      expect(interval.input).toBe(utterance.input);
      expect(interval.start).toBeCloseTo(utterance.start, 0);
      expect(interval.end).toBeCloseTo(utterance.start + utterance.dur, 0);
    });
  });

  it("leaves input 4 out when it carries a screen", () => {
    const withScreen: SessionScript = {
      ...script,
      input4: "screen",
      utterances: [...script.utterances, { input: 4, start: 12.0, dur: 2.0 }]
    };
    const analysis = detectSpeech(envelopesOf(withScreen, [2, 3]), profile, [2, 3]);
    expect(analysis.intervals.some((interval) => interval.input === 4)).toBe(false);
  });

  it("reports the noise floor it calibrated for every tracked input", () => {
    const analysis = detectSpeech(envelopesOf(script, [2, 3]), profile, [2, 3]);
    expect([...analysis.noiseFloorDb.keys()].sort()).toEqual([2, 3]);
  });
});

describe("silence detection over the program mix", () => {
  it("finds the gaps between turns and leaves the speech alone", () => {
    const mix = mixTracks([microphoneTrack(script, 2), microphoneTrack(script, 3)]);
    const silences = detectSilences(envelopeDb(mix, SAMPLE_RATE, shortSilenceProfile.voice.windowMs), shortSilenceProfile);

    expect(silences.length).toBeGreaterThanOrEqual(3);
    for (const silence of silences) {
      expect(silence.end - silence.start).toBeGreaterThanOrEqual(shortSilenceProfile.silence.thresholdSeconds);
      expect(truthSpeakerAt(script, (silence.start + silence.end) / 2)).toBeNull();
    }
  });

  it("turns silences into discards that keep the agreed padding", () => {
    const mix = mixTracks([microphoneTrack(script, 2), microphoneTrack(script, 3)]);
    const silences = detectSilences(envelopeDb(mix, SAMPLE_RATE, shortSilenceProfile.voice.windowMs), shortSilenceProfile);
    const discards = silencesToDiscards(silences, shortSilenceProfile);

    expect(discards.length).toBe(silences.length);
    discards.forEach((discard, index) => {
      const silence = silences[index]!;
      expect(discard.tIn - silence.start).toBeCloseTo(profile.silence.paddingSeconds, 5);
      expect(silence.end - discard.tEnd).toBeCloseTo(profile.silence.paddingSeconds, 5);
      expect(discard.reason).toBe("silence");
    });
  });

  it("drops a silence too short to survive its own padding", () => {
    const shortGap = [{ start: 10, end: 10.5 }];
    expect(silencesToDiscards(shortGap, profile)).toHaveLength(0);
  });
});
