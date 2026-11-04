// Adds a voiceover to video/out/capybazaar-demo.mp4 using ElevenLabs text-to-speech.
// Each caption from the recording (video/out/captions.json) is spoken at the moment it appears.
//
//   ELEVENLABS_API_KEY=... node video/narrate.mjs
//   optional: ELEVENLABS_VOICE_ID (default Rachel), ELEVENLABS_MODEL (default eleven_flash_v2_5)
//
// Output: video/out/capybazaar-demo-narrated.mp4 (needs ffmpeg). The key is read from the
// environment only and never written anywhere. About 1,000 characters of speech in total.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out");
const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("Set ELEVENLABS_API_KEY first.");
  process.exit(1);
}
const voice = process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
const model = process.env.ELEVENLABS_MODEL ?? "eleven_flash_v2_5";
const video = path.join(out, "capybazaar-demo.mp4");
const marks = JSON.parse(fs.readFileSync(path.join(out, "captions.json"), "utf8")).filter((m) => m.text);

const lines = [
  { at: 0.4, text: "Capybazaar: a hot-spring market town on NEAR, where every stall is an NFT that is its own NEAR account." },
  ...marks,
];
const last = marks.at(-1);
if (last) lines.push({ at: last.at + 6.5, text: "Built at NEAR HACKATHON. It all runs on testnet, and the code is open source." });

// Clips are cached by their text, so re-running only pays for lines that changed.
const cache = path.join(out, "vo-cache");
fs.mkdirSync(cache, { recursive: true });
const clips = [];
for (const [i, l] of lines.entries()) {
  const hash = createHash("sha256").update(`${voice}|${model}|${l.text}`).digest("hex").slice(0, 16);
  const file = path.join(cache, `${hash}.mp3`);
  if (fs.existsSync(file)) {
    clips.push({ file, at: l.at });
    console.log(`line ${i + 1}/${lines.length} at ${l.at.toFixed(1)}s (cached)`);
    continue;
  }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: l.text, model_id: model }),
  });
  if (!r.ok) {
    console.error(`ElevenLabs refused line ${i}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    process.exit(1);
  }
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  clips.push({ file, at: l.at });
  console.log(`line ${i + 1}/${lines.length} at ${l.at.toFixed(1)}s`);
}

// Never let two lines overlap: if a clip would start before the previous one ends, nudge it later.
const duration = (f) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim());
let prevEnd = 0;
for (const c of clips) {
  const start = Math.max(c.at, prevEnd + 0.25);
  c.at = start;
  prevEnd = start + duration(c.file);
  console.log(`  ${start.toFixed(1)}s → ${prevEnd.toFixed(1)}s  ${path.basename(c.file)}`);
}

// If the last line runs past the picture, hold the final frame (the end card) a little longer.
const videoLen = duration(video);
const hold = Math.max(0, prevEnd + 1.0 - videoLen);
const inputs = ["-i", video, ...clips.flatMap((c) => ["-i", c.file])];
const delays = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.at * 1000)}|${Math.round(c.at * 1000)}[a${i}]`);
const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0[aout]`;
const filters = [...delays, mix];
let vmap = "0:v";
if (hold > 0) {
  filters.push(`[0:v]tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}[vout]`);
  vmap = "[vout]";
}
const target = path.join(out, "capybazaar-demo-narrated.mp4");
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error", ...inputs,
  "-filter_complex", filters.join(";"),
  "-map", vmap, "-map", "[aout]",
  ...(hold > 0 ? ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "medium", "-crf", "20"] : ["-c:v", "copy"]),
  "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", target,
]);
console.log(`wrote ${target} (${(videoLen + hold).toFixed(1)}s${hold > 0 ? `, end card held ${hold.toFixed(1)}s longer` : ""})`);
