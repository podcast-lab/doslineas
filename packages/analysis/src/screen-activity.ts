import type { ExplainerProfile } from "@doslineas/core";

export interface ActivityTrack {
  readonly fps: number;
  readonly changed: Float32Array;
}

export interface ActiveInterval {
  readonly start: number;
  readonly end: number;
}

export function screenActivity(
  pixels: Uint8Array,
  pixelsPerFrame: number,
  fps: number,
  toleranceLevels: number
): ActivityTrack {
  const frames = Math.floor(pixels.length / pixelsPerFrame);
  const changed = new Float32Array(Math.max(0, frames));
  if (frames === 0) return { fps, changed };

  for (let frame = 1; frame < frames; frame += 1) {
    const here = frame * pixelsPerFrame;
    const there = here - pixelsPerFrame;
    let moved = 0;

    for (let pixel = 0; pixel < pixelsPerFrame; pixel += 1) {
      const difference = Math.abs((pixels[here + pixel] ?? 0) - (pixels[there + pixel] ?? 0));
      if (difference > toleranceLevels) moved += 1;
    }

    changed[frame] = moved / pixelsPerFrame;
  }

  return { fps, changed };
}

export function activitySeconds(track: ActivityTrack, frame: number): number {
  return frame / track.fps;
}

export function activityDuration(track: ActivityTrack): number {
  return track.changed.length / track.fps;
}

export function screenJumps(track: ActivityTrack, jumpRatio: number, minSpacingSeconds: number): number[] {
  const minGap = Math.max(1, Math.round(minSpacingSeconds * track.fps));
  const moments: number[] = [];
  let lastFrame = -Infinity;

  for (let frame = 1; frame < track.changed.length; frame += 1) {
    if ((track.changed[frame] ?? 0) < jumpRatio) continue;
    if (frame - lastFrame < minGap) continue;
    moments.push(activitySeconds(track, frame));
    lastFrame = frame;
  }

  return moments;
}

export function detectScreenActivity(track: ActivityTrack, profile: ExplainerProfile): ActiveInterval[] {
  const openFrames = Math.max(1, Math.round((profile.activity.openMs / 1000) * track.fps));
  const closeFrames = Math.max(1, Math.round((profile.activity.closeMs / 1000) * track.fps));

  const intervals: ActiveInterval[] = [];
  let openedAt: number | null = null;
  let busyRun = 0;
  let stillRun = 0;

  const close = (frame: number): void => {
    if (openedAt === null) return;
    const start = activitySeconds(track, openedAt);
    const end = activitySeconds(track, frame);
    if (end > start) intervals.push({ start, end });
    openedAt = null;
  };

  for (let frame = 0; frame < track.changed.length; frame += 1) {
    const moved = track.changed[frame] ?? 0;
    const busy = moved >= profile.activity.changedRatio;
    const jumped = moved >= profile.activity.jumpRatio;

    if (busy) {
      stillRun = 0;
      busyRun += 1;
      if (openedAt === null && (jumped || busyRun >= openFrames)) {
        openedAt = jumped ? frame : frame - busyRun + 1;
      }
      continue;
    }

    busyRun = 0;
    if (openedAt === null) continue;

    stillRun += 1;
    if (stillRun >= closeFrames) close(frame - stillRun + 1);
  }

  close(track.changed.length);

  return intervals;
}
