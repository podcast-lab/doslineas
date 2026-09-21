import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Edl, EditMetrics, EditProfile } from "@doslineas/core";
import { measureEdit, parseEdl, parseProfile } from "@doslineas/core";
import type { MeasureOptions, RenderMetrics } from "@doslineas/media";
import { ANNEX_A, measureRender } from "@doslineas/media";
import { exists, flag, readJson } from "./files.js";

const VIDEO = /\.(mp4|mov|mkv|webm)$/i;

function verdict(value: number, low: number, high: number, unit: string): string {
  const range = `${low}-${high} ${unit}`;
  if (value < low) return `below ${range}`;
  if (value > high) return `above ${range}`;
  return `inside ${range}`;
}

function printEdit(metrics: EditMetrics): void {
  console.log("  what the EDL intends");
  console.log(`    duration          ${metrics.durationSeconds.toFixed(1)} s`);
  console.log(`    cuts              ${metrics.cuts} (${metrics.cutsPerMinute.toFixed(1)}/min)`);
  console.log(
    `    shot p10/med/p90  ${metrics.shotP10.toFixed(1)} / ${metrics.medianShot.toFixed(1)} / ${metrics.shotP90.toFixed(1)} s`
  );
  console.log(`    by reason         ${JSON.stringify(metrics.countByReason)}`);
}

function printRender(metrics: RenderMetrics, options: MeasureOptions): void {
  console.log(`  what came out, measured with the annex A method (scene > ${options.sceneThreshold})`);
  console.log(`    duration          ${metrics.durationSeconds.toFixed(1)} s`);
  console.log(`    cuts              ${metrics.cuts} (${metrics.cutsPerMinute.toFixed(1)}/min)`);
  console.log(
    `    shot p10/med/p90  ${metrics.shotP10.toFixed(1)} / ${metrics.medianShot.toFixed(1)} / ${metrics.shotP90.toFixed(1)} s`
  );
  console.log(
    `    silence           ${metrics.silences.length} longer than ${options.silenceSeconds} s under ${options.silenceDb} dB, ${metrics.silentSeconds.toFixed(1)} s total`
  );
}

function compare(edl: Edl, intended: EditMetrics, actual: RenderMetrics, profile: EditProfile | null): void {
  const missed = intended.cuts - actual.cuts;
  console.log("  intention against result");
  console.log(
    `    cuts              ${intended.cuts} planned, ${actual.cuts} visible${missed === 0 ? "" : ` (${missed > 0 ? `${missed} not seen` : `${-missed} extra`})`}`
  );
  console.log(`    duration          ${(actual.durationSeconds - intended.durationSeconds).toFixed(2)} s of difference`);
  console.log(
    `    silence           ${edl.discards.length} trimmed, ${actual.silences.length} left in the master${actual.silences.length === 0 ? " — the trim held" : ""}`
  );

  if (profile !== null) {
    const low = profile.cuts.perMinuteTarget - profile.cuts.perMinuteTolerance;
    const high = profile.cuts.perMinuteTarget + profile.cuts.perMinuteTolerance;
    console.log(
      `    against the annex  ${actual.cutsPerMinute.toFixed(1)} cuts/min, ${verdict(actual.cutsPerMinute, low, high, "cuts/min")}`
    );
    console.log(
      `                       median shot ${actual.medianShot.toFixed(1)} s, ${verdict(actual.medianShot, profile.shot.minSeconds, profile.shot.maxSeconds, "s")}`
    );
  }

  if (actual.cuts === 0 && intended.cuts > 0) {
    console.log(
      "    warning: not one cut was visible. On synthetic sessions the four cameras look too alike for the scene\n" +
        "             score to see a cut, so this comparison only means something on real footage."
    );
  }
}

function optionsFrom(args: readonly string[]): MeasureOptions {
  return {
    sceneThreshold: Number(flag(args, "scene", String(ANNEX_A.sceneThreshold))),
    silenceDb: Number(flag(args, "noise", String(ANNEX_A.silenceDb))),
    silenceSeconds: Number(flag(args, "silence", String(ANNEX_A.silenceSeconds)))
  };
}

async function profileOf(args: readonly string[]): Promise<EditProfile | null> {
  const path = resolve(flag(args, "profile", "config/edit-profile.json"));
  if (!(await exists(path))) return null;
  return parseProfile(await readJson(path));
}

export async function measureCommand(args: readonly string[]): Promise<void> {
  const given = args[0];
  if (given === undefined || given.startsWith("--")) throw new Error("missing an EDL, a video or a session directory");

  const target = resolve(given);
  const options = optionsFrom(args);

  if (VIDEO.test(target)) {
    console.log(target);
    printRender(await measureRender(target, options), options);
    return;
  }

  const info = await stat(target).catch(() => null);
  if (info === null) throw new Error(`there is nothing at ${target}`);

  if (info.isFile()) {
    const edl = parseEdl(await readJson(target));
    console.log(`session ${edl.session} · profile ${edl.profile} · ${edl.fps} fps`);
    printEdit(measureEdit(edl));
    return;
  }

  const edlPath = join(target, "edl.json");
  if (!(await exists(edlPath))) throw new Error(`no edl.json in ${target}; run edit first`);

  const edl = parseEdl(await readJson(edlPath));
  const intended = measureEdit(edl);
  console.log(`session ${edl.session} · profile ${edl.profile} · ${edl.fps} fps`);
  printEdit(intended);

  const master = join(target, "master.mp4");
  if (!(await exists(master))) {
    console.log("  no master.mp4 yet, so there is only an intention to look at; run edit --render");
    return;
  }

  const actual = await measureRender(master, options);
  printRender(actual, options);
  compare(edl, intended, actual, await profileOf(args));
}
