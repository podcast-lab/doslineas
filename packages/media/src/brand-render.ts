import type { BrandPlan } from "@doslineas/core";
import type { RenderOptions } from "./switching-render.js";
import { AUDIO_SAMPLE_RATE, DEFAULT_RENDER, videoEncoderArgs } from "./switching-render.js";

export const ALPHA_DECODER: readonly string[] = ["-c:v", "libvpx-vp9"];

export interface BrandAssets {
  readonly intro: string | null;
  readonly outro: string | null;
  readonly lowerThirds: readonly string[];
}

export interface BrandCompositePlan {
  readonly filter: string;
  readonly args: readonly string[];
}

function time(value: number): string {
  return value.toFixed(3);
}

function assertAssets(plan: BrandPlan, assets: BrandAssets): void {
  if (assets.lowerThirds.length !== plan.lowerThirds.length) {
    throw new Error(
      `the plan has ${plan.lowerThirds.length} lower thirds but ${assets.lowerThirds.length} files were rendered`
    );
  }
  if ((plan.intro === null) !== (assets.intro === null)) throw new Error("plan and assets disagree about the intro");
  if ((plan.outro === null) !== (assets.outro === null)) throw new Error("plan and assets disagree about the outro");
}

export function brandInputs(plan: BrandPlan, assets: BrandAssets, master: string): string[] {
  assertAssets(plan, assets);
  return [
    "-i", master,
    ...assets.lowerThirds.flatMap((file) => [...ALPHA_DECODER, "-i", file]),
    ...(assets.intro === null ? [] : ["-i", assets.intro]),
    ...(assets.outro === null ? [] : ["-i", assets.outro])
  ];
}

function normalisedVideo(source: string, plan: BrandPlan, label: string): string {
  return `${source}scale=${plan.width}:${plan.height},setsar=1,fps=${plan.fps},format=yuv420p[${label}]`;
}

function normalisedAudio(source: string, label: string): string {
  return `${source}aformat=sample_fmts=fltp:sample_rates=${AUDIO_SAMPLE_RATE}:channel_layouts=stereo,asetpts=N/SR/TB[${label}]`;
}

export function brandFilter(plan: BrandPlan, assets: BrandAssets): string {
  assertAssets(plan, assets);

  const lines: string[] = [];
  let video = "[0:v]";

  plan.lowerThirds.forEach((cue, index) => {
    const overlay = `lt${index}`;
    lines.push(
      `[${index + 1}:v]format=yuva420p,tpad=start_duration=${time(cue.atSeconds)}:start_mode=add:color=black@0[${overlay}]`
    );
    const out = `over${index}`;
    lines.push(`${video}[${overlay}]overlay=x=0:y=0:eof_action=pass:shortest=0:format=auto[${out}]`);
    video = `[${out}]`;
  });

  const cards = plan.lowerThirds.length + 1;
  const introIndex = plan.intro === null ? null : cards;
  const outroIndex = plan.outro === null ? null : cards + (plan.intro === null ? 0 : 1);

  if (introIndex === null && outroIndex === null) {
    lines.push(normalisedVideo(video, plan, "v"));
    lines.push(normalisedAudio("[0:a]", "a"));
    return `${lines.join(";\n")}\n`;
  }

  lines.push(normalisedVideo(video, plan, "bodyv"));
  lines.push(normalisedAudio("[0:a]", "bodya"));

  const parts: string[] = [];
  if (introIndex !== null) {
    lines.push(normalisedVideo(`[${introIndex}:v]`, plan, "introv"));
    lines.push(normalisedAudio(`[${introIndex}:a]`, "introa"));
    parts.push("[introv][introa]");
  }
  parts.push("[bodyv][bodya]");
  if (outroIndex !== null) {
    lines.push(normalisedVideo(`[${outroIndex}:v]`, plan, "outrov"));
    lines.push(normalisedAudio(`[${outroIndex}:a]`, "outroa"));
    parts.push("[outrov][outroa]");
  }

  lines.push(`${parts.join("")}concat=n=${parts.length}:v=1:a=1[v][a]`);
  return `${lines.join(";\n")}\n`;
}

export function brandCompositePlan(
  plan: BrandPlan,
  assets: BrandAssets,
  master: string,
  filterPath: string,
  target: string,
  options: RenderOptions = DEFAULT_RENDER
): BrandCompositePlan {
  return {
    filter: brandFilter(plan, assets),
    args: [
      "-y", "-hide_banner",
      ...brandInputs(plan, assets, master),
      "-/filter_complex", filterPath,
      "-map", "[v]", "-map", "[a]",
      ...videoEncoderArgs(options),
      ...(options.threads === undefined ? [] : ["-threads", String(options.threads)]),
      "-c:a", "aac", "-b:a", "192k",
      "-ar", String(AUDIO_SAMPLE_RATE),
      "-r", String(plan.fps),
      target
    ]
  };
}
