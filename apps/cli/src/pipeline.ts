import type { Job, SessionStatus, StepName } from "@doslineas/pipeline";
import { STEP_NAMES, SqliteAlertStore, SqliteJobQueue, confirmDelivery, readConfig } from "@doslineas/pipeline";
import { option } from "./files.js";

function ago(at: number | null): string {
  if (at === null) return "";
  const seconds = (Date.now() - at) / 1000;
  if (seconds < 90) return `${seconds.toFixed(0)} s ago`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(0)} min ago`;
  return `${(seconds / 3600).toFixed(1)} h ago`;
}

function stepLine(job: Job): string {
  const attempts = job.attempts > 1 ? ` (${job.attempts} attempts)` : "";
  const note = job.note === null ? "" : `\n      ${job.note.split("\n")[0] ?? ""}`;
  return `    ${job.step.padEnd(11)} ${job.state.padEnd(8)}${attempts}${note}`;
}

function printSession(session: SessionStatus): void {
  console.log(`  ${session.session}  ${session.state}  ${ago(session.finishedAt ?? session.startedAt)}`);
  for (const job of session.steps) console.log(stepLine(job));
}

export async function statusCommand(args: readonly string[]): Promise<void> {
  const config = readConfig();
  const queue = new SqliteJobQueue(config.database);
  const alerts = new SqliteAlertStore(config.database);

  try {
    const wanted = option(args, "session");
    const sessions =
      wanted === undefined
        ? queue.sessions(config.studio)
        : [queue.session(config.studio, wanted)].filter((found): found is SessionStatus => found !== null);

    console.log(`studio ${config.studio} · watching ${config.sessionsRoot} · delivering to ${config.deliveryRoot}`);
    console.log(`sessions (${sessions.length})`);
    if (sessions.length === 0) console.log("  none yet");
    for (const session of sessions) printSession(session);

    const pending = alerts.list({ pending: true });
    console.log(`alerts (${pending.length})`);
    for (const alert of pending) console.log(`  [${alert.id}] ${alert.kind}: ${alert.message}`);
  } finally {
    queue.close();
    alerts.close();
  }

  await Promise.resolve();
}

export async function confirmCommand(args: readonly string[]): Promise<void> {
  const name = args[0];
  if (name === undefined || name.startsWith("--")) throw new Error("missing session name");

  const config = readConfig();
  const queue = new SqliteJobQueue(config.database);
  const alerts = new SqliteAlertStore(config.database);

  try {
    const session = queue.session(config.studio, name);
    if (session === null) throw new Error(`no session called ${name} in the queue`);

    const dryRun = args.includes("--dry-run");
    const { receipt, removed } = await confirmDelivery(session.directory, { dryRun });

    if (!dryRun) {
      alerts.raise({
        studio: session.studio,
        session: session.session,
        kind: "raw-removed",
        message: `the raw footage of ${session.session} is gone: ${removed.files.length} files, ${(removed.bytes / 1e6).toFixed(0)} MB`
      });
    }

    console.log(`${name} was delivered to ${receipt.target}`);
    console.log(`  ${receipt.items.length} files delivered and checked`);
    console.log(`  ${removed.files.length} raw files, ${(removed.bytes / 1e9).toFixed(2)} GB`);
    for (const file of removed.files) console.log(`    ${dryRun ? "would remove" : "removed"} ${file}`);
    if (dryRun) console.log("  nothing was touched: this was a dry run");
  } finally {
    queue.close();
    alerts.close();
  }
}

export async function retryCommand(args: readonly string[]): Promise<void> {
  const name = args[0];
  if (name === undefined || name.startsWith("--")) throw new Error("missing session name");

  const step = option(args, "step");
  if (step !== undefined && !STEP_NAMES.includes(step as StepName)) {
    throw new Error(`--step must be one of ${STEP_NAMES.join(", ")}`);
  }

  const config = readConfig();
  const queue = new SqliteJobQueue(config.database);

  try {
    const restarted =
      step === undefined
        ? queue.retry(config.studio, name)
        : queue.retry(config.studio, name, step as StepName);
    console.log(`${restarted} step${restarted === 1 ? "" : "s"} of ${name} put back in the queue`);
  } finally {
    queue.close();
  }

  await Promise.resolve();
}
