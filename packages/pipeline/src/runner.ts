import { spawn } from "node:child_process";
import { join } from "node:path";
import type { Job, StepName } from "./jobs.js";
import { stepDefinition } from "./steps.js";

export type StepLogger = (line: string) => void;

export interface StepRunner {
  run(job: Job, log: StepLogger, signal?: AbortSignal): Promise<void>;
}

export interface CliStepRunnerOptions {
  readonly repoRoot: string;
  readonly entry?: string;
  readonly executable?: string;
  readonly flags?: Partial<Record<StepName, readonly string[]>>;
  readonly commands?: Partial<Record<StepName, string>>;
  readonly env?: NodeJS.ProcessEnv;
}

function emitLines(buffer: string, chunk: string, log: StepLogger): string {
  const combined = buffer + chunk;
  const lines = combined.split(/\r?\n/);
  const rest = lines.pop() ?? "";
  for (const line of lines) if (line.trim() !== "") log(line);
  return rest;
}

export class CliStepRunner implements StepRunner {
  private readonly repoRoot: string;
  private readonly entry: string;
  private readonly executable: string;
  private readonly flags: Partial<Record<StepName, readonly string[]>>;
  private readonly commands: Partial<Record<StepName, string>>;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: CliStepRunnerOptions) {
    this.repoRoot = options.repoRoot;
    this.entry = options.entry ?? join(options.repoRoot, "apps", "cli", "src", "index.ts");
    this.executable = options.executable ?? process.execPath;
    this.flags = options.flags ?? {};
    this.commands = options.commands ?? {};
    this.env = options.env ?? process.env;
  }

  argumentsFor(job: Job): readonly string[] {
    const step = stepDefinition(job.step);
    const command = this.commands[job.step] ?? step.command;
    if (command === null) throw new Error(`step ${job.step} does not run through the command line`);
    return [
      "--import",
      "tsx",
      this.entry,
      command,
      job.directory,
      ...step.flags,
      ...(this.flags[job.step] ?? [])
    ];
  }

  run(job: Job, log: StepLogger, signal?: AbortSignal): Promise<void> {
    const args = this.argumentsFor(job);
    log(`${this.executable} ${args.slice(2).join(" ")}`);

    return new Promise((resolve, reject) => {
      const child = spawn(this.executable, [...args], {
        cwd: this.repoRoot,
        env: this.env,
        ...(signal === undefined ? {} : { signal })
      });

      let out = "";
      let err = "";
      const tail: string[] = [];
      const keep = (line: string): void => {
        tail.push(line);
        if (tail.length > 20) tail.shift();
        log(line);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        out = emitLines(out, chunk.toString(), keep);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        err = emitLines(err, chunk.toString(), keep);
      });
      child.on("error", (failure) => {
        reject(new Error(`could not start ${job.step}: ${failure.message}`));
      });
      child.on("close", (code) => {
        if (out.trim() !== "") keep(out);
        if (err.trim() !== "") keep(err);
        if (code === 0) resolve();
        else reject(new Error(`${job.step} exited with code ${code ?? -1}\n${tail.join("\n")}`));
      });
    });
  }
}
