#!/usr/bin/env node
/** Decode a source AFC stream to a private, runtime-ready PCM asset. */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const [input, output] = process.argv.slice(2);
if (!input || !output || !path.resolve(output).includes(`${path.sep}private${path.sep}`)) {
  console.error("usage: convert-source-audio.mjs <source.afc> <path-under-private.ogg>");
  process.exit(2);
}
await mkdir(path.dirname(output), { recursive: true });
await new Promise((resolve, reject) => {
  const child = spawn("ffmpeg", ["-v", "error", "-i", input, "-map_metadata", "-1", "-ac", "2", "-ar", "48000", "-c:a", "libvorbis", "-q:a", "5", "-y", output], { stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
});
console.log(JSON.stringify({ format: "orbite.source-audio/1", source: input, output }));
