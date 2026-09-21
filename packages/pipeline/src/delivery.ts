import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export const DELIVERABLE_KINDS = ["master", "explainer", "clip", "captions", "edit"] as const;
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

export interface Deliverable {
  readonly kind: DeliverableKind;
  readonly path: string;
  readonly bytes: number;
}

export interface DeliveredItem {
  readonly kind: DeliverableKind;
  readonly source: string;
  readonly target: string;
  readonly bytes: number;
}

export interface DeliveryReceipt {
  readonly version: 1;
  readonly studio: string;
  readonly session: string;
  readonly target: string;
  readonly deliveredAt: string;
  readonly items: readonly DeliveredItem[];
  readonly confirmedAt: string | null;
}

export interface SessionRef {
  readonly studio: string;
  readonly session: string;
  readonly directory: string;
}

export interface Delivery {
  readonly name: string;
  deliver(session: SessionRef, items: readonly Deliverable[]): Promise<DeliveryReceipt>;
}

export const RECEIPT_FILE = "delivery-receipt.json";

const CLIP_VIDEO = /^clip-\d+\.mp4$/;
const CLIP_SUBTITLE = /^clip-\d+\.(srt|vtt)$/;
const TRANSCRIPT_SUBTITLE = /^transcript\.(srt|vtt|txt)$/;

function kindOf(name: string): DeliverableKind | null {
  if (name === "master-branded.mp4" || name === "master.mp4") return "master";
  if (name === "explainer.mp4") return "explainer";
  if (CLIP_VIDEO.test(name)) return "clip";
  if (CLIP_SUBTITLE.test(name) || TRANSCRIPT_SUBTITLE.test(name)) return "captions";
  if (name === "edl.json" || name === "edit.fcpxml" || name === "shorts-plan.json") return "edit";
  return null;
}

export async function collectDeliverables(directory: string): Promise<readonly Deliverable[]> {
  const names = await readdir(directory);
  const branded = names.includes("master-branded.mp4");
  const found: Deliverable[] = [];

  for (const name of names.sort()) {
    if (branded && name === "master.mp4") continue;
    const kind = kindOf(name);
    if (kind === null) continue;

    const path = join(directory, name);
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) continue;
    found.push({ kind, path, bytes: info.size });
  }

  return found;
}

export interface FolderDeliveryOptions {
  readonly root: string;
  readonly now?: () => Date;
}

export class FolderDelivery implements Delivery {
  readonly name = "folder";
  private readonly root: string;
  private readonly now: () => Date;

  constructor(options: FolderDeliveryOptions) {
    this.root = options.root;
    this.now = options.now ?? ((): Date => new Date());
  }

  async deliver(session: SessionRef, items: readonly Deliverable[]): Promise<DeliveryReceipt> {
    if (items.length === 0) throw new Error(`there is nothing to deliver in ${session.directory}`);

    const target = join(this.root, session.studio, session.session);
    await mkdir(target, { recursive: true });

    const delivered: DeliveredItem[] = [];
    for (const item of items) {
      const destination = join(target, basename(item.path));
      await copyFile(item.path, destination);
      const written = await stat(destination);
      if (written.size !== item.bytes) {
        throw new Error(`${destination} was copied with ${written.size} bytes instead of ${item.bytes}`);
      }
      delivered.push({ kind: item.kind, source: item.path, target: destination, bytes: item.bytes });
    }

    const receipt: DeliveryReceipt = {
      version: 1,
      studio: session.studio,
      session: session.session,
      target,
      deliveredAt: this.now().toISOString(),
      items: delivered,
      confirmedAt: null
    };

    await writeFile(join(session.directory, RECEIPT_FILE), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    return receipt;
  }
}
