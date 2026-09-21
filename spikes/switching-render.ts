import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Discard, Edl, Input, Segment } from "@doslineas/core";
import { measureEdit, validateEdl } from "@doslineas/core";
import type { SessionScript, SyntheticSession } from "@doslineas/media";
import {
  BASE_SCRIPT,
  generateSyntheticSession,
  probe,
  runCapturingBytes,
  runOrFail,
  singlePassPlan,
  twoPassPlan
} from "@doslineas/media";

const CONFIG = {
  durationSeconds: Number(process.env["SPIKE_DURATION"] ?? 120),
  width: Number(process.env["SPIKE_WIDTH"] ?? 1920),
  height: Number(process.env["SPIKE_HEIGHT"] ?? 1080),
  fps: Number(process.env["SPIKE_FPS"] ?? 25),
  shotSeconds: Number(process.env["SPIKE_SHOT"] ?? 6),
  silenceEverySeconds: Number(process.env["SPIKE_SILENCE_EVERY"] ?? 12),
  silenceSeconds: Number(process.env["SPIKE_SILENCE_DUR"] ?? 1.4),
  encoder: (process.env["SPIKE_ENCODER"] ?? "libx264") as "libx264" | "h264_nvenc" | "h264_qsv" | "h264_amf",
  preset: process.env["SPIKE_PRESET"] ?? "veryfast",
  directory: process.env["SPIKE_DIR"] ?? join(process.cwd(), ".work", "spike-r1")
};

const INPUT_CYCLE: Input[] = [2, 3, 1, 2, 3, 1];

function buildDiscards(duration: number): Discard[] {
  const discards: Discard[] = [];
  for (
    let start = CONFIG.silenceEverySeconds;
    start + CONFIG.silenceSeconds < duration;
    start += CONFIG.silenceEverySeconds
  ) {
    discards.push({ tIn: start, tEnd: start + CONFIG.silenceSeconds, reason: "silence" });
  }
  return discards;
}

function overlap(from: number, to: number, discards: readonly Discard[]): number {
  return discards.reduce((total, discard) => {
    const start = Math.max(from, discard.tIn);
    const end = Math.min(to, discard.tEnd);
    return total + Math.max(0, end - start);
  }, 0);
}

function buildEdl(session: SyntheticSession, script: SessionScript): Edl {
  const discards = buildDiscards(script.durationSeconds);
  const segments: Segment[] = [];
  let tOut = 0;
  let index = 0;

  for (let tIn = 0; tIn < script.durationSeconds; tIn += CONFIG.shotSeconds) {
    const to = Math.min(tIn + CONFIG.shotSeconds, script.durationSeconds);
    const dur = to - tIn - overlap(tIn, to, discards);
    if (dur <= 0.04) continue;
    segments.push({
      tOut,
      dur,
      input: INPUT_CYCLE[index % INPUT_CYCLE.length] ?? 1,
      tIn,
      reason: index === 0 ? "initial" : "refresh"
    });
    tOut += dur;
    index += 1;
  }

  return {
    version: 1,
    session: script.session,
    fps: script.fps,
    profile: "podcast-v1",
    sources: ([1, 2, 3, 4] as Input[]).map((input) => ({
      input,
      role: input === 1 ? "wide" : input === 2 ? "speaker1" : input === 3 ? "speaker2" : "screen",
      video: session.isos[input],
      audio: input === 1 ? session.program : null,
      durationSeconds: script.durationSeconds
    })),
    segments,
    discards,
    audio: { source: "program", gains: {} }
  };
}

async function timed<T>(task: () => Promise<T>): Promise<{ result: T; seconds: number }> {
  const start = process.hrtime.bigint();
  const result = await task();
  return { result, seconds: Number(process.hrtime.bigint() - start) / 1e9 };
}

async function averageColour(path: string, instant: number): Promise<[number, number, number]> {
  const raw = await runCapturingBytes("ffmpeg", [
    "-hide_banner", "-loglevel", "error",
    "-ss", instant.toFixed(3),
    "-i", path,
    "-frames:v", "1",
    "-vf", "scale=1:1",
    "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
  ]);
  return [raw[0] ?? 0, raw[1] ?? 0, raw[2] ?? 0];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.sqrt(a.reduce((sum, value, index) => sum + (value - (b[index] ?? 0)) ** 2, 0));
}

async function verifySwitching(edl: Edl, target: string): Promise<{ hits: number; samples: number }> {
  const candidates = edl.segments
    .filter((s) => s.dur > 2 && overlap(s.tIn, s.tIn + s.dur, edl.discards) === 0)
    .slice(0, 8);
  let hits = 0;

  for (const segment of candidates) {
    const offset = segment.dur / 2;
    const targetColour = await averageColour(target, segment.tOut + offset);
    const distances = await Promise.all(
      edl.sources.map(async (source) => ({
        input: source.input,
        distance: distance(targetColour, await averageColour(source.video, segment.tIn + offset))
      }))
    );
    const best = distances.sort((a, b) => a.distance - b.distance)[0];
    if (best?.input === segment.input) hits += 1;
  }

  return { hits, samples: candidates.length };
}

async function sizeMb(path: string): Promise<number> {
  return (await stat(path)).size / 1024 / 1024;
}

