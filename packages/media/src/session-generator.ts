import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Input, InputRole } from "@doslineas/core";
import { runOrFail } from "./process.js";
import { writeWav } from "./wav.js";

export const SAMPLE_RATE = 48_000;

export interface Utterance {
  readonly input: Input;
  readonly start: number;
  readonly dur: number;
}

export interface SessionScript {
  readonly session: string;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
  readonly input4: Extract<InputRole, "screen" | "guest3">;
  readonly utterances: readonly Utterance[];
  readonly bleedDb: number;
  readonly noiseDb: number;
  readonly wavChannels: 2 | 4;
}

export interface SyntheticSession {
  readonly directory: string;
  readonly isos: Record<Input, string>;
  readonly program: string;
  readonly wav: string;
  readonly truth: string;
}

export const BASE_SCRIPT: SessionScript = {
  session: "synthetic-base",
  fps: 25,
  durationSeconds: 30,
  width: 640,
  height: 360,
  input4: "screen",
  bleedDb: -18,
  noiseDb: -50,
  wavChannels: 4,
  utterances: [
    { input: 2, start: 0.5, dur: 4.0 },
    { input: 3, start: 5.0, dur: 6.5 },
    { input: 2, start: 12.0, dur: 3.0 },
    { input: 3, start: 15.5, dur: 2.0 },
    { input: 2, start: 18.0, dur: 9.0 },
    { input: 3, start: 27.5, dur: 2.0 }
  ]
};

const TONE_BY_INPUT: Record<Input, number> = { 1: 110, 2: 220, 3: 330, 4: 440 };
const HUE_BY_INPUT: Record<Input, number> = { 1: 0, 2: 90, 3: 200, 4: 300 };
const SPEECH_AMPLITUDE = 0.5;
export const SLIDE_SECONDS = 2;
export const SLIDE_BURST_SECONDS = 10;
export const SLIDE_CYCLE_SECONDS = 30;

export function amplitudeFromDb(db: number): number {
  return Math.pow(10, db / 20);
}

export function isPerson(input: Input, input4: SessionScript["input4"]): boolean {
  if (input === 2 || input === 3) return true;
  return input === 4 && input4 === "guest3";
}

export function peopleOf(script: SessionScript): Input[] {
  return ([1, 2, 3, 4] as Input[]).filter((input) => isPerson(input, script.input4));
}

const UNIFORM_RMS_GAIN = Math.sqrt(12);

const TURN_LENGTHS = [12, 4, 25, 7, 3, 18, 9, 32, 5, 14];
const TURN_GAPS = [0.4, 1.8, 0.3, 2.4, 0.5];

export function conversation(durationSeconds: number, people: readonly Input[] = [2, 3]): Utterance[] {
  const utterances: Utterance[] = [];
  let start = 1.5;
  let index = 0;

  while (start < durationSeconds - 2) {
    const length = Math.min(TURN_LENGTHS[index % TURN_LENGTHS.length]!, durationSeconds - 1 - start);
    if (length <= 0) break;
    utterances.push({ input: people[index % people.length] ?? 2, start, dur: length });
    start += length + (TURN_GAPS[index % TURN_GAPS.length] ?? 0.4);
    index += 1;
  }

  return utterances;
}

function pseudoNoise(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43_758.5453;
  return (value - Math.floor(value) - 0.5) * UNIFORM_RMS_GAIN;
}

export function microphoneTrack(script: SessionScript, input: Input): Float32Array {
  const samples = Math.round(script.durationSeconds * SAMPLE_RATE);
  const track = new Float32Array(samples);
  const bleed = amplitudeFromDb(script.bleedDb);
  const noise = amplitudeFromDb(script.noiseDb);

  for (let index = 0; index < samples; index += 1) {
    track[index] = noise * pseudoNoise(input, index);
  }

  for (const utterance of script.utterances) {
    const own = utterance.input === input;
    const amplitude = SPEECH_AMPLITUDE * (own ? 1 : bleed);
    if (amplitude < 1e-5) continue;

    const tone = TONE_BY_INPUT[utterance.input];
    const from = Math.max(0, Math.round(utterance.start * SAMPLE_RATE));
    const to = Math.min(samples, Math.round((utterance.start + utterance.dur) * SAMPLE_RATE));

    for (let index = from; index < to; index += 1) {
      const t = index / SAMPLE_RATE;
      const envelope = 0.6 + 0.4 * Math.sin(2 * Math.PI * 3.7 * t);
      track[index] = (track[index] ?? 0) + amplitude * envelope * Math.sin(2 * Math.PI * tone * t);
    }
  }

  return track;
}

