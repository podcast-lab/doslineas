import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Discard, ExplainerPlan, ExplainerProfile } from "@doslineas/core";
import { parseExplainerProfile, parseProfile, planExplainer } from "@doslineas/core";
import { detectScreenActivity, detectSilences, envelopeDb, screenActivity, silencesToDiscards } from "@doslineas/analysis";
import type { ExplainerSources } from "@doslineas/media";
import { explainerRenderPlan, extractGrayFrames, extractSamples, parseEncoder, runOrFail } from "@doslineas/media";
import { ingest } from "./edit.js";
import { flag, readJson } from "./files.js";

const SAMPLE_RATE = 48_000;

export async function renderExplainer(
  plan: ExplainerPlan,
  profile: ExplainerProfile,
  sources: ExplainerSources,
  discards: readonly Discard[],
  directory: string,
  encoder: string,
  preset: string
): Promise<string> {
  const commandsPath = join(directory, "explainer-commands.txt");
  const filterPath = join(directory, "explainer-filter.txt");
  const target = join(directory, "explainer.mp4");

  const render = explainerRenderPlan(plan, profile, sources, discards, commandsPath, filterPath, target, {
    encoder: parseEncoder(encoder),
    quality: "20",
    preset
  });

  await writeFile(commandsPath, render.commands, "utf8");
  await writeFile(filterPath, render.filter, "utf8");
  await runOrFail("ffmpeg", [...render.args, "-loglevel", "error"]);

  return target;
}

export async function explainerCommand(args: readonly string[]): Promise<void> {
  const given = args[0];
  if (given === undefined || given.startsWith("--")) throw new Error("missing session directory");

  const directory = resolve(given);
  const started = process.hrtime.bigint();

  const editProfile = parseProfile(await readJson(resolve(flag(args, "edit-profile", "config/edit-profile.json"))));
  const profile = parseExplainerProfile(await readJson(resolve(flag(args, "profile", "config/explainer-profile.json"))));

  const session = await ingest(directory, editProfile, args.includes("--force"));
  const { inspection } = session;

  console.log(`session ${inspection.directory}`);
  console.log(`  ${inspection.durationSeconds.toFixed(1)} s at ${inspection.fps} fps · input 4 carries a ${session.input4Role}`);

  if (session.input4Role !== "screen") {
    throw new Error(
      "input 4 carries a third guest, not a screen: this session is a podcast, not an explainer (see section 7.6 of the plan)"
    );
  }

  const screenPath = inspection.isos[profile.layout.screenInput];
  const personPath = inspection.isos[profile.layout.personInput];

  const frames = await extractGrayFrames(screenPath, {
    fps: profile.sampling.fps,
    width: profile.sampling.width,
    height: profile.sampling.height
  });
  const track = screenActivity(
    frames.pixels,
    frames.width * frames.height,
    frames.fps,
    profile.sampling.toleranceLevels
  );
  const windows = detectScreenActivity(track, profile);

  const keepSilences = args.includes("--keep-silences");
  let discards: Discard[] = [];
  if (!keepSilences) {
    const samples = await extractSamples(session.programAudio, { sampleRate: SAMPLE_RATE });
    const envelope = envelopeDb(samples, SAMPLE_RATE, editProfile.voice.windowMs);
    discards = silencesToDiscards(detectSilences(envelope, editProfile), editProfile);
  }

  const plan = planExplainer(
    inspection.directory.split(/[\\/]/).at(-1) ?? "session",
    inspection.fps,
    windows,
    inspection.durationSeconds,
    profile
  );

  const planPath = join(inspection.directory, "explainer-plan.json");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  const trimmed = discards.reduce((total, discard) => total + (discard.tEnd - discard.tIn), 0);
  console.log(
    `  ${windows.length} moments of screen activity, ${plan.screenSeconds.toFixed(1)} s of ${plan.sourceSeconds.toFixed(1)} s on screen`
  );
  console.log(`  ${plan.segments.length} layout blocks, person on input ${plan.personInput}, screen on input ${plan.screenInput}`);
  for (const segment of plan.segments) {
    console.log(
      `    ${segment.atSeconds.toFixed(1)}-${(segment.atSeconds + segment.durationSeconds).toFixed(1)} s  ${segment.layout}`
    );
  }
  console.log(`  ${discards.length} silences trimmed (${trimmed.toFixed(1)} s), delivered ${(plan.sourceSeconds - trimmed).toFixed(1)} s`);
  for (const warning of plan.warnings) console.log(`  warning: ${warning}`);
  console.log(`  plan     ${planPath}`);

  if (args.includes("--render")) {
    const sources: ExplainerSources = { person: personPath, screen: screenPath, audio: session.programAudio };
    const target = await renderExplainer(
      plan,
      profile,
      sources,
      discards,
      inspection.directory,
      flag(args, "encoder", "libx264"),
      flag(args, "preset", "fastest")
    );
    console.log(`  explainer ${target}`);
  }

  console.log(`  done in ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(1)} s`);
}
