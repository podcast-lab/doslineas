import { percentile } from "@doslineas/core";
import { probe } from "./ffprobe.js";
import { run } from "./process.js";

export interface MeasureOptions {
  readonly sceneThreshold: number;
  readonly silenceDb: number;
  readonly silenceSeconds: number;
}

export const ANNEX_A: MeasureOptions = {
  sceneThreshold: 0.25,
  silenceDb: -32,
  silenceSeconds: 1
};

export interface DetectedSilence {
  readonly start: number;
  readonly end: number;
}

export interface RenderMetrics {
  readonly path: string;
  readonly durationSeconds: number;
  readonly cuts: number;
  readonly cutsPerMinute: number;
  readonly medianShot: number;
  readonly shotP10: number;
  readonly shotP90: number;
  readonly cutTimes: readonly number[];
  readonly silences: readonly DetectedSilence[];
  readonly silentSeconds: number;
}

const SCENE_TIME = /^frame:\d+\s+pts:\S+\s+pts_time:([\d.]+)/;
const SILENCE_START = /silence_start:\s*(-?[\d.]+)/;
const SILENCE_END = /silence_end:\s*(-?[\d.]+)/;

export function parseSceneCuts(output: string): number[] {
  const times: number[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = SCENE_TIME.exec(line.trim());
    if (match === null) continue;

    const at = Number(match[1]);
    if (Number.isFinite(at)) times.push(at);
  }
  return times.sort((a, b) => a - b);
}

export function parseSilences(output: string, durationSeconds: number): DetectedSilence[] {
  const silences: DetectedSilence[] = [];
  let open: number | null = null;

  for (const line of output.split(/\r?\n/)) {
    const start = SILENCE_START.exec(line);
    if (start !== null) {
      open = Math.max(0, Number(start[1]));
      continue;
    }

    const end = SILENCE_END.exec(line);
    if (end !== null && open !== null) {
      silences.push({ start: open, end: Number(end[1]) });
      open = null;
    }
  }

  if (open !== null && durationSeconds > open) silences.push({ start: open, end: durationSeconds });
  return silences;
}

export function shotsBetween(cuts: readonly number[], durationSeconds: number): number[] {
  const marks = [0, ...cuts.filter((at) => at > 0 && at < durationSeconds), durationSeconds];
  const shots: number[] = [];
  for (let index = 1; index < marks.length; index += 1) {
    const shot = (marks[index] ?? 0) - (marks[index - 1] ?? 0);
    if (shot > 0) shots.push(shot);
  }
  return shots;
}

export async function measureRender(path: string, options: MeasureOptions = ANNEX_A): Promise<RenderMetrics> {
  const sonde = await probe(path);
  const durationSeconds = sonde.durationSeconds;

  const scene = await run("ffmpeg", [
    "-nostdin",
    "-i",
    path,
    "-filter_complex",
    `select='gt(scene,${options.sceneThreshold})',metadata=print:file=-`,
    "-an",
    "-f",
    "null",
    "-"
  ]);
  const cutTimes = parseSceneCuts(scene.stdout);

  const silences =
    sonde.audio === null
      ? []
      : parseSilences(
          (
            await run("ffmpeg", [
              "-nostdin",
              "-i",
              path,
              "-af",
              `silencedetect=noise=${options.silenceDb}dB:d=${options.silenceSeconds}`,
              "-vn",
              "-f",
              "null",
              "-"
            ])
          ).stderr,
          durationSeconds
        );

  const shots = shotsBetween(cutTimes, durationSeconds);

  return {
    path,
    durationSeconds,
    cuts: cutTimes.length,
    cutsPerMinute: durationSeconds > 0 ? (cutTimes.length / durationSeconds) * 60 : 0,
    medianShot: percentile(shots, 0.5),
    shotP10: percentile(shots, 0.1),
    shotP90: percentile(shots, 0.9),
    cutTimes,
    silences,
    silentSeconds: silences.reduce((total, silence) => total + (silence.end - silence.start), 0)
  };
}
