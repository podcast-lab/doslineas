import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Discard, Edl, Input, Segment } from "@doslineas/core";
import { outputDuration, validateEdl } from "@doslineas/core";
import type { SessionScript } from "./session-generator.js";
import { BASE_SCRIPT, generateSyntheticSession } from "./session-generator.js";
import { probe } from "./ffprobe.js";
import { runOrFail } from "./process.js";
import {
  AUDIO_SAMPLE_RATE,
  MAX_EXPRESSION_TERMS,
  audioChain,
  escapePath,
  inputOrder,
  programAudio,
  samplesPerFrame,
  selectChain,
  sendcmdScript,
  silenceExpressions,
  singlePassPlan
} from "./switching-render.js";

const FFMPEG_TERM_CEILING = 90;

function edlOf(segments: readonly Segment[], discards: readonly Discard[] = [], videos?: Record<Input, string>): Edl {
  return {
    version: 1,
    session: "test",
    fps: 25,
    profile: "podcast-v1",
    sources: ([1, 2, 3] as Input[]).map((input) => ({
      input,
      role: input === 1 ? "wide" : input === 2 ? "speaker1" : "speaker2",
      video: videos?.[input] ?? `iso${input}.mp4`,
      audio: input === 1 ? "program.mp4" : null,
      durationSeconds: 3600
    })),
    segments: [...segments],
    discards: [...discards],
    audio: { source: "program", gains: {} }
  };
}

describe("sendcmd script", () => {
  it("turns every segment into a streamselect input index", () => {
    const edl = edlOf([
      { tOut: 0, dur: 4, input: 2, tIn: 0, reason: "initial" },
      { tOut: 4, dur: 3, input: 1, tIn: 4, reason: "refresh" },
      { tOut: 7, dur: 5, input: 3, tIn: 7, reason: "turn" }
    ]);
    expect(inputOrder(edl)).toEqual([1, 2, 3]);
    expect(sendcmdScript(edl)).toBe("0.000 streamselect map 1;\n4.000 streamselect map 0;\n7.000 streamselect map 2;\n");
  });

  it("fails when a segment points at an input that is not in sources", () => {
    const edl = edlOf([{ tOut: 0, dur: 4, input: 4, tIn: 0, reason: "initial" }]);
    expect(() => sendcmdScript(edl)).toThrow(/input 4/);
  });
});

describe("silence expressions", () => {
  it("lets everything through when there are no discards", () => {
    expect(silenceExpressions(edlOf([]))).toEqual(["1"]);
  });

  it("splits them up to stay under the ffmpeg parser ceiling", () => {
    const discards: Discard[] = Array.from({ length: 428 }, (_, i) => ({
      tIn: i * 0.7,
      tEnd: i * 0.7 + 0.25,
      reason: "silence"
    }));
    const expressions = silenceExpressions(edlOf([], discards));

    expect(expressions).toHaveLength(Math.ceil(428 / MAX_EXPRESSION_TERMS));
    for (const expression of expressions) {
      const terms = expression.split("gte(t,").length - 1;
      expect(terms).toBeLessThanOrEqual(MAX_EXPRESSION_TERMS);
      expect(terms).toBeLessThan(FFMPEG_TERM_CEILING);
    }
    expect(selectChain(edlOf([], discards), "aselect").split("aselect=").length - 1).toBe(expressions.length);
  });

  it("covers every discard without dropping any", () => {
    const fps = 25;
    const discards: Discard[] = Array.from({ length: 95 }, (_, i) => ({ tIn: i * 2, tEnd: i * 2 + 0.5, reason: "silence" }));
    const joined = silenceExpressions(edlOf([], discards)).join("+");
    for (const discard of discards) {
      const from = ((Math.round(discard.tIn * fps) - 0.5) / fps).toFixed(3);
      const to = ((Math.round(discard.tEnd * fps) - 0.5) / fps).toFixed(3);
      expect(joined).toContain(`gte(t,${from})*lt(t,${to})`);
    }
  });

  it("puts every threshold half a frame away from any frame time", () => {
    const fps = 25;
    const discards: Discard[] = Array.from({ length: 40 }, (_, i) => ({
      tIn: Math.round(i * 3.37 * fps) / fps,
      tEnd: Math.round((i * 3.37 + 0.84) * fps) / fps,
      reason: "silence"
    }));
    const thresholds = [...silenceExpressions(edlOf([], discards)).join("+").matchAll(/[gl]te?\(t,(-?[\d.]+)\)/g)].map(
      (match) => Number(match[1])
    );

    expect(thresholds).toHaveLength(discards.length * 2);
    for (const threshold of thresholds) {
      const distance = Math.abs(threshold * fps - Math.round(threshold * fps));
      expect(distance).toBeGreaterThan(0.4);
    }
  });
});

