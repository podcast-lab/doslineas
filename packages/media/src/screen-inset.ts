import type { RenderOptions } from "./switching-render.js";
import { DEFAULT_RENDER, videoEncoderArgs } from "./switching-render.js";

export type InsetCorner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface ScreenInsetLayout {
  readonly width: number;
  readonly height: number;
  readonly insetPercent: number;
  readonly insetCorner: InsetCorner;
  readonly insetMarginPercent: number;
}

export type InsetSource = "wide" | "speaker";

export interface ScreenInsetPlanInput {
  readonly master: string;
  readonly slide: string;
  readonly inset: string | null;
  readonly target: string;
  readonly spans: readonly Span[];
  readonly offsetSeconds: number;
  readonly fps: number;
  readonly layout: ScreenInsetLayout;
  readonly options?: RenderOptions;
}

export interface ScreenInsetPlan {
  readonly filter: string;
  readonly args: readonly string[];
}

function even(value: number): number {
  return Math.max(2, 2 * Math.round(value / 2));
}

export function screenSpans(
  moments: readonly number[],
  totalSeconds: number,
  minSpanSeconds: number
): Span[] {
  const ordered = [...moments].filter((moment) => moment > 0 && moment < totalSeconds).sort((a, b) => a - b);
  if (ordered.length === 0) return [];

  const spans: Span[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const start = ordered[index] as number;
    const end = index + 1 < ordered.length ? (ordered[index + 1] as number) : totalSeconds;
    if (end - start < minSpanSeconds) {
      const previous = spans.at(-1);
      if (previous !== undefined) spans[spans.length - 1] = { start: previous.start, end };
      continue;
    }
    spans.push({ start, end });
  }
  return spans;
}

function insetOffset(layout: ScreenInsetLayout): { x: string; y: string } {
  const margin = Math.round((layout.width * layout.insetMarginPercent) / 100);
  const right = `W-w-${margin}`;
  const bottom = `H-h-${margin}`;
  const left = String(margin);
  const top = String(margin);

  switch (layout.insetCorner) {
    case "bottom-right":
      return { x: right, y: bottom };
    case "bottom-left":
      return { x: left, y: bottom };
    case "top-right":
      return { x: right, y: top };
    case "top-left":
      return { x: left, y: top };
  }
}

export function insetEnableExpression(spans: readonly Span[]): string {
  if (spans.length === 0) return "0";
  return spans.map((span) => `between(t,${span.start.toFixed(3)},${span.end.toFixed(3)})`).join("+");
}

export function screenInsetFilter(input: ScreenInsetPlanInput): string {
  const { layout, fps } = input;
  const width = even((layout.width * layout.insetPercent) / 100);
  const { x, y } = insetOffset(layout);
  const fromMaster = input.inset === null;

  return [
    ...(fromMaster ? ["[0:v]split=2[base][pipsrc]"] : []),
    `[1:v]scale=${layout.width}:${layout.height}:force_original_aspect_ratio=decrease,` +
      `pad=${layout.width}:${layout.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}[slidebg]`,
    `${fromMaster ? "[pipsrc]" : "[2:v]"}scale=${width}:-2,setsar=1,fps=${fps}[pip]`,
    `[slidebg][pip]overlay=x=${x}:y=${y}:format=auto[screencomp]`,
    `${fromMaster ? "[base]" : "[0:v]"}[screencomp]overlay=enable='${insetEnableExpression(input.spans)}',format=yuv420p[v]`
  ].join(";\n");
}

export function screenInsetPlan(input: ScreenInsetPlanInput): ScreenInsetPlan {
  const options = input.options ?? DEFAULT_RENDER;
  const offset = input.offsetSeconds.toFixed(3);

  return {
    filter: screenInsetFilter(input),
    args: [
      "-y", "-hide_banner",
      "-i", input.master,
      "-itsoffset", `-${offset}`, "-i", input.slide,
      ...(input.inset === null ? [] : ["-itsoffset", `-${offset}`, "-i", input.inset]),
      "-filter_complex", screenInsetFilter(input),
      "-map", "[v]", "-map", "0:a",
      ...videoEncoderArgs(options),
      "-c:a", "copy",
      "-r", String(input.fps),
      "-movflags", "+faststart",
      input.target
    ]
  };
}
