import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ingestCommand } from "./ingest.js";

const ATEM = [
  "atem mini pro iso 02.mp4",
  "atem mini pro iso CAM 1 02.mp4",
  "atem mini pro iso CAM 2 02.mp4",
  "atem mini pro iso CAM 3 02.mp4",
  "atem mini pro iso CAM 4 02.mp4",
  "atem mini pro iso.drp"
];

describe("bringing a recording off the disk the ATEM writes to", () => {
  let home = "";
  let source = "";
  let root = "";

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "doslineas-ingest-"));
    source = join(home, "mount", "2026-09-10-piru");
    root = join(home, "sessions");
    await mkdir(source, { recursive: true });
    for (const name of ATEM) await writeFile(join(source, name), `${name} bytes`, "utf8");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (home !== "") await rm(home, { recursive: true, force: true });
  });

  it("copies every file and leaves the session under its own name", async () => {
    await ingestCommand([source, "--into", root]);

    const landed = await readdir(join(root, "2026-09-10-piru"));
    expect(landed.sort()).toEqual([...ATEM].sort());
    expect(await readFile(join(root, "2026-09-10-piru", "atem mini pro iso.drp"), "utf8")).toBe(
      "atem mini pro iso.drp bytes"
    );
  });

  it("never touches the source", async () => {
    await ingestCommand([source, "--into", root]);
    expect((await readdir(source)).sort()).toEqual([...ATEM].sort());
  });

  it("reaches the recording when it came wrapped in a folder", async () => {
    const wrapped = join(home, "mount", "ep13");
    await mkdir(join(wrapped, "atem mini pro iso 4"), { recursive: true });
    for (const name of ATEM) await writeFile(join(wrapped, "atem mini pro iso 4", name), "x", "utf8");

    await ingestCommand([wrapped, "--into", root]);
    expect((await readdir(join(root, "ep13"))).sort()).toEqual([...ATEM].sort());
  });

  it("copies nothing with --dry-run", async () => {
    await ingestCommand([source, "--into", root, "--dry-run"]);
    await expect(readdir(root)).rejects.toThrow();
  });

  it("refuses a directory that holds no recording", async () => {
    const empty = join(home, "mount", "notes");
    await mkdir(empty, { recursive: true });

    await expect(ingestCommand([empty, "--into", root])).rejects.toThrow(/no ISOs/);
  });

  it("refuses to overwrite a session that is already there", async () => {
    await ingestCommand([source, "--into", root]);
    await expect(ingestCommand([source, "--into", root])).rejects.toThrow(/already exists/);
  });

  it("leaves nothing behind in the staging folder", async () => {
    await ingestCommand([source, "--into", root]);
    expect(await readdir(join(root, "_incoming"))).toEqual([]);
  });
});
