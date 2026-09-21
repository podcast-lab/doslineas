import { z } from "zod";

export const TranscriptWordSchema = z.object({
  text: z.string().min(1),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  speaker: z.string()
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export const TranscriptSchema = z.object({
  version: z.literal(1),
  session: z.string().min(1),
  language: z.string().min(1),
  words: z.array(TranscriptWordSchema)
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export interface Cue {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly speaker: string;
  readonly text: string;
}

export interface CueOptions {
  readonly maxSeconds: number;
  readonly maxCharacters: number;
  readonly gapSeconds: number;
}

export const DEFAULT_CUES: CueOptions = {
  maxSeconds: 5,
  maxCharacters: 84,
  gapSeconds: 0.8
};

export function parseTranscript(raw: unknown): Transcript {
  const transcript = TranscriptSchema.parse(raw);
  let previousEnd = -Infinity;

  transcript.words.forEach((word, index) => {
    if (word.endSeconds < word.startSeconds) {
      throw new Error(`word ${index} (${word.text}) ends before it starts`);
    }
    if (word.startSeconds < previousEnd - 1e-6) {
      throw new Error(`word ${index} (${word.text}) starts before the previous one ends`);
    }
    previousEnd = word.endSeconds;
  });

  return transcript;
}

function closes(cue: readonly TranscriptWord[], word: TranscriptWord, options: CueOptions): boolean {
  const first = cue[0];
  const last = cue.at(-1);
  if (first === undefined || last === undefined) return false;

  const characters = cue.reduce((total, entry) => total + entry.text.length + 1, 0) + word.text.length;
  return (
    word.speaker !== last.speaker ||
    word.startSeconds - last.endSeconds > options.gapSeconds ||
    word.endSeconds - first.startSeconds > options.maxSeconds ||
    characters > options.maxCharacters
  );
}

function cueOf(words: readonly TranscriptWord[]): Cue {
  const first = words[0];
  const last = words.at(-1);
  if (first === undefined || last === undefined) throw new Error("cannot build a cue without words");

  return {
    startSeconds: first.startSeconds,
    endSeconds: last.endSeconds,
    speaker: first.speaker,
    text: words.map((word) => word.text).join(" ")
  };
}

export function groupWords(
  words: readonly TranscriptWord[],
  options: CueOptions = DEFAULT_CUES
): TranscriptWord[][] {
  const groups: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];

  for (const word of words) {
    if (current.length > 0 && closes(current, word, options)) {
      groups.push(current);
      current = [];
    }
    current.push(word);
  }
  if (current.length > 0) groups.push(current);

  return groups;
}

export function toCues(transcript: Transcript, options: CueOptions = DEFAULT_CUES): Cue[] {
  return groupWords(transcript.words, options).map(cueOf);
}

export function shiftCues(cues: readonly Cue[], seconds: number): Cue[] {
  return cues.map((cue) => ({
    ...cue,
    startSeconds: cue.startSeconds + seconds,
    endSeconds: cue.endSeconds + seconds
  }));
}

export function timecode(seconds: number, millisecondSeparator: "." | ","): string {
  const clamped = Math.max(0, seconds);
  const whole = Math.floor(clamped);
  const milliseconds = Math.round((clamped - whole) * 1000);
  const pad = (value: number, width = 2): string => String(value).padStart(width, "0");

  return [
    pad(Math.floor(whole / 3600)),
    pad(Math.floor(whole / 60) % 60),
    pad(whole % 60)
  ].join(":") + millisecondSeparator + pad(milliseconds, 3);
}

export interface CaptionOptions {
  readonly withSpeakers: boolean;
}

export const DEFAULT_CAPTIONS: CaptionOptions = { withSpeakers: true };

function line(cue: Cue, options: CaptionOptions): string {
  return options.withSpeakers && cue.speaker !== "" ? `${cue.speaker}: ${cue.text}` : cue.text;
}

export function toWebVtt(cues: readonly Cue[], options: CaptionOptions = DEFAULT_CAPTIONS): string {
  const blocks = cues.map(
    (cue) => `${timecode(cue.startSeconds, ".")} --> ${timecode(cue.endSeconds, ".")}\n${line(cue, options)}`
  );
  return `WEBVTT\n\n${blocks.join("\n\n")}${blocks.length > 0 ? "\n" : ""}`;
}

export function toSrt(cues: readonly Cue[], options: CaptionOptions = DEFAULT_CAPTIONS): string {
  const blocks = cues.map(
    (cue, index) =>
      `${index + 1}\n${timecode(cue.startSeconds, ",")} --> ${timecode(cue.endSeconds, ",")}\n${line(cue, options)}`
  );
  return `${blocks.join("\n\n")}${blocks.length > 0 ? "\n" : ""}`;
}

export function toPlainText(cues: readonly Cue[]): string {
  const paragraphs: string[] = [];
  let speaker = "";
  let sentence: string[] = [];

  const flush = (): void => {
    if (sentence.length === 0) return;
    paragraphs.push(speaker === "" ? sentence.join(" ") : `${speaker}: ${sentence.join(" ")}`);
    sentence = [];
  };

  for (const cue of cues) {
    if (cue.speaker !== speaker) {
      flush();
      speaker = cue.speaker;
    }
    sentence.push(cue.text);
  }
  flush();

  return `${paragraphs.join("\n\n")}${paragraphs.length > 0 ? "\n" : ""}`;
}
