#!/usr/bin/env python3
"""LyricAlign local-only web server. No uploaded file is stored by this server."""
import argparse
import json
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_REQUEST_BYTES = 1_000_000

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "web"), **kwargs)

    def do_POST(self):
        if self.path != "/api/transcribe":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= MAX_REQUEST_BYTES:
            self.send_error(413, "Provide local audio path and model; do not upload binary media")
            return
        try:
            params = json.loads(self.rfile.read(length))
            audio = Path(str(params["audio_path"])).expanduser().resolve(strict=True)
            if not audio.is_file() or audio.suffix.lower() not in {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".mp4"}:
                raise ValueError("Unsupported audio file")
            model = str(params.get("model", "small"))
            if model not in {"tiny", "base", "small", "medium", "large-v3"}:
                raise ValueError("Unsupported model")
            from faster_whisper import WhisperModel
            wm = WhisperModel(model, device="cpu", compute_type="int8")
            segments, info = wm.transcribe(str(audio), word_timestamps=True, vad_filter=True)
            result = [{"text": s.text.strip(), "start": s.start, "end": s.end,
                        "words": [{"text": w.word, "start": w.start, "end": w.end} for w in (s.words or [])]}
                      for s in segments]
            self.respond(200, {"segments": result, "language": info.language})
        except (ImportError, OSError, ValueError, KeyError) as exc:
            self.respond(400, {"error": str(exc), "hint": "pip install -r python/requirements.txt"})
        except Exception as exc:
            self.respond(500, {"error": f"Transcription failed: {type(exc).__name__}"})

    def respond(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/api/health":
            return self.respond(200, {"ok": True, "service": "lyricalign"})
        return super().do_GET()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()

if __name__ == "__main__":
    main()
