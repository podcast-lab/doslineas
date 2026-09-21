import type { Transcript } from "./transcript.js";

const WILDCARD = "*";
const WILDCARD_MAX_WORDS = 3;

export interface PhraseMatch {
  readonly first: number;
  readonly last: number;
}

export function normaliseWord(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ]/g, "");
}

function tokensOf(phrase: string): string[] {
  return phrase
    .split(/\s+/)
    .map((token) => (token === WILDCARD ? WILDCARD : normaliseWord(token)))
    .filter((token) => token !== "");
}

function matchLength(words: readonly string[], start: number, target: readonly string[]): number | null {
  const [head, ...rest] = target;
  if (head === undefined) return 0;

  if (head === WILDCARD) {
    for (let taken = 1; taken <= WILDCARD_MAX_WORDS && start + taken <= words.length; taken += 1) {
      const tail = matchLength(words, start + taken, rest);
      if (tail !== null) return taken + tail;
    }
    return null;
  }

  if (words[start] !== head) return null;
  const tail = matchLength(words, start + 1, rest);
  return tail === null ? null : 1 + tail;
}

export function findPhrases(transcript: Transcript, phrases: readonly string[]): PhraseMatch[] {
  const words = transcript.words.map((word) => normaliseWord(word.text));
  const targets = phrases.map(tokensOf).filter((target) => target.some((token) => token !== WILDCARD));
  const matches: PhraseMatch[] = [];

  for (let index = 0; index < words.length; index += 1) {
    for (const target of targets) {
      const length = matchLength(words, index, target);
      if (length !== null) matches.push({ first: index, last: index + length - 1 });
    }
  }

  return matches;
}
