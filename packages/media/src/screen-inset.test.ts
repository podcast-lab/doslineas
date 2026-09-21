import { describe, expect, it } from "vitest";
import { insetEnableExpression, screenInsetFilter, screenInsetPlan, screenSpans } from "./screen-inset.js";

describe("screenSpans", () => {
  it("runs each slide from its change to the next, and the last one to the end", () => {
    expect(screenSpans([600, 800, 1100], 1449.5, 4)).toEqual([
      { start: 600, end: 800 },
      { start: 800, end: 1100 },
      { start: 1100, end: 1449.5 }
    ]);
  });

  it("absorbs a span shorter than the minimum into the previous one", () => {
    expect(screenSpans([600, 800, 802], 1449.5, 4)).toEqual([
      { start: 600, end: 802 },
      { start: 802, end: 1449.5 }
    ]);
  });

  it("stays empty when the screen never changes", () => {
    expect(screenSpans([], 1449.5, 4)).toEqual([]);
  });

  it("ignores moments outside the timeline", () => {
    expect(screenSpans([-5, 700, 5000], 1449.5, 4)).toEqual([{ start: 700, end: 1449.5 }]);
  });
});

describe("insetEnableExpression", () => {
  it("enables the overlay only during the spans", () => {
    expect(insetEnableExpression([{ start: 600, end: 800 }, { start: 900, end: 1000 }])).toBe(
      "between(t,600.000,800.000)+between(t,900.000,1000.000)"
    );
  });

  it("disables the overlay when there are no spans", () => {
    expect(insetEnableExpression([])).toBe("0");
  });
});

describe("screenInsetPlan", () => {
  const base = {
    master: "master-switched.mp4",
    slide: "iso4.mp4",
    inset: "program.mp4",
    target: "master.mp4",
    spans: [{ start: 600, end: 800 }],
    offsetSeconds: 10.433,
    fps: 30,
    layout: {
      width: 1920,
      height: 1080,
      insetPercent: 26,
      insetCorner: "bottom-right" as const,
      insetMarginPercent: 3
    }
  };

  it("feeds the slide and the inset with the silence offset so they line up with the switched master", () => {
    const plan = screenInsetPlan(base);
    expect(plan.args).toContain("-itsoffset");
    expect(plan.args.join(" ")).toContain("-itsoffset -10.433 -i iso4.mp4");
    expect(plan.args.join(" ")).toContain("-itsoffset -10.433 -i program.mp4");
  });

  it("keeps the switched master audio untouched", () => {
    const plan = screenInsetPlan(base);
    expect(plan.args).toContain("copy");
    expect(plan.args.join(" ")).toContain("-map 0:a");
  });

  it("fits the slide to the frame and drops the inset in the chosen corner", () => {
    const filter = screenInsetPlan(base).filter;
    expect(filter).toContain("force_original_aspect_ratio=decrease");
    expect(filter).toContain("scale=500:-2");
    expect(filter).toContain("overlay=x=W-w-58:y=H-h-58");
    expect(filter).toContain("overlay=enable='between(t,600.000,800.000)'");
  });
});

describe("an inset that follows whoever is talking", () => {
  const layout = {
    width: 1920,
    height: 1080,
    insetPercent: 26,
    insetCorner: "bottom-right" as const,
    insetMarginPercent: 3
  };
  const input = {
    master: "master-multicam.mp4",
    slide: "iso-4.mp4",
    inset: null,
    target: "master.mp4",
    spans: [{ start: 10, end: 20 }],
    offsetSeconds: 12.7,
    fps: 30,
    layout
  };

  it("takes the inset from the master itself instead of a third input", () => {
    const filter = screenInsetFilter(input);
    expect(filter).toContain("[0:v]split=2[base][pipsrc]");
    expect(filter).toContain("[pipsrc]scale=");
    expect(filter).not.toContain("[2:v]");
  });

  it("opens only the master and the slide", () => {
    const plan = screenInsetPlan(input);
    expect(plan.args.filter((arg) => arg === "-i")).toHaveLength(2);
  });
});
