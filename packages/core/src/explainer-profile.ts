import { z } from "zod";
import { InputSchema } from "./profile.js";

export const InsetCornerSchema = z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]);
export type InsetCorner = z.infer<typeof InsetCornerSchema>;

export const ExplainerProfileSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    sampling: z.object({
      fps: z.number().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      toleranceLevels: z.number().int().min(0).max(255)
    }),
    activity: z.object({
      changedRatio: z.number().min(0).max(1),
      jumpRatio: z.number().min(0).max(1),
      openMs: z.number().nonnegative(),
      closeMs: z.number().nonnegative(),
      tailSeconds: z.number().nonnegative()
    }),
    layout: z.object({
      personInput: InputSchema,
      screenInput: InputSchema,
      minHoldSeconds: z.number().positive(),
      insetPercent: z.number().min(10).max(50),
      insetCorner: InsetCornerSchema,
      insetMarginPercent: z.number().min(0).max(20)
    }),
    frame: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive()
    })
  })
  .superRefine((profile, ctx) => {
    if (profile.layout.personInput === profile.layout.screenInput) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layout"],
        message: "the person and the screen cannot come from the same input"
      });
    }
    if (profile.activity.jumpRatio < profile.activity.changedRatio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activity", "jumpRatio"],
        message: "a slide change repaints more of the screen than writing does, not less"
      });
    }
    if (profile.activity.closeMs < profile.activity.openMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activity", "closeMs"],
        message: "closing must be slower than opening, so a still moment does not cut the screen away at once"
      });
    }
    if (profile.frame.width <= profile.frame.height) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["frame"],
        message: "the explainer frame is horizontal"
      });
    }
  });

export type ExplainerProfile = z.infer<typeof ExplainerProfileSchema>;

export function parseExplainerProfile(raw: unknown): ExplainerProfile {
  return ExplainerProfileSchema.parse(raw);
}
