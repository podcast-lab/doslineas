import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BrandKit, ClipProfile, Edl, HighlightPick, Input, Short, ShortsPlan, Transcript } from "@doslineas/core";
import {
  DEFAULT_CAPTIONS,
  nameSpeakers,
  parseBrandKit,
  parseClipProfile,
  parseEdl,
  parseTranscript,
  planShorts,
  selectHighlights,
  shortFile,
  shortSubtitleStem,
  toHighlightRequest,
  toSrt,
  toUtterances,
  toWebVtt
} from "@doslineas/core";
import { extractAudioArgs, parseEncoder, probe, runOrFail, syntheticTranscript, verticalClipPlan } from "@doslineas/media";
import { claudeHighlightPicker, deepgramTranscriber } from "@doslineas/providers";
import { readEpisode } from "./brand.js";
import { exists, flag, numberOption, option, readJson } from "./files.js";

const AUDIO_FILE = "master-audio.flac";
const TRANSCRIPT_FILE = "transcript.json";
const PLAN_FILE = "shorts-plan.json";

async function masterOf(directory: string): Promise<string> {
  const multicam = join(directory, "master-multicam.mp4");
  if (await exists(multicam)) return multicam;
  const master = join(directory, "master.mp4");
  if (!(await exists(master))) throw new Error(`no master at ${master}; run edit --render first`);
  return master;
}

async function readEdl(directory: string): Promise<Edl> {
  const path = join(directory, "edl.json");
  if (!(await exists(path))) throw new Error(`no edl.json in ${directory}; run edit first`);
  return parseEdl(await readJson(path));
}

async function readClipProfile(args: readonly string[]): Promise<ClipProfile> {
  return parseClipProfile(await readJson(resolve(flag(args, "profile", "config/clip-profile.json"))));
}

async function readKit(args: readonly string[]): Promise<BrandKit> {
  return parseBrandKit(await readJson(resolve(flag(args, "kit", "config/brand-kit.json"))));
}

export async function transcribeCommand(args: readonly string[]): Promise<void> {
  const given = args[0];
  if (given === undefined || given.startsWith("--")) throw new Error("missing session directory");

  const apiKey = process.env["DEEPGRAM_API_KEY"];
  if (apiKey === undefined || apiKey === "") throw new Error("set DEEPGRAM_API_KEY to transcribe");

  const directory = resolve(given);
  const started = process.hrtime.bigint();

  const master = await masterOf(directory);
  const audio = join(directory, AUDIO_FILE);
  console.log(`session ${directory}`);
  console.log(`  extracting the audio of the master`);
  await runOrFail("ffmpeg", [...extractAudioArgs(master, audio), "-loglevel", "error"]);

  const language = flag(args, "language", "es");
  const model = option(args, "model");
  const transcriber = deepgramTranscriber(model === undefined ? { apiKey } : { apiKey, model });

  const edl = await readEdl(directory);
  console.log(`  sending ${AUDIO_FILE} to ${transcriber.name}`);
  const raw = await transcriber.transcribe({
    audioPath: audio,
    session: edl.session,
    language,
    diarize: !args.includes("--no-diarize")
  });

  const episode = await readEpisode(directory, option(args, "episode"), edl);
  const transcript = args.includes("--no-diarize") ? raw : nameSpeakers(raw, edl, episode);

  const path = join(directory, TRANSCRIPT_FILE);
  await writeFile(path, `${JSON.stringify(transcript, null, 2)}\n`, "utf8");

  if (!args.includes("--keep-audio")) await rm(audio, { force: true });

  const speakers = new Set(transcript.words.map((word) => word.speaker));
  console.log(`  ${transcript.words.length} words, ${speakers.size} speakers: ${[...speakers].join(", ")}`);
  console.log(`  transcript ${path}`);
  console.log(`  done in ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(1)} s`);
}

export async function mockTranscriptCommand(args: readonly string[]): Promise<void> {
  const given = args[0];
  if (given === undefined || given.startsWith("--")) throw new Error("missing session directory");

  const directory = resolve(given);
  const edl = await readEdl(directory);
  const episode = await readEpisode(directory, option(args, "episode"), edl);
  const names = new Map<Input, string>(episode.participants.map((participant) => [participant.input, participant.name]));

  const transcript = syntheticTranscript(edl, names);
  const path = join(directory, TRANSCRIPT_FILE);
  await writeFile(path, `${JSON.stringify(transcript, null, 2)}
`, "utf8");

  console.log(`session ${directory}`);
  console.log(`  ${transcript.words.length} invented words over ${edl.segments.length} shots`);
  console.log(`  transcript ${path}`);
}

