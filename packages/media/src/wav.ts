import { writeFile } from "node:fs/promises";

export const BITS_PER_SAMPLE = 24;
export const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;

export function encodeWav(channels: readonly Float32Array[], sampleRate: number): Buffer {
  const first = channels[0];
  if (first === undefined) throw new Error("a WAV needs at least one channel");
  if (channels.some((channel) => channel.length !== first.length)) {
    throw new Error("every channel must hold the same number of samples");
  }

  const samples = first.length;
  const dataBytes = samples * channels.length * BYTES_PER_SAMPLE;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels.length, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels.length * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(channels.length * BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(dataBytes, 40);

  const data = Buffer.alloc(dataBytes);
  let position = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    for (const channel of channels) {
      const clamped = Math.max(-1, Math.min(1, channel[sample] ?? 0));
      data.writeIntLE(Math.round(clamped * 8_388_607), position, 3);
      position += BYTES_PER_SAMPLE;
    }
  }

  return Buffer.concat([header, data]);
}

export async function writeWav(path: string, channels: readonly Float32Array[], sampleRate: number): Promise<void> {
  await writeFile(path, encodeWav(channels, sampleRate));
}
