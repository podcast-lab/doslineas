import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SessionScript } from "./session-generator.js";
import { BASE_SCRIPT, generateSyntheticSession } from "./session-generator.js";
import { inspectSession } from "./session-files.js";

const script: SessionScript = {
  ...BASE_SCRIPT,
  session: "inspection",
  durationSeconds: 6,
  width: 320,
  height: 180,
  utterances: [{ input: 2, start: 1, dur: 3 }]
};

describe("inspecting a session directory", () => {
  let root = "";
  let complete = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "session-files-"));
    complete = join(root, "complete");
    await generateSyntheticSession(script, complete);
  }, 180_000);

  afterAll(async () => {
    if (root !== "") await rm(root, { recursive: true, force: true });
  });

  it("finds nothing wrong with a session the ATEM finished writing", async () => {
    const inspection = await inspectSession(complete);
    expect(inspection.problems).toEqual([]);
    expect(inspection.durationSeconds).toBeCloseTo(script.durationSeconds, 0);
    expect(inspection.fps).toBeCloseTo(script.fps, 1);
    expect(inspection.width).toBe(script.width);
    expect(inspection.height).toBe(script.height);
    expect(inspection.spreadSeconds).toBeLessThanOrEqual(1 / script.fps);
    expect(inspection.program).not.toBeNull();
    expect(inspection.drp).not.toBeNull();
  }, 60_000);

  it("says which ISO is missing", async () => {
    const broken = join(root, "missing-iso");
    await generateSyntheticSession(script, broken);
    await rm(join(broken, "iso3.mp4"));

    const inspection = await inspectSession(broken);
    expect(inspection.problems.some((problem) => problem.includes("iso3.mp4 is missing"))).toBe(true);
  }, 180_000);

  it("warns when the project file is not there yet", async () => {
    const writing = join(root, "still-writing");
    await generateSyntheticSession(script, writing);
    await rm(join(writing, "session.drp"));

    const inspection = await inspectSession(writing);
    expect(inspection.problems.some((problem) => problem.includes(".drp is missing"))).toBe(true);
  }, 180_000);

  it("catches ISOs that do not line up", async () => {
    const drifted = join(root, "drifted");
    await generateSyntheticSession(script, drifted);
    await generateSyntheticSession({ ...script, durationSeconds: 4 }, join(root, "shorter"));
    await writeFile(join(drifted, "iso3.mp4"), await readAll(join(root, "shorter", "iso3.mp4")));

    const inspection = await inspectSession(drifted);
    expect(inspection.problems.some((problem) => problem.includes("apart"))).toBe(true);
    expect(inspection.spreadSeconds).toBeGreaterThan(1);
  }, 240_000);
});

async function readAll(path: string): Promise<Buffer> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path);
}
