import { runCapturingBytes } from "./process.js";

export interface FrameSeries {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8Array;
}

export interface FrameOptions {
  readonly fps?: number;
  readonly width?: number;
  readonly height?: number;
  readonly binary?: string;
}

export const DEFAULT_FRAMES: Required<Omit<FrameOptions, "binary">> = {
  fps: 4,
  width: 64,
  height: 36
};

export function frameCount(series: FrameSeries): number {
  return Math.floor(series.pixels.length / (series.width * series.height));
}

export async function extractGrayFrames(path: string, options: FrameOptions = {}): Promise<FrameSeries> {
  const fps = options.fps ?? DEFAULT_FRAMES.fps;
  const width = options.width ?? DEFAULT_FRAMES.width;
  const height = options.height ?? DEFAULT_FRAMES.height;

  const raw = await runCapturingBytes(options.binary ?? "ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-i", path,
    "-an",
    "-vf", `fps=${fps},scale=${width}:${height}:flags=area,format=gray`,
    "-f", "rawvideo",
    "-"
  ]);

  return { fps, width, height, pixels: new Uint8Array(raw.buffer, raw.byteOffset, raw.length) };
}
