import type { Discard, ExplainerPlan, ExplainerProfile } from "@doslineas/core";

import type { RenderOptions } from "./switching-render.js";
import { AUDIO_SAMPLE_RATE, DEFAULT_RENDER, audioDiscardChain, discardChain, escapePath, videoEncoderArgs } from "./switching-render.js";

export const LAYOUT_ORDER: readonly ExplainerPlan["segments"][number]["layout"][] = ["person", "screen"];

export interface ExplainerSources {
  readonly person: string;
  readonly screen: string;
  readonly audio: string | null;
}

export interface ExplainerRenderPlan {
  readonly commands: string;
  readonly filter: string;
  readonly args: readonly string[];
}

function time(value: number): string {
  return value.toFixed(3);
}

function even(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

export function insetGeometry(profile: ExplainerProfile): { width: number; x: string; y: string } {
  const width = even((profile.frame.width * profile.layout.insetPercent) / 100);
  const margin = Math.round((profile.frame.width * profile.layout.insetMarginPercent) / 100);

  const right = `W-w-${margin}`;
  const bottom = `H-h-${margin}`;
  const left = String(margin);
  const top = String(margin);

  switch (profile.layout.insetCorner) {
    case "bottom-right":
      return { width, x: right, y: bottom };
    case "bottom-left":
      return { width, x: left, y: bottom };
    case "top-right":
      return { width, x: right, y: top };
    case "top-left":
      return { width, x: left, y: top };
  }
}

export function layoutCommands(plan: ExplainerPlan): string {
  const lines = plan.segments.map((segment) => {
    const index = LAYOUT_ORDER.indexOf(segment.layout);
    if (index < 0) throw new Error(`unknown layout ${segment.layout}`);
    return `${time(segment.atSeconds)} streamselect map ${index};`;
  });
  return `${lines.join("\n")}\n`;
}

export function explainerFilter(
  plan: ExplainerPlan,
  profile: ExplainerProfile,
  commandsPath: string,
  discards: readonly Discard[],
  audioIndex: number
): string {
  const { width, height } = plan;
  const inset = insetGeometry(profile);

  return [
    `[0:v]scale=${width}:${height},setsar=1,fps=${plan.fps},split=2[personfull][personsrc]`,
    `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${plan.fps}[screenbase]`,
    `[personsrc]scale=${inset.width}:-2[inset]`,
    `[screenbase][inset]overlay=x=${inset.x}:y=${inset.y}:format=auto[screencomp]`,
    `[personfull][screencomp]streamselect=inputs=2:map=0[switched]`,
    `[switched]sendcmd=f=${escapePath(commandsPath)},${discardChain(discards, "select", plan.fps)},setpts=N/FRAME_RATE/TB,format=yuv420p[v]`,
    `[${audioIndex}:a]${audioDiscardChain(discards, plan.fps)}[a]`
  ].join(";\n");
}

export function explainerRenderPlan(
  plan: ExplainerPlan,
  profile: ExplainerProfile,
  sources: ExplainerSources,
  discards: readonly Discard[],
  commandsPath: string,
  filterPath: string,
  target: string,
  options: RenderOptions = DEFAULT_RENDER
): ExplainerRenderPlan {
  const audioIndex = sources.audio === null ? 0 : 2;

  return {
    commands: layoutCommands(plan),
    filter: explainerFilter(plan, profile, commandsPath, discards, audioIndex),
    args: [
      "-y", "-hide_banner",
      "-i", sources.person,
      "-i", sources.screen,
      ...(sources.audio === null ? [] : ["-i", sources.audio]),
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
