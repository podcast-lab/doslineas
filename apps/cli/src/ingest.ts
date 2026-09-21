import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { findSessionDirectories } from "@doslineas/media";
import { exists, option } from "./files.js";

const APPLE_DOUBLE = /^\._/;

interface Piece {
  readonly name: string;
  readonly source: string;
  readonly bytes: number;
}

function human(bytes: number): string {
  const giga = bytes / 1_000_000_000;
  return giga >= 1 ? `${giga.toFixed(2)} GB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

async function piecesOf(directory: string): Promise<readonly Piece[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const pieces: Piece[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || APPLE_DOUBLE.test(entry.name)) continue;

    const source = join(directory, entry.name);
    pieces.push({ name: entry.name, source, bytes: (await stat(source)).size });
  }

  return pieces.sort((left, right) => left.name.localeCompare(right.name));
}

export async function ingestCommand(args: readonly string[]): Promise<void> {
  const given = args[0];
  if (given === undefined || given.startsWith("--")) throw new Error("missing the source directory");

  const source = resolve(given);
  const found = await findSessionDirectories(source);
  if (found.length === 0) throw new Error(`${source} holds no ISOs, neither iso1.mp4 nor "... CAM 1 ...mp4"`);
  if (found.length > 1) {
    const names = found.map((path) => basename(path)).join(", ");
    throw new Error(`${source} holds ${found.length} recordings (${names}); ingest one at a time with its own path`);
  }

  const directory = found[0] as string;
  const root = resolve(option(args, "into") ?? process.env["DOSLINEAS_SESSIONS"] ?? "sessions");
  const session = option(args, "name") ?? basename(source);
  const target = join(root, session);
  const staging = join(root, "_incoming", session);

  if (await exists(target)) throw new Error(`${target} already exists; give another --name or move it aside`);

  const pieces = await piecesOf(directory);
  const total = pieces.reduce((sum, piece) => sum + piece.bytes, 0);

  console.log(`${directory}${directory === source ? "" : `  (inside ${source})`}`);
  for (const piece of pieces) console.log(`  ${piece.name}  ${human(piece.bytes)}`);
  console.log(`${pieces.length} files, ${human(total)} into ${target}`);

  if (args.includes("--dry-run")) {
    console.log("nothing copied: --dry-run");
    return;
  }

  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  try {
    let done = 0;
    for (const piece of pieces) {
      const copy = join(staging, piece.name);
      await copyFile(piece.source, copy);

      const landed = (await stat(copy)).size;
      if (landed !== piece.bytes) {
        throw new Error(`${piece.name} arrived with ${landed} bytes instead of ${piece.bytes}`);
      }

      done += 1;
      console.log(`  copied ${done}/${pieces.length}  ${piece.name}`);
    }

    await rename(staging, target);
  } catch (failure) {
    await rm(staging, { recursive: true, force: true });
    throw failure;
  }

  console.log(`session ${session} is ready at ${target}`);
}
