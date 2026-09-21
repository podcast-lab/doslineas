import type { Discard, Edl, Input } from "@doslineas/core";

export const ENCODERS = ["libx264", "h264_nvenc", "h264_qsv", "h264_amf", "h264_videotoolbox"] as const;
export type Encoder = (typeof ENCODERS)[number];

export const RENDER_SPEEDS = ["fastest", "balanced", "best"] as const;
export type RenderSpeed = (typeof RENDER_SPEEDS)[number];

const PRESETS: Record<Encoder, Record<RenderSpeed, string>> = {
  libx264: { fastest: "veryfast", balanced: "medium", best: "slow" },
  h264_qsv: { fastest: "veryfast", balanced: "medium", best: "slow" },
  h264_nvenc: { fastest: "p1", balanced: "p4", best: "p6" },
  h264_amf: { fastest: "speed", balanced: "balanced", best: "quality" },
  h264_videotoolbox: { fastest: "1", balanced: "0", best: "0" }
};

export const DEFAULT_VIDEOTOOLBOX_BITRATE = "16M";

const BITRATE = /^\d+(\.\d+)?[kKmM]$/;

export function videotoolboxBitrate(quality: string): string {
  return BITRATE.test(quality) ? quality : DEFAULT_VIDEOTOOLBOX_BITRATE;
}

export interface RenderOptions {
  readonly encoder: Encoder;
  readonly quality: string;
  readonly preset: string;
  readonly threads?: number;
}

export const DEFAULT_RENDER: RenderOptions = {
  encoder: "libx264",
  quality: "20",
  preset: "fastest"
};

export function parseEncoder(name: string): Encoder {
  const found = ENCODERS.find((encoder) => encoder === name);
  if (found === undefined) throw new Error(`--encoder must be one of ${ENCODERS.join(", ")}, not ${name}`);
  return found;
}

export function resolvePreset(encoder: Encoder, preset: string): string {
  const speed = RENDER_SPEEDS.find((candidate) => candidate === preset);
  return speed === undefined ? preset : PRESETS[encoder][speed];
}

export interface SinglePassPlan {
  readonly commands: string;
  readonly filter: string;
  readonly args: readonly string[];
}

export interface TwoPassPlan {
  readonly commands: string;
  readonly switchingFilter: string;
  readonly silenceFilter: string;
  readonly first: readonly string[];
  readonly second: readonly string[];
}

export const MAX_EXPRESSION_TERMS = 40;

export const AUDIO_SAMPLE_RATE = 48_000;

export function samplesPerFrame(fps: number): number {
  const samples = AUDIO_SAMPLE_RATE / fps;
  if (!Number.isInteger(samples)) {
    throw new Error(
      `${fps} fps does not split ${AUDIO_SAMPLE_RATE} Hz into whole samples, so the audio cannot be cut on the same grid as the picture`
    );
  }
  return samples;
}

function time(value: number): string {
  return value.toFixed(3);
}

export function videoEncoderArgs(options: RenderOptions): string[] {
  const preset = resolvePreset(options.encoder, options.preset);

  switch (options.encoder) {
    case "libx264":
      return ["-c:v", "libx264", "-preset", preset, "-crf", options.quality];
    case "h264_nvenc":
      return ["-c:v", "h264_nvenc", "-preset", preset, "-cq", options.quality];
    case "h264_qsv":
      return ["-c:v", "h264_qsv", "-preset", preset, "-global_quality", options.quality];
    case "h264_amf":
      return ["-c:v", "h264_amf", "-quality", preset, "-qp_i", options.quality, "-qp_p", options.quality];
    case "h264_videotoolbox":
      return ["-c:v", "h264_videotoolbox", "-realtime", preset, "-b:v", videotoolboxBitrate(options.quality)];
  }
}

export function inputOrder(edl: Edl): Input[] {
  return [...edl.sources].sort((a, b) => a.input - b.input).map((s) => s.input);
}

export function sendcmdScript(edl: Edl): string {
  const order = inputOrder(edl);
  const lines = edl.segments.map((segment) => {
    const index = order.indexOf(segment.input);
    if (index < 0) throw new Error(`input ${segment.input} is not in sources`);
    return `${time(segment.tIn)} streamselect map ${index};`;
  });
  return `${lines.join("\n")}\n`;
}

export function discardExpressions(
  discards: readonly Discard[],
  fps: number,
  maxTerms = MAX_EXPRESSION_TERMS
): string[] {
  if (discards.length === 0) return ["1"];
  const expressions: string[] = [];
  const threshold = (seconds: number): string => time((Math.round(seconds * fps) - 0.5) / fps);

  for (let start = 0; start < discards.length; start += maxTerms) {
    const inside = discards
      .slice(start, start + maxTerms)
      .map((discard) => `gte(t,${threshold(discard.tIn)})*lt(t,${threshold(discard.tEnd)})`)
      .join("+");
    expressions.push(`not(${inside})`);
  }

  return expressions;
}

export function discardChain(
  discards: readonly Discard[],
  filter: "select" | "aselect",
  fps: number,
  maxTerms = MAX_EXPRESSION_TERMS
): string {
  return discardExpressions(discards, fps, maxTerms)
    .map((expression) => `${filter}='${expression}'`)
    .join(",");
}