async function main(): Promise<void> {
  const script: SessionScript = {
    ...BASE_SCRIPT,
    session: "spike-r1",
    fps: CONFIG.fps,
    durationSeconds: CONFIG.durationSeconds,
    width: CONFIG.width,
    height: CONFIG.height,
    utterances: Array.from({ length: Math.floor(CONFIG.durationSeconds / 5) }, (_, i) => ({
      input: (i % 2 === 0 ? 2 : 3) as Input,
      start: i * 5 + 0.5,
      dur: 4
    }))
  };

  console.log(
    `spike R1 — switching ${CONFIG.width}x${CONFIG.height} at ${CONFIG.fps} fps, ${CONFIG.durationSeconds} s, encoder ${CONFIG.encoder}`
  );
  await rm(CONFIG.directory, { recursive: true, force: true });
  await mkdir(CONFIG.directory, { recursive: true });

  const raw = join(CONFIG.directory, "raw");
  const generation = await timed(() => generateSyntheticSession(script, raw));
  console.log(`  synthetic session generated in ${generation.seconds.toFixed(1)} s`);

  const edl = buildEdl(generation.result, script);
  const problems = validateEdl(edl);
  if (problems.length > 0) {
    console.error(problems.map((p) => p.message).join("\n"));
    process.exitCode = 1;
    return;
  }

  const metrics = measureEdit(edl);
  const expectedDuration = metrics.durationSeconds;
  console.log(
    `  EDL: ${edl.segments.length} shots, ${metrics.cuts} cuts (${metrics.cutsPerMinute.toFixed(1)}/min), ` +
      `${edl.discards.length} silences, expected output ${expectedDuration.toFixed(1)} s`
  );

  const options = { encoder: CONFIG.encoder, quality: "20", preset: CONFIG.preset };
  const rows: Array<{ route: string; seconds: number; duration: number; mb: number; note: string }> = [];

  const commandsPath = join(CONFIG.directory, "commands.txt");
  const filterPathA = join(CONFIG.directory, "filter-a.txt");
  const targetA = join(CONFIG.directory, "master-single-pass.mp4");
  const planA = singlePassPlan(edl, commandsPath, filterPathA, targetA, options);
  await writeFile(commandsPath, planA.commands, "utf8");
  await writeFile(filterPathA, planA.filter, "utf8");

  try {
    const route = await timed(() => runOrFail("ffmpeg", planA.args));
    const sonde = await probe(targetA);
    const accuracy = await verifySwitching(edl, targetA);
    rows.push({
      route: "A · single pass",
      seconds: route.seconds,
      duration: sonde.durationSeconds,
      mb: await sizeMb(targetA),
      note: `switching ${accuracy.hits}/${accuracy.samples}`
    });
  } catch (failure) {
    console.error(`  route A failed: ${(failure as Error).message}`);
    rows.push({ route: "A · single pass", seconds: NaN, duration: NaN, mb: NaN, note: "failed" });
  }

  const filterPathB1 = join(CONFIG.directory, "filter-b1.txt");
  const filterPathB2 = join(CONFIG.directory, "filter-b2.txt");
  const intermediate = join(CONFIG.directory, "intermediate.mkv");
  const targetB = join(CONFIG.directory, "master-two-pass.mp4");
  const planB = twoPassPlan(edl, commandsPath, filterPathB1, filterPathB2, intermediate, targetB, options);
  await writeFile(filterPathB1, planB.switchingFilter, "utf8");
  await writeFile(filterPathB2, planB.silenceFilter, "utf8");

  try {
    const route = await timed(async () => {
      await runOrFail("ffmpeg", planB.first);
      await runOrFail("ffmpeg", planB.second);
    });
    const sonde = await probe(targetB);
    const accuracy = await verifySwitching(edl, targetB);
    rows.push({
      route: "B · two passes",
      seconds: route.seconds,
      duration: sonde.durationSeconds,
      mb: await sizeMb(targetB),
      note: `switching ${accuracy.hits}/${accuracy.samples}, intermediate ${(await sizeMb(intermediate)).toFixed(0)} MB`
    });
  } catch (failure) {
    console.error(`  route B failed: ${(failure as Error).message}`);
    rows.push({ route: "B · two passes", seconds: NaN, duration: NaN, mb: NaN, note: "failed" });
  }

  const controlTarget = join(CONFIG.directory, "control.mp4");
  const control = await timed(() =>
    runOrFail("ffmpeg", [
      "-y", "-hide_banner", "-i", generation.result.isos[1],
      "-c:v", "libx264", "-preset", CONFIG.preset, "-crf", "20", "-c:a", "aac", controlTarget
    ])
  );
  rows.push({
    route: "control · re-encode 1 ISO",
    seconds: control.seconds,
    duration: CONFIG.durationSeconds,
    mb: await sizeMb(controlTarget),
    note: "no switching, no trimming"
  });

  const factor90 = 5400 / CONFIG.durationSeconds;
  console.log("");
  console.log("| route | time | x real time | output length | size | extrapolated to 90 min | note |");
  console.log("|---|---|---|---|---|---|---|");
  for (const row of rows) {
    const times = CONFIG.durationSeconds / row.seconds;
    const drift = Math.abs(row.duration - expectedDuration);
    const duration = Number.isNaN(row.duration)
      ? "—"
      : `${row.duration.toFixed(1)} s (${drift < 0.2 ? "ok" : `off by ${drift.toFixed(2)} s`})`;
    console.log(
      `| ${row.route} | ${Number.isNaN(row.seconds) ? "—" : `${row.seconds.toFixed(1)} s`} | ` +
        `${Number.isNaN(row.seconds) ? "—" : `${times.toFixed(2)}x`} | ${duration} | ` +
        `${Number.isNaN(row.mb) ? "—" : `${row.mb.toFixed(1)} MB`} | ` +
        `${Number.isNaN(row.seconds) ? "—" : `${((row.seconds * factor90) / 60).toFixed(0)} min`} | ${row.note} |`
    );
  }
}

await main();