async function readTranscript(directory: string, given: string | undefined): Promise<Transcript> {
  const path = given === undefined ? join(directory, TRANSCRIPT_FILE) : resolve(given);
  if (!(await exists(path))) throw new Error(`no transcript at ${path}; run transcribe first`);
  return parseTranscript(await readJson(path));
}

async function writeSubtitles(directory: string, short: Short): Promise<void> {
  const cues = short.lines.map((line) => ({
    startSeconds: line.startSeconds,
    endSeconds: line.endSeconds,
    speaker: line.speaker,
    text: line.words.map((word) => word.text).join(" ")
  }));
  const folder = join(directory, "clip-subtitles");
  await mkdir(folder, { recursive: true });
  const stem = join(folder, shortSubtitleStem(short.index));
  const captions = { ...DEFAULT_CAPTIONS, withSpeakers: false };
  await writeFile(`${stem}.vtt`, toWebVtt(cues, captions), "utf8");
  await writeFile(`${stem}.srt`, toSrt(cues, captions), "utf8");
}

async function renderShorts(
  plan: ShortsPlan,
  profile: ClipProfile,
  kit: BrandKit,
  directory: string,
  master: string,
  encoder: string,
  preset: string,
  concurrency: number | undefined
): Promise<void> {
  const sonde = await probe(master);
  if (sonde.video === null) throw new Error(`${master} has no video track`);
  const source = { width: sonde.video.width, height: sonde.video.height };

  const { renderCaptionOverlays } = await import("@doslineas/graphics");
  const overlays = await renderCaptionOverlays(plan, profile, kit, directory, {
    onAsset: (file) => console.log(`  captions ${file}`),
    ...(concurrency === undefined ? {} : { concurrency })
  });

  for (const short of plan.shorts) {
    const overlay = overlays[short.index] ?? null;
    const filterPath = join(directory, `clip-${short.index + 1}-filter.txt`);
    const target = join(directory, shortFile(short.index));
    const clip = verticalClipPlan(short, source, master, overlay, filterPath, target, plan.fps, {
      encoder: parseEncoder(encoder),
      quality: "20",
      preset
    });

    await writeFile(filterPath, clip.filter, "utf8");
    await runOrFail("ffmpeg", [...clip.args, "-loglevel", "error"]);
    console.log(`  clip     ${target}`);
  }
}

export async function clipsCommand(args: readonly string[]): Promise<void> {
  const given = args[0];
  if (given === undefined || given.startsWith("--")) throw new Error("missing session directory");

  const directory = resolve(given);
  const started = process.hrtime.bigint();

  const edl = await readEdl(directory);
  const transcript = await readTranscript(directory, option(args, "transcript"));
  const profile = await readClipProfile(args);
  const kit = await readKit(args);

  const utterances = toUtterances(transcript, profile.grouping.utteranceGapSeconds);
  if (utterances.length === 0) throw new Error("the transcript has no words to work with");

  const byRules = args.includes("--rules") || !profile.llm.enabled;
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  let picks: readonly HighlightPick[] | null = null;

  console.log(`session ${directory}`);
  console.log(`  ${transcript.words.length} words in ${utterances.length} turns`);

  if (byRules) {
    console.log("  choosing the moments with the rules");
  } else if (apiKey === undefined || apiKey === "") {
    console.log("  no ANTHROPIC_API_KEY: falling back to the rules");
  } else {
    const picker = claudeHighlightPicker({ model: flag(args, "model", profile.llm.model), apiKey });
    console.log(`  asking ${picker.name} for ${profile.clip.count} moments`);
    try {
      picks = await picker.pick(toHighlightRequest(transcript, utterances, profile));
    } catch (failure) {
      console.log(`  the model failed (${(failure as Error).message}): falling back to the rules`);
    }
  }

  const selection = selectHighlights(utterances, profile, picks);
  const plan = planShorts(edl, transcript, profile, selection.highlights);
  const planPath = join(directory, PLAN_FILE);
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

  for (const short of plan.shorts) {
    console.log(
      `    ${short.masterStartSeconds.toFixed(1)}-${short.masterEndSeconds.toFixed(1)} s (${short.durationSeconds.toFixed(1)} s, ${short.source}, score ${short.score.toFixed(2)})  ${short.title}`
    );
    if (short.reason !== "") console.log(`      ${short.reason}`);
    await writeSubtitles(directory, short);
  }
  for (const warning of [...selection.warnings, ...plan.warnings]) console.log(`  warning: ${warning}`);
  console.log(`  plan     ${planPath}`);

  if (args.includes("--render")) {
    const master = await masterOf(directory);
    await renderShorts(
      plan,
      profile,
      kit,
      directory,
      master,
      flag(args, "encoder", "libx264"),
      flag(args, "preset", "fastest"),
      numberOption(args, "concurrency")
    );
  }

  console.log(`  done in ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(1)} s`);
}
