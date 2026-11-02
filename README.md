# LyricAlign

Offline, dependency-light lyric alignment extracted from the LMN516 music lyric system.

**Input:** Plain lyrics and an existing, timestamped speech/music transcription (JSON).  
**Output:** Matched lyric lines, character-level karaoke timing, coverage and confidence metrics.

## Features

- Unicode-aware text normalization (including Chinese/English)
- Local sequence matching and tolerance to recognition mistakes
- Match a short transcript against a section of full song lyrics
- Monotonic character timing and interpolation for unrecognized characters
- Low-match rejection instead of a fabricated timeline
- JSON CLI and importable TypeScript library

## Quick start

Requires Node.js >= 20.

```sh
npm install
npm run check
node dist/cli.js examples/lyrics.txt examples/transcript.json aligned.json
```

The transcript format is an array of `{text, start, end, words?}` objects, where start/end are in seconds. Optional `words` contains similarly timestamped objects. `{segments: [...]}` is also accepted.

```ts
import { alignTranscriptToLyrics } from "@burgcreate/lyricalign";
const aligned = alignTranscriptToLyrics(lyrics, transcriptSegments, durationSeconds);
if (!aligned) { /* insufficient match; request manual review */ }
```

The result has `lines[]` with `at`, `end`, `text`, and `tokens[]` at the character level, plus `confidence`, `transcriptCoverage`, `lyricCoverage`, and matched span diagnostics.

## Scope

This is an **alignment engine**, not speech recognition. Supply timestamps from an ASR system of your choice. It does not download songs, scrape lyrics, provide transcription models, or guarantee accuracy. The underlying local sequence alignment uses O(transcript characters × lyric characters) time and may be expensive for very long inputs. Human review is appropriate before publishing karaoke timings.

## Licensing and data

MIT license applies to the source code in this repository only. Use music and lyrics you have rights to process. Third-party ASR services and music providers have separate terms. Examples are original synthetic text; no LMN516 private configuration, credentials, or user data are included.

## Credits

Extracted and made standalone from the LMN516 music lyric alignment implementation by BurgCreate.
