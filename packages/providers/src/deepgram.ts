import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { z } from "zod";
import type { Transcriber, Transcript, TranscriptionRequest, TranscriptWord } from "@doslineas/core";

export const DEEPGRAM_ENDPOINT = "https://api.deepgram.com/v1/listen";
export const DEEPGRAM_MODEL = "nova-3";

const DeepgramWordSchema = z.object({
  word: z.string(),
  punctuated_word: z.string().optional(),
  start: z.number(),
  end: z.number(),
  speaker: z.number().optional()
});

const DeepgramResponseSchema = z.object({
  results: z.object({
    channels: z
      .array(
        z.object({
          alternatives: z
            .array(z.object({ words: z.array(DeepgramWordSchema) }))
            .min(1)
        })
      )
      .min(1)
  })
});

export interface DeepgramOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly contentType?: string;
}

export function deepgramQuery(request: TranscriptionRequest, model: string): string {
  const params = new URLSearchParams({
    model,
    language: request.language,
    punctuate: "true",
    smart_format: "true",
    diarize: String(request.diarize)
  });
  return params.toString();
}

export function toTranscript(raw: unknown, request: TranscriptionRequest): Transcript {
  const parsed = DeepgramResponseSchema.parse(raw);
  const alternative = parsed.results.channels[0]?.alternatives[0];
  if (alternative === undefined) throw new Error("Deepgram answered without an alternative to read");

  let previousEnd = 0;
  const words: TranscriptWord[] = alternative.words.map((word) => {
    const startSeconds = Math.max(word.start, previousEnd);
    const endSeconds = Math.max(startSeconds, word.end);
    previousEnd = endSeconds;
    return {
      text: word.punctuated_word ?? word.word,
      startSeconds,
      endSeconds,
      speaker: word.speaker === undefined ? "" : `speaker ${word.speaker}`
    };
  });

  return { version: 1, session: request.session, language: request.language, words };
}

export function deepgramTranscriber(options: DeepgramOptions): Transcriber {
  const model = options.model ?? DEEPGRAM_MODEL;
  const endpoint = options.endpoint ?? DEEPGRAM_ENDPOINT;
  const contentType = options.contentType ?? "audio/flac";

  return {
    name: `deepgram:${model}`,
    async transcribe(request: TranscriptionRequest): Promise<Transcript> {
      const { size } = await stat(request.audioPath);
      const body = Readable.toWeb(createReadStream(request.audioPath)) as ReadableStream<Uint8Array>;

      const response = await fetch(`${endpoint}?${deepgramQuery(request, model)}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${options.apiKey}`,
          "Content-Type": contentType,
          "Content-Length": String(size)
        },
        body,
        duplex: "half"
      } as RequestInit & { duplex: "half" });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 400);
        throw new Error(`Deepgram answered ${response.status}: ${detail}`);
      }

      return toTranscript(await response.json(), request);
    }
  };
}
