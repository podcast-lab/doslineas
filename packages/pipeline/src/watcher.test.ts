import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryAlertStore } from "./alerts.js";
import { SqliteJobQueue } from "./sqlite-queue.js";
import { FolderWatcher, scanRoot } from "./watcher.js";

const HOUR = 3_600_000;

async function fakeSession(root: string, name: string, files: readonly string[], ageMs: number): Promise<string> {
  const directory = join(root, name);
  await mkdir(directory, { recursive: true });
  const stamp = new Date(Date.now() - ageMs);

  for (const file of files) {
    const path = join(directory, file);
    await writeFile(path, `${file} bytes`, "utf8");
    await utimes(path, stamp, stamp);
  }
  return directory;
}

const FULL = ["iso1.mp4", "iso2.mp4", "iso3.mp4", "iso4.mp4", "program.mp4", "session.drp"];

describe("watching the folder where the sessions land", () => {
  let root: string;
  let queue: SqliteJobQueue;
  let alerts: MemoryAlertStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "doslineas-watch-"));
    queue = new SqliteJobQueue(":memory:");
    alerts = new MemoryAlertStore();
  });

  afterEach(async () => {
    queue.close();
    await rm(root, { recursive: true, force: true });
  });

  function watcher(quietSeconds = 120): FolderWatcher {
    return new FolderWatcher(queue, alerts, { root, studio: "doslineas", quietSeconds, maxAttempts: 3 });
  }

  it("leaves a session alone while it is still being written", async () => {
    await fakeSession(root, "ep12", FULL, 5_000);
    const round = await watcher().round();

    expect(round.settling.map((candidate) => candidate.session)).toEqual(["ep12"]);
    expect(round.accepted).toEqual([]);
    expect(queue.jobs()).toEqual([]);
  });

  it("ignores a directory that holds no ISOs at all", async () => {
    await fakeSession(root, "notes", ["readme.txt"], HOUR);
    const round = await watcher().round();

    expect(round.accepted).toEqual([]);
    expect(round.incomplete).toEqual([]);
    expect(alerts.list()).toEqual([]);
  });

  it("warns instead of starting when a quiet session is incomplete", async () => {
    await fakeSession(root, "ep12", ["iso1.mp4", "iso2.mp4"], HOUR);
    const round = await watcher().round();

    expect(round.incomplete.map((candidate) => candidate.session)).toEqual(["ep12"]);
    expect(queue.jobs()).toEqual([]);

    const raised = alerts.list({ pending: true });
    expect(raised).toHaveLength(1);
    expect(raised[0]?.kind).toBe("incomplete-session");
    expect(raised[0]?.message).toContain("iso3.mp4");
  });

  it("does not repeat the same warning on every round", async () => {
    await fakeSession(root, "ep12", ["iso1.mp4"], HOUR);
    const guard = watcher();
    await guard.round();
    await guard.round();

    expect(alerts.list()).toHaveLength(1);
  });

  it("does not look again at a session it already queued", async () => {
    const directory = await fakeSession(root, "ep12", FULL, HOUR);
    queue.enqueue([
      { studio: "doslineas", session: "ep12", directory, step: "edit", position: 0, maxAttempts: 3 }
    ]);

    const round = await watcher().round();
    expect(round.accepted).toEqual([]);
    expect(round.incomplete).toEqual([]);
  });

  it("a corrupt ISO becomes a warning, not a crash", async () => {
    await fakeSession(root, "ep12", FULL, HOUR);
    const candidates = await scanRoot({ root, quietSeconds: 120 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.ready).toBe(false);
    expect(candidates[0]?.problems.some((problem) => problem.includes("cannot be read"))).toBe(true);
  });
});

describe("the shapes a recording can arrive in", () => {
  let root: string;
  let queue: SqliteJobQueue;
  let alerts: MemoryAlertStore;

  const ATEM = [
    "atem mini pro iso 02.mp4",
    "atem mini pro iso CAM 1 02.mp4",
    "atem mini pro iso CAM 2 02.mp4",
    "atem mini pro iso CAM 3 02.mp4",
    "atem mini pro iso CAM 4 02.mp4",
    "atem mini pro iso.drp"
  ];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "doslineas-shapes-"));
    queue = new SqliteJobQueue(":memory:");
    alerts = new MemoryAlertStore();
  });

  afterEach(async () => {
    queue.close();
    await rm(root, { recursive: true, force: true });
  });

  it("sees a session named the way the ATEM names it", async () => {
    await fakeSession(root, "ep12", ATEM, HOUR);
    const candidates = await scanRoot({ root, quietSeconds: 120 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.session).toBe("ep12");
    expect(candidates[0]?.directory).toBe(join(root, "ep12"));
  });

  it("follows the recording one folder down and keeps the outer name", async () => {
    await fakeSession(root, join("ep12", "atem mini pro iso 4"), ATEM, HOUR);
    const candidates = await scanRoot({ root, quietSeconds: 120 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.session).toBe("ep12");
    expect(candidates[0]?.directory).toBe(join(root, "ep12", "atem mini pro iso 4"));
  });

  it("refuses to guess when two recordings arrived in the same folder", async () => {
    await fakeSession(root, join("ep12", "take-01"), ATEM, HOUR);
    await fakeSession(root, join("ep12", "take-02"), FULL, HOUR);

    const round = await new FolderWatcher(queue, alerts, {
      root,
      studio: "doslineas",
      quietSeconds: 120,
      maxAttempts: 3
    }).round();

    expect(round.accepted).toEqual([]);
    expect(round.incomplete.map((candidate) => candidate.session)).toEqual(["ep12"]);
    expect(alerts.list()[0]?.message).toContain("2 recordings");
  });
});
