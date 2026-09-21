import { describe, expect, it } from "vitest";
import type { Encoder, RenderSpeed } from "./switching-render.js";
import { ENCODERS, RENDER_SPEEDS, parseEncoder, resolvePreset, videoEncoderArgs } from "./switching-render.js";

function argsFor(encoder: Encoder, preset: string): string[] {
  return videoEncoderArgs({ encoder, preset, quality: "20" });
}

describe("choosing an encoder", () => {
  it("names the ones it knows when given one it does not", () => {
    expect(() => parseEncoder("h264_vaapi")).toThrow(/libx264, h264_nvenc, h264_qsv, h264_amf, h264_videotoolbox/);
  });

  it("accepts every encoder it offers", () => {
    for (const encoder of ENCODERS) expect(parseEncoder(encoder)).toBe(encoder);
  });
});

describe("the speed of a render", () => {
  it("never sends one encoder the preset vocabulary of another", () => {
    const vocabularies: Record<Encoder, readonly string[]> = {
      libx264: ["ultrafast", "superfast", "veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"],
      h264_qsv: ["veryfast", "faster", "fast", "medium", "slow", "slower", "veryslow"],
      h264_nvenc: ["p1", "p2", "p3", "p4", "p5", "p6", "p7"],
      h264_amf: ["speed", "balanced", "quality"],
      h264_videotoolbox: ["0", "1"]
    };

    for (const encoder of ENCODERS) {
      for (const speed of RENDER_SPEEDS) {
        expect(vocabularies[encoder]).toContain(resolvePreset(encoder, speed));
      }
    }
  });

  it("keeps the master encoding exactly as it was before the speeds existed", () => {
    expect(argsFor("libx264", "fastest")).toEqual(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"]);
  });

  it("gives each encoder the flag it understands", () => {
    expect(argsFor("h264_nvenc", "fastest")).toEqual(["-c:v", "h264_nvenc", "-preset", "p1", "-cq", "20"]);
    expect(argsFor("h264_qsv", "best")).toEqual(["-c:v", "h264_qsv", "-preset", "slow", "-global_quality", "20"]);
    expect(argsFor("h264_amf", "balanced")).toEqual([
      "-c:v",
      "h264_amf",
      "-quality",
      "balanced",
      "-qp_i",
      "20",
      "-qp_p",
      "20"
    ]);
  });

  it("asks videotoolbox for a bitrate, because it does not share the quality scale of the others", () => {
    expect(argsFor("h264_videotoolbox", "fastest")).toEqual([
      "-c:v",
      "h264_videotoolbox",
      "-realtime",
      "1",
      "-b:v",
      "16M"
    ]);
    expect(videoEncoderArgs({ encoder: "h264_videotoolbox", preset: "best", quality: "24M" })).toEqual([
      "-c:v",
      "h264_videotoolbox",
      "-realtime",
      "0",
      "-b:v",
      "24M"
    ]);
  });

  it("lets through a preset that belongs to the encoder itself", () => {
    expect(resolvePreset("h264_nvenc", "p7")).toBe("p7");
    expect(resolvePreset("libx264", "veryslow")).toBe("veryslow");
  });

  it("orders the speeds from fastest to best for every encoder", () => {
    const ordered: Record<Encoder, readonly string[]> = {
      libx264: ["veryfast", "medium", "slow"],
      h264_qsv: ["veryfast", "medium", "slow"],
      h264_nvenc: ["p1", "p4", "p6"],
      h264_amf: ["speed", "balanced", "quality"],
      h264_videotoolbox: ["1", "0", "0"]
    };

    for (const encoder of ENCODERS) {
      const mapped = RENDER_SPEEDS.map((speed: RenderSpeed) => resolvePreset(encoder, speed));
      expect(mapped).toEqual(ordered[encoder]);
    }
  });
});
