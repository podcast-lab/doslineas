import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Input } from "@doslineas/core";

export const SESSION_INPUTS = [1, 2, 3, 4] as Input[];

export type SessionNaming = "atem" | "plain";

export interface SessionLayout {
  readonly directory: string;
  readonly naming: SessionNaming;
  readonly base: string | null;
  readonly take: string | null;
  readonly otherTakes: readonly string[];
  readonly isos: Record<Input, string | null>;
  readonly audio: Record<Input, string | null>;
  readonly mics: readonly string[];
  readonly program: string | null;
  readonly drp: string | null;
}

const ATEM_ISO = /^(?<base>.+) CAM (?<input>[1-4])(?: (?<take>\d+))?\.mp4$/i;
const ATEM_MIC = /^(?<base>.+) MIC (?<index>\d+)(?: (?<take>\d+))?\.wav$/i;
const APPLE_DOUBLE = /^\._/;

interface Candidate {
  readonly base: string;
  readonly take: string;
  readonly input: Input;
}

function takeLabel(base: string, take: string): string {
  return take === "" ? base : `${base} ${take}`;
}

export function chooseTake(candidates: readonly Candidate[]): { base: string; take: string } | null {
  const groups = new Map<string, { base: string; take: string; inputs: Set<Input> }>();

  for (const candidate of candidates) {
    const key = `${candidate.base}\u0000${candidate.take}`;
    const group = groups.get(key) ?? { base: candidate.base, take: candidate.take, inputs: new Set<Input>() };
    group.inputs.add(candidate.input);
    groups.set(key, group);
  }

  const ranked = [...groups.values()].sort((left, right) => {
    if (left.inputs.size !== right.inputs.size) return right.inputs.size - left.inputs.size;
    return takeLabel(left.base, left.take).localeCompare(takeLabel(right.base, right.take));
  });

  const best = ranked[0];
  return best === undefined ? null : { base: best.base, take: best.take };
}

export async function resolveLayout(directory: string): Promise<SessionLayout> {
  const names = (await readdir(directory)).filter((name) => !APPLE_DOUBLE.test(name));
  const real = new Map(names.map((name) => [name.toLowerCase(), join(directory, name)]));
  const find = (name: string): string | null => real.get(name.toLowerCase()) ?? null;

  const candidates: Candidate[] = [];
  for (const name of names) {
    const match = ATEM_ISO.exec(name);
    if (match?.groups === undefined) continue;
    candidates.push({
      base: match.groups["base"] ?? "",
      take: match.groups["take"] ?? "",
      input: Number(match.groups["input"]) as Input
    });
  }

  const chosen = chooseTake(candidates);

  if (chosen === null) {
    const isos = {} as Record<Input, string | null>;
    const audio = {} as Record<Input, string | null>;
    for (const input of SESSION_INPUTS) {
      isos[input] = find(`iso${input}.mp4`);
      audio[input] = null;
    }
    return {
      directory,
      naming: "plain",
      base: null,
      take: null,
      otherTakes: [],
      isos,
      audio,
      mics: [],
      program: find("program.mp4"),
      drp: find("session.drp")
    };
  }

  const { base, take } = chosen;
  const suffix = take === "" ? "" : ` ${take}`;
  const isos = {} as Record<Input, string | null>;
  const audio = {} as Record<Input, string | null>;
  for (const input of SESSION_INPUTS) {
    isos[input] = find(`${base} CAM ${input}${suffix}.mp4`);
    audio[input] = find(`${base} CAM ${input}${suffix}.wav`);
  }

  const mics: string[] = [];
  for (const name of names) {
    const match = ATEM_MIC.exec(name);
    if (match?.groups === undefined) continue;
    if ((match.groups["base"] ?? "") !== base) continue;
    if ((match.groups["take"] ?? "") !== take) continue;
    mics.push(join(directory, name));
  }

  const otherTakes = [
    ...new Set(
      candidates
        .map((candidate) => takeLabel(candidate.base, candidate.take))
        .filter((label) => label !== takeLabel(base, take))
    )
  ].sort();

  return {
    directory,
    naming: "atem",
    base,
    take: take === "" ? null : take,
    otherTakes,
    isos,
    audio,
    mics: mics.sort(),
    program: find(`${base}${suffix}.mp4`),
    drp: find(`${base}${suffix}.drp`) ?? find(`${base}.drp`)
  };
}

export function hasIsos(layout: SessionLayout): boolean {
  return SESSION_INPUTS.some((input) => layout.isos[input] !== null);
}

export async function findSessionDirectories(directory: string): Promise<readonly string[]> {
  if (hasIsos(await resolveLayout(directory))) return [directory];

  const entries = await readdir(directory, { withFileTypes: true });
  const nested: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || APPLE_DOUBLE.test(entry.name)) continue;

    const child = join(directory, entry.name);
    if (hasIsos(await resolveLayout(child))) nested.push(child);
  }

  return nested.sort();
}