export function mixTracks(tracks: readonly Float32Array[], gain = 0.6): Float32Array {
  const first = tracks[0];
  if (first === undefined) throw new Error("there are no tracks to mix");
  const mix = new Float32Array(first.length);
  for (const track of tracks) {
    for (let index = 0; index < mix.length; index += 1) {
      mix[index] = (mix[index] ?? 0) + gain * (track[index] ?? 0);
    }
  }
  return mix;
}

function videoSource(script: SessionScript, input: Input): string[] {
  const size = `${script.width}x${script.height}`;
  const common = `:rate=${script.fps}:duration=${script.durationSeconds.toFixed(3)}`;
  const isScreen = input === 4 && script.input4 === "screen";
  const slideWidth = Math.round(script.width * 0.6);
  const slideHeight = Math.round(script.height * 0.55);
  const screen = [
    `color=c=0x101820:size=${size}${common}[page]`,
    `color=c=0x3fa0ff:size=${slideWidth}x${slideHeight}${common}[block]`,
    `[page][block]overlay=x='if(lt(mod(t,${SLIDE_CYCLE_SECONDS}),${SLIDE_BURST_SECONDS}),mod(floor(t/${SLIDE_SECONDS}),2)*${script.width - slideWidth},0)':y=${Math.round((script.height - slideHeight) / 2)}:eval=frame,format=yuv420p`
  ].join(";");
  const description = isScreen
    ? screen
    : `testsrc2=size=${size}${common},hue=h=${HUE_BY_INPUT[input]},format=yuv420p`;
  return ["-f", "lavfi", "-i", description];
}

async function mux(script: SessionScript, input: Input, audio: string, target: string, binary: string): Promise<void> {
  await runOrFail(binary, [
    "-y", "-hide_banner", "-loglevel", "error",
    ...videoSource(script, input),
    "-i", audio,
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", String(script.fps * 2),
    "-c:a", "aac", "-b:a", "128k",
    "-shortest", target
  ]);
}

export async function generateSyntheticSession(
  script: SessionScript,
  directory: string,
  binary = "ffmpeg"
): Promise<SyntheticSession> {
  await mkdir(directory, { recursive: true });

  const inputs = [1, 2, 3, 4] as Input[];
  const tracks = new Map<Input, Float32Array>(inputs.map((input) => [input, microphoneTrack(script, input)]));
  const isos = {} as Record<Input, string>;

  for (const input of inputs) {
    const track = tracks.get(input);
    if (track === undefined) throw new Error(`missing track for input ${input}`);
    const audio = join(directory, `mic${input}.wav`);
    await writeWav(audio, [track], SAMPLE_RATE);
    const target = join(directory, `iso${input}.mp4`);
    await mux(script, input, audio, target, binary);
    isos[input] = target;
  }

  const mix = mixTracks(peopleOf(script).map((input) => tracks.get(input) ?? new Float32Array(0)));
  const programAudio = join(directory, "mix.wav");
  await writeWav(programAudio, [mix], SAMPLE_RATE);

  const program = join(directory, "program.mp4");
  await mux(script, 1, programAudio, program, binary);

  const wavChannels = (script.wavChannels === 4 ? inputs : ([2, 3] as Input[])).map(
    (input) => tracks.get(input) ?? new Float32Array(0)
  );
  const wav = join(directory, "program.wav");
  await writeWav(wav, wavChannels, SAMPLE_RATE);

  const truth = join(directory, "truth.json");
  await writeFile(truth, `${JSON.stringify({ script, generatedBy: "session-generator" }, null, 2)}\n`, "utf8");
  await writeFile(join(directory, "session.drp"), "resolve project placeholder\n", "utf8");

  return { directory, isos, program, wav, truth };
}
