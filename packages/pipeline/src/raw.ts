import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { DeliveryReceipt } from "./delivery.js";
import { DELIVERABLE_KINDS, RECEIPT_FILE } from "./delivery.js";

const DeliveredItemSchema = z.object({
  kind: z.enum(DELIVERABLE_KINDS),
  source: z.string().min(1),
  target: z.string().min(1),
  bytes: z.number().nonnegative()
});

export const DeliveryReceiptSchema = z.object({
  version: z.literal(1),
  studio: z.string().min(1),
  session: z.string().min(1),
  target: z.string().min(1),
  deliveredAt: z.string().min(1),
  items: z.array(DeliveredItemSchema).min(1),
  confirmedAt: z.string().min(1).nullable()
});

export function parseDeliveryReceipt(raw: unknown): DeliveryReceipt {
  return DeliveryReceiptSchema.parse(raw);
}

export async function readReceipt(directory: string): Promise<DeliveryReceipt> {
  const path = join(directory, RECEIPT_FILE);
  try {
    return parseDeliveryReceipt(JSON.parse(await readFile(path, "utf8")));
  } catch (failure) {
    throw new Error(`no usable delivery receipt at ${path}: ${(failure as Error).message}`);
  }
}

export const RAW_FILES: readonly string[] = [
  "iso1.mp4",
  "iso2.mp4",
  "iso3.mp4",
  "iso4.mp4",
  "program.mp4",
  "session.drp"
];

export const INTERMEDIATE_FILES: readonly string[] = [
  "master-audio.flac",
  "commands.txt",
  "filter.txt",
  "brand-filter.txt",
  "explainer-commands.txt",
  "explainer-filter.txt"
];

export interface RemovedRaw {
  readonly files: readonly string[];
  readonly bytes: number;
}

export async function rawFiles(directory: string): Promise<readonly string[]> {
  const present = new Set(await readdir(directory));
  const wavs = [...present].filter((name) => name.toLowerCase().endsWith(".wav"));
  return [...RAW_FILES, ...wavs, ...INTERMEDIATE_FILES].filter((name) => present.has(name)).sort();
}

export async function verifyDelivered(receipt: DeliveryReceipt): Promise<readonly string[]> {
  const problems: string[] = [];

  if (!receipt.items.some((item) => item.kind === "master")) {
    problems.push("the receipt carries no master, so the delivery is not complete enough to drop the raw footage");
  }

  for (const item of receipt.items) {
    try {
      const info = await stat(item.target);
      if (!info.isFile()) problems.push(`${item.target} is not a file`);
      else if (info.size !== item.bytes) problems.push(`${item.target} has ${info.size} bytes instead of ${item.bytes}`);
    } catch {
      problems.push(`${item.target} is not there any more`);
    }
  }

  return problems;
}

export interface ConfirmDeliveryResult {
  readonly receipt: DeliveryReceipt;
  readonly removed: RemovedRaw;
}

export interface ConfirmDeliveryOptions {
  readonly dryRun?: boolean;
  readonly now?: () => Date;
}

export async function confirmDelivery(
  directory: string,
  options: ConfirmDeliveryOptions = {}
): Promise<ConfirmDeliveryResult> {
  const receipt = await readReceipt(directory);
  const problems = await verifyDelivered(receipt);
  if (problems.length > 0) {
    throw new Error(
      `the raw footage of ${receipt.session} stays where it is; the delivery does not check out:\n${problems
        .map((problem) => `  - ${problem}`)
        .join("\n")}`
    );
  }

  const names = await rawFiles(directory);
  let bytes = 0;
  for (const name of names) {
    const path = join(directory, name);
    bytes += (await stat(path)).size;
    if (options.dryRun !== true) await rm(path, { force: true });
  }

  const now = options.now ?? ((): Date => new Date());
  const confirmed: DeliveryReceipt = { ...receipt, confirmedAt: now().toISOString() };
  if (options.dryRun !== true) {
    await writeFile(join(directory, RECEIPT_FILE), `${JSON.stringify(confirmed, null, 2)}\n`, "utf8");
  }

  return { receipt: confirmed, removed: { files: names, bytes } };
}
