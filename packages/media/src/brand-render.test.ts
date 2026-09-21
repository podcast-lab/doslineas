import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrandPlan } from "@doslineas/core";
import type { BrandAssets } from "./brand-render.js";
import { brandCompositePlan, brandFilter, brandInputs } from "./brand-render.js";
import { probe } from "./ffprobe.js";
import { runCapturingBytes, runOrFail } from "./process.js";

const WIDTH = 320;
const HEIGHT = 180;
const FPS = 25;

function planOf(overrides: Partial<BrandPlan> = {}): BrandPlan {
  return {
    version: 1,
    session: "test",
    kit: "test-kit",
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    corner: "bottom-left",
    marginPercent: 6,
    intro: { kind: "intro", durationSeconds: 1, headline: "Episodio", tagline: "" },
    outro: { kind: "outro", durationSeconds: 1, headline: "Gracias", tagline: "" },
    lowerThirds: [{ input: 2, name: "Ana Ruiz", title: "Presentadora", atSeconds: 0.5, durationSeconds: 1, segment: 0 }],
    masterSeconds: 2,
    totalSeconds: 4,
    warnings: [],
    ...overrides
  };
}

const ASSETS: BrandAssets = { intro: "intro.mp4", outro: "outro.mp4", lowerThirds: ["lower-third-1.webm"] };

describe("brand composite plan", () => {
  it("feeds ffmpeg the master first, then the lower thirds, then the cards", () => {
    expect(brandInputs(planOf(), ASSETS, "master.mp4")).toEqual([
      "-i", "master.mp4",
      "-c:v", "libvpx-vp9", "-i", "lower-third-1.webm",
      "-i", "intro.mp4",
      "-i", "outro.mp4"
    ]);
  });

  it("refuses to build a filter that does not match the plan", () => {
    expect(() => brandFilter(planOf(), { ...ASSETS, lowerThirds: [] })).toThrow(/lower thirds/);
    expect(() => brandFilter(planOf(), { ...ASSETS, intro: null })).toThrow(/intro/);
  });

  it("delays each overlay to its cue instead of showing it from the start", () => {
    const filter = brandFilter(
      planOf({
        lowerThirds: [
          { input: 2, name: "Ana", title: "", atSeconds: 12.5, durationSeconds: 4, segment: 0 },
          { input: 3, name: "Luis", title: "", atSeconds: 40, durationSeconds: 4, segment: 3 }
        ]
      }),
      { ...ASSETS, lowerThirds: ["lower-third-1.webm", "lower-third-2.webm"] }
    );

    expect(filter).toContain("[1:v]format=yuva420p,tpad=start_duration=12.500:start_mode=add:color=black@0[lt0]");
    expect(filter).toContain("[2:v]format=yuva420p,tpad=start_duration=40.000:start_mode=add:color=black@0[lt1]");
    expect(filter).toContain("[0:v][lt0]overlay=x=0:y=0:eof_action=pass:shortest=0:format=auto[over0]");
    expect(filter).toContain("[over0][lt1]overlay=");
    expect(filter).toContain("concat=n=3:v=1:a=1[v][a]");
  });

  it("skips the concat when the kit asks for no cards", () => {
    const filter = brandFilter(planOf({ intro: null, outro: null }), { ...ASSETS, intro: null, outro: null });
    expect(filter).not.toContain("concat");
    expect(filter).toContain("[over0]scale=320:180,setsar=1,fps=25,format=yuv420p[v]");
    expect(filter).toContain("[0:a]aformat");
  });

  it("puts the encoder and the frame rate of the plan in the command", () => {
    const { args } = brandCompositePlan(planOf(), ASSETS, "master.mp4", "filter.txt", "branded.mp4", {
      encoder: "h264_nvenc",
      quality: "22",
      preset: "p4"
    });
    expect(args).toContain("h264_nvenc");
    expect(args.slice(-5)).toEqual(["-ar", "48000", "-r", "25", "branded.mp4"]);
  });
});

