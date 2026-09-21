import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FolderDelivery, RECEIPT_FILE } from "./delivery.js";
import { confirmDelivery, rawFiles } from "./raw.js";

const RAW = ["iso1.mp4", "iso2.mp4", "iso3.mp4", "iso4.mp4", "program.mp4", "session.drp", "program.wav"];
const KEEP = ["edl.json", "edit.fcpxml", "master-branded.mp4", "clip-1.mp4", "transcript.json"];

async function present(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("confirming a delivery drops the raw footage", () => {
  let root: string;
  let directory: string;
  let deliveryRoot: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "doslineas-raw-"));
    directory = join(root, "ep12");
    deliveryRoot = join(root, "delivered");
    await mkdir(directory, { recursive: true });

    for (const name of [...RAW, ...KEEP, "master-audio.flac", "filter.txt"]) {
      await writeFile(join(directory, name), `${name} bytes`, "utf8");
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function deliver(): Promise<void> {
    const delivery = new FolderDelivery({ root: deliveryRoot });
    const { collectDeliverables } = await import("./delivery.js");
    await delivery.deliver(
      { studio: "doslineas", session: "ep12", directory },
      await collectDeliverables(directory)
    );
  }

  it("lists the raw and the intermediates, and nothing else", async () => {
    const names = await rawFiles(directory);

    expect(names).toEqual([...RAW, "filter.txt", "master-audio.flac"].sort());
    for (const kept of KEEP) expect(names).not.toContain(kept);
  });

  it("removes the raw once the delivered files check out", async () => {
    await deliver();
    const { removed, receipt } = await confirmDelivery(directory);

    expect(receipt.confirmedAt).not.toBeNull();
    expect(removed.bytes).toBeGreaterThan(0);
    for (const name of RAW) expect(await present(join(directory, name))).toBe(false);
    for (const name of KEEP) expect(await present(join(directory, name))).toBe(true);
  });

  it("writes the confirmation back into the receipt", async () => {
    await deliver();
    await confirmDelivery(directory);

    const receipt = JSON.parse(await readFile(join(directory, RECEIPT_FILE), "utf8")) as { confirmedAt: string | null };
    expect(receipt.confirmedAt).not.toBeNull();
  });

  it("refuses when there is no receipt at all", async () => {
    await expect(confirmDelivery(directory)).rejects.toThrow(/no usable delivery receipt/);
    for (const name of RAW) expect(await present(join(directory, name))).toBe(true);
  });

  it("refuses when a delivered file is not at the other end any more", async () => {
    await deliver();
    await rm(join(deliveryRoot, "doslineas", "ep12", "master-branded.mp4"));

    await expect(confirmDelivery(directory)).rejects.toThrow(/not there any more/);
    for (const name of RAW) expect(await present(join(directory, name))).toBe(true);
  });

  it("refuses when a delivered file arrived truncated", async () => {
    await deliver();
    await writeFile(join(deliveryRoot, "doslineas", "ep12", "master-branded.mp4"), "", "utf8");

    await expect(confirmDelivery(directory)).rejects.toThrow(/bytes instead of/);
    for (const name of RAW) expect(await present(join(directory, name))).toBe(true);
  });

  it("refuses when the receipt carries no master", async () => {
    await mkdir(join(deliveryRoot, "doslineas", "ep12"), { recursive: true });
    const target = join(deliveryRoot, "doslineas", "ep12", "edl.json");
    await writeFile(target, "{}", "utf8");
    await writeFile(
      join(directory, RECEIPT_FILE),
      JSON.stringify({
        version: 1,
        studio: "doslineas",
        session: "ep12",
        target: join(deliveryRoot, "doslineas", "ep12"),
        deliveredAt: new Date().toISOString(),
        items: [{ kind: "edit", source: join(directory, "edl.json"), target, bytes: 2 }],
        confirmedAt: null
      }),
      "utf8"
    );

    await expect(confirmDelivery(directory)).rejects.toThrow(/no master/);
    for (const name of RAW) expect(await present(join(directory, name))).toBe(true);
  });

  it("a dry run says what would go and touches nothing", async () => {
    await deliver();
    const { removed } = await confirmDelivery(directory, { dryRun: true });

    expect(removed.files.length).toBeGreaterThan(0);
    for (const name of RAW) expect(await present(join(directory, name))).toBe(true);

    const receipt = JSON.parse(await readFile(join(directory, RECEIPT_FILE), "utf8")) as { confirmedAt: string | null };
    expect(receipt.confirmedAt).toBeNull();
  });
});
