import type { Clip } from "./clips.js";
import { flattenToClips } from "./clips.js";
import type { Edl, Source } from "./edl.js";

export interface FcpxmlOptions {
  readonly event?: string;
  readonly project?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface FrameRate {
  readonly numerator: number;
  readonly denominator: number;
}

const NTSC_RATES: ReadonlyArray<readonly [number, FrameRate]> = [
  [23.976, { numerator: 1001, denominator: 24_000 }],
  [29.97, { numerator: 1001, denominator: 30_000 }],
  [47.952, { numerator: 1001, denominator: 48_000 }],
  [59.94, { numerator: 1001, denominator: 60_000 }]
];

export function frameRateOf(fps: number): FrameRate {
  const ntsc = NTSC_RATES.find(([rate]) => Math.abs(fps - rate) < 0.01);
  if (ntsc !== undefined) return ntsc[1];
  return { numerator: 1, denominator: Math.round(fps) };
}

export function toRational(seconds: number, rate: FrameRate): string {
  const frames = Math.round((seconds * rate.denominator) / rate.numerator);
  return `${frames * rate.numerator}/${rate.denominator}s`;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function toFileUrl(path: string): string {
  const normalised = path.replace(/\\/g, "/");
  const withRoot = /^[a-zA-Z]:/.test(normalised) ? `/${normalised}` : normalised;
  return `file://${encodeURI(withRoot).replace(/#/g, "%23")}`;
}

function assetId(source: Source): string {
  return `r-video-${source.input}`;
}

function videoAsset(source: Source, formatId: string, rate: FrameRate): string {
  const name = escapeXml(`iso${source.input}-${source.role}`);
  const duration = toRational(source.durationSeconds, rate);
  return [
    `    <asset id="${assetId(source)}" name="${name}" start="0s" duration="${duration}" hasVideo="1" format="${formatId}">`,
    `      <media-rep kind="original-media" src="${escapeXml(toFileUrl(source.video))}"/>`,
    `    </asset>`
  ].join("\n");
}

function audioAsset(path: string, durationSeconds: number, rate: FrameRate): string {
  const duration = toRational(durationSeconds, rate);
  return [
    `    <asset id="r-audio" name="program" start="0s" duration="${duration}" hasAudio="1" audioSources="1" audioChannels="2">`,
    `      <media-rep kind="original-media" src="${escapeXml(toFileUrl(path))}"/>`,
    `    </asset>`
  ].join("\n");
}

function clipElement(clip: Clip, edl: Edl, rate: FrameRate, hasProgramAudio: boolean): string {
  const source = edl.sources.find((candidate) => candidate.input === clip.input);
  if (source === undefined) throw new Error(`input ${clip.input} is not in sources`);

  const offset = toRational(clip.timelineStart, rate);
  const start = toRational(clip.sourceStart, rate);
  const duration = toRational(clip.duration, rate);
  const name = escapeXml(`${clip.segment + 1} · ${source.role}`);

  if (!hasProgramAudio) {
    return `        <asset-clip ref="${assetId(source)}" name="${name}" offset="${offset}" start="${start}" duration="${duration}"/>`;
  }

  return [
    `        <asset-clip ref="${assetId(source)}" name="${name}" offset="${offset}" start="${start}" duration="${duration}">`,
    `          <asset-clip ref="r-audio" lane="-1" offset="${start}" start="${start}" duration="${duration}" audioRole="dialogue"/>`,
    `        </asset-clip>`
  ].join("\n");
}

export function toFcpxml(edl: Edl, options: FcpxmlOptions = {}): string {
  const rate = frameRateOf(edl.fps);
  const clips = flattenToClips(edl);
  const timelineSeconds = clips.reduce((total, clip) => total + clip.duration, 0);
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const formatId = "r-format";
  const programPath = edl.sources.find((source) => source.input === 1)?.audio ?? null;
  const longestSource = Math.max(...edl.sources.map((source) => source.durationSeconds));

  const resources = [
    `    <format id="${formatId}" name="FFVideoFormat${height}p${Math.round(edl.fps)}" frameDuration="${rate.numerator}/${rate.denominator}s" width="${width}" height="${height}"/>`,
    ...edl.sources.map((source) => videoAsset(source, formatId, rate)),
    ...(programPath === null ? [] : [audioAsset(programPath, longestSource, rate)])
  ].join("\n");

  const spine = clips.map((clip) => clipElement(clip, edl, rate, programPath !== null)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
${resources}
  </resources>
  <library>
    <event name="${escapeXml(options.event ?? "doslineas")}">
      <project name="${escapeXml(options.project ?? edl.session)}">
        <sequence format="${formatId}" duration="${toRational(timelineSeconds, rate)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
${spine}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
