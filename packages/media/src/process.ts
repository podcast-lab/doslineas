import { spawn } from "node:child_process";

export interface ProcessResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessOptions {
  readonly cwd?: string;
  readonly onStderr?: (chunk: string) => void;
}

export function run(command: string, args: readonly string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], options.cwd === undefined ? {} : { cwd: options.cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });
    child.on("error", (failure) => {
      reject(new Error(`could not run ${command}: ${failure.message}`));
    });
    child.on("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function runOrFail(
  command: string,
  args: readonly string[],
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    const tail = result.stderr.trim().split("\n").slice(-12).join("\n");
    throw new Error(`${command} exited with code ${result.code}\n${tail}`);
  }
  return result;
}

export function runCapturingBytes(command: string, args: readonly string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args]);
    const chunks: Buffer[] = [];
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (failure) => {
      reject(new Error(`could not run ${command}: ${failure.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
        return;
      }
      const tail = stderr.trim().split("\n").slice(-8).join("\n");
      reject(new Error(`${command} exited with code ${code}\n${tail}`));
    });
  });
}
