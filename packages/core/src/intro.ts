import type { Transcript } from "./transcript.js";

export const DEFAULT_INTRO_PHRASES: readonly string[] = [
  "bienvenido",
  "bienvenidos",
  "bienvenida",
  "bienvenidas",
  "muy buenas",
  "hoy estamos",
  "buenos dias",
  "buenas tardes"
];

export function normaliseWord(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9ñ]/g, "");
}

export function findIntroStart(transcript: Transcript, phrases: readonly string[]): number | null {
  const words = transcript.words.map((word) => normaliseWord(word.text));
  const targets = phrases
    .map((phrase) => phrase.split(/\s+/).map(normaliseWord).filter((word) => word !== ""))
    .filter((target) => target.length > 0);

  for (let index = 0; index < words.length; index += 1) {
    for (const target of targets) {
      const matches = target.every((word, offset) => words[index + offset] === word);
      if (matches) return transcript.words[index]?.startSeconds ?? null;
    }
  }

  return null;
}
