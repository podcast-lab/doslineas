import { describe, expect, it } from "vitest";
import { parseTranscript } from "@doslineas/core";
import { deepgramQuery, toTranscript } from "./deepgram.js";

const request = {
  audioPath: "/tmp/master-audio.flac",
  session: "test",
  language: "es",
  diarize: true
};

function response(words: readonly Record<string, unknown>[]): unknown {
  return { results: { channels: [{ alternatives: [{ words }] }] } };
}

describe("deepgram query", () => {
  it("carries the language and diarization the request asks for", () => {
    const query = new URLSearchParams(deepgramQuery(request, "nova-3"));
    expect(query.get("model")).toBe("nova-3");
    expect(query.get("language")).toBe("es");
    expect(query.get("diarize")).toBe("true");
  });
});

describe("deepgram transcript mapping", () => {
  it("clamps words whose start overlaps the previous word so the transcript stays monotonic", () => {
    const raw = response([
      { word: "una", start: 1.0, end: 1.4, speaker: 0 },
      { word: "revolucion", start: 1.38, end: 2.1, speaker: 0 },
      { word: "clara", start: 2.05, end: 2.6, speaker: 1 }
    ]);

    const transcript = toTranscript(raw, request);

    expect(transcript.words.map((word) => [word.startSeconds, word.endSeconds])).toEqual([
      [1.0, 1.4],
      [1.4, 2.1],
      [2.1, 2.6]
    ]);
    expect(() => parseTranscript(transcript)).not.toThrow();
  });

  it("prefers the punctuated form and labels speakers", () => {
    const raw = response([{ word: "hola", punctuated_word: "Hola,", start: 0, end: 0.5, speaker: 2 }]);
    const [word] = toTranscript(raw, request).words;
    expect(word).toMatchObject({ text: "Hola,", speaker: "speaker 2" });
  });
});
