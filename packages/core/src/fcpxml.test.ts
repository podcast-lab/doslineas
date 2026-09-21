import { describe, expect, it } from "vitest";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Discard, Edl, Segment } from "./edl.js";
import type { Input } from "./profile.js";
import { outputDuration } from "./edl.js";
import { flattenToClips } from "./clips.js";
import { escapeXml, frameRateOf, toFcpxml, toFileUrl, toRational } from "./fcpxml.js";

function edlOf(segments: readonly Segment[], discards: readonly Discard[] = []): Edl {
  return {
    version: 1,
    session: "2026-08-20-ep12",
    fps: 25,
    profile: "podcast-v1",
    sources: ([1, 2, 3] as Input[]).map((input) => ({
      input,
      role: input === 1 ? "wide" : input === 2 ? "speaker1" : "speaker2",
      video: `C:\\work\\ep12\\iso${input}.mp4`,
      audio: input === 1 ? "C:\\work\\ep12\\program.mp4" : null,
      durationSeconds: 120
    })),
    segments: [...segments],
    discards: [...discards],
    audio: { source: "program", gains: {} }
  };
}

const SEGMENTS: Segment[] = [
  { tOut: 0, dur: 8, input: 2, tIn: 0, reason: "initial" },
  { tOut: 8, dur: 6, input: 3, tIn: 9, reason: "turn" },
  { tOut: 14, dur: 5, input: 1, tIn: 15, reason: "refresh" }
];

const DISCARDS: Discard[] = [{ tIn: 4, tEnd: 5, reason: "silence" }];

describe("frame rates", () => {
  it("keeps whole rates whole", () => {
    expect(frameRateOf(25)).toEqual({ numerator: 1, denominator: 25 });
    expect(frameRateOf(30)).toEqual({ numerator: 1, denominator: 30 });
  });

  it("uses the NTSC fractions where they belong", () => {
    expect(frameRateOf(29.97)).toEqual({ numerator: 1001, denominator: 30_000 });
    expect(frameRateOf(23.976)).toEqual({ numerator: 1001, denominator: 24_000 });
  });

  it("snaps times to whole frames", () => {
    expect(toRational(4, frameRateOf(25))).toBe("100/25s");
    expect(toRational(4.017, frameRateOf(25))).toBe("100/25s");
    expect(toRational(1, frameRateOf(29.97))).toBe("30030/30000s");
  });
});

describe("paths and escaping", () => {
  it("turns a Windows path into a file URL", () => {
    expect(toFileUrl("C:\\work\\ep12\\iso2.mp4")).toBe("file:///C:/work/ep12/iso2.mp4");
  });

  it("escapes spaces and ampersands in paths", () => {
    expect(toFileUrl("C:\\mi trabajo\\a&b.mp4")).toBe("file:///C:/mi%20trabajo/a&b.mp4");
    expect(escapeXml('a & b "c"')).toBe("a &amp; b &quot;c&quot;");
  });
});

describe("flattening an EDL into contiguous clips", () => {
  it("leaves segments alone when there is nothing to discard", () => {
    const clips = flattenToClips(edlOf(SEGMENTS));
    expect(clips).toHaveLength(SEGMENTS.length);
    expect(clips.map((clip) => clip.duration)).toEqual([8, 6, 5]);
  });

  it("splits the segment that holds a silence", () => {
    const clips = flattenToClips(edlOf(SEGMENTS, DISCARDS));
    expect(clips).toHaveLength(SEGMENTS.length + 1);
    expect(clips[0]).toMatchObject({ input: 2, sourceStart: 0, duration: 4, timelineStart: 0 });
    expect(clips[1]).toMatchObject({ input: 2, sourceStart: 5, duration: 4, timelineStart: 4 });
  });

  it("never lets a clip cover discarded time", () => {
    for (const clip of flattenToClips(edlOf(SEGMENTS, DISCARDS))) {
      for (const discard of DISCARDS) {
        const overlap = Math.min(clip.sourceStart + clip.duration, discard.tEnd) - Math.max(clip.sourceStart, discard.tIn);
        expect(overlap).toBeLessThanOrEqual(1e-9);
      }
    }
  });

  it("adds up to exactly the duration the EDL promises", () => {
    const edl = edlOf(SEGMENTS, DISCARDS);
    const total = flattenToClips(edl).reduce((sum, clip) => sum + clip.duration, 0);
    expect(total).toBeCloseTo(outputDuration(edl), 6);
  });

  it("leaves the timeline contiguous", () => {
    const clips = flattenToClips(edlOf(SEGMENTS, DISCARDS));
    let expected = 0;
    for (const clip of clips) {
      expect(clip.timelineStart).toBeCloseTo(expected, 6);
      expected += clip.duration;
    }
  });
});

describe("FCPXML export", () => {
  const xml = toFcpxml(edlOf(SEGMENTS, DISCARDS), { project: "ep12" });

  it("is well formed XML", () => {
    expect(XMLValidator.validate(xml)).toBe(true);
  });

  it("declares one video asset per source plus the program audio", () => {
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const assets = parsed.fcpxml.resources.asset;
    expect(assets).toHaveLength(4);
    expect(assets.filter((asset: Record<string, string>) => asset["@_hasVideo"] === "1")).toHaveLength(3);
    expect(assets.filter((asset: Record<string, string>) => asset["@_hasAudio"] === "1")).toHaveLength(1);
  });

  it("puts one clip on the spine per contiguous piece, with the program audio attached", () => {
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const spine = parsed.fcpxml.library.event.project.sequence.spine["asset-clip"];
    expect(spine).toHaveLength(flattenToClips(edlOf(SEGMENTS, DISCARDS)).length);
    expect(spine[0]["@_offset"]).toBe("0/25s");
    expect(spine[0]["asset-clip"]["@_lane"]).toBe("-1");
    expect(spine[1]["@_offset"]).toBe("100/25s");
    expect(spine[1]["@_start"]).toBe("125/25s");
  });

  it("declares the sequence as long as the edit", () => {
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    expect(parsed.fcpxml.library.event.project.sequence["@_duration"]).toBe("475/25s");
    expect(parsed.fcpxml.library.event.project["@_name"]).toBe("ep12");
  });

  it("survives an EDL with no program audio", () => {
    const edl = edlOf(SEGMENTS);
    const noAudio: Edl = { ...edl, sources: edl.sources.map((source) => ({ ...source, audio: null })) };
    const plain = toFcpxml(noAudio);
    expect(XMLValidator.validate(plain)).toBe(true);
    expect(plain).not.toContain("r-audio");
  });
});
