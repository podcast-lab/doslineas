import type { ClipLayout, ClipProfile } from "./clip-profile.js";
import { anchorOf, wideAnchorOf } from "./clip-profile.js";
import type { Edl } from "./edl.js";
import { outputDuration } from "./edl.js";
import type { Highlight } from "./highlights.js";
import type { Input } from "./profile.js";
import type { Transcript, TranscriptWord } from "./transcript.js";
import { groupWords } from "./transcript.js";

export interface ShortCrop {
  readonly atSeconds: number;
  readonly durationSeconds: number;
  readonly input: Input;
  readonly anchor: number;
}

export interface CaptionWord {
  readonly text: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
}

export interface CaptionLine {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly speaker: string;
  readonly words: readonly CaptionWord[];
}

export interface Short {
  readonly index: number;
  readonly title: string;
  readonly reason: string;
  readonly source: Highlight["source"];
  readonly score: number;
  readonly masterStartSeconds: number;
  readonly masterEndSeconds: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly layout: ClipLayout;
  readonly crops: readonly ShortCrop[];
  readonly lines: readonly CaptionLine[];
}

export interface ShortsPlan {
  readonly version: 1;
  readonly session: string;
  readonly profile: string;
  readonly fps: number;
  readonly layout: ClipLayout;
  readonly masterSeconds: number;
  readonly shorts: readonly Short[];
  readonly warnings: readonly string[];
}

export function shortFile(index: number): string {
  return `clip-${index + 1}.mp4`;
}

export function shortCaptionFile(index: number): string {
  return `clip-${index + 1}-captions.webm`;
}

export function shortSubtitleStem(index: number): string {
  return `clip-${index + 1}`;
}

function cropsWithin(edl: Edl, profile: ClipProfile, start: number, end: number): ShortCrop[] {
  const roleByInput = new Map(edl.sources.map((source) => [source.input, source.role]));
  const isHead = (input: Input): boolean => {
    const role = roleByInput.get(input);
    return role === "speaker1" || role === "speaker2" || role === "guest3";
  };
  const speakerOf = (input: Input): 1 | 2 | undefined => {
    const role = roleByInput.get(input);
    return role === "speaker1" ? 1 : role === "speaker2" ? 2 : undefined;
  };

  const pieces: { from: number; to: number; input: Input }[] = [];
  for (const segment of edl.segments) {
    const from = Math.max(segment.tOut, start);
    const to = Math.min(segment.tOut + segment.dur, end);
    if (to <= from) continue;
    pieces.push({ from, to, input: segment.input });
  }

  const fallbackHead = pieces.find((piece) => isHead(piece.input))?.input;
  const framed = pieces.map((piece, index) => {
    if (isHead(piece.input)) return { from: piece.from, to: piece.to, input: piece.input, anchor: anchorOf(profile, piece.input) };

    const before = [...pieces.slice(0, index)].reverse().find((other) => isHead(other.input))?.input;
    const after = pieces.slice(index + 1).find((other) => isHead(other.input))?.input;
    const borrowed = before ?? after ?? fallbackHead;
    if (borrowed === undefined) {
      return { from: piece.from, to: piece.to, input: piece.input, anchor: anchorOf(profile, piece.input) };
    }

    const speaker = speakerOf(borrowed);
    const wide = speaker === undefined ? undefined : wideAnchorOf(profile, speaker);
    if (wide !== undefined) {
      return { from: piece.from, to: piece.to, input: piece.input, anchor: wide };
    }
    return { from: piece.from, to: piece.to, input: borrowed, anchor: anchorOf(profile, borrowed) };
  });

  const crops: ShortCrop[] = [];
  for (const piece of framed) {
    const previous = crops.at(-1);
    if (previous !== undefined && previous.input === piece.input && previous.anchor === piece.anchor) {
      crops[crops.length - 1] = { ...previous, durationSeconds: piece.to - start - previous.atSeconds };
      continue;
    }
    crops.push({
      atSeconds: piece.from - start,
      durationSeconds: piece.to - piece.from,
      input: piece.input,
      anchor: piece.anchor
    });
  }

  return crops;
}

function linesWithin(transcript: Transcript, profile: ClipProfile, start: number, end: number): CaptionLine[] {
  const inside = transcript.words.filter((word) => word.endSeconds > start && word.startSeconds < end);
  const groups = groupWords(inside, {
    maxSeconds: profile.captions.maxSeconds,
    maxCharacters: profile.captions.maxCharacters,
    gapSeconds: profile.captions.gapSeconds
  });

  return groups.map((words) => {
    const first = words[0];
    const last = words.at(-1);
    if (first === undefined || last === undefined) throw new Error("a caption line came out empty");

    const rebase = (word: TranscriptWord): CaptionWord => ({
      text: word.text,
      startSeconds: Math.max(0, word.startSeconds - start),
      endSeconds: Math.min(end - start, word.endSeconds - start)
    });

    return {
      startSeconds: Math.max(0, first.startSeconds - start),
      endSeconds: Math.min(end - start, last.endSeconds - start),
      speaker: first.speaker,
      words: words.map(rebase)
    };
  });
}

export function planShorts(
  edl: Edl,
  transcript: Transcript,
  profile: ClipProfile,
  highlights: readonly Highlight[]
): ShortsPlan {
  const masterSeconds = outputDuration(edl);
  const warnings: string[] = [];
  const shorts: Short[] = [];

  for (const highlight of highlights) {
    const start = Math.max(0, highlight.startSeconds - profile.padding.leadSeconds);
    const end = Math.min(masterSeconds, highlight.endSeconds + profile.padding.tailSeconds);
    const duration = end - start;

    if (duration <= 0) {
      warnings.push(`"${highlight.title}" falls outside the master and was dropped`);
      continue;
    }

    const crops = cropsWithin(edl, profile, start, end);
    if (crops.length === 0) {
      warnings.push(`"${highlight.title}" has no picture behind it and was dropped`);
      continue;
    }

    const lines = linesWithin(transcript, profile, start, end);
    if (lines.length === 0) {
      warnings.push(`"${highlight.title}" has no words in range: it goes out without captions`);
    }

    shorts.push({
      index: shorts.length,
      title: highlight.title,
      reason: highlight.reason,
      source: highlight.source,
      score: highlight.score,
      masterStartSeconds: start,
      masterEndSeconds: end,
      durationSeconds: duration,
      width: profile.frame.width,
      height: profile.frame.height,
      layout: profile.layout,
      crops,
      lines
    });
  }

  if (shorts.length < profile.clip.count) {
    warnings.push(`asked for ${profile.clip.count} clips, planned ${shorts.length}`);
  }

  return {
    version: 1,
    session: edl.session,
    profile: profile.name,
    fps: edl.fps,
    layout: profile.layout,
    masterSeconds,
    shorts,
    warnings
  };
}
