import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname } from "node:path";
import type { BrandFont } from "@doslineas/core";
import type { FontFace } from "./theme.js";

const resolveFrom = createRequire(import.meta.url);

export const STANDARD_FAMILY = "Montserrat";
export const STANDARD_WEIGHTS = [500, 700] as const;

const FONT_MIME: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
};

const IMAGE_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

export async function dataUrl(path: string, mimes: Record<string, string>): Promise<string> {
  const mime = mimes[extname(path).toLowerCase()];
  if (mime === undefined) throw new Error(`the brand kit points at an unsupported file: ${path}`);
  const bytes = await readFile(path);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

export function fontDataUrl(path: string): Promise<string> {
  return dataUrl(path, FONT_MIME);
}

export function imageDataUrl(path: string): Promise<string> {
  return dataUrl(path, IMAGE_MIME);
}

export function nearestStandardWeight(weight: number): (typeof STANDARD_WEIGHTS)[number] {
  return STANDARD_WEIGHTS.reduce((closest, candidate) =>
    Math.abs(candidate - weight) < Math.abs(closest - weight) ? candidate : closest
  );
}

export function standardFontFile(weight: number): string {
  return resolveFrom.resolve(
    `@fontsource/montserrat/files/montserrat-latin-${nearestStandardWeight(weight)}-normal.woff2`
  );
}

export async function loadFont(font: BrandFont): Promise<FontFace> {
  const file = font.file ?? (font.family === STANDARD_FAMILY ? standardFontFile(font.weight) : null);

  return {
    family: font.family,
    weight: font.weight,
    dataUrl: file === null ? null : await fontDataUrl(file)
  };
}
