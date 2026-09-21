import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseExplainerProfile } from "./explainer-profile.js";

const profilePath = fileURLToPath(new URL("../../../config/explainer-profile.json", import.meta.url));
const raw = (): Record<string, unknown> => JSON.parse(readFileSync(profilePath, "utf8"));

describe("explainer profile", () => {
  it("the profile shipped in the repo is valid", () => {
    expect(() => parseExplainerProfile(raw())).not.toThrow();
  });

  it("takes the person and the screen from different inputs", () => {
    const layout = { ...(raw()["layout"] as object), personInput: 4, screenInput: 4 };
    expect(() => parseExplainerProfile({ ...raw(), layout })).toThrow(/same input/);
  });

  it("refuses to close faster than it opens", () => {
    const activity = { ...(raw()["activity"] as object), openMs: 2000, closeMs: 500 };
    expect(() => parseExplainerProfile({ ...raw(), activity })).toThrow(/closing must be slower/);
  });

  it("refuses a slide change smaller than a pen stroke", () => {
    const activity = { ...(raw()["activity"] as object), changedRatio: 0.4, jumpRatio: 0.1 };
    expect(() => parseExplainerProfile({ ...raw(), activity })).toThrow(/repaints more/);
  });

  it("keeps the explainer horizontal", () => {
    expect(() => parseExplainerProfile({ ...raw(), frame: { width: 1080, height: 1920 } })).toThrow(/horizontal/);
  });

  it("keeps the inset big enough to see and small enough to be an inset", () => {
    const layout = raw()["layout"] as { insetPercent: number };
    expect(() => parseExplainerProfile({ ...raw(), layout: { ...layout, insetPercent: 5 } })).toThrow();
    expect(() => parseExplainerProfile({ ...raw(), layout: { ...layout, insetPercent: 80 } })).toThrow();
  });
});