export function audioDiscardChain(
  discards: readonly Discard[],
  fps: number,
  maxTerms = MAX_EXPRESSION_TERMS
): string {
  return [
    `aresample=${AUDIO_SAMPLE_RATE}`,
    `asetnsamples=n=${samplesPerFrame(fps)}:p=0`,
    discardChain(discards, "aselect", fps, maxTerms),
    "asetpts=N/SR/TB"
  ].join(",");
}

export function silenceExpressions(edl: Edl, maxTerms = MAX_EXPRESSION_TERMS): string[] {
  return discardExpressions(edl.discards, edl.fps, maxTerms);
}

export function selectChain(edl: Edl, filter: "select" | "aselect", maxTerms = MAX_EXPRESSION_TERMS): string {
  return discardChain(edl.discards, filter, edl.fps, maxTerms);
}

export function audioChain(edl: Edl, maxTerms = MAX_EXPRESSION_TERMS): string {
  return audioDiscardChain(edl.discards, edl.fps, maxTerms);
}

export function escapePath(path: string): string {
  return `'${path.replace(/\\/g, "/").replace(/:/g, "\\:")}'`;
}

function videoInputs(edl: Edl): string[] {
  return inputOrder(edl).flatMap((input) => {
    const source = edl.sources.find((s) => s.input === input);
    if (source === undefined) throw new Error(`missing source for input ${input}`);
    return ["-i", source.video];
  });
}

export function programAudio(edl: Edl): string | null {
  if (edl.audio.source !== "program") return null;
  return edl.sources.find((source) => source.audio !== null)?.audio ?? null;
}

export function singlePassFilter(edl: Edl, commandsPath: string, audioIndex: number): string {
  const order = inputOrder(edl);
  const labels = order.map((_, index) => `[${index}:v]`).join("");
  return [
    `${labels}streamselect=inputs=${order.length}:map=0[switched]`,
    `[switched]sendcmd=f=${escapePath(commandsPath)},${selectChain(edl, "select")},setpts=N/FRAME_RATE/TB[v]`,
    `[${audioIndex}:a]${audioChain(edl)}[a]`
  ].join(";\n");
}

export function switchingFilter(edl: Edl, commandsPath: string, audioIndex: number): string {
  const order = inputOrder(edl);
  const labels = order.map((_, index) => `[${index}:v]`).join("");
  return [
    `${labels}streamselect=inputs=${order.length}:map=0[switched]`,
    `[switched]sendcmd=f=${escapePath(commandsPath)}[v]`,
    `[${audioIndex}:a]anull[a]`
  ].join(";\n");
}

export function silenceFilter(edl: Edl): string {
  return [
    `[0:v]${selectChain(edl, "select")},setpts=N/FRAME_RATE/TB[v]`,
    `[0:a]${audioChain(edl)}[a]`
  ].join(";\n");
}

export function singlePassPlan(
  edl: Edl,
  commandsPath: string,
  filterPath: string,
  target: string,
  options: RenderOptions = DEFAULT_RENDER
): SinglePassPlan {
  const audioPath = programAudio(edl);
  const audioIndex = audioPath === null ? 0 : inputOrder(edl).length;

  return {
    commands: sendcmdScript(edl),
    filter: singlePassFilter(edl, commandsPath, audioIndex),
    args: [
      "-y", "-hide_banner",
      ...videoInputs(edl),
      ...(audioPath === null ? [] : ["-i", audioPath]),
      "-/filter_complex", filterPath,
      "-map", "[v]", "-map", "[a]",
      ...videoEncoderArgs(options),
      ...(options.threads === undefined ? [] : ["-threads", String(options.threads)]),
      "-c:a", "aac", "-b:a", "192k",
      "-r", String(edl.fps),
      target
    ]
  };
}

export function twoPassPlan(
  edl: Edl,
  commandsPath: string,
  switchingFilterPath: string,
  silenceFilterPath: string,
  intermediate: string,
  target: string,
  options: RenderOptions = DEFAULT_RENDER
): TwoPassPlan {
  const audioPath = programAudio(edl);
  const audioIndex = audioPath === null ? 0 : inputOrder(edl).length;

  return {
    commands: sendcmdScript(edl),
    switchingFilter: switchingFilter(edl, commandsPath, audioIndex),
    silenceFilter: silenceFilter(edl),
    first: [
      "-y", "-hide_banner",
      ...videoInputs(edl),
      ...(audioPath === null ? [] : ["-i", audioPath]),
      "-/filter_complex", switchingFilterPath,
      "-map", "[v]", "-map", "[a]",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16",
      "-c:a", "pcm_s16le",
      "-r", String(edl.fps),
      intermediate
    ],
    second: [
      "-y", "-hide_banner",
      "-i", intermediate,
      "-/filter_complex", silenceFilterPath,
      "-map", "[v]", "-map", "[a]",
      ...videoEncoderArgs(options),
      ...(options.threads === undefined ? [] : ["-threads", String(options.threads)]),
      "-c:a", "aac", "-b:a", "192k",
      "-r", String(edl.fps),
      target
    ]
  };
}
