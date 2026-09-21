import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionScript, SyntheticSession } from "./session-generator.js";
import { BASE_SCRIPT, generateSyntheticSession } from "./session-generator.js";
import { duplicateFrames, lastFrameCount, looksLikeScreen } from "./duplicate-frames.js";

const THRESHOLD = 0.15;

const script: SessionScript = {
  ...BASE_SCRIPT,
  session: "input4-classifier",
  durationSeconds: 12,
  width: 320,
  height: 180,
  utterances: [{ input: 2, start: 1, dur: 4 }]
};

describe("reading the frame counter out of the ffmpeg log", () => {
  it("takes the last progress line", () => {
    expect(lastFrameCount("frame=   12 fps=0.0\nframe=  240 fps=99")).toBe(240);
  });

  it("returns zero when ffmpeg printed no progress at all", () => {
    expect(lastFrameCount("nothing here")).toBe(0);
  });
});

describe("telling a screen apart from a camera", () => {
  let directory = "";
  let withScreen: SyntheticSession;
  let withGuest: SyntheticSession;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "duplicate-frames-"));
    withScreen = await generateSyntheticSession(script, join(directory, "screen"));
    withGuest = await generateSyntheticSession({ ...script, input4: "guest3" }, join(directory, "guest"));
  }, 180_000);

  afterAll(async () => {
    if (directory !== "") await rm(directory, { recursive: true, force: true });
  });

  it("a screen repeats most of its frames", async () => {
    const report = await duplicateFrames(withScreen.isos[4], { seconds: 10 });
    expect(report.ratio).toBeGreaterThan(0.5);
    expect(await looksLikeScreen(withScreen.isos[4], THRESHOLD, { seconds: 10 })).toBe(true);
  }, 60_000);

  it("a camera never repeats a frame", async () => {
    const report = await duplicateFrames(withGuest.isos[4], { seconds: 10 });
    expect(report.ratio).toBeLessThan(THRESHOLD);
    expect(await looksLikeScreen(withGuest.isos[4], THRESHOLD, { seconds: 10 })).toBe(false);
  }, 60_000);

  it("the gap between both cases is wide enough to trust the threshold", async () => {
    const screen = await duplicateFrames(withScreen.isos[4], { seconds: 10 });
    const camera = await duplicateFrames(withGuest.isos[4], { seconds: 10 });
    expect(screen.ratio - camera.ratio).toBeGreaterThan(0.4);
  }, 90_000);
});
