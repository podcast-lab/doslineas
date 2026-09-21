import { findPhrases } from "./phrases.js";
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

export function findIntroStart(transcript: Transcript, phrases: readonly string[]): number | null {
  const first = findPhrases(transcript, phrases)[0];
  return first === undefined ? null : (transcript.words[first.first]?.startSeconds ?? null);
}
