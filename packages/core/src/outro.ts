import { findPhrases } from "./phrases.js";
import type { Transcript } from "./transcript.js";

export const DEFAULT_FAREWELL_PHRASES: readonly string[] = [
  "hasta aqui el episodio",
  "hasta aqui el programa",
  "hasta aqui el podcast",
  "hasta aqui llegamos",
  "hasta aqui por hoy",
  "esto ha sido todo",
  "con esto cerramos",
  "con esto nos quedamos",
  "lo dejamos aqui",
  "damos por finalizado",
  "damos por cerrado",
  "nos despedimos",
  "nos vemos",
  "nos escuchamos",
  "nos oimos",
  "nos volveremos a ver",
  "en el proximo episodio",
  "hasta la proxima",
  "hasta el proximo",
  "volvemos la semana que viene",
  "suscribete",
  "suscribios",
  "dale a like",
  "dadle a like",
  "activa la campanita",
  "compartelo con quien",
  "dejanos un comentario",
  "siguenos en",
  "valoranos",
  "encontraras el episodio en",
  "gracias por escucharnos",
  "gracias por acompañarnos",
  "gracias por estar ahi",
  "gracias por venir",
  "gracias por pasarte",
  "gracias por tu tiempo",
  "gracias por la invitacion",
  "muchas gracias * por venir",
  "muchas gracias * por pasarte",
  "muchas gracias * por tu tiempo",
  "sido un placer",
  "un abrazo",
  "cuidaos",
  "chao",
  "chaito",
  "adios",
  "hasta luego"
];

export const DEFAULT_OFF_AIR_PHRASES: readonly string[] = [
  "corta",
  "cortamos",
  "corten",
  "ya esta",
  "listo",
  "hemos terminado",
  "esto fuera"
];

export interface OutroSettings {
  readonly farewells: readonly string[];
  readonly offAir: readonly string[];
  readonly joinSeconds: number;
  readonly tailSeconds: number;
}

export function findOutroEnd(transcript: Transcript, settings: OutroSettings): number | null {
  const { words } = transcript;
  const farewell = findPhrases(transcript, settings.farewells).reduce<number | null>(
    (latest, match) => (latest === null || match.last > latest ? match.last : latest),
    null
  );
  if (farewell === null) return null;

  const offAirStarts = new Set(
    findPhrases(transcript, settings.offAir)
      .map((match) => match.first)
      .filter((first) => first > farewell)
  );

  let end = farewell;
  for (;;) {
    const current = words[end];
    const next = words[end + 1];
    if (current === undefined || next === undefined || offAirStarts.has(end + 1)) break;
    if (next.startSeconds - current.endSeconds >= settings.joinSeconds) break;
    end += 1;
  }

  const last = words[end];
  if (last === undefined) return null;
  const cut = last.endSeconds + settings.tailSeconds;
  const next = words[end + 1];
  return next === undefined ? cut : Math.min(cut, next.startSeconds);
}
