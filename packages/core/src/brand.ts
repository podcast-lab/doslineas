import { z } from "zod";
import type { Edl, Segment } from "./edl.js";
import { outputDuration } from "./edl.js";
import type { Input } from "./profile.js";
import { InputSchema } from "./profile.js";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export const BrandColorSchema = z.string().regex(HEX_COLOR, "expected a #rrggbb colour");

export const BrandColorsSchema = z.object({
  primary: BrandColorSchema,
  accent: BrandColorSchema,
  background: BrandColorSchema,
  text: BrandColorSchema,
  muted: BrandColorSchema
});
export type BrandColors = z.infer<typeof BrandColorsSchema>;

export const BrandFontSchema = z.object({
  family: z.string().min(1),
  file: z.string().min(1).nullable(),
  weight: z.number().int().min(100).max(900)
});
export type BrandFont = z.infer<typeof BrandFontSchema>;

export const TitleCardSchema = z.object({
  seconds: z.number().nonnegative(),
  headline: z.string(),
  tagline: z.string()
});
export type TitleCardStyle = z.infer<typeof TitleCardSchema>;

export const LowerThirdStyleSchema = z.object({
  seconds: z.number().positive(),
  minSeconds: z.number().positive(),
  delaySeconds: z.number().nonnegative(),
  gapSeconds: z.number().nonnegative(),
  corner: z.enum(["bottom-left", "bottom-right"]),
  marginPercent: z.number().min(0).max(40)
});
export type LowerThirdStyle = z.infer<typeof LowerThirdStyleSchema>;

export const BrandKitSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    colors: BrandColorsSchema,
    fonts: z.object({ heading: BrandFontSchema, body: BrandFontSchema }),
    logo: z.string().min(1).nullable(),
    intro: TitleCardSchema,
    outro: TitleCardSchema,
    lowerThird: LowerThirdStyleSchema
  })
  .superRefine((kit, ctx) => {
    if (kit.lowerThird.minSeconds > kit.lowerThird.seconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lowerThird", "minSeconds"],
        message: "cannot ask for more time than lowerThird.seconds"
      });
    }
  });
export type BrandKit = z.infer<typeof BrandKitSchema>;

export const ParticipantSchema = z.object({
  input: InputSchema,
  name: z.string().min(1),
  title: z.string()
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const EpisodeSchema = z
  .object({
    title: z.string().min(1),
    subtitle: z.string(),
    participants: z.array(ParticipantSchema).min(1)
  })
  .superRefine((episode, ctx) => {
    const seen = new Set<Input>();
    for (const participant of episode.participants) {
      if (seen.has(participant.input)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["participants"],
          message: `input ${participant.input} has more than one participant`
        });
      }
      seen.add(participant.input);
    }
  });
export type Episode = z.infer<typeof EpisodeSchema>;

export interface TitleCardCue {
  readonly kind: "intro" | "outro";
  readonly durationSeconds: number;
  readonly headline: string;
  readonly tagline: string;
}

export interface LowerThirdCue {
  readonly input: Input;
  readonly name: string;
  readonly title: string;
  readonly atSeconds: number;
  readonly durationSeconds: number;
  readonly segment: number;
}

export interface BrandPlan {
  readonly version: 1;
  readonly session: string;
  readonly kit: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly corner: LowerThirdStyle["corner"];
  readonly marginPercent: number;
  readonly intro: TitleCardCue | null;
  readonly outro: TitleCardCue | null;
  readonly lowerThirds: readonly LowerThirdCue[];
  readonly masterSeconds: number;
  readonly totalSeconds: number;
  readonly warnings: readonly string[];
}

export interface Frame {
  readonly width: number;
  readonly height: number;
}

function titleCard(kind: TitleCardCue["kind"], style: TitleCardStyle, episode: Episode): TitleCardCue | null {
  if (style.seconds === 0) return null;
  return {
    kind,
    durationSeconds: style.seconds,
    headline: style.headline === "" ? episode.title : style.headline,
    tagline: style.tagline === "" ? episode.subtitle : style.tagline
  };
}

