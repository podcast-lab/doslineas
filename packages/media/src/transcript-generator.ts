import type { Edl, Input, Transcript, TranscriptWord } from "@doslineas/core";

export const SENTENCES: readonly string[] = [
  "la clave esta en medir lo que de verdad importa cada semana",
  "el error que cometimos fue creer que el problema era el precio",
  "por ejemplo la primera vez que lo probamos me di cuenta de todo",
  "nadie te cuenta que al principio vas a perder dinero durante meses",
  "en realidad lo que pasa es que la gente compra por otra cosa",
  "de hecho el secreto no esta en vender mas sino en repetir",
  "y entonces cambiamos el enfoque entero del equipo en dos semanas",
  "lo importante aqui es que se puede medir desde el primer dia",
  "siempre digo que un cliente contento vale por diez anuncios",
  "aprendi que hay que preguntar antes de construir nada"
];

const WORDS_PER_SECOND = 3.2;

function nameFor(input: Input, names: ReadonlyMap<Input, string>): string {
  return names.get(input) ?? `input ${input}`;
}

export function syntheticTranscript(edl: Edl, names: ReadonlyMap<Input, string>): Transcript {
  const words: TranscriptWord[] = [];
  let sentence = 0;

  for (const segment of edl.segments) {
    const speaker = nameFor(segment.input, names);
    let cursor = segment.tOut + 0.15;
    const limit = segment.tOut + segment.dur - 0.1;

    while (cursor < limit) {
      const text = SENTENCES[sentence % SENTENCES.length];
      sentence += 1;
      if (text === undefined) break;

      const pieces = text.split(" ");
      for (const piece of pieces) {
        const end = cursor + 1 / WORDS_PER_SECOND;
        if (end > limit) break;
        words.push({
          text: piece,
          startSeconds: Number(cursor.toFixed(3)),
          endSeconds: Number(end.toFixed(3)),
          speaker
        });
        cursor = end;
      }
      cursor += 0.35;
    }
  }

  return { version: 1, session: edl.session, language: "es", words };
}
