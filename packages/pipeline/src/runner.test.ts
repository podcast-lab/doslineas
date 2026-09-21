import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job, StepName } from "./jobs.js";
import { CliStepRunner } from "./runner.js";

function job(step: StepName, directory: string): Job {
  return {
    id: 1,
    studio: "doslineas",
    session: "ep12",
    directory,
    step,
    position: 0,
    state: "leased",
    attempts: 1,
    maxAttempts: 3,
    owner: "worker-test",
    leaseExpiresAt: null,
    note: null,
    createdAt: 0,
    updatedAt: 0,
    startedAt: null,
    finishedAt: null
  };
}

describe("running a step through the command line", () => {
  let root = "";
  let entry = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "doslineas-runner-"));
    entry = join(root, "fake-cli.mjs");
    await writeFile(
      entry,
      [
        "const [command, directory, ...flags] = process.argv.slice(2);",
        "console.log(`command ${command} on ${directory} with ${flags.join(' ')}`);",
        "if (command === 'clips') { console.error('remotion could not start'); process.exit(3); }"
      ].join("\n"),
      "utf8"
    );
  });

  afterAll(async () => {
    if (root !== "") await rm(root, { recursive: true, force: true });
  });

  function runner(): CliStepRunner {
    return new CliStepRunner({ repoRoot: process.cwd(), entry });
  }

  it("builds the same call the studio types by hand", () => {
    const args = runner().argumentsFor(job("edit", "/sessions/ep12"));
    expect(args.slice(-3)).toEqual(["edit", "/sessions/ep12", "--render"]);
  });

  it("passes the extra flags of a step through", () => {
    const withRules = new CliStepRunner({ repoRoot: process.cwd(), entry, flags: { clips: ["--rules"] } });
    expect(withRules.argumentsFor(job("clips", "/sessions/ep12"))).toContain("--rules");
  });

  it("refuses to shell out for a step that has no command", () => {
    expect(() => runner().argumentsFor(job("deliver", "/sessions/ep12"))).toThrow(/does not run through the command line/);
  });

  it("reports the lines the step prints", async () => {
    const lines: string[] = [];
    await runner().run(job("edit", "/sessions/ep12"), (line) => lines.push(line));

    expect(lines.some((line) => line.includes("command edit on /sessions/ep12 with --render"))).toBe(true);
  });

  it("turns a non-zero exit into a failure that carries the output", async () => {
    await expect(runner().run(job("clips", "/sessions/ep12"), () => {})).rejects.toThrow(
      /clips exited with code 3[\s\S]*remotion could not start/
    );
  });
});