describe("branding a master with ffmpeg", () => {
  let directory = "";

  async function meanColour(
    video: string,
    seconds: number,
    half: "top" | "bottom" | "all" = "all"
  ): Promise<{ r: number; g: number; b: number }> {
    const crops = {
      all: [],
      top: ["-vf", `crop=${WIDTH}:${HEIGHT / 2}:0:0`],
      bottom: ["-vf", `crop=${WIDTH}:${HEIGHT / 2}:0:${HEIGHT / 2}`]
    };
    const bytes = await runCapturingBytes("ffmpeg", [
      "-v", "error",
      "-ss", seconds.toFixed(3),
      "-i", video,
      "-frames:v", "1",
      ...crops[half],
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
    directory = await mkdtemp(join(tmpdir(), "doslineas-brand-"));

    await runOrFail("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", `color=c=green:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=2`,
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      join(directory, "master.mp4")
    ]);

    for (const [file, colour] of [["intro.mp4", "blue"], ["outro.mp4", "white"]] as const) {
      await runOrFail("ffmpeg", [
        "-y", "-v", "error",
        "-f", "lavfi", "-i", `color=c=${colour}:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=1`,
        "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        join(directory, file)
      ]);
    }

    await runOrFail("ffmpeg", [
      "-y", "-v", "error",
      "-f", "lavfi", "-i", `color=c=red:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=1`,
      "-filter_complex", `[0:v]format=yuva420p,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(Y,${HEIGHT} / 2),0,255)'[v]`,
      "-map", "[v]",
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
      join(directory, "lower-third-1.webm")
    ]);
  }, 60_000);

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("shows the overlay only while its cue lasts", async () => {
    const plan = planOf({ intro: null, outro: null, totalSeconds: 2 });
    const assets: BrandAssets = { intro: null, outro: null, lowerThirds: [join(directory, "lower-third-1.webm")] };
    const filterPath = join(directory, "overlay-filter.txt");
    const target = join(directory, "overlaid.mp4");

    const { filter, args } = brandCompositePlan(plan, assets, join(directory, "master.mp4"), filterPath, target);
    await writeFile(filterPath, filter, "utf8");
    await runOrFail("ffmpeg", [...args, "-loglevel", "error"]);

    const before = await meanColour(target, 0.1, "bottom");
    const during = await meanColour(target, 0.9, "bottom");
    const after = await meanColour(target, 1.8, "bottom");

    expect(before.g).toBeGreaterThan(before.r + 40);
    expect(during.r).toBeGreaterThan(during.g + 40);
    expect(after.g).toBeGreaterThan(after.r + 40);
  }, 60_000);

  it("lets the master show through where the overlay is transparent", async () => {
    const plan = planOf({ intro: null, outro: null, totalSeconds: 2 });
    const assets: BrandAssets = { intro: null, outro: null, lowerThirds: [join(directory, "lower-third-1.webm")] };
    const filterPath = join(directory, "alpha-filter.txt");
    const target = join(directory, "alpha.mp4");

    const { filter, args } = brandCompositePlan(plan, assets, join(directory, "master.mp4"), filterPath, target);
    await writeFile(filterPath, filter, "utf8");
    await runOrFail("ffmpeg", [...args, "-loglevel", "error"]);

    const top = await meanColour(target, 0.9, "top");
    const bottom = await meanColour(target, 0.9, "bottom");

    expect(top.g).toBeGreaterThan(top.r + 40);
    expect(bottom.r).toBeGreaterThan(bottom.g + 40);
  }, 60_000);

  it("wraps the master with the intro and the outro", async () => {
    const plan = planOf();
    const assets: BrandAssets = {
      intro: join(directory, "intro.mp4"),
      outro: join(directory, "outro.mp4"),
      lowerThirds: [join(directory, "lower-third-1.webm")]
    };
    const filterPath = join(directory, "brand-filter.txt");
    const target = join(directory, "branded.mp4");

    const { filter, args } = brandCompositePlan(plan, assets, join(directory, "master.mp4"), filterPath, target);
    await writeFile(filterPath, filter, "utf8");
    await runOrFail("ffmpeg", [...args, "-loglevel", "error"]);

    const sonde = await probe(target);
    expect(sonde.durationSeconds).toBeCloseTo(plan.totalSeconds, 1);
    expect(sonde.video?.width).toBe(WIDTH);
    expect(sonde.audio).not.toBeNull();

    const opening = await meanColour(target, 0.5, "bottom");
    const closing = await meanColour(target, 3.5, "bottom");
    expect(opening.b).toBeGreaterThan(opening.r + 40);
    expect(closing.r).toBeGreaterThan(200);
    expect(closing.g).toBeGreaterThan(200);
  }, 90_000);
});
