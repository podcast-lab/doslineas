import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ClipProfile } from "./clip-profile.js";
import { parseClipProfile } from "./clip-profile.js";
import type { HighlightPick } from "./highlights.js";
import {
  chooseByRules,
  formatUtterances,
  fromPicks,
  rankWindows,
  scoreWindow,
  selectHighlights,
  toUtterances
} from "./highlights.js";
import type { Transcript, TranscriptWord } from "./transcript.js";

const profilePath = fileURLToPath(new URL("../../../config/clip-profile.json", import.meta.url));
const repoProfile = (): ClipProfile => parseClipProfile(JSON.parse(readFileSync(profilePath, "utf8")));

function speech(from: number, to: number, speaker: string, text: string): TranscriptWord[] {
  const pieces = text.split(" ");
  const step = (to - from) / pieces.length;
  return pieces.map((word, index) => ({
    text: word,
    startSeconds: Number((from + index * step).toFixed(3)),
    endSeconds: Number((from + (index + 1) * step).toFixed(3)),
    speaker
  }));
}

function transcriptOf(words: readonly TranscriptWord[]): Transcript {
  return { version: 1, session: "2026-08-20-ep12", language: "es", words: [...words] };
}

const SHORT_PROFILE: ClipProfile = parseClipProfile({
  ...JSON.parse(readFileSync(profilePath, "utf8")),
  clip: { minSeconds: 4, maxSeconds: 12, targetSeconds: 8, count: 2 },
  captions: { ...repoProfile().captions, maxSeconds: 2.4 }
});

const CONVERSATION = transcriptOf([
  ...speech(0, 5, "Ana Ruiz", "hola y bienvenidos a una nueva edicion del programa de hoy"),
  ...speech(6, 11, "Luis Vega", "la clave esta en que nadie mide lo que de verdad importa aqui"),
  ...speech(12, 17, "Ana Ruiz", "el error que cometimos fue creer que el problema era el precio"),
  ...speech(18, 24, "Luis Vega", "por ejemplo la primera vez que lo probamos me di cuenta de todo")
]);

describe("utterances", () => {
  it("splits the transcript by speaker and by pause", () => {
    const utterances = toUtterances(CONVERSATION, 0.7);
    expect(utterances).toHaveLength(4);
    expect(utterances[0]?.speaker).toBe("Ana Ruiz");
    expect(utterances[1]?.startSeconds).toBe(6);
    expect(utterances[0]?.gapBefore).toBe(Number.POSITIVE_INFINITY);
    expect(utterances.at(-1)?.gapAfter).toBe(Number.POSITIVE_INFINITY);
  });

  it("numbers the turns so the model can point at them", () => {
    const text = formatUtterances(toUtterances(CONVERSATION, 0.7));
    expect(text.split("\n")[0]).toMatch(/^\[0\] 0\.0-5\.0 Ana Ruiz: hola/);
  });
});

describe("scoring", () => {
  it("rewards a window that opens and closes on a pause", () => {
    const utterances = toUtterances(CONVERSATION, 0.7);
    const score = scoreWindow(utterances.slice(1, 3), SHORT_PROFILE);
    expect(score.opening).toBe(1);
    expect(score.closing).toBe(1);
    expect(score.exchange).toBe(1);
    expect(score.total).toBeGreaterThan(0);
    expect(score.total).toBeLessThanOrEqual(1);
  });

  it("counts the hook words configured in the profile", () => {
    const utterances = toUtterances(CONVERSATION, 0.7);
    expect(scoreWindow(utterances.slice(1, 2), SHORT_PROFILE).hooks).toBeGreaterThan(0);
    expect(scoreWindow(utterances.slice(0, 1), SHORT_PROFILE).hooks).toBe(0);
  });

  it("only offers windows that fit the configured length", () => {
    const windows = rankWindows(toUtterances(CONVERSATION, 0.7), SHORT_PROFILE);
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      const seconds = window.endSeconds - window.startSeconds;
      expect(seconds).toBeGreaterThanOrEqual(SHORT_PROFILE.clip.minSeconds);
      expect(seconds).toBeLessThanOrEqual(SHORT_PROFILE.clip.maxSeconds);
    }
  });
});

