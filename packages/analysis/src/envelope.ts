import { percentile } from "@doslineas/core";

export const SILENT_DB = -120;

export interface Envelope {
  readonly windowMs: number;
  readonly sampleRate: number;
  readonly db: Float32Array;
}

export function envelopeDb(samples: Float32Array, sampleRate: number, windowMs: number): Envelope {
  const windowSamples = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const windows = Math.ceil(samples.length / windowSamples);
  const db = new Float32Array(windows);

  for (let window = 0; window < windows; window += 1) {
    const from = window * windowSamples;
    const to = Math.min(samples.length, from + windowSamples);
    let sum = 0;
    for (let index = from; index < to; index += 1) {
      sum += (samples[index] ?? 0) ** 2;
    }
    const rms = Math.sqrt(sum / Math.max(1, to - from));
    db[window] = rms <= 0 ? SILENT_DB : Math.max(SILENT_DB, 20 * Math.log10(rms));
  }

  return { windowMs, sampleRate, db };
}

export function windowsPerSecond(envelope: Envelope): number {
  return 1000 / envelope.windowMs;
}

export function secondsAt(envelope: Envelope, window: number): number {
  return (window * envelope.windowMs) / 1000;
}

export function durationSeconds(envelope: Envelope): number {
  return secondsAt(envelope, envelope.db.length);
}

export function noiseFloorDb(envelope: Envelope, calibrationSeconds: number): number {
  const windows = Math.max(1, Math.min(envelope.db.length, Math.round(calibrationSeconds * windowsPerSecond(envelope))));
  const head = percentile(Array.from(envelope.db.subarray(0, windows)), 0.1);
  const whole = percentile(Array.from(envelope.db), 0.1);
  return Math.min(head, whole);
}
