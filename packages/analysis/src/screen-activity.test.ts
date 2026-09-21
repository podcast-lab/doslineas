import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ExplainerProfile } from "@doslineas/core";
import { parseExplainerProfile } from "@doslineas/core";
import { activityDuration, detectScreenActivity, screenActivity, screenJumps } from "./screen-activity.js";

const profilePath = fileURLToPath(new URL("../../../config/explainer-profile.json", import.meta.url));
const raw = (): Record<string, unknown> => JSON.parse(readFileSync(profilePath, "utf8"));

const PIXELS = 100;
const FPS = 4;

const PROFILE: ExplainerProfile = parseExplainerProfile({
  ...raw(),
  sampling: { fps: FPS, width: 10, height: 10, toleranceLevels: 10 },
  activity: { changedRatio: 0.05, jumpRatio: 0.5, openMs: 500, closeMs: 1500, tailSeconds: 2 },
  layout: { ...(raw()["layout"] as object), minHoldSeconds: 3 }
});

function series(lit: readonly number[]): Uint8Array {
  const pixels = new Uint8Array(lit.length * PIXELS);
  lit.forEach((count, frame) => {
    if (count > PIXELS) throw new Error(`frame ${frame} lights ${count} of ${PIXELS} pixels`);
    for (let pixel = 0; pixel < count; pixel += 1) pixels[frame * PIXELS + pixel] = 255;
  });
  return pixels;
}

const track = (lit: readonly number[]): ReturnType<typeof screenActivity> =>
  screenActivity(series(lit), PIXELS, FPS, PROFILE.sampling.toleranceLevels);

describe("measuring how much the screen moves", () => {
  it("reads a still screen as no movement at all", () => {
    const measured = track([30, 30, 30, 30]);
    expect(Array.from(measured.changed)).toEqual([0, 0, 0, 0]);
  });

  it("counts the share of the picture that changed", () => {
    const measured = track([0, 20, 20, 55]);
    expect(measured.changed[1]).toBeCloseTo(0.2, 6);
    expect(measured.changed[2]).toBeCloseTo(0, 6);
    expect(measured.changed[3]).toBeCloseTo(0.35, 6);
  });

  it("ignores a wobble smaller than the tolerance", () => {
    const pixels = new Uint8Array(2 * PIXELS).fill(100);
    for (let pixel = 0; pixel < PIXELS; pixel += 1) pixels[PIXELS + pixel] = 108;
    expect(screenActivity(pixels, PIXELS, FPS, 10).changed[1]).toBe(0);
    expect(screenActivity(pixels, PIXELS, FPS, 4).changed[1]).toBe(1);
  });

  it("reports its own length in seconds", () => {
    expect(activityDuration(track([0, 0, 0, 0, 0, 0, 0, 0]))).toBe(2);
  });
});

describe("deciding when the screen is working", () => {
  it("finds nothing in a screen that never moves", () => {
    expect(detectScreenActivity(track(new Array(40).fill(10)), PROFILE)).toEqual([]);
  });

  it("opens only after the movement holds", () => {
    const lit = [0, 0, 0, 0, 20, 20, 20, 40, 60, 80, 100, 80, 60, 40, 20];
    const windows = detectScreenActivity(track(lit), PROFILE);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.start).toBeGreaterThanOrEqual(1);
  });

  it("does not cut the screen away on a single still frame", () => {
    const lit = [0, 20, 40, 60, 60, 80, 100, 80, 60];
    const windows = detectScreenActivity(track(lit), PROFILE);
    expect(windows).toHaveLength(1);
  });

  it("closes when the screen stays still long enough", () => {
    const moving = [0, 20, 40, 60, 80, 100];
    const still = new Array(20).fill(100);
    const windows = detectScreenActivity(track([...moving, ...still]), PROFILE);
    expect(windows).toHaveLength(1);
    expect(windows[0]?.end).toBeLessThan(activityDuration(track([...moving, ...still])));
  });

  it("finds both bursts when the screen works, rests and works again", () => {
    const burst = [20, 40, 60, 80, 100];
    const rest = new Array(16).fill(100);
    const again = [80, 60, 40, 20, 0];
    const windows = detectScreenActivity(track([0, ...burst, ...rest, ...again, ...new Array(16).fill(0)]), PROFILE);
    expect(windows).toHaveLength(2);
    expect(windows[1]?.start).toBeGreaterThan(windows[0]?.end ?? 0);
  });
});

describe("screenJumps", () => {
  it("reports the frame of each big change, honouring the minimum spacing", () => {
    const moments = screenJumps(track([0, ...new Array(13).fill(100), 0, ...new Array(6).fill(100)]), 0.5, 3);
    expect(moments).toEqual([1 / FPS, 14 / FPS]);
  });

  it("ignores a change that lands within the minimum spacing of the previous one", () => {
    const moments = screenJumps(track([0, 100, 100, 100, 0, ...new Array(8).fill(100)]), 0.5, 3);
    expect(moments).toEqual([1 / FPS]);
  });

  it("stays empty for a screen that never jumps", () => {
    expect(screenJumps(track(new Array(40).fill(100)), 0.5, 3)).toEqual([]);
  });
});
