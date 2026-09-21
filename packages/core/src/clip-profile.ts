import { z } from "zod";

export const ClipLayoutSchema = z.enum(["crop", "blur"]);
export type ClipLayout = z.infer<typeof ClipLayoutSchema>;

export const CaptionPositionSchema = z.enum(["bottom", "middle"]);
export type CaptionPosition = z.infer<typeof CaptionPositionSchema>;

export const ScoringWeightsSchema = z.object({
  density: z.number().nonnegative(),
  fit: z.number().nonnegative(),
  opening: z.number().nonnegative(),
  closing: z.number().nonnegative(),
  exchange: z.number().nonnegative(),
  hooks: z.number().nonnegative(),
  question: z.number().nonnegative()
});
export type ScoringWeights = z.infer<typeof ScoringWeightsSchema>;

export const ClipProfileSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    clip: z.object({
      minSeconds: z.number().positive(),
      maxSeconds: z.number().positive(),
      targetSeconds: z.number().positive(),
      count: z.number().int().positive()
    }),
    grouping: z.object({
      utteranceGapSeconds: z.number().positive(),
      wordsPerSecondReference: z.number().positive()
    }),
    padding: z.object({
      leadSeconds: z.number().nonnegative(),
      tailSeconds: z.number().nonnegative()
    }),
    frame: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    }),
    layout: ClipLayoutSchema,
    anchors: z.object({
      "1": z.number().min(0).max(1),
      "2": z.number().min(0).max(1),
      "3": z.number().min(0).max(1),
      "4": z.number().min(0).max(1)
    }),
    wideAnchors: z
      .object({
        "1": z.number().min(0).max(1),
        "2": z.number().min(0).max(1)
      })
      .optional(),
    captions: z.object({
      maxSeconds: z.number().positive(),
      maxCharacters: z.number().int().positive(),
      gapSeconds: z.number().nonnegative(),
      safeAreaPercent: z.number().min(0).max(40),
      position: CaptionPositionSchema,
      withTitle: z.boolean(),
      withSpeakers: z.boolean()
    }),
    scoring: ScoringWeightsSchema,
    hookWords: z.array(z.string().min(1)),
    llm: z.object({
      model: z.string().min(1),
      enabled: z.boolean()
    })
  })
  .superRefine((profile, ctx) => {
    if (profile.clip.minSeconds >= profile.clip.maxSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clip"],
        message: "minSeconds must be lower than maxSeconds"
      });
    }
    const outOfRange =
      profile.clip.targetSeconds < profile.clip.minSeconds || profile.clip.targetSeconds > profile.clip.maxSeconds;
    if (outOfRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clip", "targetSeconds"],
        message: "targetSeconds must fall between minSeconds and maxSeconds"
      });
    }
    if (profile.frame.height <= profile.frame.width) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frame"],
        message: "the clip frame must be taller than it is wide"
      });
    }
    if (profile.captions.maxSeconds > profile.clip.minSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["captions", "maxSeconds"],
        message: "a single caption cannot outlast the shortest clip"
      });
    }
    const total = Object.values(profile.scoring).reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["scoring"], message: "at least one weight must be positive" });
    }
  });

export type ClipProfile = z.infer<typeof ClipProfileSchema>;

export function parseClipProfile(raw: unknown): ClipProfile {
  return ClipProfileSchema.parse(raw);
}

export function anchorOf(profile: ClipProfile, input: 1 | 2 | 3 | 4): number {
  return profile.anchors[String(input) as "1" | "2" | "3" | "4"];
}

export function wideAnchorOf(profile: ClipProfile, speaker: 1 | 2): number | undefined {
  return profile.wideAnchors?.[String(speaker) as "1" | "2"];
}
