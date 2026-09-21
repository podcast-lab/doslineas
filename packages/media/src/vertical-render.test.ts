import { describe, expect, it } from "vitest";
import type { Short } from "@doslineas/core";
import {
  MAX_CROP_TERMS,
  cropExpression,
  cropOffset,
  cropWidth,
  extractAudioArgs,
  verticalClipPlan,
  verticalFilter
} from "./vertical-render.js";

const SOURCE = { width: 1920, height: 1080 };

function shortOf(overrides: Partial<Short> = {}): Short {
  return {
    index: 0,
    title: "La clave",
    reason: "",
    source: "llm",
    score: 0.8,
    masterStartSeconds: 12.5,
    masterEndSeconds: 42.5,
    durationSeconds: 30,
    width: 1080,
    height: 1920,
    layout: "crop",
    crops: [
      { atSeconds: 0, durationSeconds: 10, input: 2, anchor: 0.3 },
      { atSeconds: 10, durationSeconds: 20, input: 3, anchor: 0.7 }
    ],
    lines: [],
    ...overrides
  };
}

describe("the vertical window", () => {
  it("takes the tallest 9:16 window that fits in the master", () => {
    expect(cropWidth(shortOf(), SOURCE)).toBe(608);
  });

  it("never lets the window fall outside the picture", () => {
    const width = cropWidth(shortOf(), SOURCE);
    expect(cropOffset(0, width, SOURCE)).toBe(0);
    expect(cropOffset(1, width, SOURCE)).toBe(1920 - width);
    expect(cropOffset(0.5, width, SOURCE)).toBe(656);
  });

  it("never asks for more width than the source has", () => {
    expect(cropWidth(shortOf({ width: 1920, height: 1080 }), { width: 640, height: 360 })).toBeLessThanOrEqual(640);
  });
});

describe("the crop expression", () => {
  it("stays a plain number when every shot uses the same anchor", () => {
    const short = shortOf({
      crops: [
        { atSeconds: 0, durationSeconds: 10, input: 2, anchor: 0.5 },
        { atSeconds: 10, durationSeconds: 20, input: 3, anchor: 0.5 }
      ]
    });
    expect(cropExpression(short, SOURCE)).toBe("656");
  });

  it("switches anchor with the camera on screen", () => {
    expect(cropExpression(shortOf(), SOURCE)).toBe("lt(t,10.000)*272+gte(t,10.000)*1040");
  });

  it("leaves exactly one term active at any moment", () => {
    const short = shortOf({
      crops: [
        { atSeconds: 0, durationSeconds: 5, input: 2, anchor: 0.2 },
        { atSeconds: 5, durationSeconds: 5, input: 3, anchor: 0.8 },
        { atSeconds: 10, durationSeconds: 5, input: 1, anchor: 0.5 }
      ]
    });
    const terms = cropExpression(short, SOURCE).split("+");
    expect(terms).toHaveLength(3);
    expect(terms[0]?.startsWith("lt(")).toBe(true);
    expect(terms[1]).toMatch(/^gte\(t,5\.000\)\*lt\(t,10\.000\)\*/);
    expect(terms[2]?.startsWith("gte(")).toBe(true);
  });

  it("falls back to the dominant anchor when there are too many shots", () => {
    const crops = Array.from({ length: MAX_CROP_TERMS + 1 }, (_, index) => ({
      atSeconds: index,
      durationSeconds: index === 0 ? 100 : 1,
      input: (index % 2 === 0 ? 2 : 3) as 2 | 3,
      anchor: index % 2 === 0 ? 0.2 : 0.8
    }));
    const expression = cropExpression(shortOf({ crops }), SOURCE);
    expect(expression).toBe(String(cropOffset(0.2, cropWidth(shortOf(), SOURCE), SOURCE)));
  });
});

describe("the filter", () => {
  it("crops, scales and closes on a playable pixel format", () => {
    const filter = verticalFilter(shortOf(), SOURCE, null);
    expect(filter).toContain("crop=w=608:h=1080");
    expect(filter).toContain("scale=1080:1920");
    expect(filter).toContain("[base]format=yuv420p[v]");
  });

  it("lays the captions on top when there is an overlay", () => {
    const filter = verticalFilter(shortOf(), SOURCE, "clip-1-captions.webm");
    expect(filter).toContain("[1:v]format=yuva420p[overlay]");
    expect(filter).toContain("[base][overlay]overlay=x=0:y=0");
  });

  it("blurs a copy behind the picture when asked for the safe layout", () => {
    const filter = verticalFilter(shortOf({ layout: "blur" }), SOURCE, null);
    expect(filter).toContain("force_original_aspect_ratio=increase");
    expect(filter).toContain("boxblur=");
    expect(filter).not.toContain("crop=w=608");
  });
});

describe("the ffmpeg call", () => {
  const plan = verticalClipPlan(shortOf(), SOURCE, "master.mp4", null, "filter.txt", "clip-1.mp4", 25);

  it("seeks before opening the master so it does not decode the whole episode", () => {
    const args = [...plan.args];
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
    expect(args[args.indexOf("-ss") + 1]).toBe("12.500");
    expect(args[args.indexOf("-t") + 1]).toBe("30.000");
  });

  it("takes the sound from the master and the picture from the filter", () => {
    expect(plan.args).toContain("[v]");
    expect(plan.args).toContain("0:a");
  });

  it("extracts a mono transcription audio, no video", () => {
    const args = extractAudioArgs("master.mp4", "master-audio.flac");
    expect(args).toContain("-vn");
    expect(args[args.indexOf("-ac") + 1]).toBe("1");
    expect(args[args.indexOf("-ar") + 1]).toBe("16000");
  });
});
