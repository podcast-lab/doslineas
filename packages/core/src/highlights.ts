import type { ClipProfile } from "./clip-profile.js";
import type { Transcript, TranscriptWord } from "./transcript.js";
import { groupWords } from "./transcript.js";

export interface Utterance {
  readonly index: number;
  readonly speaker: string;
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly text: string;
  readonly words: readonly TranscriptWord[];
  readonly gapBefore: number;
  readonly gapAfter: number;
}

export interface Highlight {
  readonly startSeconds: number;
  readonly endSeconds: number;
  readonly startUtterance: number;
  readonly endUtterance: number;
  readonly title: string;
  readonly reason: string;
  readonly score: number;
  readonly source: "rules" | "llm";
}

export interface HighlightRequest {
  readonly session: string;
  readonly language: string;
  readonly count: number;
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly targetSeconds: number;
  readonly utterances: readonly Utterance[];
}

export interface HighlightPick {
  readonly startUtterance: number;
  readonly endUtterance: number;
  readonly title: string;
  readonly reason: string;
}

export interface HighlightPicker {
  readonly name: string;
  pick(request: HighlightRequest): Promise<readonly HighlightPick[]>;
}

export interface HighlightSelection {
  readonly highlights: readonly Highlight[];
  readonly warnings: readonly string[];
}

export function toUtterances(transcript: Transcript, gapSeconds: number): Utterance[] {
  const groups = groupWords(transcript.words, {
    maxSeconds: Number.POSITIVE_INFINITY,
    maxCharacters: Number.POSITIVE_INFINITY,
    gapSeconds
  });

  return groups.map((words, index) => {
    const first = words[0];
    const last = words.at(-1);
    if (first === undefined || last === undefined) throw new Error(`utterance ${index} has no words`);

    const previous = groups[index - 1]?.at(-1);
    const next = groups[index + 1]?.[0];

    return {
      index,
      speaker: first.speaker,
      startSeconds: first.startSeconds,
      endSeconds: last.endSeconds,
      text: words.map((word) => word.text).join(" "),
      words,
      gapBefore: previous === undefined ? Number.POSITIVE_INFINITY : first.startSeconds - previous.endSeconds,
      gapAfter: next === undefined ? Number.POSITIVE_INFINITY : next.startSeconds - last.endSeconds
    };
  });
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.min(high, Math.max(low, value));
}

export interface WindowScore {
  readonly total: number;
  readonly density: number;
  readonly fit: number;
  readonly opening: number;
  readonly closing: number;
  readonly exchange: number;
  readonly hooks: number;
  readonly question: number;
}

export function scoreWindow(window: readonly Utterance[], profile: ClipProfile): WindowScore {
  const first = window[0];
  const last = window.at(-1);
  if (first === undefined || last === undefined) throw new Error("cannot score an empty window");

  const seconds = last.endSeconds - first.startSeconds;
  const words = window.reduce((total, utterance) => total + utterance.words.length, 0);
  const text = window.map((utterance) => utterance.text).join(" ");
  const flat = normalise(text);

  const { minSeconds, maxSeconds, targetSeconds } = profile.clip;
  const slack = Math.max(targetSeconds - minSeconds, maxSeconds - targetSeconds, 1e-6);

  const hits = profile.hookWords.filter((hook) => flat.includes(normalise(hook))).length;
  const speakers = new Set(window.map((utterance) => utterance.speaker));

  const parts = {
    density: clamp(words / Math.max(seconds, 1e-6) / profile.grouping.wordsPerSecondReference),
    fit: clamp(1 - Math.abs(seconds - targetSeconds) / slack),
    opening: first.gapBefore >= profile.grouping.utteranceGapSeconds ? 1 : 0,
    closing: last.gapAfter >= profile.grouping.utteranceGapSeconds ? 1 : 0,
    exchange: speakers.size > 1 ? 1 : 0,
    hooks: clamp(hits / 2),
    question: /[?¿]/.test(text) ? 1 : 0
  };

  const weights = profile.scoring;
  const sum = Object.values(weights).reduce((total, weight) => total + weight, 0);
  const total =
    (parts.density * weights.density +
      parts.fit * weights.fit +
      parts.opening * weights.opening +
      parts.closing * weights.closing +
      parts.exchange * weights.exchange +
      parts.hooks * weights.hooks +
      parts.question * weights.question) /
    sum;

  return { total, ...parts };
}

function titleOf(window: readonly Utterance[]): string {
  const text = window.map((utterance) => utterance.text).join(" ");
  const words = text.split(/\s+/).slice(0, 8).join(" ");
  return words.length < text.length ? `${words}…` : words;
}

function overlaps(a: Highlight, b: Highlight): boolean {
  return a.startSeconds < b.endSeconds && b.startSeconds < a.endSeconds;
}

function withoutOverlaps(candidates: readonly Highlight[], taken: readonly Highlight[], count: number): Highlight[] {
  const chosen: Highlight[] = [...taken];
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    if (chosen.some((highlight) => overlaps(highlight, candidate))) continue;
    chosen.push(candidate);
  }
  return chosen.sort((a, b) => a.startSeconds - b.startSeconds);
}

