#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { alignTranscriptToLyrics } from "./align.js";
import { exportLrc, exportSrt, exportTtml, exportAss } from "./formats.js";
const args = process.argv.slice(2);
if (args.length < 2 || args.includes("--help")) {
  console.log("Usage: lyricalign lyrics.txt transcript.json [output.json]\nTranscript: [{text,start,end,words?:[{text,start,end}]}] (seconds)");
  process.exit(args.includes("--help") ? 0 : 1);
}
try {
  const lyrics = readFileSync(args[0], "utf8");
  const parsed: unknown = JSON.parse(readFileSync(args[1], "utf8"));
  const segments = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" && "segments" in parsed ? (parsed as {segments:unknown}).segments : null);
  if (!Array.isArray(segments)) throw new Error("Transcript must be an array or {segments: []}");
  const result = alignTranscriptToLyrics(lyrics, segments);
  if (!result) throw new Error("Insufficient transcript / lyric match; no timeline generated");
  const format = args[2]?.split(".").at(-1)?.toLowerCase();
  const output = format === "lrc" ? exportLrc(result.lines) : format === "srt" ? exportSrt(result.lines) : format === "ttml" ? exportTtml(result.lines) : format === "ass" ? exportAss(result.lines) : JSON.stringify(result, null, 2) + "\n";
  if (args[2]) writeFileSync(args[2], output); else process.stdout.write(output);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
