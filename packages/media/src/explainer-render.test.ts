import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExplainerPlan, ExplainerProfile } from "@doslineas/core";
import { parseExplainerProfile, planExplainer } from "@doslineas/core";
import { explainerFilter, explainerRenderPlan, insetGeometry, layoutCommands } from "./explainer-render.js";
import { AUDIO_SAMPLE_RATE } from "./switching-render.js";
import { probe } from "./ffprobe.js";
import { runCapturingBytes, runOrFail } from "./process.js";

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 25;

const PROFILE: ExplainerProfile = parseExplainerProfile({
  name: "explainer-test",
  sampling: { fps: 4, width: 64, height: 36, toleranceLevels: 10 },
  activity: { changedRatio: 0.02, jumpRatio: 0.12, openMs: 500, closeMs: 1500, tailSeconds: 0 },
  layout: {
    personInput: 2,
    screenInput: 4,
    minHoldSeconds: 0.5,
    insetPercent: 30,
    insetCorner: "bottom-right",
    insetMarginPercent: 3
  },
  frame: { width: WIDTH, height: HEIGHT }
});

const PLAN: ExplainerPlan = planExplainer("explainer-test", FPS, [{ start: 2, end: 3 }], 4, PROFILE);

describe("the split screen composition", () => {
  it("puts the person in the corner the profile asks for", () => {
    expect(insetGeometry(PROFILE)).toEqual({ width: 96, x: "W-w-10", y: "H-h-10" });
    expect(insetGeometry({ ...PROFILE, layout: { ...PROFILE.layout, insetCorner: "top-left" } })).toEqual({
      width: 96,
      x: "10",
      y: "10"
    });
  });

  it("asks the switch for one layout per block, in source time", () => {
    expect(layoutCommands(PLAN)).toBe(
      ["0.000 streamselect map 0;", "2.000 streamselect map 1;", "3.000 streamselect map 0;", ""].join("\n")
    );
  });

  it("builds both pictures and lets the switch choose between them", () => {
    const filter = explainerFilter(PLAN, PROFILE, "cmds.txt", [], 0);
    expect(filter).toContain("split=2[personfull][personsrc]");
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("[screenbase][inset]overlay=");
    expect(filter).toContain("streamselect=inputs=2:map=0[switched]");
    expect(filter).toContain("sendcmd=");
  });

  it("drops the silences it is given from both picture and sound", () => {
    const filter = explainerFilter(PLAN, PROFILE, "cmds.txt", [{ tIn: 1, tEnd: 1.5, reason: "silence" }], 0);
    const spans = [...filter.matchAll(/a?select='([^']+)'/g)].map((match) => match[1]);

    expect(spans).toHaveLength(2);
    expect(spans[0]).toBe(spans[1]);
    expect(filter).toContain(`asetnsamples=n=${AUDIO_SAMPLE_RATE / PLAN.fps}:p=0`);
  });

  it("opens the person first, then the screen, then the sound", () => {
    const plan = explainerRenderPlan(
      PLAN,
      PROFILE,
      { person: "iso2.mp4", screen: "iso4.mp4", audio: "program.wav" },
      [],
      "cmds.txt",
      "filter.txt",
      "explainer.mp4"
    );
    const args = [...plan.args];
    expect(args.filter((arg) => arg === "-i")).toHaveLength(3);
    expect(args[args.indexOf("iso2.mp4")]).toBe("iso2.mp4");
    expect(args.indexOf("iso2.mp4")).toBeLessThan(args.indexOf("iso4.mp4"));
    expect(args.indexOf("iso4.mp4")).toBeLessThan(args.indexOf("program.wav"));
  });

  it("takes the sound from the person when there is no program track", () => {
    const plan = explainerRenderPlan(
      PLAN,
      PROFILE,
      { person: "iso2.mp4", screen: "iso4.mp4", audio: null },
      [],
      "cmds.txt",
      "filter.txt",
      "explainer.mp4"
    );
    expect(plan.filter).toContain("[0:a]");
  });
});

describe("rendering the explainer with ffmpeg", () => {
  let directory = "";

  async function meanColour(
    video: string,
    seconds: number,
    region: "all" | "centre" | "corner"
  ): Promise<{ r: number; g: number; b: number }> {
    const inset = insetGeometry(PROFILE);
    const crops = {
      all: [],
      centre: ["-vf", `crop=${WIDTH / 2}:${HEIGHT / 2}:${WIDTH / 4}:0`],
      corner: ["-vf", `crop=${inset.width / 2}:${inset.width / 4}:${WIDTH - inset.width / 2 - 12}:${HEIGHT - inset.width / 4 - 12}`]
    };
    const bytes = await runCapturingBytes("ffmpeg", [
      "-v", "error",
      "-ss", seconds.toFixed(3),
      "-i", video,
      "-frames:v", "1",
      ...crops[region],
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "pipe:1"
    ]);
    let r = 0;
    let g = 0;
    let b = 0;
    const pixels = bytes.length / 3;
    for (let index = 0; index < bytes.length; index += 3) {
      r += bytes[index] ?? 0;
      g += bytes[index + 1] ?? 0;
      b += bytes[index + 2] ?? 0;
    }
    return { r: r / pixels, g: g / pixels, b: b / pixels };
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "doslineas-explainer-"));

    await runOrFail("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", `color=c=green:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=4`,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      join(directory, "person.mp4")
    ]);

    await runOrFail("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", `color=c=red:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=4`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p",
      join(directory, "screen.mp4")
    ]);
  }, 60_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function render(): Promise<string> {
    const commandsPath = join(directory, "cmds.txt");
    const filterPath = join(directory, "filter.txt");
    const target = join(directory, "explainer.mp4");
    const plan = explainerRenderPlan(
      PLAN,
      PROFILE,
      { person: join(directory, "person.mp4"), screen: join(directory, "screen.mp4"), audio: null },
      [],
      commandsPath,
      filterPath,
      target
    );
    await writeFile(commandsPath, plan.commands, "utf8");
    await writeFile(filterPath, plan.filter, "utf8");
    await runOrFail("ffmpeg", [...plan.args, "-loglevel", "error"]);
    return target;
  }

  it("switches from the person to the screen and back", async () => {
    const target = await render();

    expect((await meanColour(target, 1, "centre")).g).toBeGreaterThan(100);
    expect((await meanColour(target, 2.5, "centre")).r).toBeGreaterThan(100);
    expect((await meanColour(target, 3.5, "centre")).g).toBeGreaterThan(100);
  }, 90_000);

  it("keeps the person in the corner while the screen is in charge", async () => {
    const target = await render();
    const corner = await meanColour(target, 2.5, "corner");

    expect(corner.g).toBeGreaterThan(corner.r + 40);
  }, 90_000);

  it("comes out at the size and length the plan says, with sound", async () => {
    const sonde = await probe(await render());
    expect(sonde.video?.width).toBe(WIDTH);
    expect(sonde.video?.height).toBe(HEIGHT);
    expect(sonde.durationSeconds).toBeCloseTo(4, 0);
    expect(sonde.audio).not.toBeNull();
  }, 90_000);
});
