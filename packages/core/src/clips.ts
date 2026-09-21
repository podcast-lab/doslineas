import type { Discard, Edl, Segment } from "./edl.js";
import type { Input } from "./profile.js";
import { advanceByOutput } from "./solver.js";

export interface Clip {
  readonly input: Input;
  readonly sourceStart: number;
  readonly timelineStart: number;
  readonly duration: number;
  readonly segment: number;
}

export function segmentSourceEnd(segment: Segment, discards: readonly Discard[]): number {
  return advanceByOutput(segment.tIn, segment.dur, discards);
}

export function flattenToClips(edl: Edl): Clip[] {
  const clips: Clip[] = [];
  let timeline = 0;

  edl.segments.forEach((segment, index) => {
    const sourceEnd = segmentSourceEnd(segment, edl.discards);
    let cursor = segment.tIn;

    const pieces = edl.discards
      .filter((discard) => discard.tEnd > segment.tIn && discard.tIn < sourceEnd)
      .sort((a, b) => a.tIn - b.tIn);

    for (const discard of pieces) {
      const pieceEnd = Math.min(discard.tIn, sourceEnd);
      if (pieceEnd > cursor) {
        clips.push({
          input: segment.input,
          sourceStart: cursor,
          timelineStart: timeline,
          duration: pieceEnd - cursor,
          segment: index
        });
        timeline += pieceEnd - cursor;
      }
      cursor = Math.max(cursor, discard.tEnd);
    }

    if (sourceEnd > cursor) {
      clips.push({
        input: segment.input,
        sourceStart: cursor,
        timelineStart: timeline,
        duration: sourceEnd - cursor,
        segment: index
      });
      timeline += sourceEnd - cursor;
    }
  });

  return clips;
}
