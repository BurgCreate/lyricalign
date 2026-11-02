import { normalizeLyricLines, type LyricLine } from "./lyric-sync.js";

export type TranscriptWordTiming = {
  text: string;
  start: number;
  end: number;
};

export type TranscriptSegmentTiming = {
  text: string;
  start: number;
  end: number;
  words?: TranscriptWordTiming[];
};

export type LyricAutoAlignment = {
  lines: LyricLine[];
  confidence: number;
  transcriptCoverage: number;
  lyricCoverage: number;
  matchedCharacters: number;
  transcriptCharacters: number;
  matchedLineStart: number;
  matchedLineEnd: number;
  transcript: string;
};

type LyricMatchUnit = {
  symbol: string;
  lineIndex: number;
  tokenIndex: number;
};

type TimedTranscriptUnit = {
  symbol: string;
  start: number;
  end: number;
};

type TokenAnchor = {
  start: number;
  end: number;
};

type DisplayToken = {
  text: string;
  lineIndex: number;
  tokenIndex: number;
};

const MATCH_SCORE = 4;
const MISMATCH_SCORE = -3;
const GAP_SCORE = -2;
const MIN_TOKEN_DURATION = 0.045;
const MAX_MATCH_UNITS = 8_000;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundTime(value: number) {
  return Number(Math.max(0, value).toFixed(3));
}