describe("cutting audio on the same grid as the picture", () => {
  it("chops the audio into one frame worth of samples before selecting", () => {
    expect(samplesPerFrame(25)).toBe(1920);
    expect(samplesPerFrame(30)).toBe(1600);
    expect(audioChain(edlOf([]))).toContain("asetnsamples=n=1920:p=0");
    expect(audioChain(edlOf([]))).toContain(`aresample=${AUDIO_SAMPLE_RATE}`);
  });

  it("refuses a frame rate that would leave the two grids out of step", () => {
    expect(() => samplesPerFrame(30000 / 1001)).toThrow(/whole samples/);
  });

  it("drops exactly the same spans from the audio as from the picture", () => {
    const discards: Discard[] = [
      { tIn: 1.0, tEnd: 2.0, reason: "silence" },
      { tIn: 5.0, tEnd: 5.4, reason: "silence" }
    ];
    const edl = edlOf([], discards);
    const video = selectChain(edl, "select").replace(/select=/g, "");
    const audio = audioChain(edl).replace(/^.*?aselect=/, "").replace(/,asetpts.*$/, "");

    expect(audio).toBe(video);
  });

  it("takes the audio from whichever input carries it, not from input 1", () => {
    const edl = edlOf([]);
    const moved = {
      ...edl,
      sources: edl.sources.map((source) => ({
        ...source,
        audio: source.input === 3 ? "program.mp4" : null
      }))
    };

    expect(programAudio(moved)).toBe("program.mp4");
  });
});

describe("paths inside the filtergraph", () => {
  it("quotes and escapes the colon of a Windows path", () => {
    expect(escapePath("C:\\work\\session\\commands.txt")).toBe("'C\\:/work/session/commands.txt'");
  });
});

describe("single pass render over a real session", () => {
  let directory = "";
  let edl: Edl;

  const script: SessionScript = {
    ...BASE_SCRIPT,
    session: "short-render",
    durationSeconds: 12,
    width: 320,
    height: 180,
    utterances: [
      { input: 2, start: 0.5, dur: 3 },
      { input: 3, start: 5, dur: 4 }
    ]
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "switching-render-"));
    const session = await generateSyntheticSession(script, join(directory, "raw"));
    const discards: Discard[] = [{ tIn: 4.0, tEnd: 5.0, reason: "silence" }];
    const segments: Segment[] = [
      { tOut: 0, dur: 4, input: 2, tIn: 0, reason: "initial" },
      { tOut: 4, dur: 3, input: 3, tIn: 5, reason: "turn" },
      { tOut: 7, dur: 4, input: 1, tIn: 8, reason: "refresh" }
    ];
    const base = edlOf(segments, discards, session.isos);
    edl = {
      ...base,
      fps: script.fps,
      sources: base.sources.map((s) => ({
        ...s,
        audio: s.input === 1 ? session.program : null,
        durationSeconds: script.durationSeconds
      }))
    };
  }, 120_000);

  afterAll(async () => {
    if (directory !== "") await rm(directory, { recursive: true, force: true });
  });

  it("the EDL used by the test is consistent", () => {
    expect(validateEdl(edl)).toEqual([]);
  });

  it("renders in a single pass and the output lasts what the EDL says", async () => {
    const commandsPath = join(directory, "commands.txt");
    const filterPath = join(directory, "filter.txt");
    const target = join(directory, "master.mp4");
    const plan = singlePassPlan(edl, commandsPath, filterPath, target, {
      encoder: "libx264",
      quality: "28",
      preset: "ultrafast"
    });

    await writeFile(commandsPath, plan.commands, "utf8");
    await writeFile(filterPath, plan.filter, "utf8");
    await runOrFail("ffmpeg", [...plan.args, "-loglevel", "error"]);

    const sonde = await probe(target);
    expect(sonde.durationSeconds).toBeCloseTo(outputDuration(edl), 0);
    expect(sonde.video?.width).toBe(script.width);
    expect((await readFile(commandsPath, "utf8")).split("\n").filter(Boolean)).toHaveLength(edl.segments.length);
  }, 120_000);
});
