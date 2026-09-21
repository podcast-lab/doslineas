import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { BrandKit, Episode } from "./brand.js";
import { brandAssetNames, parseBrandKit, placeholderEpisode, planBranding } from "./brand.js";
import type { Edl, Segment } from "./edl.js";
import type { Input } from "./profile.js";

const KIT: BrandKit = {
  name: "test-kit",
  colors: {
    primary: "#4f46e5",
    accent: "#22d3ee",
    background: "#0b0f19",
    text: "#f8fafc",
    muted: "#94a3b8"
  },
  fonts: {
    heading: { family: "Inter", file: null, weight: 700 },
    body: { family: "Inter", file: null, weight: 400 }
  },
  logo: null,
  intro: { seconds: 5, headline: "", tagline: "" },
  outro: { seconds: 6, headline: "Gracias", tagline: "Hasta la próxima" },
  lowerThird: { seconds: 4, minSeconds: 2, delaySeconds: 0.8, gapSeconds: 1.5, corner: "bottom-left", marginPercent: 6 }
};

const EPISODE: Episode = {
  title: "Episodio 12",
  subtitle: "Cómo montar un podcast",
  participants: [
    { input: 2, name: "Ana Ruiz", title: "Presentadora" },
    { input: 3, name: "Luis Vega", title: "Invitado" }
  ]
};

const FRAME = { width: 1920, height: 1080 };

function edlOf(segments: readonly Segment[]): Edl {
  return {
    version: 1,
    session: "2026-08-20-ep12",
    fps: 25,
    profile: "podcast-v1",
    sources: ([1, 2, 3] as Input[]).map((input) => ({
      input,
      role: input === 1 ? "wide" : input === 2 ? "speaker1" : "speaker2",
      video: `iso${input}.mp4`,
      audio: input === 1 ? "program.mp4" : null,
      durationSeconds: 600
    })),
    segments: [...segments],
    discards: [],
    audio: { source: "program", gains: {} }
  };
}

const CONVERSATION: Segment[] = [
  { tOut: 0, dur: 6, input: 2, tIn: 0, reason: "initial" },
  { tOut: 6, dur: 3, input: 1, tIn: 6, reason: "refresh" },
  { tOut: 9, dur: 7, input: 3, tIn: 9, reason: "turn" },
  { tOut: 16, dur: 5, input: 2, tIn: 16, reason: "turn" }
];

describe("brand kit", () => {
  it("validates the studio kit that ships with the repository", async () => {
    const raw = JSON.parse(await readFile(resolve("config/brand-kit.json"), "utf8"));
    const kit = parseBrandKit(raw);
    expect(kit.name).toBe("studio-standard-v1");
    expect(kit.fonts.heading.family).toBe("Montserrat");
  });

  it("rejects a colour that is not #rrggbb", () => {
    expect(() => parseBrandKit({ ...KIT, colors: { ...KIT.colors, accent: "cyan" } })).toThrow();
  });

  it("rejects a lower third that asks for more time than it lasts", () => {
    expect(() => parseBrandKit({ ...KIT, lowerThird: { ...KIT.lowerThird, minSeconds: 9 } })).toThrow();
  });
});

describe("branding plan", () => {
  it("gives every participant one lower third inside a shot of their own input", () => {
    const plan = planBranding(edlOf(CONVERSATION), KIT, EPISODE, FRAME);

    expect(plan.lowerThirds).toEqual([
      { input: 2, name: "Ana Ruiz", title: "Presentadora", atSeconds: 0.8, durationSeconds: 4, segment: 0 },
      { input: 3, name: "Luis Vega", title: "Invitado", atSeconds: 9.8, durationSeconds: 4, segment: 2 }
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("never lets a lower third outlive the shot that carries it", () => {
    const plan = planBranding(
      edlOf([
        { tOut: 0, dur: 3, input: 2, tIn: 0, reason: "initial" },
        { tOut: 3, dur: 12, input: 3, tIn: 3, reason: "turn" }
      ]),
      KIT,
      EPISODE,
      FRAME
    );

    const [first] = plan.lowerThirds;
    expect(first?.durationSeconds).toBe(2.2);
    expect((first?.atSeconds ?? 0) + (first?.durationSeconds ?? 0)).toBeLessThanOrEqual(3);
  });

  it("keeps two lower thirds a gap apart", () => {
    const plan = planBranding(
      edlOf([
        { tOut: 0, dur: 6, input: 2, tIn: 0, reason: "initial" },
        { tOut: 6, dur: 6, input: 3, tIn: 6, reason: "turn" }
      ]),
      KIT,
      EPISODE,
      FRAME
    );

    const [first, second] = plan.lowerThirds;
    expect(first?.atSeconds).toBe(0.8);
    expect(second?.atSeconds).toBe(6.8);
    const gap = (second?.atSeconds ?? 0) - ((first?.atSeconds ?? 0) + (first?.durationSeconds ?? 0));
    expect(gap).toBeGreaterThanOrEqual(KIT.lowerThird.gapSeconds);
  });

  it("says so instead of inventing a lower third for someone who never appears", () => {
    const plan = planBranding(
      edlOf([{ tOut: 0, dur: 20, input: 2, tIn: 0, reason: "initial" }]),
      KIT,
      EPISODE,
      FRAME
    );

    expect(plan.lowerThirds).toHaveLength(1);
    expect(plan.warnings).toEqual(["Luis Vega: input 3 never appears in the edit, no lower third"]);
  });

  it("says so when no shot is long enough to hold one", () => {
    const plan = planBranding(
      edlOf([
        { tOut: 0, dur: 1.5, input: 2, tIn: 0, reason: "initial" },
        { tOut: 1.5, dur: 8, input: 3, tIn: 1.5, reason: "turn" }
      ]),
      KIT,
      EPISODE,
      FRAME
    );

    expect(plan.lowerThirds.map((cue) => cue.input)).toEqual([3]);
    expect(plan.warnings[0]).toContain("no shot on input 2");
  });

  it("adds the cards to the running time and drops the ones set to zero seconds", () => {
    const edl = edlOf(CONVERSATION);
    const full = planBranding(edl, KIT, EPISODE, FRAME);
    expect(full.masterSeconds).toBe(21);
    expect(full.totalSeconds).toBe(32);
    expect(full.intro?.headline).toBe("Episodio 12");
    expect(full.intro?.tagline).toBe("Cómo montar un podcast");
    expect(full.outro?.headline).toBe("Gracias");

    const bare = planBranding(edl, { ...KIT, intro: { ...KIT.intro, seconds: 0 } }, EPISODE, FRAME);
    expect(bare.intro).toBeNull();
    expect(bare.totalSeconds).toBe(27);
    expect(brandAssetNames(bare)).toEqual({ intro: null, outro: "outro.mp4", lowerThirds: ["lower-third-1.webm", "lower-third-2.webm"] });
  });

  it("carries the frame and the profile of the edit into the plan", () => {
    const plan = planBranding(edlOf(CONVERSATION), KIT, EPISODE, FRAME);
    expect(plan).toMatchObject({ session: "2026-08-20-ep12", kit: "test-kit", fps: 25, width: 1920, height: 1080 });
  });
});

describe("placeholder episode", () => {
  it("names the people after their role so the templates can be shown without client data", () => {
    const episode = placeholderEpisode(edlOf(CONVERSATION));
    expect(episode.title).toBe("2026-08-20-ep12");
    expect(episode.participants).toEqual([
      { input: 2, name: "Speaker one", title: "" },
      { input: 3, name: "Speaker two", title: "" }
    ]);
  });
});
