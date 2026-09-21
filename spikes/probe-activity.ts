import { screenActivity } from "@doslineas/analysis";
import { extractGrayFrames } from "@doslineas/media";

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined) throw new Error("missing video");
  const frames = await extractGrayFrames(path, { fps: 4, width: 64, height: 36 });
  const track = screenActivity(frames.pixels, frames.width * frames.height, frames.fps, 10);
  const values = [...track.changed];
  const nonzero = values.map((value, index) => ({ at: index / 4, value })).filter((entry) => entry.value > 0);
  console.log(`frames ${values.length}, nonzero ${nonzero.length}, max ${Math.max(...values).toFixed(4)}`);
  console.log(nonzero.slice(0, 30).map((entry) => `${entry.at.toFixed(2)}=${entry.value.toFixed(4)}`).join(" "));
}

await main();
