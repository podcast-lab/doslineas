import { runOrFail } from "./process.js";

export interface VideoTrack {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly codec: string;
}

export interface AudioTrack {
  readonly channels: number;
  readonly sampleRate: number;
  readonly codec: string;
}

export interface Probe {
  readonly path: string;
  readonly durationSeconds: number;
  readonly video: VideoTrack | null;
  readonly audio: AudioTrack | null;
}

interface RawStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  channels?: number;
  sample_rate?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
}

export function fractionToFps(fraction: string | undefined): number {
  if (fraction === undefined) return 0;
  const [numerator, denominator] = fraction.split("/");
  const top = Number(numerator ?? 0);
  const bottom = Number(denominator ?? 1);
  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom === 0) return 0;
  return top / bottom;
}

export async function probe(path: string, binary = "ffprobe"): Promise<Probe> {
  const { stdout } = await runOrFail(binary, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    path
  ]);

  const raw = JSON.parse(stdout) as { format?: { duration?: string }; streams?: RawStream[] };
  const streams = raw.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");

  return {
    path,
    durationSeconds: Number(raw.format?.duration ?? 0),
    video: videoStream === undefined ? null : {
      width: videoStream.width ?? 0,
      height: videoStream.height ?? 0,
      fps: fractionToFps(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
      codec: videoStream.codec_name ?? "unknown"
    },
    audio: audioStream === undefined ? null : {
      channels: audioStream.channels ?? 0,
      sampleRate: Number(audioStream.sample_rate ?? 0),
      codec: audioStream.codec_name ?? "unknown"
    }
  };
}
