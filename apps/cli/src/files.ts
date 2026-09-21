import { access, readFile } from "node:fs/promises";

export function flag(args: readonly string[], name: string, fallback: string): string {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? fallback : args[index + 1] ?? fallback;
}

export function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index < 0 ? undefined : args[index + 1];
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

export function numberOption(args: readonly string[], name: string): number | undefined {
  const raw = option(args, name);
  if (raw === undefined) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a whole number of 1 or more`);
  return value;
}
