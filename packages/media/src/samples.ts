import { runCapturingBytes } from "./process.js";

export interface ExtractOptions {
  readonly sampleRate?: number;
  readonly streamIndex?: number;
  readonly binary?: string;
}

export function bytesToSamples(raw: Buffer): Float32Array {
  const usable = raw.length - (raw.length % 4);
  const copy = raw.buffer.slice(raw.byteOffset, raw.byteOffset + usable);
  return new Float32Array(copy);
}

export async function extractSamples(path: string, options: ExtractOptions = {}): Promise<Float32Array> {
  const sampleRate = options.sampleRate ?? 48_000;
  const raw = await runCapturingBytes(options.binary ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", path,
    ...(options.streamIndex === undefined ? ["-vn"] : ["-map", `0:a:${options.streamIndex}`]),
    "-ac", "1",
    "-ar", String(sampleRate),
    "-f", "f32le",
    "-"
  ]);
  return bytesToSamples(raw);
}

export async function extractChannels(path: string, channels: number, options: ExtractOptions = {}): Promise<Float32Array[]> {
  const sampleRate = options.sampleRate ?? 48_000;
  const tracks: Float32Array[] = [];

  for (let channel = 0; channel < channels; channel += 1) {
    const raw = await runCapturingBytes(options.binary ?? "ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", path,
      "-filter_complex", `[0:a]pan=mono|c0=c${channel}[out]`,
      "-map", "[out]",
      "-ar", String(sampleRate),
      "-f", "f32le",
      "-"
    ]);
    tracks.push(bytesToSamples(raw));
  }

  return tracks;
}
