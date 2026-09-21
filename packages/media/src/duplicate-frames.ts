import { probe } from "./ffprobe.js";
import { runOrFail } from "./process.js";

export interface DuplicateReport {
  readonly total: number;
  readonly kept: number;
  readonly ratio: number;
}

export interface DuplicateOptions {
  readonly seconds?: number;
  readonly binary?: string;
}

export function lastFrameCount(log: string): number {
  const matches = [...log.matchAll(/frame=\s*(\d+)/g)];
  const last = matches.at(-1);
  return last === undefined ? 0 : Number(last[1]);
}

export async function duplicateFrames(path: string, options: DuplicateOptions = {}): Promise<DuplicateReport> {
  const seconds = options.seconds ?? 30;
  const binary = options.binary ?? "ffmpeg";
  const sonde = await probe(path);
  const fps = sonde.video?.fps ?? 0;
  const sampled = Math.min(seconds, sonde.durationSeconds);
  const total = Math.max(1, Math.round(fps * sampled));

  const { stderr } = await runOrFail(binary, [
    "-hide_banner",
    "-t", sampled.toFixed(3),
    "-i", path,
    "-vf", "mpdecimate",
    "-fps_mode", "vfr",
    "-an",
    "-f", "null",
    "-"
  ]);

  const kept = lastFrameCount(stderr);
  return { total, kept, ratio: Math.max(0, 1 - kept / total) };
}

export async function looksLikeScreen(path: string, threshold: number, options: DuplicateOptions = {}): Promise<boolean> {
  const report = await duplicateFrames(path, options);
  return report.ratio > threshold;
}
