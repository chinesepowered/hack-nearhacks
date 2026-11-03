// Adds a voiceover to video/out/capybazaar-demo.mp4 using ElevenLabs text-to-speech.
// Each caption from the recording (video/out/captions.json) is spoken at the moment it appears.
//
//   ELEVENLABS_API_KEY=... node video/narrate.mjs
//   optional: ELEVENLABS_VOICE_ID (default Rachel), ELEVENLABS_MODEL (default eleven_flash_v2_5)
//
// Output: video/out/capybazaar-demo-narrated.mp4 (needs ffmpeg). The key is read from the
// environment only and never written anywhere. About 1,000 characters of speech in total.

import { execFileSync } from "node:child_process";
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

const clips = [];
for (const [i, l] of lines.entries()) {
  const file = path.join(out, `vo-${String(i).padStart(2, "0")}.mp3`);
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

const inputs = ["-i", video, ...clips.flatMap((c) => ["-i", c.file])];
const delays = clips.map((c, i) => `[${i + 1}:a]adelay=${Math.round(c.at * 1000)}|${Math.round(c.at * 1000)}[a${i}]`);
const mix = `${clips.map((_, i) => `[a${i}]`).join("")}amix=inputs=${clips.length}:normalize=0[aout]`;
const target = path.join(out, "capybazaar-demo-narrated.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...inputs, "-filter_complex", [...delays, mix].join(";"), "-map", "0:v", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", target]);
for (const c of clips) fs.unlinkSync(c.file);
console.log(`wrote ${target}`);