export function rankWindows(utterances: readonly Utterance[], profile: ClipProfile): Highlight[] {
  const { minSeconds, maxSeconds } = profile.clip;
  const candidates: Highlight[] = [];

  for (let from = 0; from < utterances.length; from += 1) {
    const start = utterances[from];
    if (start === undefined) continue;

    for (let to = from; to < utterances.length; to += 1) {
      const end = utterances[to];
      if (end === undefined) continue;

      const seconds = end.endSeconds - start.startSeconds;
      if (seconds > maxSeconds) break;
      if (seconds < minSeconds) continue;

      const window = utterances.slice(from, to + 1);
      candidates.push({
        startSeconds: start.startSeconds,
        endSeconds: end.endSeconds,
        startUtterance: from,
        endUtterance: to,
        title: titleOf(window),
        reason: "",
        score: scoreWindow(window, profile).total,
        source: "rules"
      });
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.startSeconds - b.startSeconds);
}

export function chooseByRules(utterances: readonly Utterance[], profile: ClipProfile): Highlight[] {
  return withoutOverlaps(rankWindows(utterances, profile), [], profile.clip.count);
}

export function toHighlightRequest(
  transcript: Transcript,
  utterances: readonly Utterance[],
  profile: ClipProfile
): HighlightRequest {
  return {
    session: transcript.session,
    language: transcript.language,
    count: profile.clip.count,
    minSeconds: profile.clip.minSeconds,
    maxSeconds: profile.clip.maxSeconds,
    targetSeconds: profile.clip.targetSeconds,
    utterances
  };
}

export function formatUtterances(utterances: readonly Utterance[]): string {
  return utterances
    .map(
      (utterance) =>
        `[${utterance.index}] ${utterance.startSeconds.toFixed(1)}-${utterance.endSeconds.toFixed(1)} ${utterance.speaker}: ${utterance.text}`
    )
    .join("\n");
}

function trimToLength(
  utterances: readonly Utterance[],
  from: number,
  to: number,
  profile: ClipProfile
): { from: number; to: number } | null {
  const start = utterances[from];
  if (start === undefined) return null;

  let last = to;
  while (last > from) {
    const end = utterances[last];
    if (end !== undefined && end.endSeconds - start.startSeconds <= profile.clip.maxSeconds) break;
    last -= 1;
  }

  let end = utterances[last];
  if (end === undefined) return null;

  while (end.endSeconds - start.startSeconds < profile.clip.minSeconds && last + 1 < utterances.length) {
    const next = utterances[last + 1];
    if (next === undefined) break;
    if (next.endSeconds - start.startSeconds > profile.clip.maxSeconds) break;
    last += 1;
    end = next;
  }

  const seconds = end.endSeconds - start.startSeconds;
  if (seconds < profile.clip.minSeconds || seconds > profile.clip.maxSeconds) return null;
  return { from, to: last };
}

export function fromPicks(
  picks: readonly HighlightPick[],
  utterances: readonly Utterance[],
  profile: ClipProfile
): HighlightSelection {
  const highlights: Highlight[] = [];
  const warnings: string[] = [];

  for (const pick of picks) {
    const { startUtterance, endUtterance } = pick;
    const valid =
      Number.isInteger(startUtterance) &&
      Number.isInteger(endUtterance) &&
      startUtterance >= 0 &&
      endUtterance < utterances.length &&
      startUtterance <= endUtterance;

    if (!valid) {
      warnings.push(`the model asked for utterances ${startUtterance}-${endUtterance}, which do not exist`);
      continue;
    }

    const range = trimToLength(utterances, startUtterance, endUtterance, profile);
    if (range === null) {
      warnings.push(`"${pick.title}" cannot be trimmed to ${profile.clip.minSeconds}-${profile.clip.maxSeconds} s`);
      continue;
    }

    const start = utterances[range.from];
    const end = utterances[range.to];
    if (start === undefined || end === undefined) continue;

    const window = utterances.slice(range.from, range.to + 1);
    highlights.push({
      startSeconds: start.startSeconds,
      endSeconds: end.endSeconds,
      startUtterance: range.from,
      endUtterance: range.to,
      title: pick.title.trim() === "" ? titleOf(window) : pick.title.trim(),
      reason: pick.reason.trim(),
      score: scoreWindow(window, profile).total,
      source: "llm"
    });
  }

  const kept: Highlight[] = [];
  for (const highlight of highlights) {
    if (kept.some((other) => overlaps(other, highlight))) {
      warnings.push(`"${highlight.title}" overlaps an earlier pick and was dropped`);
      continue;
    }
    kept.push(highlight);
  }

  return { highlights: kept.slice(0, profile.clip.count), warnings };
}

export function selectHighlights(
  utterances: readonly Utterance[],
  profile: ClipProfile,
  picks: readonly HighlightPick[] | null
): HighlightSelection {
  const fromModel = picks === null ? { highlights: [], warnings: [] as string[] } : fromPicks(picks, utterances, profile);
  const warnings = [...fromModel.warnings];

  if (fromModel.highlights.length >= profile.clip.count) {
    return { highlights: fromModel.highlights, warnings };
  }

  if (picks !== null) {
    warnings.push(
      `the model gave ${fromModel.highlights.length} usable moments of ${profile.clip.count}: the rest come from the rules`
    );
  }

  const topped = withoutOverlaps(rankWindows(utterances, profile), fromModel.highlights, profile.clip.count);
  return { highlights: topped, warnings };
}
