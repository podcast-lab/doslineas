import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findSessionDirectories, resolveLayout } from "./session-layout.js";

const ATEM_TAKE = [
  "atem mini pro iso 02.mp4",
  "atem mini pro iso CAM 1 02.mp4",
  "atem mini pro iso CAM 2 02.mp4",
  "atem mini pro iso CAM 3 02.mp4",
  "atem mini pro iso CAM 4 02.mp4",
  "atem mini pro iso CAM 1 02.wav",
  "atem mini pro iso CAM 2 02.wav",
  "atem mini pro iso CAM 3 02.wav",
  "atem mini pro iso CAM 4 02.wav",
  "atem mini pro iso MIC 1 02.wav",
  "atem mini pro iso MIC 2 02.wav",
  "atem mini pro iso.drp"
];

describe("resolving what the ATEM left in a directory", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "session-layout-"));
  });

  afterEach(async () => {
    if (directory !== "") await rm(directory, { recursive: true, force: true });
  });

  const drop = async (names: readonly string[]): Promise<void> => {
    for (const name of names) await writeFile(join(directory, name), "x", "utf8");
  };

  it("maps CAM n to input n and finds the programme, the project and the sidecar audio", async () => {
    await drop(ATEM_TAKE);
    const layout = await resolveLayout(directory);

    expect(layout.naming).toBe("atem");
    expect(layout.base).toBe("atem mini pro iso");
    expect(layout.take).toBe("02");
    expect(basename(layout.isos[3] ?? "")).toBe("atem mini pro iso CAM 3 02.mp4");
    expect(basename(layout.audio[3] ?? "")).toBe("atem mini pro iso CAM 3 02.wav");
    expect(basename(layout.program ?? "")).toBe("atem mini pro iso 02.mp4");
    expect(basename(layout.drp ?? "")).toBe("atem mini pro iso.drp");
    expect(layout.mics.map((path) => basename(path))).toEqual([
      "atem mini pro iso MIC 1 02.wav",
      "atem mini pro iso MIC 2 02.wav"
    ]);
  });

  it("ignores the AppleDouble files a Mac leaves behind", async () => {
    await drop([...ATEM_TAKE, ...ATEM_TAKE.map((name) => `._${name}`)]);
    const layout = await resolveLayout(directory);

    expect(layout.otherTakes).toEqual([]);
    expect(basename(layout.isos[1] ?? "")).toBe("atem mini pro iso CAM 1 02.mp4");
  });

  it("keeps the complete recording and names the ones it left out", async () => {
    await drop([...ATEM_TAKE, "atem mini pro iso 01.mp4", "atem mini pro iso CAM 1 01.mp4"]);
    const layout = await resolveLayout(directory);

    expect(layout.take).toBe("02");
    expect(layout.otherTakes).toEqual(["atem mini pro iso 01"]);
  });

  it("reads a recording the ATEM did not number", async () => {
    await drop([
      "friday show.mp4",
      "friday show CAM 1.mp4",
      "friday show CAM 2.mp4",
      "friday show CAM 1.wav",
      "friday show.drp"
    ]);
    const layout = await resolveLayout(directory);

    expect(layout.base).toBe("friday show");
    expect(layout.take).toBeNull();
    expect(basename(layout.isos[2] ?? "")).toBe("friday show CAM 2.mp4");
    expect(layout.isos[3]).toBeNull();
    expect(layout.audio[2]).toBeNull();
  });

  it("still reads the plain names the synthetic sessions use", async () => {
    await drop(["iso1.mp4", "iso2.mp4", "iso3.mp4", "iso4.mp4", "program.mp4", "session.drp"]);
    const layout = await resolveLayout(directory);

    expect(layout.naming).toBe("plain");
    expect(layout.base).toBeNull();
    expect(basename(layout.isos[4] ?? "")).toBe("iso4.mp4");
    expect(layout.audio[4]).toBeNull();
    expect(basename(layout.program ?? "")).toBe("program.mp4");
  });
});

describe("finding the session inside a directory that arrived who knows how", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "session-find-"));
  });

  afterEach(async () => {
    if (root !== "") await rm(root, { recursive: true, force: true });
  });

  const drop = async (where: string, names: readonly string[]): Promise<void> => {
    await mkdir(where, { recursive: true });
    for (const name of names) await writeFile(join(where, name), "x", "utf8");
  };

  it("takes the directory itself when the ATEM files are right there", async () => {
    await drop(root, ATEM_TAKE);
    expect(await findSessionDirectories(root)).toEqual([root]);
  });

  it("takes the directory itself with the synthetic naming too", async () => {
    await drop(root, ["iso1.mp4", "iso2.mp4", "iso3.mp4", "iso4.mp4"]);
    expect(await findSessionDirectories(root)).toEqual([root]);
  });

  it("goes one level down when the recording came wrapped in a folder", async () => {
    const inside = join(root, "atem mini pro iso 4");
    await drop(inside, ATEM_TAKE);
    await writeFile(join(root, "readme.txt"), "x", "utf8");

    expect(await findSessionDirectories(root)).toEqual([inside]);
  });

  it("reports every recording when more than one came wrapped together", async () => {
    const first = join(root, "take-01");
    const second = join(root, "take-02");
    await drop(first, ATEM_TAKE);
    await drop(second, ["iso1.mp4"]);

    expect(await findSessionDirectories(root)).toEqual([first, second]);
  });

  it("finds nothing in a directory that holds no recording", async () => {
    await drop(root, ["notes.txt"]);
    await drop(join(root, "photos"), ["one.jpg"]);

    expect(await findSessionDirectories(root)).toEqual([]);
  });
});
