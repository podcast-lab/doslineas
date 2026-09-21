import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ExplainerProfile } from "./explainer-profile.js";
import { parseExplainerProfile } from "./explainer-profile.js";
import { layoutAt, planExplainer, settleWindows } from "./explainer.js";

const profilePath = fileURLToPath(new URL("../../../config/explainer-profile.json", import.meta.url));
const raw = (): Record<string, unknown> => JSON.parse(readFileSync(profilePath, "utf8"));

const PROFILE: ExplainerProfile = parseExplainerProfile({
  ...raw(),
  activity: { changedRatio: 0.02, jumpRatio: 0.12, openMs: 500, closeMs: 1500, tailSeconds: 2 },
  layout: { ...(raw()["layout"] as object), minHoldSeconds: 3 }
});

const plan = (windows: readonly { start: number; end: number }[], seconds = 60) =>
  planExplainer("2026-08-24-explainer", 25, windows, seconds, PROFILE);

describe("settling the moments the screen was working", () => {
  it("lets the screen linger after the movement stops", () => {
    expect(settleWindows([{ start: 10, end: 20 }], 60, PROFILE)).toEqual([{ start: 10, end: 22 }]);
  });

  it("gives a short burst the minimum time on screen", () => {
    expect(settleWindows([{ start: 10, end: 10.4 }], 60, PROFILE)).toEqual([{ start: 10, end: 13 }]);
  });

  it("joins two bursts instead of blinking between them", () => {
    const settled = settleWindows(
      [
        { start: 10, end: 14 },
        { start: 17, end: 20 }
      ],
      60,
      PROFILE
    );
    expect(settled).toEqual([{ start: 10, end: 22 }]);
  });

  it("keeps two bursts apart when there is room for a real person shot", () => {
    const settled = settleWindows(
      [
        { start: 5, end: 10 },
        { start: 30, end: 35 }
      ],
      60,
      PROFILE
    );
    expect(settled).toHaveLength(2);
  });

  it("never runs past the end of the session", () => {
    expect(settleWindows([{ start: 50, end: 59 }], 60, PROFILE)).toEqual([{ start: 50, end: 60 }]);
  });

  it("starts on the screen instead of flashing a person shot too short to see", () => {
    expect(settleWindows([{ start: 1, end: 20 }], 60, PROFILE)[0]?.start).toBe(0);
  });
});

describe("the explainer plan", () => {
  it("opens on the person when the screen is quiet at the start", () => {
    const built = plan([{ start: 20, end: 30 }]);
    expect(built.segments[0]).toEqual({ atSeconds: 0, durationSeconds: 20, layout: "person" });
    expect(built.segments[1]?.layout).toBe("screen");
  });

  it("covers the whole session with no gaps and no overlaps", () => {
    const built = plan([
      { start: 10, end: 15 },
      { start: 40, end: 45 }
    ]);
    let cursor = 0;
    for (const segment of built.segments) {
      expect(segment.atSeconds).toBeCloseTo(cursor, 6);
      expect(segment.durationSeconds).toBeGreaterThan(0);
      cursor = segment.atSeconds + segment.durationSeconds;
    }
    expect(cursor).toBeCloseTo(built.sourceSeconds, 6);
  });

  it("never puts two blocks of the same layout in a row", () => {
    const built = plan([
      { start: 5, end: 8 },
      { start: 25, end: 28 },
      { start: 45, end: 48 }
    ]);
    for (let index = 1; index < built.segments.length; index += 1) {
      expect(built.segments[index]?.layout).not.toBe(built.segments[index - 1]?.layout);
    }
  });

  it("comes out as a plain person shot when the screen never moves, and says so", () => {
    const built = plan([]);
    expect(built.segments).toEqual([{ atSeconds: 0, durationSeconds: 60, layout: "person" }]);
    expect(built.screenSeconds).toBe(0);
    expect(built.warnings[0]).toMatch(/never moved/);
  });

  it("warns when the screen swallows the whole session", () => {
    const built = plan([{ start: 0, end: 59 }]);
    expect(built.warnings.some((warning) => warning.includes("almost the whole session"))).toBe(true);
  });

  it("adds up the time the screen is in charge", () => {
    const built = plan([{ start: 10, end: 20 }]);
    expect(built.screenSeconds).toBe(12);
  });

  it("answers which layout is up at a given second", () => {
    const built = plan([{ start: 20, end: 30 }]);
    expect(layoutAt(built, 5)).toBe("person");
    expect(layoutAt(built, 25)).toBe("screen");
    expect(layoutAt(built, 50)).toBe("person");
  });

  it("carries the inputs and the frame from the profile", () => {
    const built = plan([{ start: 20, end: 30 }]);
    expect(built.personInput).toBe(PROFILE.layout.personInput);
    expect(built.screenInput).toBe(PROFILE.layout.screenInput);
    expect(built.width).toBe(1920);
    expect(built.height).toBe(1080);
  });
});
