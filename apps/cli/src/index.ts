import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseProfile } from "@doslineas/core";
import type { SessionScript } from "@doslineas/media";
import { ANNEX_A, BASE_SCRIPT, conversation, generateSyntheticSession, probe } from "@doslineas/media";
import { brandCommand, captionsCommand } from "./brand.js";
import { clipsCommand, mockTranscriptCommand, transcribeCommand } from "./clips.js";
import { explainerCommand } from "./explainer.js";
import { ingestCommand } from "./ingest.js";
import { editCommand } from "./edit.js";
import { measureCommand } from "./measure.js";
import { confirmCommand, retryCommand, statusCommand } from "./pipeline.js";

const HELP = `doslineas — development and rescue tool

  generate-session <directory> [options]   writes a synthetic session: 4 ISOs, the program and the WAV
      --duration <s>        length in seconds (default ${BASE_SCRIPT.durationSeconds})
      --width <px>          picture width (default ${BASE_SCRIPT.width})
      --height <px>         picture height (default ${BASE_SCRIPT.height})
      --fps <n>             frames per second (default ${BASE_SCRIPT.fps})
      --input4 <role>       screen | guest3 (default ${BASE_SCRIPT.input4})

  ingest <source> [--into <dir>] [--name <session>] [--dry-run]
      copies a recording off the read-only disk into the sessions root, and only then makes it visible
      --into defaults to DOSLINEAS_SESSIONS; --name defaults to the name of the source directory

  edit <directory> [--render] [--force] [--encoder <name>] [--preset <name>] [--profile <path>] [--out <dir>] [--no-intro] [--no-outro] [--language <code>]
      ingests a session directory, analyses it, writes edl.json and edit.fcpxml, and optionally the master
      --out sends everything it writes to another directory; --no-intro keeps the head instead of cutting to the opening line
      --no-outro keeps the tail instead of cutting after the farewell

  brand <directory> [--render] [--kit <path>] [--episode <path>] [--encoder <name>] [--preset <name>] [--concurrency <n>]
      plans intro, outro and lower thirds over an existing edl.json, and optionally renders master-branded.mp4

  captions <transcript.json> [--offset <s>] [--no-speakers]
      writes the transcript next to it as .vtt, .srt and .txt

  transcribe <directory> [--language <code>] [--model <name>] [--no-diarize] [--keep-audio] [--episode <path>]
      sends the audio of the master to Deepgram and writes transcript.json in the master timeline

  mock-transcript <directory> [--episode <path>]
      development aid: invents a transcript over an existing edl.json so clips can be tried without Deepgram

  clips <directory> [--render] [--rules] [--profile <path>] [--kit <path>] [--model <name>] [--encoder <name>] [--concurrency <n>]
      picks the best moments, writes shorts-plan.json and the per-clip subtitles, and optionally renders the verticals

  explainer <directory> [--render] [--profile <path>] [--keep-silences] [--force] [--encoder <name>]
      measures the activity of the screen on input 4 and composes the split screen where the person never leaves

  status [--session <name>]                what the queue has done with every session, and the standing alerts

  retry <session> [--step <name>]          puts the failed steps of a session back in the queue

  confirm <session> [--dry-run]            checks the delivered files and then drops the raw footage of the session

  probe <file...>                          duration, fps, resolution and audio of each file
  measure <edl.json | video | directory>   what the EDL intends, what the render actually shows, and the gap
      --scene <n>           scene score above which a cut counts (default ${ANNEX_A.sceneThreshold})
      --noise <db>          silence floor in dB (default ${ANNEX_A.silenceDb})
      --silence <s>         how long a silence has to be to count (default ${ANNEX_A.silenceSeconds})
  profile [path]                           validates the edit profile (default config/edit-profile.json)
`;

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}

function numberOption(args: readonly string[], name: string, fallback: number): number {
  const value = option(args, name);
  return value === undefined ? fallback : Number(value);
}

