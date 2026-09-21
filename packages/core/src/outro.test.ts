import { describe, expect, it } from "vitest";
import { DEFAULT_FAREWELL_PHRASES, DEFAULT_OFF_AIR_PHRASES, findOutroEnd } from "./outro.js";
import { findPhrases } from "./phrases.js";
import type { Transcript } from "./transcript.js";

const SETTINGS = {
  farewells: DEFAULT_FAREWELL_PHRASES,
  offAir: DEFAULT_OFF_AIR_PHRASES,
  joinSeconds: 0.8,
  tailSeconds: 1.0
};

function spoken(...words: readonly [string, number][]): Transcript {
  return {
    version: 1,
    session: "s",
    language: "es",
    words: words.map(([text, startSeconds]) => ({ text, startSeconds, endSeconds: startSeconds + 0.3, speaker: "A" }))
  };
}

describe("finding where the episode ends", () => {
  it("cuts after the last farewell, not the first one", () => {
    const transcript = spoken(
      ["gracias", 10.0], ["por", 10.3], ["venir.", 10.6],
      ["y", 12.0], ["otra", 12.3], ["cosa", 12.6],
      ["adiós.", 20.0],
      ["¿cómo", 24.0], ["fluyó?", 24.3]
    );

    expect(findOutroEnd(transcript, SETTINGS)).toBeCloseTo(21.3, 3);
  });

  it("keeps what is said right after the farewell without a pause", () => {
    const transcript = spoken(["Adiós", 20.0], ["a", 20.4], ["todos.", 20.7], ["¿Cómo", 25.0], ["fluyó?", 25.3]);

    expect(findOutroEnd(transcript, SETTINGS)).toBeCloseTo(22.0, 3);
  });

  it("never lets the margin reach the next word", () => {
    const transcript = spoken(["Adiós.", 20.0], ["Muy", 21.2], ["bien.", 21.5]);

    expect(findOutroEnd(transcript, SETTINGS)).toBeCloseTo(21.2, 3);
  });

  it("stops at an off-air word said straight after the farewell", () => {
    const transcript = spoken(["un", 20.0], ["abrazo", 20.3], ["corta,", 20.7], ["corta", 21.0]);

    expect(findOutroEnd(transcript, SETTINGS)).toBeCloseTo(20.7, 3);
  });

  it("cuts nothing on an off-air word with no farewell before it", () => {
    const transcript = spoken(["ya", 10.0], ["está", 10.3], ["listo", 10.6], ["el", 11.0], ["informe", 11.3]);

    expect(findOutroEnd(transcript, SETTINGS)).toBeNull();
  });

  it("takes the guest's name in place of the wildcard", () => {
    const transcript = spoken(["Muchas", 5.0], ["gracias,", 5.3], ["Piru,", 5.6], ["por", 5.9], ["venir.", 6.2]);

    expect(findPhrases(transcript, ["muchas gracias * por venir"])).toEqual([{ first: 0, last: 4 }]);
    expect(findOutroEnd(transcript, SETTINGS)).toBeCloseTo(7.5, 3);
  });

  it("says nothing when no farewell is heard", () => {
    const transcript = spoken(["seguimos", 1.0], ["hablando", 1.3]);

    expect(findOutroEnd(transcript, SETTINGS)).toBeNull();
  });
});
