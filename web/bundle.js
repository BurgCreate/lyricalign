"use strict";
(() => {
  // src/lyric-sync.ts
  function cleanLyricText(input2) {
    return typeof input2 === "string" ? input2.replace(/\s+/g, " ").trim() : "";
  }
  function cleanLyricTokenText(input2) {
    if (typeof input2 !== "string") return "";
    const normalized = input2.replace(/\s+/g, " ");
    return normalized.trim() ? normalized : "";
  }
  function normalizeLyricTokens(input2) {
    if (!input2?.length) return void 0;
    const tokens = input2.map((token, sourceIndex) => ({
      at: Number(token?.at),
      end: Number(token?.end),
      text: cleanLyricTokenText(token?.text),
      sourceIndex
    })).filter(
      (token) => Number.isFinite(token.at) && Number.isFinite(token.end) && token.at >= 0 && token.end >= token.at && Boolean(token.text.trim())
    ).sort((a, b) => a.at - b.at || a.sourceIndex - b.sourceIndex).map((token) => ({
      at: Number(token.at.toFixed(3)),
      end: Number(token.end.toFixed(3)),
      text: token.text
    }));
    return tokens.length ? tokens : void 0;
  }
  function normalizeLyricLines(input2) {
    const normalized = input2.map((line, sourceIndex) => {
      const at = Number(line?.at);
      const rawEnd = Number(line?.end);
      const end = Number.isFinite(rawEnd) && rawEnd >= at ? Number(rawEnd.toFixed(3)) : void 0;
      return {
        at,
        end,
        text: cleanLyricText(line?.text),
        tokens: normalizeLyricTokens(line?.tokens),
        sourceIndex
      };
    }).filter((line) => Number.isFinite(line.at) && line.at >= 0 && Boolean(line.text)).sort((a, b) => a.at - b.at || a.sourceIndex - b.sourceIndex);
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const line of normalized) {
      const key = `${line.at.toFixed(3)}\0${line.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        at: Number(line.at.toFixed(3)),
        ...line.end === void 0 ? {} : { end: line.end },
        text: line.text,
        ...line.tokens ? { tokens: line.tokens } : {}
      });
    }
    return result;
  }

  // src/align.ts
  var MATCH_SCORE = 4;
  var MISMATCH_SCORE = -3;
  var GAP_SCORE = -2;
  var MIN_TOKEN_DURATION = 0.045;
  var MAX_MATCH_UNITS = 8e3;
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function roundTime(value) {
    return Number(Math.max(0, value).toFixed(3));
  }
  function normalizeLyricSourceText(input2) {
    return input2.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  }
  function segmentLyricLine(text) {
    const tokens = [];
    for (const character of Array.from(text)) {
      if (/\s/u.test(character)) {
        if (tokens.length > 0) tokens[tokens.length - 1] += character;
        continue;
      }
      tokens.push(character);
    }
    return tokens;
  }
  function matchSymbols(input2) {
    const normalized = input2.normalize("NFKC").toLocaleLowerCase();
    return Array.from(normalized).filter((character) => /[\p{L}\p{N}]/u.test(character));
  }
  function buildLyricUnits(lines) {
    const units = [];
    lines.forEach((line, lineIndex) => {
      segmentLyricLine(line).forEach((token, tokenIndex) => {
        for (const symbol of matchSymbols(token)) {
          if (units.length >= MAX_MATCH_UNITS) return;
          units.push({ symbol, lineIndex, tokenIndex });
        }
      });
    });
    return units;
  }
  function distributeTimedText(text, start, end) {
    const symbols = matchSymbols(text);
    if (!symbols.length) return [];
    const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
    const safeEnd = Number.isFinite(end) ? Math.max(safeStart + 0.04, end) : safeStart + 0.2;
    const duration = safeEnd - safeStart;
    return symbols.map((symbol, index) => ({
      symbol,
      start: safeStart + duration * index / symbols.length,
      end: safeStart + duration * (index + 1) / symbols.length
    }));
  }
  function buildTranscriptUnits(segments) {
    const units = [];
    for (const segment of segments) {
      const words = segment.words?.filter(
        (word) => word?.text && Number.isFinite(word.start) && Number.isFinite(word.end)
      );
      if (words?.length) {
        for (const word of words) {
          units.push(...distributeTimedText(word.text, word.start, word.end));
        }
        continue;
      }
      units.push(...distributeTimedText(segment.text, segment.start, segment.end));
    }
    return units.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  function localAlignmentPairs(lyrics, transcript) {
    const width = lyrics.length + 1;
    const directions = new Uint8Array((transcript.length + 1) * width);
    let previous = new Int16Array(width);
    let current = new Int16Array(width);
    let bestScore = 0;
    let bestI = 0;
    let bestJ = 0;
    for (let i2 = 1; i2 <= transcript.length; i2 += 1) {
      current.fill(0);
      for (let j2 = 1; j2 <= lyrics.length; j2 += 1) {
        const same = transcript[i2 - 1].symbol === lyrics[j2 - 1].symbol;
        const diagonal = previous[j2 - 1] + (same ? MATCH_SCORE : MISMATCH_SCORE);
        const up = previous[j2] + GAP_SCORE;
        const left = current[j2 - 1] + GAP_SCORE;
        let score = 0;
        let direction = 0;
        if (diagonal > score) {
          score = diagonal;
          direction = 1;
        }
        if (up > score) {
          score = up;
          direction = 2;
        }
        if (left > score) {
          score = left;
          direction = 3;
        }
        current[j2] = score;
        directions[i2 * width + j2] = direction;
        if (score > bestScore) {
          bestScore = score;
          bestI = i2;
          bestJ = j2;
        }
      }
      const swap = previous;
      previous = current;
      current = swap;
    }
    const pairs = [];
    let i = bestI;
    let j = bestJ;
    while (i > 0 && j > 0) {
      const direction = directions[i * width + j];
      if (!direction) break;
      if (direction === 1) {
        if (transcript[i - 1].symbol === lyrics[j - 1].symbol) {
          pairs.push({ lyricIndex: j - 1, transcriptIndex: i - 1 });
        }
        i -= 1;
        j -= 1;
      } else if (direction === 2) {
        i -= 1;
      } else {
        j -= 1;
      }
    }
    pairs.reverse();
    return { pairs, bestScore };
  }
  function median(values, fallback) {
    const finite = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
    if (!finite.length) return fallback;
    const middle = Math.floor(finite.length / 2);
    return finite.length % 2 === 0 ? (finite[middle - 1] + finite[middle]) / 2 : finite[middle];
  }
  function tokenKey(lineIndex, tokenIndex) {
    return `${lineIndex}:${tokenIndex}`;
  }
  function fillTokenStarts(tokens, anchors, estimatedStep, previewEnd) {
    const starts = new Array(tokens.length).fill(null);
    const anchoredIndexes = [];
    tokens.forEach((token, index) => {
      const anchor = anchors.get(tokenKey(token.lineIndex, token.tokenIndex));
      if (!anchor) return;
      starts[index] = anchor.start;
      anchoredIndexes.push(index);
    });
    if (!anchoredIndexes.length) return null;
    const first = anchoredIndexes[0];
    for (let index = first - 1; index >= 0; index -= 1) {
      starts[index] = Math.max(0, starts[index + 1] - estimatedStep);
    }
    for (let anchorPosition = 0; anchorPosition < anchoredIndexes.length - 1; anchorPosition += 1) {
      const leftIndex = anchoredIndexes[anchorPosition];
      const rightIndex = anchoredIndexes[anchorPosition + 1];
      const leftTime = starts[leftIndex];
      const rightTime = starts[rightIndex];
      const count = rightIndex - leftIndex;
      if (count <= 1) continue;
      for (let offset = 1; offset < count; offset += 1) {
        starts[leftIndex + offset] = leftTime + (rightTime - leftTime) * offset / count;
      }
    }
    const last = anchoredIndexes[anchoredIndexes.length - 1];
    for (let index = last + 1; index < starts.length; index += 1) {
      starts[index] = Math.min(previewEnd - MIN_TOKEN_DURATION, starts[index - 1] + estimatedStep);
    }
    let previous = -MIN_TOKEN_DURATION;
    for (let index = 0; index < starts.length; index += 1) {
      const remaining = starts.length - index - 1;
      const latest = Math.max(0, previewEnd - MIN_TOKEN_DURATION * (remaining + 1));
      const next = clamp(starts[index] ?? previous + estimatedStep, previous + MIN_TOKEN_DURATION, latest);
      starts[index] = next;
      previous = next;
    }
    return starts;
  }
  function alignTranscriptToLyrics(lyricsText, segments, previewDuration) {
    const normalizedLyrics = normalizeLyricSourceText(lyricsText);
    const lyricLines = normalizedLyrics ? normalizedLyrics.split("\n") : [];
    if (!lyricLines.length || !segments.length) return null;
    const lyricUnits = buildLyricUnits(lyricLines);
    const transcriptUnits = buildTranscriptUnits(segments);
    if (lyricUnits.length < 2 || transcriptUnits.length < 2) return null;
    const { pairs, bestScore } = localAlignmentPairs(lyricUnits, transcriptUnits);
    if (pairs.length < Math.min(6, Math.max(3, Math.ceil(transcriptUnits.length * 0.14)))) return null;
    const firstLyricUnit = pairs[0].lyricIndex;
    const lastLyricUnit = pairs[pairs.length - 1].lyricIndex;
    const lyricSpan = Math.max(1, lastLyricUnit - firstLyricUnit + 1);
    const transcriptCoverage = pairs.length / transcriptUnits.length;
    const lyricCoverage = pairs.length / lyricSpan;
    const normalizedScore = bestScore / Math.max(MATCH_SCORE, MATCH_SCORE * Math.min(transcriptUnits.length, lyricSpan));
    const confidence = clamp(
      transcriptCoverage * 0.52 + lyricCoverage * 0.28 + normalizedScore * 0.2,
      0,
      1
    );
    const startLine = lyricUnits[firstLyricUnit].lineIndex;
    const endLine = lyricUnits[lastLyricUnit].lineIndex;
    const anchors = /* @__PURE__ */ new Map();
    for (const pair of pairs) {
      const lyric = lyricUnits[pair.lyricIndex];
      const transcript2 = transcriptUnits[pair.transcriptIndex];
      const key = tokenKey(lyric.lineIndex, lyric.tokenIndex);
      const existing = anchors.get(key);
      anchors.set(key, {
        start: existing ? Math.min(existing.start, transcript2.start) : transcript2.start,
        end: existing ? Math.max(existing.end, transcript2.end) : transcript2.end
      });
    }
    const selectedTokens = [];
    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
      segmentLyricLine(lyricLines[lineIndex]).forEach((text, tokenIndex) => {
        selectedTokens.push({ text, lineIndex, tokenIndex });
      });
    }
    if (!selectedTokens.length) return null;
    const observedDiffs = [];
    for (let index = 1; index < transcriptUnits.length; index += 1) {
      const diff = transcriptUnits[index].start - transcriptUnits[index - 1].start;
      if (diff > 0.025 && diff < 0.8) observedDiffs.push(diff);
    }
    const observedDurations = transcriptUnits.map((unit) => unit.end - unit.start);
    const estimatedStep = clamp(
      median(observedDiffs, median(observedDurations, 0.16)),
      0.06,
      0.34
    );
    const observedEnd = Math.max(...transcriptUnits.map((unit) => unit.end));
    const duration = typeof previewDuration === "number" && Number.isFinite(previewDuration) && previewDuration > 0 ? previewDuration : Math.max(observedEnd + 0.4, 1);
    const starts = fillTokenStarts(selectedTokens, anchors, estimatedStep, duration);
    if (!starts) return null;
    const timedByLine = /* @__PURE__ */ new Map();
    selectedTokens.forEach((token, index) => {
      const at = starts[index];
      const nextToken = selectedTokens[index + 1];
      const nextAt = starts[index + 1];
      const anchor = anchors.get(tokenKey(token.lineIndex, token.tokenIndex));
      const sameLine = nextToken?.lineIndex === token.lineIndex;
      const inferredEnd = sameLine && Number.isFinite(nextAt) ? nextAt : Math.min(duration, at + Math.min(0.9, Math.max(0.12, estimatedStep * 1.8)));
      const anchoredEnd = anchor?.end;
      const end = Math.min(
        duration,
        Math.max(at + MIN_TOKEN_DURATION, anchoredEnd && anchoredEnd > at ? anchoredEnd : inferredEnd)
      );
      const bucket = timedByLine.get(token.lineIndex) ?? [];
      bucket.push({ text: token.text, at: roundTime(at), end: roundTime(end) });
      timedByLine.set(token.lineIndex, bucket);
    });
    const lines = [];
    for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
      const tokens = timedByLine.get(lineIndex) ?? [];
      if (!tokens.length) continue;
      lines.push({
        text: lyricLines[lineIndex],
        at: tokens[0].at,
        end: tokens[tokens.length - 1].end,
        tokens
      });
    }
    const transcript = segments.map((segment) => segment.text.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
    return {
      lines: normalizeLyricLines(lines),
      confidence: Number(confidence.toFixed(3)),
      transcriptCoverage: Number(transcriptCoverage.toFixed(3)),
      lyricCoverage: Number(lyricCoverage.toFixed(3)),
      matchedCharacters: pairs.length,
      transcriptCharacters: transcriptUnits.length,
      matchedLineStart: startLine,
      matchedLineEnd: endLine,
      transcript
    };
  }

  // src/formats.ts
  var time = (n, decimals = 2) => {
    const t = Math.max(0, Number.isFinite(n) ? n : 0);
    const m = Math.floor(t / 60);
    const s = (t - m * 60).toFixed(decimals).padStart(3 + decimals, "0");
    return { m, s };
  };
  function exportLrc(lines) {
    return lines.map((line) => {
      const t = time(line.at);
      return `[${String(t.m).padStart(2, "0")}:${t.s}]${line.text}`;
    }).join("\n") + "\n";
  }
  function stamp(n, sep, digits = 3) {
    const t = Math.max(0, n), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60);
    const s = (t % 60).toFixed(digits).padStart(3 + digits, "0");
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${s.replace(".", sep)}`;
  }
  var escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function exportSrt(lines) {
    return lines.map((line, i) => `${i + 1}
${stamp(line.at, ",")} --> ${stamp(Math.max(line.at + 0.05, line.end ?? line.at + 2), ",")}
${line.text}
`).join("\n");
  }
  function exportTtml(lines) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
${lines.map((line) => {
      const tokens = line.tokens?.length ? line.tokens.map((token) => `<span begin="${stamp(token.at, ".")}" end="${stamp(token.end, ".")}">${escapeXml(token.text)}</span>`).join("") : escapeXml(line.text);
      return `<p begin="${stamp(line.at, ".")}" end="${stamp(Math.max(line.at + 0.05, line.end ?? line.at + 2), ".")}">${tokens}</p>`;
    }).join("\n")}
</div></body></tt>
`;
  }
  function exportAss(lines) {
    const assTime = (n) => {
      const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = (n % 60).toFixed(2).padStart(5, "0");
      return `${h}:${String(m).padStart(2, "0")}:${s}`;
    };
    const esc = (s) => s.replace(/\\/g, "\\\\").replace(/[{}]/g, "").replace(/\n/g, " ");
    const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,60,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,2,20,20,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    return header + lines.map((l) => {
      const lyric = l.tokens?.length ? l.tokens.map((t) => `{\\k${Math.max(1, Math.round((t.end - t.at) * 100))}}${esc(t.text)}`).join("") : esc(l.text);
      return `Dialogue: 0,${assTime(l.at)},${assTime(Math.max(l.at + 0.05, l.end ?? l.at + 2))},Default,,0,0,0,,${lyric}`;
    }).join("\n") + "\n";
  }

  // web/app.js
  var $ = (id) => document.getElementById(id);
  var state = { lines: [], transcript: [], url: null };
  var audio = $("audio");
  var fmtTime = (n) => Number.isFinite(n) ? n.toFixed(2) + "s" : "\u2014";
  var setStatus = (text) => $("status").textContent = text;
  var byTime = (n) => Number.isFinite(+n) ? +n : 0;
  $("audioFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(f);
    audio.src = state.url;
    setStatus("Audio loaded locally: " + f.name + ". For ASR, supply its local path below.");
  });
  $("transcriptFile").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      state.transcript = Array.isArray(j) ? j : j.segments;
      if (!Array.isArray(state.transcript)) throw Error("Expected array");
      setStatus("Loaded " + state.transcript.length + " transcript segments");
    } catch (err) {
      setStatus(String(err));
    }
  });
  $("transcribe").addEventListener("click", async () => {
    const audio_path = $("localPath").value.trim();
    if (!audio_path) {
      setStatus("Provide an absolute path to an audio file on this machine.");
      return;
    }
    $("transcribe").disabled = true;
    setStatus("Transcribing locally; the model may need downloading on first use...");
    try {
      const r = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio_path, model: $("model").value }) });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || r.statusText);
      state.transcript = j.segments;
      setStatus("Transcribed " + state.transcript.length + " segments (" + j.language + "); now align.");
    } catch (e) {
      setStatus("ASR error: " + e.message);
    } finally {
      $("transcribe").disabled = false;
    }
  });
  $("align").addEventListener("click", () => {
    const result = alignTranscriptToLyrics($("lyrics").value, state.transcript, audio.duration || void 0);
    if (!result) {
      setStatus("Low similarity: cannot align. Check lyrics vs. audio transcript.");
      return;
    }
    state.lines = result.lines;
    render();
    setStatus("Aligned " + result.lines.length + " lines, confidence " + result.confidence + "; review timing before export.");
  });
  $("jsonImport").addEventListener("change", async (e) => {
    try {
      const obj = JSON.parse(await e.target.files[0].text());
      state.lines = normalizeLyricLines(Array.isArray(obj) ? obj : obj.lines);
      render();
      setStatus("Imported timeline");
    } catch (e2) {
      setStatus(String(e2));
    }
  });
  $("offset").addEventListener("click", () => {
    const delta = Number($("delta").value);
    if (!Number.isFinite(delta)) return;
    state.lines = state.lines.map((l) => ({ ...l, at: Math.max(0, l.at + delta), end: l.end === void 0 ? void 0 : Math.max(0, l.end + delta), tokens: l.tokens?.map((t) => ({ ...t, at: Math.max(0, t.at + delta), end: Math.max(0, t.end + delta) })) }));
    render();
  });
  $("editor").addEventListener("change", (e) => {
    const el = e.target, i = Number(el.dataset.i), t = el.dataset.token;
    if (!state.lines[i]) return;
    const line = state.lines[i];
    if (t !== void 0) {
      const token = line.tokens?.[Number(t)];
      if (!token) return;
      if (el.dataset.field === "text") token.text = el.value;
      else token[el.dataset.field] = Math.max(0, byTime(el.value));
    } else if (el.dataset.field === "text") line.text = el.value;
    else line[el.dataset.field] = Math.max(0, byTime(el.value));
    state.lines = normalizeLyricLines(state.lines);
    render();
  });
  $("download").addEventListener("click", () => {
    if (!state.lines.length) {
      setStatus("No timeline to export");
      return;
    }
    const format = $("format").value;
    const content = format === "lrc" ? exportLrc(state.lines) : format === "srt" ? exportSrt(state.lines) : format === "ttml" ? exportTtml(state.lines) : format === "ass" ? exportAss(state.lines) : JSON.stringify({ lines: state.lines }, null, 2);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lyricalign." + format;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5e3);
  });
  var lastIndex = -1;
  audio.addEventListener("timeupdate", () => {
    const t = audio.currentTime;
    const i = state.lines.findIndex((l) => t >= l.at && t < (l.end ?? l.at + 2));
    if (i !== lastIndex) {
      document.querySelectorAll(".line").forEach((el, j) => el.classList.toggle("active", j === i));
      lastIndex = i;
    }
    $("current").textContent = fmtTime(t);
  });
  function input(field, value, i, token = void 0) {
    const inp = document.createElement("input");
    inp.value = value;
    inp.dataset.field = field;
    inp.dataset.i = i;
    if (token !== void 0) inp.dataset.token = token;
    if (field !== "text") {
      inp.type = "number";
      inp.step = "0.01";
      inp.min = "0";
    }
    return inp;
  }
  function render() {
    const editor = $("editor");
    editor.replaceChildren();
    state.lines.forEach((l, i) => {
      const line = document.createElement("div");
      line.className = "line";
      const heading = document.createElement("div");
      heading.className = "fields";
      const start = input("at", l.at, i), end = input("end", l.end ?? l.at + 2, i), text = input("text", l.text, i);
      start.title = "Line start";
      end.title = "Line end";
      text.title = "Lyric line";
      const jump = document.createElement("button");
      jump.textContent = "\u25B6";
      jump.addEventListener("click", () => {
        audio.currentTime = l.at;
        audio.play().catch(() => {
        });
      });
      heading.append(jump, start, end, text);
      line.append(heading);
      if (l.tokens?.length) {
        const tokens = document.createElement("div");
        tokens.className = "tokens";
        l.tokens.forEach((t, j) => {
          const span = document.createElement("label");
          span.append(input("text", t.text, i, j), input("at", t.at, i, j), input("end", t.end, i, j));
          tokens.append(span);
        });
        line.append(tokens);
      }
      editor.append(line);
    });
    lastIndex = -1;
  }
})();
