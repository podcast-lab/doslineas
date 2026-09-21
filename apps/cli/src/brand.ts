import { writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { BrandKit, BrandPlan, Edl, Episode } from "@doslineas/core";
import {
  DEFAULT_CUES,
  parseBrandKit,
  parseEdl,
  parseEpisode,
  parseTranscript,
  placeholderEpisode,
  planBranding,
  shiftCues,
  toCues,
  toPlainText,
  toSrt,
  toWebVtt
} from "@doslineas/core";
import type { BrandAssets } from "@doslineas/media";
import { brandCompositePlan, parseEncoder, probe, runOrFail } from "@doslineas/media";
import { exists, flag, numberOption, option, readJson } from "./files.js";

export async function readEpisode(directory: string, given: string | undefined, edl: Edl): Promise<Episode> {
  const path = given === undefined ? join(directory, "episode.json") : resolve(given);
  if (await exists(path)) return parseEpisode(await readJson(path));
  if (given !== undefined) throw new Error(`no episode file at ${path}`);

  console.log("  no episode.json: naming the participants after their role");
  return placeholderEpisode(edl);
}

async function frameOf(directory: string, edl: Edl): Promise<{ width: number; height: number }> {
  const master = join(directory, "master.mp4");
  const reference = (await exists(master)) ? master : edl.sources[0]?.video;
  if (reference === undefined) throw new Error("the EDL has no sources to take the frame size from");

  const sonde = await probe(reference);
  if (sonde.video === null) throw new Error(`${reference} has no video track`);
  return { width: sonde.video.width, height: sonde.video.height };
}

export async function renderBranded(
  plan: BrandPlan,
  kit: BrandKit,
  directory: string,
  encoder: string,
  preset: string,
  concurrency: number | undefined
): Promise<string> {
  const master = join(directory, "master.mp4");
  if (!(await exists(master))) throw new Error(`no master at ${master}; run edit --render first`);

  const { renderBrandAssets } = await import("@doslineas/graphics");
  const rendered = await renderBrandAssets(plan, kit, directory, {
    onAsset: (file) => console.log(`  graphic  ${file}`),
    ...(concurrency === undefined ? {} : { concurrency })
  });

  const assets: BrandAssets = {
    intro: rendered.intro,
    outro: rendered.outro,
    lowerThirds: rendered.lowerThirds
  };
  const filterPath = join(directory, "brand-filter.txt");
  const target = join(directory, "master-branded.mp4");
  const composite = brandCompositePlan(plan, assets, master, filterPath, target, {
    encoder: parseEncoder(encoder),
    quality: "20",
    preset
  });

  await writeFile(filterPath, composite.filter, "utf8");
  await runOrFail("ffmpeg", [...composite.args, "-loglevel", "error"]);

  return target;
}

export async function brandCommand(args: readonly string[]): Promise<void> {
  const given = args[0];
  if (given === undefined || given.startsWith("--")) throw new Error("missing session directory");

  const directory = resolve(given);
  const started = process.hrtime.bigint();

  const edlPath = join(directory, "edl.json");
  if (!(await exists(edlPath))) throw new Error(`no edl.json in ${directory}; run edit first`);

  const edl = parseEdl(await readJson(edlPath));
  const kit = parseBrandKit(await readJson(resolve(flag(args, "kit", "config/brand-kit.json"))));
  const episode = await readEpisode(directory, option(args, "episode"), edl);
  const frame = await frameOf(directory, edl);

  const plan = planBranding(edl, kit, episode, frame);
  const planPath = join(directory, "brand-plan.json");
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  console.log(`session ${directory}`);
  console.log(`  kit ${plan.kit} · ${plan.width}x${plan.height} at ${plan.fps} fps`);
  console.log(
    `  intro ${plan.intro?.durationSeconds ?? 0} s · outro ${plan.outro?.durationSeconds ?? 0} s · ${plan.lowerThirds.length} lower thirds`
  );
  for (const cue of plan.lowerThirds) {
    console.log(`    ${cue.atSeconds.toFixed(1)} s  ${cue.name} (${cue.durationSeconds.toFixed(1)} s on input ${cue.input})`);
  }
  for (const warning of plan.warnings) console.log(`  warning: ${warning}`);
  console.log(`  master ${plan.masterSeconds.toFixed(1)} s, delivered ${plan.totalSeconds.toFixed(1)} s`);
  console.log(`  plan     ${planPath}`);

  if (args.includes("--render")) {
    const target = await renderBranded(plan, kit, directory, flag(args, "encoder", "libx264"), flag(args, "preset", "fastest"), numberOption(args, "concurrency"));
    console.log(`  branded  ${target}`);
  }

  console.log(`  done in ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(1)} s`);
}

async function transcriptPath(given: string): Promise<string> {
  if (given.toLowerCase().endsWith(".json")) return given;

  const inside = join(given, "transcript.json");
  if (await exists(inside)) return inside;
  throw new Error(`no transcript at ${given} nor at ${inside}`);
}

export async function captionsCommand(args: readonly string[]): Promise<void> {
  const given = args[0];
  if (given === undefined || given.startsWith("--")) throw new Error("missing transcript file");

  const path = await transcriptPath(resolve(given));
  const transcript = parseTranscript(await readJson(path));
  const offset = Number(flag(args, "offset", "0"));
  if (!Number.isFinite(offset)) throw new Error("--offset must be a number of seconds");

  const cues = shiftCues(toCues(transcript, DEFAULT_CUES), offset);
  const captions = { withSpeakers: !args.includes("--no-speakers") };
  const stem = join(dirname(path), basename(path).replace(/\.json$/i, ""));

  const files: [string, string][] = [
    [`${stem}.vtt`, toWebVtt(cues, captions)],
    [`${stem}.srt`, toSrt(cues, captions)],
    [`${stem}.txt`, toPlainText(cues)]
  ];
  for (const [file, contents] of files) await writeFile(file, contents, "utf8");

  console.log(`${transcript.words.length} words, ${cues.length} cues, offset ${offset.toFixed(1)} s`);
  for (const [file] of files) console.log(`  ${file}`);
}
