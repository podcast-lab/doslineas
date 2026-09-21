import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Discard, Edl, EditProfile, Input, Source } from "@doslineas/core";
import type { Overlap } from "@doslineas/core";
import {
  DEFAULT_INTRO_PHRASES,
  buildEdl,
  findIntroStart,
  measureEdit,
  mergeDiscards,
  parseProfile,
  personInputs,
  roleOfInput,
  toFcpxml,
  variableInput,
  wideInput
} from "@doslineas/core";
import type { Envelope } from "@doslineas/analysis";
import {
  detectOverlaps,
  detectSilences,
  detectSpeech,
  envelopeDb,
  screenActivity,
  screenJumps,
  silencesToDiscards
} from "@doslineas/analysis";
import type { SessionInspection, Span } from "@doslineas/media";
import {
  extractGrayFrames,
  extractSamples,
  inspectSession,
  looksLikeScreen,
  parseEncoder,
  runOrFail,
  screenInsetPlan,
  screenSpans,
  singlePassPlan
} from "@doslineas/media";
import { deepgramTranscriber } from "@doslineas/providers";

const SAMPLE_RATE = 48_000;
const SCREEN_SAMPLE = { fps: 4, width: 64, height: 36, toleranceLevels: 10 } as const;
const SCREEN_DEFAULTS = {
  jumpRatio: 0.12,
  minSpacingSeconds: 15.0,
  minSpanSeconds: 4.0,
  insetPercent: 26,
  insetCorner: "bottom-right",
  insetMarginPercent: 3,
  insetSource: "wide"
} as const;
const INTRO_DEFAULTS = { leadSeconds: 1.0, searchSeconds: 240.0 } as const;

function toOutputSeconds(sourceSeconds: number, discards: readonly Discard[]): number {
  let shift = 0;
  for (const discard of discards) {
    if (discard.tEnd <= sourceSeconds) shift += discard.tEnd - discard.tIn;
    else if (discard.tIn < sourceSeconds) return discard.tIn - shift;
  }
  return sourceSeconds - shift;
}

export interface IngestedSession {
  readonly inspection: SessionInspection;
  readonly sources: Source[];
  readonly input4Role: "screen" | "guest3";
  readonly programAudio: string;
}

export async function ingest(directory: string, profile: EditProfile, force: boolean): Promise<IngestedSession> {
  const inspection = await inspectSession(directory);

  if (inspection.problems.length > 0) {
    for (const problem of inspection.problems) console.error(`  problem: ${problem}`);
    if (!force) throw new Error("the session is not ready; fix the problems above or pass --force");
  }

  const variable = variableInput(profile);
  const forced = profile.input4.forcedRole;
  const input4Role =
    forced ??
    (variable !== null &&
    (await looksLikeScreen(inspection.isos[variable], profile.input4.screenDuplicateRatio, {
      seconds: profile.input4.sampleSeconds
    }))
      ? "screen"
      : "guest3");

  const wide = wideInput(profile);
  const programAudio = inspection.program ?? inspection.audio[wide];

  return {
    inspection,
    input4Role,
    programAudio,
    sources: ([1, 2, 3, 4] as Input[]).map((input) => ({
      input,
      role: roleOfInput(profile, input, input4Role),
      video: inspection.isos[input],
      audio: input === wide ? programAudio : null,
      durationSeconds: inspection.durationSeconds
    }))
  };
}

export async function introDiscard(
  session: IngestedSession,
  profile: EditProfile,
  directory: string,
  language: string
): Promise<Discard | null> {
  const settings = profile.intro;
  if (settings === undefined) return null;

  const phrases = settings.phrases.length > 0 ? settings.phrases : DEFAULT_INTRO_PHRASES;
  const apiKey = process.env["DEEPGRAM_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    console.error("  no DEEPGRAM_API_KEY: the opening cannot be found, nothing is trimmed at the head");
    return null;
  }

  const searchSeconds = settings.searchSeconds ?? INTRO_DEFAULTS.searchSeconds;
  const head = join(directory, "intro-search.flac");
  await runOrFail("ffmpeg", [
    "-y", "-hide_banner",
    "-t", String(searchSeconds),
    "-i", session.programAudio,
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "flac",
    head,
    "-loglevel", "error"
  ]);

  const transcriber = deepgramTranscriber({ apiKey });
  const transcript = await transcriber.transcribe({
    audioPath: head,
    session: "intro",
    language,
    diarize: false
  });
  await rm(head, { force: true });

  const found = findIntroStart(transcript, phrases);
  if (found === null) {
    console.error(`  no opening phrase in the first ${searchSeconds.toFixed(0)} s: nothing is trimmed at the head`);
    return null;
  }

  const lead = settings.leadSeconds ?? INTRO_DEFAULTS.leadSeconds;
  const tEnd = Math.max(0, found - lead);
  console.log(`  opening heard at ${found.toFixed(1)} s: the first ${tEnd.toFixed(1)} s go`);
  return tEnd <= 0 ? null : { tIn: 0, tEnd, reason: "manual" };
}

