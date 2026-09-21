import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { anchorOf, parseClipProfile } from "./clip-profile.js";

const profilePath = fileURLToPath(new URL("../../../config/clip-profile.json", import.meta.url));
const raw = (): Record<string, unknown> => JSON.parse(readFileSync(profilePath, "utf8"));

describe("clip profile", () => {
  it("the profile shipped in the repo is valid", () => {
    expect(() => parseClipProfile(raw())).not.toThrow();
  });

  it("asks for a vertical frame", () => {
    const profile = parseClipProfile(raw());
    expect(profile.frame.width).toBe(1080);
    expect(profile.frame.height).toBe(1920);
  });

  it("rejects a frame that is not taller than it is wide", () => {
    expect(() => parseClipProfile({ ...raw(), frame: { width: 1920, height: 1080 } })).toThrow(/taller/);
  });

  it("rejects a target length outside the allowed range", () => {
    expect(() =>
      parseClipProfile({ ...raw(), clip: { minSeconds: 20, maxSeconds: 60, targetSeconds: 90, count: 4 } })
    ).toThrow(/targetSeconds/);
  });

  it("rejects a caption that outlasts the shortest clip", () => {
    const profile = raw();
    const captions = { ...(profile["captions"] as object), maxSeconds: 90 };
    expect(() => parseClipProfile({ ...profile, captions })).toThrow(/outlast/);
  });

  it("rejects an anchor outside the picture", () => {
    expect(() => parseClipProfile({ ...raw(), anchors: { "1": 0.5, "2": 1.4, "3": 0.5, "4": 0.5 } })).toThrow();
  });

  it("reads the anchor of each input", () => {
    const profile = parseClipProfile({ ...raw(), anchors: { "1": 0.5, "2": 0.3, "3": 0.7, "4": 0.4 } });
    expect(anchorOf(profile, 2)).toBe(0.3);
    expect(anchorOf(profile, 3)).toBe(0.7);
  });
});
