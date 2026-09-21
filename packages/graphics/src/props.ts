import { zColor } from "@remotion/zod-types";
import { z } from "zod";

export const paletteSchema = z.object({
  primary: zColor(),
  accent: zColor(),
  background: zColor(),
  text: zColor(),
  muted: zColor()
});

export const fontSchema = z.object({
  family: z.string(),
  dataUrl: z.string().nullable(),
  weight: z.number().int().min(100).max(900)
});

export const frameSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  durationInFrames: z.number().int().positive()
});

export const titleCardSchema = frameSchema.extend({
  kind: z.enum(["intro", "outro"]),
  headline: z.string(),
  tagline: z.string(),
  colors: paletteSchema,
  heading: fontSchema,
  body: fontSchema,
  logoDataUrl: z.string().nullable()
});
export type TitleCardProps = z.infer<typeof titleCardSchema>;

export const lowerThirdSchema = frameSchema.extend({
  name: z.string(),
  title: z.string(),
  corner: z.enum(["bottom-left", "bottom-right"]),
  marginPercent: z.number().min(0).max(40),
  colors: paletteSchema,
  heading: fontSchema,
  body: fontSchema
});
export type LowerThirdProps = z.infer<typeof lowerThirdSchema>;

export const STANDARD_PALETTE: z.infer<typeof paletteSchema> = {
  primary: "#4f46e5",
  accent: "#22d3ee",
  background: "#0b0f19",
  text: "#f8fafc",
  muted: "#94a3b8"
};

export const STANDARD_HEADING: z.infer<typeof fontSchema> = { family: "Montserrat", dataUrl: null, weight: 700 };
export const STANDARD_BODY: z.infer<typeof fontSchema> = { family: "Montserrat", dataUrl: null, weight: 500 };

export const DEFAULT_TITLE_CARD: TitleCardProps = {
  width: 1920,
  height: 1080,
  fps: 25,
  durationInFrames: 125,
  kind: "intro",
  headline: "Dos Líneas",
  tagline: "Episodio de muestra",
  colors: STANDARD_PALETTE,
  heading: STANDARD_HEADING,
  body: STANDARD_BODY,
  logoDataUrl: null
};

export const DEFAULT_LOWER_THIRD: LowerThirdProps = {
  width: 1920,
  height: 1080,
  fps: 25,
  durationInFrames: 100,
  name: "Nombre Apellido",
  title: "Invitado",
  corner: "bottom-left",
  marginPercent: 6,
  colors: STANDARD_PALETTE,
  heading: STANDARD_HEADING,
  body: STANDARD_BODY
};

export const captionWordSchema = z.object({
  text: z.string(),
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative()
});

export const captionLineSchema = z.object({
  startSeconds: z.number().nonnegative(),
  endSeconds: z.number().nonnegative(),
  speaker: z.string(),
  words: z.array(captionWordSchema)
});

export const captionStripSchema = frameSchema.extend({
  title: z.string(),
  withTitle: z.boolean(),
  withSpeakers: z.boolean(),
  position: z.enum(["bottom", "middle"]),
  safeAreaPercent: z.number().min(0).max(40),
  lines: z.array(captionLineSchema),
  colors: paletteSchema,
  heading: fontSchema,
  body: fontSchema
});
export type CaptionStripProps = z.infer<typeof captionStripSchema>;

export const DEFAULT_CAPTION_STRIP: CaptionStripProps = {
  width: 1080,
  height: 1920,
  fps: 25,
  durationInFrames: 250,
  title: "Un momento del episodio",
  withTitle: true,
  withSpeakers: false,
  position: "bottom",
  safeAreaPercent: 12,
  lines: [
    {
      startSeconds: 0.2,
      endSeconds: 2.4,
      speaker: "Speaker one",
      words: [
        { text: "Esto", startSeconds: 0.2, endSeconds: 0.6 },
        { text: "es", startSeconds: 0.6, endSeconds: 0.9 },
        { text: "un", startSeconds: 0.9, endSeconds: 1.2 },
        { text: "subtítulo", startSeconds: 1.2, endSeconds: 1.9 },
        { text: "animado", startSeconds: 1.9, endSeconds: 2.4 }
      ]
    }
  ],
  colors: STANDARD_PALETTE,
  heading: STANDARD_HEADING,
  body: STANDARD_BODY
};