describe("choosing by rules", () => {
  it("never returns overlapping moments", () => {
    const chosen = chooseByRules(toUtterances(CONVERSATION, 0.7), SHORT_PROFILE);
    expect(chosen.length).toBeGreaterThan(0);
    expect(chosen.length).toBeLessThanOrEqual(SHORT_PROFILE.clip.count);
    for (let index = 1; index < chosen.length; index += 1) {
      expect(chosen[index]?.startSeconds).toBeGreaterThanOrEqual(chosen[index - 1]?.endSeconds ?? 0);
    }
  });
});

describe("what the model asks for", () => {
  const utterances = toUtterances(CONVERSATION, 0.7);

  it("takes a well formed pick", () => {
    const picks: HighlightPick[] = [{ startUtterance: 1, endUtterance: 2, title: "La clave", reason: "afirmacion" }];
    const { highlights } = fromPicks(picks, utterances, SHORT_PROFILE);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]?.startSeconds).toBe(6);
    expect(highlights[0]?.title).toBe("La clave");
    expect(highlights[0]?.source).toBe("llm");
  });

  it("refuses turns that do not exist instead of inventing them", () => {
    const picks: HighlightPick[] = [{ startUtterance: 40, endUtterance: 41, title: "Fantasma", reason: "" }];
    const { highlights, warnings } = fromPicks(picks, utterances, SHORT_PROFILE);
    expect(highlights).toHaveLength(0);
    expect(warnings[0]).toMatch(/do not exist/);
  });

  it("trims a pick that runs past the maximum length", () => {
    const picks: HighlightPick[] = [{ startUtterance: 0, endUtterance: 3, title: "Todo", reason: "" }];
    const { highlights } = fromPicks(picks, utterances, SHORT_PROFILE);
    expect(highlights).toHaveLength(1);
    const seconds = (highlights[0]?.endSeconds ?? 0) - (highlights[0]?.startSeconds ?? 0);
    expect(seconds).toBeLessThanOrEqual(SHORT_PROFILE.clip.maxSeconds);
  });

  it("drops a second pick that overlaps the first", () => {
    const picks: HighlightPick[] = [
      { startUtterance: 0, endUtterance: 1, title: "Uno", reason: "" },
      { startUtterance: 1, endUtterance: 2, title: "Dos", reason: "" }
    ];
    const { highlights, warnings } = fromPicks(picks, utterances, SHORT_PROFILE);
    expect(highlights).toHaveLength(1);
    expect(warnings.some((warning) => warning.includes("overlaps"))).toBe(true);
  });
});

describe("falling back to the rules", () => {
  const utterances = toUtterances(CONVERSATION, 0.7);

  it("uses the rules when there is no model", () => {
    const { highlights } = selectHighlights(utterances, SHORT_PROFILE, null);
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights.every((highlight) => highlight.source === "rules")).toBe(true);
  });

  it("tops up with the rules when the model gives too few", () => {
    const picks: HighlightPick[] = [{ startUtterance: 0, endUtterance: 1, title: "Uno", reason: "" }];
    const { highlights, warnings } = selectHighlights(utterances, SHORT_PROFILE, picks);
    expect(highlights.length).toBeGreaterThan(1);
    expect(highlights.some((highlight) => highlight.source === "llm")).toBe(true);
    expect(warnings.some((warning) => warning.includes("come from the rules"))).toBe(true);
  });

  it("keeps the model picks when it gives enough", () => {
    const picks: HighlightPick[] = [
      { startUtterance: 0, endUtterance: 1, title: "Uno", reason: "" },
      { startUtterance: 2, endUtterance: 3, title: "Dos", reason: "" }
    ];
    const { highlights } = selectHighlights(utterances, SHORT_PROFILE, picks);
    expect(highlights).toHaveLength(2);
    expect(highlights.every((highlight) => highlight.source === "llm")).toBe(true);
  });
});
