# LyricAlign Studio

A standalone MIT-licensed lyric alignment studio extracted from the LMN516 music system. Runs locally and stores no media on a remote service.

## What it does

1. Load local MP3/WAV/M4A/FLAC/OGG audio in the browser.
2. Run local Whisper transcription using **faster-whisper** (optional), or import your own timestamped transcript JSON.
3. Paste original or licensed lyrics; automatically match against the recognized sections and generate per-character timing.
4. Play audio, preview highlighted lines, edit line/token timestamps, and apply a global offset.
5. Export **JSON, LRC, SRT, TTML and ASS karaoke**.

## Run locally

Node.js >= 20 and Python 3 are required.

```bash
git clone https://github.com/BurgCreate/lyricalign.git
cd lyricalign
npm install
npm run check
python3 -m pip install -r python/requirements.txt
npm run studio
```

Open **http://127.0.0.1:8765/**. Browser audio selection is local and remains in-browser. To transcribe, enter the absolute path to the same file on the computer running the server. Models may download weights on first run and need significant disk/memory resources; choose `tiny` or `base` on constrained hardware.

If faster-whisper is unavailable, import `examples/transcript.json` and paste `examples/lyrics.txt` to use the editor without ASR.

## CLI and API

```bash
npm run build
node dist/cli.js examples/lyrics.txt examples/transcript.json result.json
node dist/cli.js examples/lyrics.txt examples/transcript.json result.lrc
node dist/cli.js examples/lyrics.txt examples/transcript.json result.srt
node dist/cli.js examples/lyrics.txt examples/transcript.json result.ttml
node dist/cli.js examples/lyrics.txt examples/transcript.json result.ass
```

Use `alignTranscriptToLyrics(lyrics, segments, durationSeconds)` in TypeScript; `segments` is a timed array of `{text,start,end,words?:[{text,start,end}]}`. Alignment can return `null` for insufficient matches.

## Technical boundaries

- The localhost server binds **127.0.0.1** only. It resolves explicit audio paths given by the local user, not uploaded binaries.
- The ASR engine requires separate installation and has not been tested with a real song in the initial release. Whisper is not a music-specialized transcription model: instrumentals, overlapping singers, languages, and studio effects can substantially reduce accuracy. Manually review timings.
- Alignment is local sequence matching, not audio-source separation. The matching engine has quadratic time/memory characteristics for very long inputs.
- ASS supports karaoke token timing, LRC/SRT use line timing, and TTML writes line and span times. This does not implement Apple Music proprietary lyric authoring.
- Only code and original synthetic example lyrics are distributed. Do not upload or redistribute copyrighted audio or lyrics without permission. Any third-party model provider and ASR library terms apply separately.

## License

MIT. Copyright (c) 2026 BurgCreate.
