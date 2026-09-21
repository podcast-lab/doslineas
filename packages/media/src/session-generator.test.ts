import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionScript, SyntheticSession } from "./session-generator.js";
import {
  BASE_SCRIPT,
  SAMPLE_RATE,
  amplitudeFromDb,
  generateSyntheticSession,
  isPerson,
  microphoneTrack
} from "./session-generator.js";
import { probe } from "./ffprobe.js";

const script: SessionScript = {
  ...BASE_SCRIPT,
  session: "short-test",
  durationSeconds: 6,
  width: 320,
  height: 180,
  utterances: [
    { input: 2, start: 0.5, dur: 2.0 },
    { input: 3, start: 3.0, dur: 2.5 }
  ]
};

function levelDb(track: Float32Array, from: number, to: number): number {
  const start = Math.round(from * SAMPLE_RATE);
  const end = Math.round(to * SAMPLE_RATE);
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    sum += (track[index] ?? 0) ** 2;
  }
  const rms = Math.sqrt(sum / Math.max(1, end - start));
  return 20 * Math.log10(Math.max(rms, 1e-12));
}

describe("microphone track synthesis", () => {
  it("converts dB to amplitude", () => {
    expect(amplitudeFromDb(0)).toBeCloseTo(1);
    expect(amplitudeFromDb(-6)).toBeCloseTo(0.501, 3);
  });

  it("counts input 4 as a person only when it carries a guest", () => {
    expect(isPerson(4, "screen")).toBe(false);
    expect(isPerson(4, "guest3")).toBe(true);
    expect(isPerson(2, "screen")).toBe(true);
  });

  it("each mic dominates while its own person talks and only bleeds for the other", () => {
    const mic2 = microphoneTrack(script, 2);
    const mic3 = microphoneTrack(script, 3);

    const own = levelDb(mic2, 0.8, 2.3);
    const bleed = levelDb(mic2, 3.3, 5.3);
    const silence = levelDb(mic2, 5.6, 6.0);

    expect(own - bleed).toBeGreaterThan(12);
    expect(bleed - silence).toBeGreaterThan(12);
    expect(levelDb(mic3, 3.3, 5.3)).toBeGreaterThan(levelDb(mic2, 3.3, 5.3));
  });

  it("keeps the noise floor near the requested level", () => {
    const mic2 = microphoneTrack(script, 2);
    expect(levelDb(mic2, 5.6, 6.0)).toBeLessThan(script.noiseDb + 6);
  });

  it("holds up at the utterance density of a full length episode", () => {
    const long: SessionScript = {
      ...script,
      durationSeconds: 60,
      utterances: Array.from({ length: 600 }, (_, i) => ({
        input: (i % 2 === 0 ? 2 : 3) as SessionScript["utterances"][number]["input"],
        start: i * 0.1,
        dur: 0.08
      }))
    };
    expect(microphoneTrack(long, 2).length).toBe(60 * SAMPLE_RATE);
  });
});

describe("synthetic session generator", () => {
  let directory = "";
  let session: SyntheticSession;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "synthetic-session-"));
    session = await generateSyntheticSession(script, directory);
  }, 120_000);

  afterAll(async () => {
    if (directory !== "") await rm(directory, { recursive: true, force: true });
  });

  it("writes the four ISOs at the requested fps and resolution", async () => {
    for (const input of [1, 2, 3, 4] as const) {
      const sonde = await probe(session.isos[input]);
      expect(sonde.video?.width).toBe(script.width);
      expect(sonde.video?.height).toBe(script.height);
      expect(sonde.video?.fps).toBeCloseTo(script.fps, 1);
      expect(sonde.audio?.channels).toBe(1);
      expect(sonde.durationSeconds).toBeCloseTo(script.durationSeconds, 0);
    }
  });

  it("keeps the four ISOs in sync to the frame", async () => {
    const durations = await Promise.all(
      ([1, 2, 3, 4] as const).map(async (input) => (await probe(session.isos[input])).durationSeconds)
    );
    const tolerance = 1 / script.fps;
    for (const duration of durations) {
      expect(Math.abs(duration - durations[0]!)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("writes the program and a WAV with one track per input", async () => {
    const program = await probe(session.program);
    expect(program.video).not.toBeNull();

    const wav = await probe(session.wav);
    expect(wav.audio?.channels).toBe(script.wavChannels);
    expect(wav.audio?.codec).toBe("pcm_s24le");
    expect(wav.durationSeconds).toBeCloseTo(script.durationSeconds, 1);
  });
});