async function generateSession(args: readonly string[]): Promise<void> {
  const directory = args[0];
  if (directory === undefined || directory.startsWith("--")) throw new Error("missing target directory");

  const duration = numberOption(args, "duration", BASE_SCRIPT.durationSeconds);
  const input4 = option(args, "input4") ?? BASE_SCRIPT.input4;
  if (input4 !== "screen" && input4 !== "guest3") throw new Error("--input4 must be screen or guest3");

  const script: SessionScript = {
    ...BASE_SCRIPT,
    session: `synthetic-${duration}s`,
    durationSeconds: duration,
    width: numberOption(args, "width", BASE_SCRIPT.width),
    height: numberOption(args, "height", BASE_SCRIPT.height),
    fps: numberOption(args, "fps", BASE_SCRIPT.fps),
    input4,
    utterances: conversation(duration, input4 === "guest3" ? [2, 3, 4] : [2, 3])
  };

  const session = await generateSyntheticSession(script, resolve(directory));
  console.log(`session written to ${session.directory}`);
  for (const input of [1, 2, 3, 4] as const) console.log(`  iso${input}  ${session.isos[input]}`);
  console.log(`  program  ${session.program}`);
  console.log(`  wav      ${session.wav}`);
  console.log(`  truth    ${session.truth}`);
}

async function probeFiles(args: readonly string[]): Promise<void> {
  if (args.length === 0) throw new Error("missing at least one file");
  for (const path of args) {
    const sonde = await probe(resolve(path));
    const video = sonde.video === null
      ? "no video"
      : `${sonde.video.width}x${sonde.video.height} ${sonde.video.fps.toFixed(2)} fps ${sonde.video.codec}`;
    const audio = sonde.audio === null
      ? "no audio"
      : `${sonde.audio.channels} channels ${sonde.audio.sampleRate} Hz ${sonde.audio.codec}`;
    console.log(`${path}\n  ${sonde.durationSeconds.toFixed(3)} s · ${video} · ${audio}`);
  }
}


async function validateProfile(args: readonly string[]): Promise<void> {
  const path = resolve(args[0] ?? "config/edit-profile.json");
  const profile = parseProfile(JSON.parse(await readFile(path, "utf8")));
  console.log(`profile ${profile.name} is valid`);
  console.log(`  shot ${profile.shot.minSeconds}-${profile.shot.maxSeconds} s, target ${profile.shot.targetSeconds} s`);
  console.log(
    `  ${profile.cuts.perMinuteTarget} cuts/min, silences longer than ${profile.silence.thresholdSeconds} s trimmed with ${profile.silence.paddingSeconds} s of padding`
  );
}

async function main(): Promise<void> {
  const [command = "", ...args] = process.argv.slice(2);

  switch (command) {
    case "generate-session":
      await generateSession(args);
      return;
    case "ingest":
      await ingestCommand(args);
      return;
    case "edit":
      await editCommand(args);
      return;
    case "brand":
      await brandCommand(args);
      return;
    case "captions":
      await captionsCommand(args);
      return;
    case "transcribe":
      await transcribeCommand(args);
      return;
    case "mock-transcript":
      await mockTranscriptCommand(args);
      return;
    case "clips":
      await clipsCommand(args);
      return;
    case "explainer":
      await explainerCommand(args);
      return;
    case "status":
      await statusCommand(args);
      return;
    case "retry":
      await retryCommand(args);
      return;
    case "confirm":
      await confirmCommand(args);
      return;
    case "probe":
      await probeFiles(args);
      return;
    case "measure":
      await measureCommand(args);
      return;
    case "profile":
      await validateProfile(args);
      return;
    default:
      console.log(HELP);
      if (command !== "" && command !== "--help" && command !== "-h") process.exitCode = 1;
  }
}

try {
  await main();
} catch (failure) {
  console.error(`error: ${(failure as Error).message}`);
  process.exitCode = 1;
}
