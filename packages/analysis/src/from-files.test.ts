import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EditProfile, Input } from "@doslineas/core";
import { parseProfile } from "@doslineas/core";
import type { SessionScript, SyntheticSession } from "@doslineas/media";
import { BASE_SCRIPT, extractSamples, generateSyntheticSession } from "@doslineas/media";
import type { Envelope } from "./envelope.js";
import { envelopeDb } from "./envelope.js";
import { detectSpeech, speakerAt } from "./speech.js";

const profilePath = fileURLToPath(new URL("../../../config/edit-profile.json", import.meta.url));
const profile: EditProfile = parseProfile(JSON.parse(readFileSync(profilePath, "utf8")));

const script: SessionScript = {
  ...BASE_SCRIPT,
  session: "from-files",
  durationSeconds: 24,
  width: 320,
  height: 180,
  utterances: [
    { input: 2, start: 2.0, dur: 6.0 },
    { input: 3, start: 9.0, dur: 5.0 },
    { input: 2, start: 15.0, dur: 3.0 },
    { input: 3, start: 19.0, dur: 4.0 }
  ]
};

describe("analysis over the files a session actually leaves on disk", () => {
  let directory = "";
  let session: SyntheticSession;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "analysis-files-"));
    session = await generateSyntheticSession(script, directory);
  }, 120_000);

  afterAll(async () => {
    if (directory !== "") await rm(directory, { recursive: true, force: true });
  });

  it("reads the embedded audio of each ISO back at the expected length", async () => {
    const samples = await extractSamples(session.isos[2]);
    expect(samples.length / 48_000).toBeCloseTo(script.durationSeconds, 0);
  }, 60_000);

  it("gets who is talking right after going through AAC and back", async () => {
    const envelopes = new Map<Input, Envelope>();
    for (const input of [2, 3] as const) {
      const samples = await extractSamples(session.isos[input]);
      envelopes.set(input, envelopeDb(samples, 48_000, profile.voice.windowMs));
    }

    const analysis = detectSpeech(envelopes, profile, [2, 3]);
    expect(analysis.intervals).toHaveLength(script.utterances.length);

    analysis.intervals.forEach((interval, index) => {
      const utterance = script.utterances[index]!;
      expect(interval.input).toBe(utterance.input);
      expect(Math.abs(interval.start - utterance.start)).toBeLessThan(0.5);
      expect(Math.abs(interval.end - (utterance.start + utterance.dur))).toBeLessThan(0.5);
    });

    expect(speakerAt(analysis.intervals, 4.0)).toBe(2);
    expect(speakerAt(analysis.intervals, 11.0)).toBe(3);
    expect(speakerAt(analysis.intervals, 8.5)).toBeNull();
  }, 120_000);

  it("reads the four channels of the ATEM WAV as separate tracks", async () => {
    const samples = await extractSamples(session.wav);
    expect(samples.length / 48_000).toBeCloseTo(script.durationSeconds, 0);
  }, 60_000);
});
