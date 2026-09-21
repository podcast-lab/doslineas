import { describe, expect, it } from "vitest";
import { contrastRatio, fontFaceCss, fontStack, readableOn, relativeLuminance, toRgb, withAlpha } from "./theme.js";

describe("colours", () => {
  it("reads a #rrggbb colour", () => {
    expect(toRgb("#22d3ee")).toEqual({ r: 34, g: 211, b: 238 });
    expect(() => toRgb("cyan")).toThrow(/not a #rrggbb/);
  });

  it("adds alpha and clamps it", () => {
    expect(withAlpha("#0b0f19", 0.85)).toBe("rgba(11, 15, 25, 0.85)");
    expect(withAlpha("#0b0f19", 4)).toBe("rgba(11, 15, 25, 1)");
  });

  it("measures luminance and contrast the way the accessibility rules do", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
  });

  it("picks the most readable colour the kit offers", () => {
    expect(readableOn("#0b0f19", ["#f8fafc", "#4f46e5"])).toBe("#f8fafc");
    expect(readableOn("#f8fafc", ["#f8fafc", "#4f46e5"])).toBe("#4f46e5");
  });

  it("falls back to black or white when the kit offers nothing", () => {
    expect(readableOn("#ffffff", [])).toBe("#000000");
    expect(readableOn("#0b0f19", [])).toBe("#ffffff");
  });
});

describe("fonts", () => {
  it("always leaves a fallback stack behind the brand font", () => {
    expect(fontStack({ family: "Mulish", dataUrl: null, weight: 700 })).toContain("'Mulish', system-ui");
  });

  it("only declares a face for the fonts the kit actually ships", () => {
    const css = fontFaceCss([
      { family: "Mulish", dataUrl: "data:font/woff2;base64,AAAA", weight: 700 },
      { family: "Inter", dataUrl: null, weight: 400 }
    ]);
    expect(css).toContain("font-family: 'Mulish'");
    expect(css).toContain("src: url(data:font/woff2;base64,AAAA)");
    expect(css).not.toContain("Inter");
  });
});
