import type { Episode } from "./brand.js";
import type { Edl, Segment } from "./edl.js";
import type { Input } from "./profile.js";
import type { Transcript, TranscriptWord } from "./transcript.js";

export interface TranscriptionRequest {
  readonly audioPath: string;
  readonly session: string;
  readonly language: string;
  readonly diarize: boolean;
}

export interface Transcriber {
  readonly name: string;
  transcribe(request: TranscriptionRequest): Promise<Transcript>;
}

export function inputOnScreen(segments: readonly Segment[], seconds: number): Input | null {
  let low = 0;
  let high = segments.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle];
    if (segment === undefined) break;

    if (seconds < segment.tOut) high = middle - 1;
    else if (seconds >= segment.tOut + segment.dur) low = middle + 1;
    else return segment.input;
  }

  return null;
}

export function nameSpeakers(transcript: Transcript, edl: Edl, episode: Episode): Transcript {
  const nameByInput = new Map<Input, string>(episode.participants.map((p) => [p.input, p.name]));
  const votes = new Map<string, Map<string, number>>();

  for (const word of transcript.words) {
    const input = inputOnScreen(edl.segments, (word.startSeconds + word.endSeconds) / 2);
    if (input === null) continue;

    const name = nameByInput.get(input);
    if (name === undefined) continue;

    const tally = votes.get(word.speaker) ?? new Map<string, number>();
    tally.set(name, (tally.get(name) ?? 0) + 1);
    votes.set(word.speaker, tally);
  }

  const chosen = new Map<string, string>();
  for (const [label, tally] of votes) {
    const best = [...tally].sort((a, b) => b[1] - a[1])[0];
    if (best !== undefined) chosen.set(label, best[0]);
  }

  const taken = new Set<string>();
  for (const [label, name] of [...chosen].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (taken.has(name)) {
      chosen.delete(label);
      continue;
    }
    taken.add(name);
  }

  const words: TranscriptWord[] = transcript.words.map((word) => ({
    ...word,
    speaker: chosen.get(word.speaker) ?? word.speaker
  }));

  return { ...transcript, words };
}
