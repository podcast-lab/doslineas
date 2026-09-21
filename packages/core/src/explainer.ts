import type { ExplainerProfile } from "./explainer-profile.js";
import type { Input } from "./profile.js";

export interface ScreenWindow {
  readonly start: number;
  readonly end: number;
}

export type ExplainerLayout = "person" | "screen";

export interface ExplainerSegment {
  readonly atSeconds: number;
  readonly durationSeconds: number;
  readonly layout: ExplainerLayout;
}

export interface ExplainerPlan {
  readonly version: 1;
  readonly session: string;
  readonly profile: string;
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly personInput: Input;
  readonly screenInput: Input;
  readonly sourceSeconds: number;
  readonly screenSeconds: number;
  readonly segments: readonly ExplainerSegment[];
  readonly warnings: readonly string[];
}

export function settleWindows(
  windows: readonly ScreenWindow[],
  sourceSeconds: number,
  profile: ExplainerProfile
): ScreenWindow[] {
  const { minHoldSeconds } = profile.layout;
  const grown = windows
    .map((window) => ({
      start: Math.max(0, Math.min(window.start, sourceSeconds)),
      end: Math.min(sourceSeconds, Math.max(window.end + profile.activity.tailSeconds, window.start + minHoldSeconds))
    }))
    .filter((window) => window.end > window.start)
    .sort((a, b) => a.start - b.start);

  const merged: ScreenWindow[] = [];
  for (const window of grown) {
    const previous = merged.at(-1);
    if (previous !== undefined && window.start - previous.end < minHoldSeconds) {
      merged[merged.length - 1] = { start: previous.start, end: Math.max(previous.end, window.end) };
      continue;
    }
    merged.push(window);
  }

  const first = merged[0];
  if (first !== undefined && first.start > 0 && first.start < minHoldSeconds) {
    merged[0] = { start: 0, end: first.end };
  }

  const last = merged.at(-1);
  if (last !== undefined && last.end < sourceSeconds && sourceSeconds - last.end < minHoldSeconds) {
    merged[merged.length - 1] = { start: last.start, end: sourceSeconds };
  }

  return merged;
}

export function planExplainer(
  session: string,
  fps: number,
  windows: readonly ScreenWindow[],
  sourceSeconds: number,
  profile: ExplainerProfile
): ExplainerPlan {
  const settled = settleWindows(windows, sourceSeconds, profile);
  const segments: ExplainerSegment[] = [];
  const warnings: string[] = [];
  let cursor = 0;

  const push = (layout: ExplainerLayout, from: number, to: number): void => {
    if (to - from <= 0) return;
    segments.push({ atSeconds: from, durationSeconds: to - from, layout });
  };

  for (const window of settled) {
    push("person", cursor, window.start);
    push("screen", window.start, window.end);
    cursor = window.end;
  }
  push("person", cursor, sourceSeconds);

  if (segments.length === 0) push("person", 0, sourceSeconds);

  const screenSeconds = segments
    .filter((segment) => segment.layout === "screen")
    .reduce((total, segment) => total + segment.durationSeconds, 0);

  if (screenSeconds === 0) {
    warnings.push("the screen never moved: the explainer comes out as a plain person shot");
  } else if (screenSeconds > sourceSeconds * 0.95) {
    warnings.push("the screen is on for almost the whole session: check the activity threshold");
  }

  return {
    version: 1,
    session,
    profile: profile.name,
    fps,
    width: profile.frame.width,
    height: profile.frame.height,
    personInput: profile.layout.personInput,
    screenInput: profile.layout.screenInput,
    sourceSeconds,
    screenSeconds,
    segments,
    warnings
  };
}

export function layoutAt(plan: ExplainerPlan, seconds: number): ExplainerLayout {
  let found: ExplainerLayout = "person";
  for (const segment of plan.segments) {
    if (seconds < segment.atSeconds) break;
    if (seconds < segment.atSeconds + segment.durationSeconds) return segment.layout;
    found = segment.layout;
  }
  return found;
}
