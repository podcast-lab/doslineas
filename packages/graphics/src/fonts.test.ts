import { access } from "node:fs/promises";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { fontDataUrl, loadFont, nearestStandardWeight, standardFontFile } from "./fonts.js";

describe("the standard typeface", () => {
  it("ships with the software instead of being downloaded at render time", async () => {
    const file = standardFontFile(700);
    expect(basename(file)).toBe("montserrat-latin-700-normal.woff2");
    await expect(access(file)).resolves.toBeUndefined();
  });

  it("rounds any weight the kit asks for to one it actually has", () => {
    expect(nearestStandardWeight(400)).toBe(500);
    expect(nearestStandardWeight(500)).toBe(500);
    expect(nearestStandardWeight(600)).toBe(500);
    expect(nearestStandardWeight(900)).toBe(700);
  });

  it("embeds itself in the templates when the kit names it without a file", async () => {
    const face = await loadFont({ family: "Montserrat", file: null, weight: 700 });
    expect(face.dataUrl?.startsWith("data:font/woff2;base64,")).toBe(true);
  });

  it("does not pass itself off as a font it is not", async () => {
    const face = await loadFont({ family: "Poppins", file: null, weight: 700 });
    expect(face).toEqual({ family: "Poppins", weight: 700, dataUrl: null });
  });

  it("refuses a file it cannot embed", async () => {
    await expect(fontDataUrl("brand.pdf")).rejects.toThrow(/unsupported file/);
  });
});
