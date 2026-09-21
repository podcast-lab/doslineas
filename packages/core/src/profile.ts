import { z } from "zod";

export const InputRoleSchema = z.enum(["wide", "speaker1", "speaker2", "screen", "guest3"]);
export type InputRole = z.infer<typeof InputRoleSchema>;

export const InputSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type Input = z.infer<typeof InputSchema>;

export const INPUTS: readonly Input[] = [1, 2, 3, 4];

export const ConfiguredRoleSchema = z.enum(["wide", "speaker1", "speaker2", "variable"]);
export type ConfiguredRole = z.infer<typeof ConfiguredRoleSchema>;

export const EditProfileSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    shot: z.object({
      minSeconds: z.number().positive(),
      maxSeconds: z.number().positive(),
      targetSeconds: z.number().positive()
    }),
    cuts: z.object({
      perMinuteTarget: z.number().positive(),
      perMinuteTolerance: z.number().nonnegative()
    }),
    silence: z.object({
      thresholdSeconds: z.number().positive(),
      paddingSeconds: z.number().nonnegative(),
      thresholdDb: z.number().negative()
    }),
    voice: z.object({
      windowMs: z.number().positive(),
      calibrationSeconds: z.number().positive(),
      dominanceMarginDb: z.number().positive(),
      aboveNoiseMarginDb: z.number().positive(),
      openHysteresisMs: z.number().nonnegative(),
      closeHysteresisMs: z.number().nonnegative()
    }),
    refresh: z.object({
      afterSeconds: z.number().positive(),
      minHoldSeconds: z.number().positive(),
      preference: z.array(z.enum(["listening", "wide"])).min(1)
    }),
    inputs: z.object({
      "1": ConfiguredRoleSchema,
      "2": ConfiguredRoleSchema,
      "3": ConfiguredRoleSchema,
      "4": ConfiguredRoleSchema
    }),
    input4: z.object({
      screenDuplicateRatio: z.number().min(0).max(1),
      sampleSeconds: z.number().positive(),
      forcedRole: z.enum(["screen", "guest3"]).nullable()
    }),
    switching: z
      .object({
        mode: z.enum(["dynamic", "speaker"])
      })
      .optional(),
    intro: z
      .object({
        phrases: z.array(z.string().min(1)),
        leadSeconds: z.number().nonnegative(),
        searchSeconds: z.number().positive()
      })
      .optional(),
    screen: z
      .object({
        jumpRatio: z.number().min(0).max(1),
        minSpacingSeconds: z.number().positive(),
        minSpanSeconds: z.number().positive(),
        insetPercent: z.number().positive().max(100),
        insetCorner: z.enum(["bottom-right", "bottom-left", "top-right", "top-left"]),
        insetMarginPercent: z.number().nonnegative().max(100),
        insetSource: z.enum(["wide", "speaker"]).optional()
      })
      .optional()
  })
  .superRefine((profile, ctx) => {
    if (profile.shot.minSeconds >= profile.shot.maxSeconds) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["shot"], message: "minSeconds must be lower than maxSeconds" });
    }
    const targetOutOfRange =
      profile.shot.targetSeconds < profile.shot.minSeconds || profile.shot.targetSeconds > profile.shot.maxSeconds;
    if (targetOutOfRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shot", "targetSeconds"],
        message: "targetSeconds must fall between minSeconds and maxSeconds"
      });
    }
    if (profile.silence.paddingSeconds * 2 >= profile.silence.thresholdSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["silence", "paddingSeconds"],
        message: "padding on both sides cannot fill the silence being trimmed"
      });
    }
    const assigned = Object.values(profile.inputs);
    const count = (role: ConfiguredRole): number => assigned.filter((entry) => entry === role).length;
    if (count("wide") !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "exactly one input must be the wide shot" });
    }
    if (count("variable") > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "only one input can be the variable one" });
    }
    for (const role of ["speaker1", "speaker2"] as const) {
      if (count(role) > 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: `${role} is assigned to more than one input` });
      }
    }
    if (count("speaker1") + count("speaker2") === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["inputs"], message: "no input carries a speaker" });
    }
    if (profile.refresh.minHoldSeconds < profile.shot.minSeconds) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["refresh", "minHoldSeconds"],
        message: "cannot be lower than shot.minSeconds"
      });
    }
  });

export type EditProfile = z.infer<typeof EditProfileSchema>;

export function parseProfile(raw: unknown): EditProfile {
  return EditProfileSchema.parse(raw);
}

export function configuredRole(profile: EditProfile, input: Input): ConfiguredRole {
  return profile.inputs[String(input) as "1" | "2" | "3" | "4"];
}

export function variableInput(profile: EditProfile): Input | null {
  return INPUTS.find((input) => configuredRole(profile, input) === "variable") ?? null;
}

export function wideInput(profile: EditProfile): Input {
  return INPUTS.find((input) => configuredRole(profile, input) === "wide") ?? 1;
}

export function roleOfInput(profile: EditProfile, input: Input, variableRole: InputRole): InputRole {
  const configured = configuredRole(profile, input);
  return configured === "variable" ? (profile.input4.forcedRole ?? variableRole) : configured;
}

export type SwitchingMode = "dynamic" | "speaker";

export function switchingMode(profile: EditProfile): SwitchingMode {
  return profile.switching?.mode ?? "dynamic";
}

export function personInputs(profile: EditProfile, variableRole: InputRole): Input[] {
  return INPUTS.filter((input) => {
    const role = roleOfInput(profile, input, variableRole);
    return role !== "wide" && role !== "screen";
  });
}
