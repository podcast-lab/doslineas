import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANNEX_A, measureRender, parseSceneCuts, parseSilences, shotsBetween } from "./measure-render.js";
import { runOrFail } from "./process.js";

const SCENE_OUTPUT = `frame:0    pts:51200   pts_time:4
lavfi.scene_score=1.000000
frame:1    pts:89600   pts_time:7
lavfi.scene_score=0.805683
frame:2    pts:140800  pts_time:11
lavfi.scene_score=1.000000
`;

const SILENCE_OUTPUT = `[Parsed_silencedetect_0 @ 000001] silence_start: 2.999932
[Parsed_silencedetect_0 @ 000001] silence_end: 5.000091 | silence_duration: 2.000159
[Parsed_silencedetect_0 @ 000001] silence_start: 9.5
`;

describe("reading what ffmpeg says", () => {
  it("takes the times of the frames that crossed the scene threshold", () => {
    expect(parseSceneCuts(SCENE_OUTPUT)).toEqual([4, 7, 11]);
  });

  it("ignores anything that is not a frame line", () => {
    expect(parseSceneCuts("Press [q] to stop\nframe= 0 fps=0.0\n")).toEqual([]);
  });

  it("pairs every silence with its end", () => {
    const silences = parseSilences(SILENCE_OUTPUT, 12);
    expect(silences[0]).toEqual({ start: 2.999932, end: 5.000091 });
  });

  it("closes a silence that runs to the end of the file", () => {
    const silences = parseSilences(SILENCE_OUTPUT, 12);
    expect(silences).toHaveLength(2);
    expect(silences[1]).toEqual({ start: 9.5, end: 12 });
  });

  it("turns the cuts into the shots between them", () => {
    expect(shotsBetween([4, 7, 11], 14)).toEqual([4, 3, 4, 3]);
  });

  it("counts one shot when nothing was cut", () => {
    expect(shotsBetween([], 14)).toEqual([14]);
  });
});

describe("measuring a render with the annex A method", () => {
  let root = "";
  let clip = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "doslineas-measure-"));
    clip = join(root, "clip.mp4");

    await runOrFail("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=25:duration=4",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:size=320x180:rate=25:duration=3",
      "-f",
      "lavfi",
      "-i",
      "smptebars=size=320x180:rate=25:duration=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono:d=3",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=4",
      "-filter_complex",
      "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v];[3:a][4:a][5:a]concat=n=3:v=0:a=1[a]",
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      clip
    ]);
  }, 120_000);

  afterAll(async () => {
    if (root !== "") await rm(root, { recursive: true, force: true });
  });

  it("finds the cuts where the picture really changes", async () => {
    const metrics = await measureRender(clip, ANNEX_A);

    expect(metrics.cuts).toBe(2);
    expect(metrics.cutTimes[0]).toBeCloseTo(4, 1);
    expect(metrics.cutTimes[1]).toBeCloseTo(7, 1);
  }, 60_000);

  it("measures the shots between those cuts", async () => {
    const metrics = await measureRender(clip, ANNEX_A);

    expect(metrics.durationSeconds).toBeCloseTo(11, 0);
    expect(metrics.medianShot).toBeCloseTo(4, 0);
    expect(metrics.cutsPerMinute).toBeCloseTo((2 / 11) * 60, 0);
  }, 60_000);

  it("finds the silence in the middle and not the tone around it", async () => {
    const metrics = await measureRender(clip, ANNEX_A);

    expect(metrics.silences).toHaveLength(1);
    expect(metrics.silences[0]?.start).toBeCloseTo(4, 0);
    expect(metrics.silentSeconds).toBeCloseTo(3, 0);
  }, 60_000);

  it("sees no cut when the threshold is above the highest score there can be", async () => {
    const metrics = await measureRender(clip, { ...ANNEX_A, sceneThreshold: 1 });

    expect(metrics.cuts).toBe(0);
    expect(metrics.medianShot).toBeCloseTo(metrics.durationSeconds, 1);
  }, 60_000);
});