function firstAppearance(segments: readonly Segment[], input: Input): number {
  return segments.findIndex((segment) => segment.input === input);
}

function placeLowerThird(
  segments: readonly Segment[],
  participant: Participant,
  style: LowerThirdStyle,
  notBefore: number
): LowerThirdCue | null {
  const candidates = segments
    .map((segment, index) => ({ segment, index }))
    .filter(({ segment }) => segment.input === participant.input && segment.tOut + style.delaySeconds >= notBefore);

  const room = (candidate: { readonly segment: Segment }): number => candidate.segment.dur - style.delaySeconds;
  const chosen = candidates.find((candidate) => room(candidate) >= style.seconds)
    ?? candidates.find((candidate) => room(candidate) >= style.minSeconds);
  if (chosen === undefined) return null;

  return {
    input: participant.input,
    name: participant.name,
    title: participant.title,
    atSeconds: chosen.segment.tOut + style.delaySeconds,
    durationSeconds: Math.min(style.seconds, room(chosen)),
    segment: chosen.index
  };
}

export function planBranding(edl: Edl, kit: BrandKit, episode: Episode, frame: Frame): BrandPlan {
  const masterSeconds = outputDuration(edl);
  const warnings: string[] = [];

  const ordered = [...episode.participants]
    .map((participant) => ({ participant, appears: firstAppearance(edl.segments, participant.input) }))
    .sort((a, b) => a.appears - b.appears);

  const lowerThirds: LowerThirdCue[] = [];
  let notBefore = 0;

  for (const { participant, appears } of ordered) {
    if (appears < 0) {
      warnings.push(`${participant.name}: input ${participant.input} never appears in the edit, no lower third`);
      continue;
    }
    const cue = placeLowerThird(edl.segments, participant, kit.lowerThird, notBefore);
    if (cue === null) {
      warnings.push(`${participant.name}: no shot on input ${participant.input} long enough for a lower third`);
      continue;
    }
    lowerThirds.push(cue);
    notBefore = cue.atSeconds + cue.durationSeconds + kit.lowerThird.gapSeconds;
  }

  const intro = titleCard("intro", kit.intro, episode);
  const outro = titleCard("outro", kit.outro, episode);

  return {
    version: 1,
    session: edl.session,
    kit: kit.name,
    fps: edl.fps,
    width: frame.width,
    height: frame.height,
    corner: kit.lowerThird.corner,
    marginPercent: kit.lowerThird.marginPercent,
    intro,
    outro,
    lowerThirds: lowerThirds.sort((a, b) => a.atSeconds - b.atSeconds),
    masterSeconds,
    totalSeconds: masterSeconds + (intro?.durationSeconds ?? 0) + (outro?.durationSeconds ?? 0),
    warnings
  };
}

export function parseBrandKit(raw: unknown): BrandKit {
  return BrandKitSchema.parse(raw);
}

export function parseEpisode(raw: unknown): Episode {
  return EpisodeSchema.parse(raw);
}

const PLACEHOLDER_NAMES: Record<string, string> = {
  speaker1: "Speaker one",
  speaker2: "Speaker two",
  guest3: "Guest"
};

export function placeholderEpisode(edl: Edl): Episode {
  const participants = edl.sources
    .filter((source) => PLACEHOLDER_NAMES[source.role] !== undefined)
    .map((source) => ({ input: source.input, name: PLACEHOLDER_NAMES[source.role] ?? source.role, title: "" }));

  return {
    title: edl.session,
    subtitle: "",
    participants: participants.length > 0 ? participants : [{ input: 2 as Input, name: "Speaker one", title: "" }]
  };
}

export function lowerThirdFile(index: number): string {
  return `lower-third-${index + 1}.webm`;
}

export interface BrandAssetNames {
  readonly intro: string | null;
  readonly outro: string | null;
  readonly lowerThirds: readonly string[];
}

export function brandAssetNames(plan: BrandPlan): BrandAssetNames {
  return {
    intro: plan.intro === null ? null : "intro.mp4",
    outro: plan.outro === null ? null : "outro.mp4",
    lowerThirds: plan.lowerThirds.map((_, index) => lowerThirdFile(index))
  };
}
