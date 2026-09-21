import { stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Input } from "@doslineas/core";
import { probe } from "./ffprobe.js";
import type { SessionNaming } from "./session-layout.js";
import { SESSION_INPUTS, resolveLayout } from "./session-layout.js";

export interface SessionInspection {
  readonly directory: string;
  readonly naming: SessionNaming;
  readonly take: string | null;
  readonly isos: Record<Input, string>;
  readonly audio: Record<Input, string>;
  readonly mics: readonly string[];
  readonly program: string | null;
  readonly drp: string | null;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number;
  readonly spreadSeconds: number;
  readonly problems: readonly string[];
}

async function exists(path: string | null): Promise<boolean> {
  if (path === null) return false;
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

export async function inspectSession(directory: string): Promise<SessionInspection> {
  const layout = await resolveLayout(directory);
  const problems: string[] = [];
  const isos = {} as Record<Input, string>;
  const audio = {} as Record<Input, string>;
  const durations: number[] = [];
  let fps = 0;
  let width = 0;
  let height = 0;
  let sidecars = 0;

  if (layout.otherTakes.length > 0) {
    problems.push(
      `this directory holds more than one recording (${layout.otherTakes.join(", ")}); one session per directory`
    );
  }

  for (const input of SESSION_INPUTS) {
    const fallback = layout.naming === "atem" ? `${layout.base} CAM ${input}.mp4` : `iso${input}.mp4`;
    const path = layout.isos[input] ?? join(directory, fallback);
    const label = basename(path);
    isos[input] = path;
    audio[input] = path;

    if (!(await exists(path))) {
      problems.push(`${label} is missing or empty`);
      continue;
    }

    const sidecar = layout.audio[input];
    if (await exists(sidecar)) {
      audio[input] = sidecar as string;
      sidecars += 1;
    }

    let sonde;
    try {
      sonde = await probe(path);
    } catch (failure) {
      problems.push(`${label} cannot be read: ${(failure as Error).message.split("\n")[0] ?? "unknown reason"}`);
      continue;
    }

    if (sonde.video === null) problems.push(`${label} carries no video`);
    if (sonde.audio === null && audio[input] === path) problems.push(`${label} carries no audio of its own`);
    if (fps === 0) {
      fps = sonde.video?.fps ?? 0;
      width = sonde.video?.width ?? 0;
      height = sonde.video?.height ?? 0;
    }
    durations.push(sonde.durationSeconds);
  }

  if (layout.naming === "atem" && sidecars === 0) {
    problems.push(
      "no per-camera WAV next to the ISOs: the ATEM embeds the program mix in every ISO, so no input can be told from another"
    );
  }

  const program = (await exists(layout.program)) ? layout.program : null;
  if (program === null) problems.push("the program recording is missing, and it is where the master audio comes from");

  const drp = (await exists(layout.drp)) ? layout.drp : null;
  if (drp === null) problems.push("the .drp is missing: the ATEM may still be writing this session");

  const durationSeconds = durations.length === 0 ? 0 : Math.min(...durations);
  const spreadSeconds = durations.length === 0 ? 0 : Math.max(...durations) - durationSeconds;
  const frame = fps > 0 ? 1 / fps : 0.04;
  if (durations.length === SESSION_INPUTS.length && spreadSeconds > frame) {
    problems.push(`the ISOs are ${spreadSeconds.toFixed(3)} s apart, more than the ${frame.toFixed(3)} s of one frame`);
  }

  return {
    directory,
    naming: layout.naming,
    take: layout.take,
    isos,
    audio,
    mics: layout.mics,
    program,
    drp,
    fps: fps || 25,
    width: width || 1920,
    height: height || 1080,
    durationSeconds,
    spreadSeconds,
    problems
  };
}