export function normalizeLyricSourceText(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function segmentLyricLine(text: string) {
  const tokens: string[] = [];
  for (const character of Array.from(text)) {
    if (/\s/u.test(character)) {
      if (tokens.length > 0) tokens[tokens.length - 1] += character;
      continue;
    }
    tokens.push(character);
  }
  return tokens;
}

function matchSymbols(input: string) {
  const normalized = input.normalize("NFKC").toLocaleLowerCase();
  return Array.from(normalized).filter((character) => /[\p{L}\p{N}]/u.test(character));
}

function buildLyricUnits(lines: readonly string[]) {
  const units: LyricMatchUnit[] = [];
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

function distributeTimedText(text: string, start: number, end: number) {
  const symbols = matchSymbols(text);
  if (!symbols.length) return [] as TimedTranscriptUnit[];
  const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
  const safeEnd = Number.isFinite(end) ? Math.max(safeStart + 0.04, end) : safeStart + 0.2;
  const duration = safeEnd - safeStart;
  return symbols.map((symbol, index) => ({
    symbol,
    start: safeStart + (duration * index) / symbols.length,
    end: safeStart + (duration * (index + 1)) / symbols.length,
  }));
}

function buildTranscriptUnits(segments: readonly TranscriptSegmentTiming[]) {
  const units: TimedTranscriptUnit[] = [];
  for (const segment of segments) {
    const words = segment.words?.filter(
      (word) => word?.text && Number.isFinite(word.start) && Number.isFinite(word.end),
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

function localAlignmentPairs(lyrics: readonly LyricMatchUnit[], transcript: readonly TimedTranscriptUnit[]) {
  const width = lyrics.length + 1;
  const directions = new Uint8Array((transcript.length + 1) * width);
  let previous = new Int16Array(width);
  let current = new Int16Array(width);
  let bestScore = 0;
  let bestI = 0;
  let bestJ = 0;

  for (let i = 1; i <= transcript.length; i += 1) {
    current.fill(0);
    for (let j = 1; j <= lyrics.length; j += 1) {
      const same = transcript[i - 1].symbol === lyrics[j - 1].symbol;
      const diagonal = previous[j - 1] + (same ? MATCH_SCORE : MISMATCH_SCORE);
      const up = previous[j] + GAP_SCORE;
      const left = current[j - 1] + GAP_SCORE;
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

      current[j] = score;
      directions[i * width + j] = direction;
      if (score > bestScore) {
        bestScore = score;
        bestI = i;
        bestJ = j;
      }
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  const pairs: Array<{ lyricIndex: number; transcriptIndex: number }> = [];
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

function median(values: readonly number[], fallback: number) {
  const finite = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!finite.length) return fallback;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 === 0 ? (finite[middle - 1] + finite[middle]) / 2 : finite[middle];
}

function tokenKey(lineIndex: number, tokenIndex: number) {
  return `${lineIndex}:${tokenIndex}`;
}

function fillTokenStarts(
  tokens: readonly DisplayToken[],
  anchors: ReadonlyMap<string, TokenAnchor>,
  estimatedStep: number,
  previewEnd: number,
) {
  const starts = new Array<number | null>(tokens.length).fill(null);
  const anchoredIndexes: number[] = [];

  tokens.forEach((token, index) => {
    const anchor = anchors.get(tokenKey(token.lineIndex, token.tokenIndex));
    if (!anchor) return;
    starts[index] = anchor.start;
    anchoredIndexes.push(index);
  });

  if (!anchoredIndexes.length) return null;

  const first = anchoredIndexes[0];
  for (let index = first - 1; index >= 0; index -= 1) {
    starts[index] = Math.max(0, (starts[index + 1] as number) - estimatedStep);
  }

  for (let anchorPosition = 0; anchorPosition < anchoredIndexes.length - 1; anchorPosition += 1) {
    const leftIndex = anchoredIndexes[anchorPosition];
    const rightIndex = anchoredIndexes[anchorPosition + 1];
    const leftTime = starts[leftIndex] as number;
    const rightTime = starts[rightIndex] as number;
    const count = rightIndex - leftIndex;
    if (count <= 1) continue;
    for (let offset = 1; offset < count; offset += 1) {
      starts[leftIndex + offset] = leftTime + ((rightTime - leftTime) * offset) / count;
    }
  }

  const last = anchoredIndexes[anchoredIndexes.length - 1];
  for (let index = last + 1; index < starts.length; index += 1) {
    starts[index] = Math.min(previewEnd - MIN_TOKEN_DURATION, (starts[index - 1] as number) + estimatedStep);
  }

  let previous = -MIN_TOKEN_DURATION;
  for (let index = 0; index < starts.length; index += 1) {
    const remaining = starts.length - index - 1;
    const latest = Math.max(0, previewEnd - MIN_TOKEN_DURATION * (remaining + 1));
    const next = clamp(starts[index] ?? previous + estimatedStep, previous + MIN_TOKEN_DURATION, latest);
    starts[index] = next;
    previous = next;
  }

  return starts as number[];
}

export function alignTranscriptToLyrics(
  lyricsText: string,
  segments: readonly TranscriptSegmentTiming[],
  previewDuration?: number | null,
): LyricAutoAlignment | null {
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
    1,
  );

  const startLine = lyricUnits[firstLyricUnit].lineIndex;
  const endLine = lyricUnits[lastLyricUnit].lineIndex;
  const anchors = new Map<string, TokenAnchor>();
  for (const pair of pairs) {
    const lyric = lyricUnits[pair.lyricIndex];
    const transcript = transcriptUnits[pair.transcriptIndex];
    const key = tokenKey(lyric.lineIndex, lyric.tokenIndex);
    const existing = anchors.get(key);
    anchors.set(key, {
      start: existing ? Math.min(existing.start, transcript.start) : transcript.start,
      end: existing ? Math.max(existing.end, transcript.end) : transcript.end,
    });
  }

  const selectedTokens: DisplayToken[] = [];
  for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
    segmentLyricLine(lyricLines[lineIndex]).forEach((text, tokenIndex) => {
      selectedTokens.push({ text, lineIndex, tokenIndex });
    });
  }
  if (!selectedTokens.length) return null;

  const observedDiffs: number[] = [];
  for (let index = 1; index < transcriptUnits.length; index += 1) {
    const diff = transcriptUnits[index].start - transcriptUnits[index - 1].start;
    if (diff > 0.025 && diff < 0.8) observedDiffs.push(diff);
  }
  const observedDurations = transcriptUnits.map((unit) => unit.end - unit.start);
  const estimatedStep = clamp(
    median(observedDiffs, median(observedDurations, 0.16)),
    0.06,
    0.34,
  );
  const observedEnd = Math.max(...transcriptUnits.map((unit) => unit.end));
  const duration =
    typeof previewDuration === "number" && Number.isFinite(previewDuration) && previewDuration > 0
      ? previewDuration
      : Math.max(observedEnd + 0.4, 1);
  const starts = fillTokenStarts(selectedTokens, anchors, estimatedStep, duration);
  if (!starts) return null;

  const timedByLine = new Map<number, Array<{ text: string; at: number; end: number }>>();
  selectedTokens.forEach((token, index) => {
    const at = starts[index];
    const nextToken = selectedTokens[index + 1];
    const nextAt = starts[index + 1];
    const anchor = anchors.get(tokenKey(token.lineIndex, token.tokenIndex));
    const sameLine = nextToken?.lineIndex === token.lineIndex;
    const inferredEnd = sameLine && Number.isFinite(nextAt)
      ? nextAt
      : Math.min(duration, at + Math.min(0.9, Math.max(0.12, estimatedStep * 1.8)));
    const anchoredEnd = anchor?.end;
    const end = Math.min(
      duration,
      Math.max(at + MIN_TOKEN_DURATION, anchoredEnd && anchoredEnd > at ? anchoredEnd : inferredEnd),
    );
    const bucket = timedByLine.get(token.lineIndex) ?? [];
    bucket.push({ text: token.text, at: roundTime(at), end: roundTime(end) });
    timedByLine.set(token.lineIndex, bucket);
  });

  const lines: LyricLine[] = [];
  for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
    const tokens = timedByLine.get(lineIndex) ?? [];
    if (!tokens.length) continue;
    lines.push({
      text: lyricLines[lineIndex],
      at: tokens[0].at,
      end: tokens[tokens.length - 1].end,
      tokens,
    });
  }

  const transcript = segments
    .map((segment) => segment.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");

  return {
    lines: normalizeLyricLines(lines),
    confidence: Number(confidence.toFixed(3)),
    transcriptCoverage: Number(transcriptCoverage.toFixed(3)),
    lyricCoverage: Number(lyricCoverage.toFixed(3)),
    matchedCharacters: pairs.length,
    transcriptCharacters: transcriptUnits.length,
    matchedLineStart: startLine,
    matchedLineEnd: endLine,
    transcript,
  };
}
