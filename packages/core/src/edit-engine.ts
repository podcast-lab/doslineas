import type { Cast, Overlap, SpeechInterval } from "./cut-generators.js";
import { gapCuts, openingCut, refreshCuts, speakerCuts, turnCuts } from "./cut-generators.js";
import type { Discard, Edl, Source } from "./edl.js";
import { snapDiscards } from "./edl.js";
import type { EditProfile, Input, InputRole } from "./profile.js";
import { personInputs, switchingMode, wideInput } from "./profile.js";
import { cutsToSegments, solveCuts } from "./solver.js";

export interface EditRequest {
  readonly session: string;
  readonly fps: number;
  readonly profile: EditProfile;
  readonly sources: readonly Source[];
  readonly speech: readonly SpeechInterval[];
  readonly discards: readonly Discard[];
  readonly durationSeconds: number;
  readonly input4Role: InputRole;
  readonly overlaps?: readonly Overlap[];
  readonly screenSpans?: readonly Overlap[];
}

export function castOf(profile: EditProfile, sources: readonly Source[], variableRole: InputRole): Cast {
  const available = new Set(sources.map((source) => source.input));
  const people = personInputs(profile, variableRole).filter((input) => available.has(input));
  const configured = wideInput(profile);
  const wide: Input = available.has(configured) ? configured : (people[0] ?? configured);
  return { wide, people };
}

export function buildEdl(request: EditRequest): Edl {
  const { profile, durationSeconds } = request;
  const discards = snapDiscards(request.discards, request.fps);
  const cast = castOf(profile, request.sources, request.input4Role);
  const speech = request.speech.filter((interval) => cast.people.includes(interval.input));

  const mode = switchingMode(profile);
  const candidates =
    mode === "speaker"
      ? speakerCuts(speech, request.overlaps ?? [], cast, profile.shot.minSeconds, request.screenSpans ?? [])
      : [
          openingCut(speech, profile, cast, discards),
          ...turnCuts(speech),
          ...refreshCuts(speech, profile, cast, discards),
          ...gapCuts(speech, profile, cast, discards, durationSeconds)
        ];

  const options = { profile, discards, durationSeconds, cast, mode };
  const segments = cutsToSegments(solveCuts(candidates, options), options);

  return {
    version: 1,
    session: request.session,
    fps: request.fps,
    profile: profile.name,
    sources: [...request.sources],
    segments,
    discards,
    audio: { source: "program", gains: {} }
  };
}
