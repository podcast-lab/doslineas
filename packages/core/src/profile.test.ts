import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseProfile, personInputs, roleOfInput, variableInput, wideInput } from "./profile.js";

const profilePath = fileURLToPath(new URL("../../../config/edit-profile.json", import.meta.url));
const repoProfile = () => parseProfile(JSON.parse(readFileSync(profilePath, "utf8")));

describe("edit profile", () => {
  it("the profile shipped in the repo is valid", () => {
    expect(() => repoProfile()).not.toThrow();
  });

  it("keeps the values measured in annex A", () => {
    const profile = repoProfile();
    expect(profile.shot.minSeconds).toBe(1.2);
    expect(profile.shot.targetSeconds).toBeGreaterThanOrEqual(4);
    expect(profile.shot.targetSeconds).toBeLessThanOrEqual(5);
    expect(profile.cuts.perMinuteTarget).toBe(10);
    expect(profile.silence.paddingSeconds).toBe(0.3);
  });

  it("trims only silences of 5 s or longer, as the client asked", () => {
    expect(repoProfile().silence.thresholdSeconds).toBe(5);
  });

  it("rejects a minimum shot longer than the maximum", () => {
    const profile = repoProfile();
    expect(() => parseProfile({ ...profile, shot: { ...profile.shot, minSeconds: 20 } })).toThrow();
  });

  it("rejects padding that would fill the silence being trimmed", () => {
    const profile = repoProfile();
    expect(() => parseProfile({ ...profile, silence: { ...profile.silence, paddingSeconds: 3.0 } })).toThrow();
  });

  it("applies the studio's real wiring: speakers on 1 and 2, wide on 3", () => {
    const profile = repoProfile();
    expect(roleOfInput(profile, 1, "screen")).toBe("speaker1");
    expect(roleOfInput(profile, 2, "screen")).toBe("speaker2");
    expect(roleOfInput(profile, 3, "screen")).toBe("wide");
    expect(roleOfInput(profile, 4, "guest3")).toBe("guest3");
    expect(wideInput(profile)).toBe(3);
    expect(variableInput(profile)).toBe(4);

    const forced = { ...profile, input4: { ...profile.input4, forcedRole: "screen" as const } };
    expect(roleOfInput(forced, 4, "guest3")).toBe("screen");
  });

  it("leaves input 4 out of the people when it carries a screen", () => {
    const profile = repoProfile();
    expect(personInputs(profile, "screen")).toEqual([1, 2]);
    expect(personInputs(profile, "guest3")).toEqual([1, 2, 4]);
  });

  it("reads the roles off the profile instead of assuming the input number", () => {
    const profile = repoProfile();
    const wired = parseProfile({ ...profile, inputs: { "1": "wide", "2": "speaker1", "3": "speaker2", "4": "variable" } });
    expect(wideInput(wired)).toBe(1);
    expect(variableInput(wired)).toBe(4);
    expect(roleOfInput(wired, 1, "screen")).toBe("wide");
    expect(roleOfInput(wired, 2, "screen")).toBe("speaker1");
    expect(personInputs(wired, "screen")).toEqual([2, 3]);
    expect(personInputs(wired, "guest3")).toEqual([2, 3, 4]);
  });

  it("refuses a layout without a wide shot or with a speaker on two inputs", () => {
    const profile = repoProfile();
    const noWide = { "1": "speaker1", "2": "speaker2", "3": "variable", "4": "variable" };
    expect(() => parseProfile({ ...profile, inputs: noWide })).toThrow();
    const twice = { "1": "wide", "2": "speaker1", "3": "speaker1", "4": "variable" };
    expect(() => parseProfile({ ...profile, inputs: twice })).toThrow();
  });
});