export async function screenMoments(session: IngestedSession, profile: EditProfile): Promise<number[]> {
  if (session.input4Role !== "screen") return [];
  const screenInput = variableInput(profile);
  if (screenInput === null) return [];

  const settings = { ...SCREEN_DEFAULTS, ...(profile.screen ?? {}) };
  const frames = await extractGrayFrames(session.inspection.isos[screenInput], SCREEN_SAMPLE);
  const track = screenActivity(frames.pixels, frames.width * frames.height, frames.fps, SCREEN_SAMPLE.toleranceLevels);
  return screenJumps(track, settings.jumpRatio, settings.minSpacingSeconds);
}

export async function analyse(
  session: IngestedSession,
  profile: EditProfile,
  opening?: Discard | null,
  moments: readonly number[] = []
): Promise<Edl> {
  const people = personInputs(profile, session.input4Role);
  const envelopes = new Map<Input, Envelope>();

  for (const input of people) {
    const samples = await extractSamples(session.inspection.audio[input], { sampleRate: SAMPLE_RATE });
    envelopes.set(input, envelopeDb(samples, SAMPLE_RATE, profile.voice.windowMs));
  }

  const speech = detectSpeech(envelopes, profile, people);
  const overlaps: Overlap[] = detectOverlaps(envelopes, profile, people);
  const programSamples = await extractSamples(session.programAudio, { sampleRate: SAMPLE_RATE });
  const programEnvelope = envelopeDb(programSamples, SAMPLE_RATE, profile.voice.windowMs);
  const silenceDiscards = silencesToDiscards(detectSilences(programEnvelope, profile), profile);
  const discards = mergeDiscards(
    opening === undefined || opening === null ? silenceDiscards : [opening, ...silenceDiscards]
  );

  const settings = { ...SCREEN_DEFAULTS, ...(profile.screen ?? {}) };
  const slideSpans = screenSpans([...moments], session.inspection.durationSeconds, settings.minSpanSeconds);

  return buildEdl({
    session: session.inspection.directory.split(/[\\/]/).at(-1) ?? "session",
    fps: session.inspection.fps,
    profile,
    sources: session.sources,
    speech: speech.intervals,
    overlaps,
    screenSpans: slideSpans,
    discards,
    durationSeconds: session.inspection.durationSeconds,
    input4Role: session.input4Role
  });
}

export function screenSpansOf(profile: EditProfile, edl: Edl, moments: readonly number[]): Span[] {
  if (moments.length === 0) return [];
  const settings = { ...SCREEN_DEFAULTS, ...(profile.screen ?? {}) };
  const outputSeconds = edl.segments.reduce((sum, segment) => sum + segment.dur, 0);
  return screenSpans(
    moments.map((moment) => toOutputSeconds(moment, edl.discards)),
    outputSeconds,
    settings.minSpanSeconds
  );
}

export interface ScreenInsetRender {
  readonly spans: readonly Span[];
  readonly slide: string;
  readonly inset: string | null;
  readonly offsetSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly profile: EditProfile;
}

