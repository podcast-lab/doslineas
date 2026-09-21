import { describe, expect, it } from "vitest";
import type { Transcript, TranscriptWord } from "./transcript.js";
import { parseTranscript, shiftCues, timecode, toCues, toPlainText, toSrt, toWebVtt } from "./transcript.js";

function words(entries: readonly [string, number, number, string][]): TranscriptWord[] {
  return entries.map(([text, startSeconds, endSeconds, speaker]) => ({ text, startSeconds, endSeconds, speaker }));
}

function transcriptOf(entries: readonly [string, number, number, string][]): Transcript {
  return { version: 1, session: "2026-08-20-ep12", language: "es", words: words(entries) };
}

const DIALOGUE = transcriptOf([
  ["Hola", 0.0, 0.3, "Ana Ruiz"],
  ["y", 0.3, 0.4, "Ana Ruiz"],
  ["bienvenidos", 0.4, 1.1, "Ana Ruiz"],
  ["Gracias", 1.4, 2.0, "Luis Vega"],
  ["por", 2.0, 2.2, "Luis Vega"],
  ["invitarme", 2.2, 3.0, "Luis Vega"]
]);

describe("transcript", () => {
  it("rejects words that go backwards", () => {
    expect(() => parseTranscript(transcriptOf([["uno", 2, 3, "Ana"], ["dos", 1, 1.5, "Ana"]]))).toThrow(/before/);
  });

  it("rejects a word that ends before it starts", () => {
    expect(() => parseTranscript(transcriptOf([["uno", 3, 2, "Ana"]]))).toThrow(/ends before/);
  });

  it("accepts a well ordered transcript", () => {
    expect(parseTranscript(DIALOGUE).words).toHaveLength(6);
  });
});

describe("cues", () => {
  it("breaks a cue when the speaker changes", () => {
    const cues = toCues(DIALOGUE);
    expect(cues).toEqual([
      { startSeconds: 0, endSeconds: 1.1, speaker: "Ana Ruiz", text: "Hola y bienvenidos" },
      { startSeconds: 1.4, endSeconds: 3, speaker: "Luis Vega", text: "Gracias por invitarme" }
    ]);
  });

  it("breaks a cue on a long pause", () => {
    const cues = toCues(transcriptOf([
      ["uno", 0, 0.4, "Ana"],
      ["dos", 3.0, 3.4, "Ana"]
    ]));
    expect(cues).toHaveLength(2);
  });

  it("breaks a cue that would run too long or too wide", () => {
    const long = transcriptOf(
      Array.from({ length: 40 }, (_, index) => ["palabra", index * 0.2, index * 0.2 + 0.19, "Ana"] as [string, number, number, string])
    );
    const cues = toCues(long);
    expect(cues.length).toBeGreaterThan(1);
    for (const cue of cues) {
      expect(cue.endSeconds - cue.startSeconds).toBeLessThanOrEqual(5.2);
      expect(cue.text.length).toBeLessThanOrEqual(84);
    }
  });

  it("shifts every cue when the delivered video carries an intro", () => {
    expect(shiftCues(toCues(DIALOGUE), 5)[0]).toEqual({
      startSeconds: 5,
      endSeconds: 6.1,
      speaker: "Ana Ruiz",
      text: "Hola y bienvenidos"
    });
  });
});

describe("caption files", () => {
  it("writes timecodes with the separator each format wants", () => {
    expect(timecode(0, ".")).toBe("00:00:00.000");
    expect(timecode(3723.456, ",")).toBe("01:02:03,456");
    expect(timecode(-1, ".")).toBe("00:00:00.000");
  });

  it("writes WebVTT with a header and speaker labels", () => {
    const vtt = toWebVtt(toCues(DIALOGUE));
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:01.100\nAna Ruiz: Hola y bienvenidos");
  });

  it("writes SRT numbered from one and without speaker labels when asked", () => {
    const srt = toSrt(toCues(DIALOGUE), { withSpeakers: false });
    expect(srt).toBe(
      "1\n00:00:00,000 --> 00:00:01,100\nHola y bienvenidos\n\n2\n00:00:01,400 --> 00:00:03,000\nGracias por invitarme\n"
    );
  });

  it("writes the plain reading copy as one paragraph per speaker turn", () => {
    expect(toPlainText(toCues(DIALOGUE))).toBe("Ana Ruiz: Hola y bienvenidos\n\nLuis Vega: Gracias por invitarme\n");
  });

  it("writes empty files for an empty transcript instead of failing", () => {
    const cues = toCues(transcriptOf([]));
    expect(cues).toEqual([]);
    expect(toWebVtt(cues)).toBe("WEBVTT\n\n");
    expect(toSrt(cues)).toBe("");
    expect(toPlainText(cues)).toBe("");
  });
});
