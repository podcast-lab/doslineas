import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import type { BrandKit, BrandPlan, ClipProfile, LowerThirdCue, Short, ShortsPlan, TitleCardCue } from "@doslineas/core";
import { brandAssetNames, shortCaptionFile } from "@doslineas/core";
import { imageDataUrl, loadFont } from "./fonts.js";
import type { CaptionStripProps, LowerThirdProps, TitleCardProps } from "./props.js";
import { webpackOverride } from "./webpack-override.js";

export interface RenderedBrandAssets {
  readonly intro: string | null;
  readonly outro: string | null;
  readonly lowerThirds: readonly string[];
}

export interface RenderBrandOptions {
  readonly concurrency?: number;
  readonly onAsset?: (file: string) => void;
}

export function entryPoint(): string {
  return fileURLToPath(new URL("./entry.tsx", import.meta.url));
}

export async function renderBrandAssets(
  plan: BrandPlan,
  kit: BrandKit,
  directory: string,
  options: RenderBrandOptions = {}
): Promise<RenderedBrandAssets> {
  const names = brandAssetNames(plan);
  const frames = (seconds: number): number => Math.max(1, Math.round(seconds * plan.fps));

  await ensureBrowser();
  const serveUrl = await bundle({ entryPoint: entryPoint(), webpackOverride });

  const heading = await loadFont(kit.fonts.heading);
  const body = await loadFont(kit.fonts.body);
  const logoDataUrl = kit.logo === null ? null : await imageDataUrl(kit.logo);
  const concurrency = options.concurrency === undefined ? {} : { concurrency: options.concurrency };

  const frame = { width: plan.width, height: plan.height, fps: plan.fps };

  const renderCard = async (cue: TitleCardCue, id: "Intro" | "Outro", file: string): Promise<string> => {
    const inputProps: TitleCardProps = {
      ...frame,
      durationInFrames: frames(cue.durationSeconds),
      kind: cue.kind,
      headline: cue.headline,
      tagline: cue.tagline,
      colors: kit.colors,
      heading,
      body,
      logoDataUrl
    };
    const composition = await selectComposition({ serveUrl, id, inputProps });
    const outputLocation = join(directory, file);
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      outputLocation,
      codec: "h264",
      audioCodec: "aac",
      enforceAudioTrack: true,
      ...concurrency
    });
    options.onAsset?.(outputLocation);
    return outputLocation;
  };

  const renderLowerThird = async (cue: LowerThirdCue, file: string): Promise<string> => {
    const inputProps: LowerThirdProps = {
      ...frame,
      durationInFrames: frames(cue.durationSeconds),
      name: cue.name,
      title: cue.title,
      corner: plan.corner,
      marginPercent: plan.marginPercent,
      colors: kit.colors,
      heading,
      body
    };
    const composition = await selectComposition({ serveUrl, id: "LowerThird", inputProps });
    const outputLocation = join(directory, file);
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      outputLocation,
      codec: "vp9",
      pixelFormat: "yuva420p",
      imageFormat: "png",
      muted: true,
      ...concurrency
    });
    options.onAsset?.(outputLocation);
    return outputLocation;
  };

  const lowerThirds: string[] = [];
  for (const [index, cue] of plan.lowerThirds.entries()) {
    const file = names.lowerThirds[index];
    if (file === undefined) throw new Error(`no file name for lower third ${index}`);
    lowerThirds.push(await renderLowerThird(cue, file));
  }

  return {
    intro: plan.intro === null || names.intro === null ? null : await renderCard(plan.intro, "Intro", names.intro),
    outro: plan.outro === null || names.outro === null ? null : await renderCard(plan.outro, "Outro", names.outro),
    lowerThirds
  };
}
export interface RenderCaptionOptions {
  readonly concurrency?: number;
  readonly onAsset?: (file: string) => void;
}

export async function renderCaptionOverlays(
  plan: ShortsPlan,
  profile: ClipProfile,
  kit: BrandKit,
  directory: string,
  options: RenderCaptionOptions = {}
): Promise<string[]> {
  if (plan.shorts.length === 0) return [];

  await ensureBrowser();
  const serveUrl = await bundle({ entryPoint: entryPoint(), webpackOverride });

  const heading = await loadFont(kit.fonts.heading);
  const body = await loadFont(kit.fonts.body);
  const concurrency = options.concurrency === undefined ? {} : { concurrency: options.concurrency };

  const overlays: string[] = [];

  const renderOne = async (short: Short): Promise<string> => {
    const inputProps: CaptionStripProps = {
      width: short.width,
      height: short.height,
      fps: plan.fps,
      durationInFrames: Math.max(1, Math.round(short.durationSeconds * plan.fps)),
      title: short.title,
      withTitle: profile.captions.withTitle,
      withSpeakers: profile.captions.withSpeakers,
      position: profile.captions.position,
      safeAreaPercent: profile.captions.safeAreaPercent,
      lines: short.lines.map((line) => ({
        startSeconds: line.startSeconds,
        endSeconds: line.endSeconds,
        speaker: line.speaker,
        words: line.words.map((word) => ({
          text: word.text,
          startSeconds: word.startSeconds,
          endSeconds: word.endSeconds
        }))
      })),
      colors: kit.colors,
      heading,
      body
    };

    const composition = await selectComposition({ serveUrl, id: "CaptionStrip", inputProps });
    const outputLocation = join(directory, shortCaptionFile(short.index));
    await renderMedia({
      composition,
      serveUrl,
      inputProps,
      outputLocation,
      codec: "vp9",
      pixelFormat: "yuva420p",
      imageFormat: "png",
      muted: true,
      ...concurrency
    });
    options.onAsset?.(outputLocation);
    return outputLocation;
  };

  for (const short of plan.shorts) overlays.push(await renderOne(short));

  return overlays;
}