export async function renderMaster(
  edl: Edl,
  directory: string,
  encoder: string,
  preset: string,
  screen?: ScreenInsetRender
): Promise<string> {
  const commandsPath = join(directory, "commands.txt");
  const filterPath = join(directory, "filter.txt");
  const target = join(directory, "master.mp4");
  const options = { encoder: parseEncoder(encoder), quality: "20", preset };

  const multicam = join(directory, "master-multicam.mp4");
  const composited = screen !== undefined && screen.spans.length > 0;
  const firstTarget = composited ? multicam : target;
  const plan = singlePassPlan(edl, commandsPath, filterPath, firstTarget, options);

  await writeFile(commandsPath, plan.commands, "utf8");
  await writeFile(filterPath, plan.filter, "utf8");
  await runOrFail("ffmpeg", [...plan.args, "-loglevel", "error"]);

  if (!composited || screen === undefined) {
    await rm(multicam, { force: true });
    return target;
  }

  const settings = { ...SCREEN_DEFAULTS, ...(screen.profile.screen ?? {}) };
  const inset = screenInsetPlan({
    master: multicam,
    slide: screen.slide,
    inset: screen.inset,
    target,
    spans: screen.spans,
    offsetSeconds: screen.offsetSeconds,
    fps: edl.fps,
    layout: {
      width: screen.width,
      height: screen.height,
      insetPercent: settings.insetPercent,
      insetCorner: settings.insetCorner,
      insetMarginPercent: settings.insetMarginPercent
    },
    options
  });

  await writeFile(join(directory, "screen-inset-filter.txt"), inset.filter, "utf8");
  await runOrFail("ffmpeg", [...inset.args, "-loglevel", "error"]);

  return target;
}

function flag(args: readonly string[], name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1] ?? fallback;
}

export async function editCommand(args: readonly string[]): Promise<void> {
  const directory = args[0];
  if (directory === undefined || directory.startsWith("--")) throw new Error("missing session directory");

  const profile = parseProfile(JSON.parse(await readFile(resolve(flag(args, "profile", "config/edit-profile.json")), "utf8")));
  const started = process.hrtime.bigint();

  const session = await ingest(resolve(directory), profile, args.includes("--force"));
  const { inspection } = session;
  const out = resolve(flag(args, "out", inspection.directory));
  await mkdir(out, { recursive: true });
  console.log(`session ${inspection.directory}`);
  console.log(`  ${inspection.durationSeconds.toFixed(1)} s at ${inspection.fps} fps · input 4 carries a ${session.input4Role}`);
  if (out !== inspection.directory) console.log(`  writing to ${out}`);

  const opening = args.includes("--no-intro") ? null : await introDiscard(session, profile, out, flag(args, "language", "es"));
  const moments = await screenMoments(session, profile);
  const edl = await analyse(session, profile, opening, moments);
  const metrics = measureEdit(edl);
  const spans = screenSpansOf(profile, edl, moments);

  const edlPath = join(out, "edl.json");
  const fcpxmlPath = join(out, "edit.fcpxml");
  await writeFile(edlPath, `${JSON.stringify(edl, null, 2)}\n`, "utf8");
  await writeFile(
    fcpxmlPath,
    toFcpxml(edl, { project: edl.session, width: inspection.width, height: inspection.height }),
    "utf8"
  );

  console.log(`  edit: ${edl.segments.length} shots, ${metrics.cuts} cuts (${metrics.cutsPerMinute.toFixed(1)}/min)`);
  console.log(`  shot p10/median/p90: ${metrics.shotP10.toFixed(1)} / ${metrics.medianShot.toFixed(1)} / ${metrics.shotP90.toFixed(1)} s`);
  console.log(`  by reason: ${JSON.stringify(metrics.countByReason)}`);
  if (spans.length > 0) {
    const onScreen = spans.reduce((sum, span) => sum + (span.end - span.start), 0);
    const source = { ...SCREEN_DEFAULTS, ...(profile.screen ?? {}) }.insetSource;
    console.log(`  ${spans.length} screen spans (slide + ${source} inset), ${onScreen.toFixed(1)} s on the slides`);
  }
  console.log(`  ${edl.discards.length} silences trimmed, output ${metrics.durationSeconds.toFixed(1)} s`);
  console.log(`  EDL      ${edlPath}`);
  console.log(`  FCPXML   ${fcpxmlPath}`);

  if (args.includes("--render")) {
    const screenInput = variableInput(profile);
    const offsetSeconds = edl.discards.reduce((sum, discard) => sum + (discard.tEnd - discard.tIn), 0);
    const screen: ScreenInsetRender | undefined =
      spans.length > 0 && screenInput !== null
        ? {
            spans,
            slide: inspection.isos[screenInput],
            inset:
              { ...SCREEN_DEFAULTS, ...(profile.screen ?? {}) }.insetSource === "speaker"
                ? null
                : inspection.isos[wideInput(profile)],
            offsetSeconds,
            width: inspection.width,
            height: inspection.height,
            profile
          }
        : undefined;

    const target = await renderMaster(
      edl,
      out,
      flag(args, "encoder", "libx264"),
      flag(args, "preset", "fastest"),
      screen
    );
    console.log(`  master   ${target}`);
  }

  console.log(`  done in ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(1)} s`);
}
