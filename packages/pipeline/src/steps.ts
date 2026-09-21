import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { NewJob, StepName } from "./jobs.js";

export interface StepDefinition {
  readonly name: StepName;
  readonly command: string | null;
  readonly flags: readonly string[];
  readonly requires: readonly string[];
  readonly produces: readonly string[];
  readonly onlyWithScreen: boolean;
}

export const PIPELINE: readonly StepDefinition[] = [
  {
    name: "edit",
    command: "edit",
    flags: ["--render"],
    requires: [],
    produces: ["edl.json", "edit.fcpxml", "master.mp4"],
    onlyWithScreen: false
  },
  {
    name: "brand",
    command: "brand",
    flags: ["--render"],
    requires: ["edl.json", "master.mp4"],
    produces: ["brand-plan.json", "master-branded.mp4"],
    onlyWithScreen: false
  },
  {
    name: "transcribe",
    command: "transcribe",
    flags: [],
    requires: ["master.mp4"],
    produces: ["transcript.json"],
    onlyWithScreen: false
  },
  {
    name: "captions",
    command: "captions",
    flags: [],
    requires: ["transcript.json"],
    produces: ["transcript.vtt", "transcript.srt", "transcript.txt"],
    onlyWithScreen: false
  },
  {
    name: "clips",
    command: "clips",
    flags: ["--render"],
    requires: ["edl.json", "master.mp4", "transcript.json"],
    produces: ["shorts-plan.json"],
    onlyWithScreen: false
  },
  {
    name: "explainer",
    command: "explainer",
    flags: ["--render"],
    requires: ["edl.json"],
    produces: ["explainer-plan.json", "explainer.mp4"],
    onlyWithScreen: true
  },
  {
    name: "deliver",
    command: null,
    flags: [],
    requires: ["master.mp4"],
    produces: ["delivery-receipt.json"],
    onlyWithScreen: false
  }
];

export function stepDefinition(name: StepName): StepDefinition {
  const found = PIPELINE.find((step) => step.name === name);
  if (found === undefined) throw new Error(`unknown step ${name}`);
  return found;
}

export function plannedJobs(
  studio: string,
  session: string,
  directory: string,
  maxAttempts: number
): readonly NewJob[] {
  return PIPELINE.map((step, position) => ({
    studio,
    session,
    directory,
    step: step.name,
    position,
    maxAttempts
  }));
}

async function modifiedAt(path: string): Promise<number | null> {
  try {
    const info = await stat(path);
    return info.size > 0 ? info.mtimeMs : null;
  } catch {
    return null;
  }
}

export interface Freshness {
  readonly fresh: boolean;
  readonly missing: readonly string[];
  readonly stale: readonly string[];
}

export async function artifactFreshness(step: StepDefinition, directory: string): Promise<Freshness> {
  const missing: string[] = [];
  const stale: string[] = [];
  const outputs = new Map<string, number>();

  for (const artifact of step.produces) {
    const at = await modifiedAt(join(directory, artifact));
    if (at === null) missing.push(artifact);
    else outputs.set(artifact, at);
  }

  if (missing.length === 0) {
    for (const artifact of step.requires) {
      const inputAt = await modifiedAt(join(directory, artifact));
      if (inputAt === null) continue;
      for (const [output, outputAt] of outputs) {
        if (inputAt > outputAt) stale.push(`${artifact} is newer than ${output}`);
      }
    }
  }

  return { fresh: missing.length === 0 && stale.length === 0, missing, stale };
}

export async function missingInputs(step: StepDefinition, directory: string): Promise<readonly string[]> {
  const missing: string[] = [];
  for (const artifact of step.requires) {
    if ((await modifiedAt(join(directory, artifact))) === null) missing.push(artifact);
  }
  return missing;
}
