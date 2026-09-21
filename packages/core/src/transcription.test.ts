import { describe, expect, it } from "vitest";
import type { Episode } from "./brand.js";
import type { Edl } from "./edl.js";
import { parseEdl } from "./edl.js";
import type { Transcript } from "./transcript.js";
import { nameSpeakers } from "./transcription.js";

const EDL: Edl = parseEdl({
  version: 1,
  session: "2026-08-20-ep12",
  fps: 25,
  profile: "podcast-v1",
  sources: [1, 2, 3, 4].map((input) => ({
    input,
    role: input === 1 ? "wide" : input === 2 ? "speaker1" : input === 3 ? "speaker2" : "screen",
    video: `iso${input}.mp4`,
    audio: input === 1 ? "program.wav" : null,
    durationSeconds: 40
  })),
  segments: [
    { tOut: 0, dur: 5, input: 2, tIn: 0, reason: "initial" },
    { tOut: 5, dur: 5, input: 3, tIn: 5, reason: "turn" },
    { tOut: 10, dur: 5, input: 1, tIn: 10, reason: "refresh" },
    { tOut: 15, dur: 5, input: 2, tIn: 15, reason: "turn" }
  ],
  discards: [],
  audio: { source: "program", gains: {} }
});

const EPISODE: Episode = {
  title: "Episodio 12",
  subtitle: "",
  participants: [
    { input: 2, name: "Ana Ruiz", title: "Presentadora" },
    { input: 3, name: "Luis Vega", title: "Invitado" }
  ]
};

function transcriptOf(entries: readonly [string, number, number, string][]): Transcript {
  return {
    version: 1,
    session: "2026-08-20-ep12",
    language: "es",
    words: entries.map(([text, startSeconds, endSeconds, speaker]) => ({ text, startSeconds, endSeconds, speaker }))
  };
}

describe("putting names to the diarised speakers", () => {
  it("names each label after the person the edit was showing", () => {
    const transcript = transcriptOf([
      ["hola", 0.5, 1.0, "speaker 0"],
      ["bienvenidos", 1.0, 2.0, "speaker 0"],
      ["gracias", 5.5, 6.2, "speaker 1"],
      ["por", 6.2, 6.5, "speaker 1"],
      ["invitarme", 6.5, 7.4, "speaker 1"]
    ]);
    const named = nameSpeakers(transcript, EDL, EPISODE);
    expect(named.words.map((word) => word.speaker)).toEqual([
      "Ana Ruiz",
      "Ana Ruiz",
      "Luis Vega",
      "Luis Vega",
      "Luis Vega"
    ]);
  });

  it("decides by majority instead of by the first word", () => {
    const transcript = transcriptOf([
      ["hola", 0.5, 1.0, "speaker 0"],
      ["que", 1.0, 1.4, "speaker 0"],
      ["tal", 1.4, 1.8, "speaker 0"],
      ["eh", 5.1, 5.3, "speaker 0"],
      ["bueno", 16.0, 16.4, "speaker 0"],
      ["vamos", 16.4, 16.9, "speaker 0"]
    ]);
    const named = nameSpeakers(transcript, EDL, EPISODE);
    expect(new Set(named.words.map((word) => word.speaker))).toEqual(new Set(["Ana Ruiz"]));
  });

  it("leaves the label alone when the wide shot was on screen", () => {
    const transcript = transcriptOf([["algo", 11.0, 12.0, "speaker 2"]]);
    const named = nameSpeakers(transcript, EDL, EPISODE);
    expect(named.words[0]?.speaker).toBe("speaker 2");
  });

  it("never gives one name to two different labels", () => {
    const transcript = transcriptOf([
      ["uno", 0.5, 1.0, "speaker 0"],
      ["dos", 16.0, 16.5, "speaker 1"]
    ]);
    const named = nameSpeakers(transcript, EDL, EPISODE);
    const names = named.words.map((word) => word.speaker);
    expect(names[0]).toBe("Ana Ruiz");
    expect(names[1]).toBe("speaker 1");
  });

  it("keeps every word and its timing untouched", () => {
    const transcript = transcriptOf([["hola", 0.5, 1.0, "speaker 0"]]);
    const named = nameSpeakers(transcript, EDL, EPISODE);
    expect(named.words[0]?.startSeconds).toBe(0.5);
    expect(named.words[0]?.text).toBe("hola");
    expect(named.words).toHaveLength(transcript.words.length);
  });
});
