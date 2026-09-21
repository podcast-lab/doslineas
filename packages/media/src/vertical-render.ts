import type { Short } from "@doslineas/core";
import { ALPHA_DECODER } from "./brand-render.js";
import type { RenderOptions } from "./switching-render.js";
import { AUDIO_SAMPLE_RATE, DEFAULT_RENDER, videoEncoderArgs } from "./switching-render.js";

export const MAX_CROP_TERMS = 60;

export interface SourceFrame {
  readonly width: number;
  readonly height: number;
}

export interface VerticalClipPlan {
  readonly filter: string;
  readonly args: readonly string[];
}

function time(value: number): string {
  return value.toFixed(3);
}

function even(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

export function cropWidth(short: Short, source: SourceFrame): number {
  const wanted = (source.height * short.width) / short.height;
  return Math.min(even(source.width), even(wanted));
}

export function cropOffset(anchor: number, width: number, source: SourceFrame): number {
  const centred = anchor * source.width - width / 2;
  return Math.round(Math.min(Math.max(centred, 0), source.width - width));
}

export function cropExpression(short: Short, source: SourceFrame): string {
  const width = cropWidth(short, source);
  const offsets = short.crops.map((crop) => cropOffset(crop.anchor, width, source));
  const unique = new Set(offsets);

  if (unique.size <= 1) return String(offsets[0] ?? cropOffset(0.5, width, source));

  if (short.crops.length > MAX_CROP_TERMS) {
    const tally = new Map<number, number>();
    short.crops.forEach((crop, index) => {
      const offset = offsets[index] ?? 0;
      tally.set(offset, (tally.get(offset) ?? 0) + crop.durationSeconds);
    });
    const dominant = [...tally].sort((a, b) => b[1] - a[1])[0];
    return String(dominant?.[0] ?? 0);
  }

  const terms = short.crops.map((crop, index) => {
    const offset = offsets[index] ?? 0;
    const last = index === short.crops.length - 1;
    const from = index === 0 ? "" : `gte(t,${time(crop.atSeconds)})*`;
    const until = last ? "" : `lt(t,${time(crop.atSeconds + crop.durationSeconds)})*`;
    return `${from}${until}${offset}`;
  });

  return terms.join("+");
}

function cropChain(short: Short, source: SourceFrame): string[] {
  const width = cropWidth(short, source);
  const x = cropExpression(short, source);
  return [
    `[0:v]crop=w=${width}:h=${source.height}:x='${x}':y=0,scale=${short.width}:${short.height},setsar=1[base]`
  ];
}

function blurChain(short: Short): string[] {
  return [
    "[0:v]split=2[wide][front]",
    `[wide]scale=${short.width}:${short.height}:force_original_aspect_ratio=increase,crop=${short.width}:${short.height},boxblur=luma_radius=${Math.round(short.width / 24)}:luma_power=2[behind]`,
    `[front]scale=${short.width}:-2[inset]`,
    `[behind][inset]overlay=x=(W-w)/2:y=(H-h)/2,setsar=1[base]`
  ];
}

export function verticalFilter(short: Short, source: SourceFrame, captions: string | null): string {
  const lines = short.layout === "crop" ? cropChain(short, source) : blurChain(short);

  if (captions === null) {
    lines.push("[base]format=yuv420p[v]");
  } else {
    lines.push("[1:v]format=yuva420p[overlay]");
    lines.push("[base][overlay]overlay=x=0:y=0:eof_action=pass:shortest=0:format=auto,format=yuv420p[v]");
  }

  return `${lines.join(";\n")}\n`;
}

export function verticalClipPlan(
  short: Short,
  source: SourceFrame,
  master: string,
  captions: string | null,
  filterPath: string,
  target: string,
  fps: number,
  options: RenderOptions = DEFAULT_RENDER
): VerticalClipPlan {
  return {
    filter: verticalFilter(short, source, captions),
    args: [
      "-y", "-hide_banner",
      "-ss", time(short.masterStartSeconds),
      "-t", time(short.durationSeconds),
      "-i", master,
      ...(captions === null ? [] : [...ALPHA_DECODER, "-i", captions]),
      "-/filter_complex", filterPath,
      "-map", "[v]", "-map", "0:a",
      ...videoEncoderArgs(options),
      ...(options.threads === undefined ? [] : ["-threads", String(options.threads)]),
      "-c:a", "aac", "-b:a", "160k",
      "-ar", String(AUDIO_SAMPLE_RATE),
      "-r", String(fps),
      "-t", time(short.durationSeconds),
      target
    ]
  };
}

export function extractAudioArgs(master: string, target: string): string[] {
  return [
    "-y", "-hide_banner",
    "-i", master,
    "-vn",
    "-ac", "1",
    "-ar", "16000",
    "-c:a", "flac",
    target
  ];
}
