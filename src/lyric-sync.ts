export type LyricToken = { at: number; end: number; text: string };
export type LyricLine = {
  at: number;
  end?: number;
  text: string;
  tokens?: LyricToken[];
};
export type TimedLyricLine = { time: number; text: string };
export type LyricPosition = {
  activeIndex: number;
  previousIndex: number;
  nextIndex: number;
  inInstrumentalGap: boolean;
};

export const LYRIC_SYNC_EPSILON_SECONDS = 0.05;
export const LYRIC_MAX_HOLD_SECONDS = 9;

function cleanLyricText(input: unknown) {
  return typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
}

function cleanLyricTokenText(input: unknown) {
  if (typeof input !== "string") return "";
  const normalized = input.replace(/\s+/g, " ");
  return normalized.trim() ? normalized : "";
}

function normalizeLyricTokens(input: readonly LyricToken[] | undefined) {
  if (!input?.length) return undefined;
  const tokens = input
    .map((token, sourceIndex) => ({
      at: Number(token?.at),
      end: Number(token?.end),
      text: cleanLyricTokenText(token?.text),
      sourceIndex,
    }))
    .filter(
      (token) =>
        Number.isFinite(token.at) &&
        Number.isFinite(token.end) &&
        token.at >= 0 &&
        token.end >= token.at &&
        Boolean(token.text.trim()),
    )
    .sort((a, b) => a.at - b.at || a.sourceIndex - b.sourceIndex)
    .map((token) => ({
      at: Number(token.at.toFixed(3)),
      end: Number(token.end.toFixed(3)),
      text: token.text,
    }));
  return tokens.length ? tokens : undefined;
}

export function normalizeLyricLines(input: readonly LyricLine[]) {
  const normalized = input
    .map((line, sourceIndex) => {
      const at = Number(line?.at);
      const rawEnd = Number(line?.end);
      const end = Number.isFinite(rawEnd) && rawEnd >= at ? Number(rawEnd.toFixed(3)) : undefined;
      return {
        at,
        end,
        text: cleanLyricText(line?.text),
        tokens: normalizeLyricTokens(line?.tokens),
        sourceIndex,
      };
    })
    .filter((line) => Number.isFinite(line.at) && line.at >= 0 && Boolean(line.text))
    .sort((a, b) => a.at - b.at || a.sourceIndex - b.sourceIndex);

  const seen = new Set<string>();
  const result: LyricLine[] = [];
  for (const line of normalized) {
    const key = `${line.at.toFixed(3)}\u0000${line.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      at: Number(line.at.toFixed(3)),
      ...(line.end === undefined ? {} : { end: line.end }),
      text: line.text,
      ...(line.tokens ? { tokens: line.tokens } : {}),
    });
  }
  return result;
}

export function parseLrc(input: string) {
  const lines: TimedLyricLine[] = [];
  const timestampPattern = /\[(\d{1,3}):(\d{2}(?:\.\d+)?)\]/g;

  for (const rawLine of input.split(/\r?\n/)) {
    const matches = [...rawLine.matchAll(timestampPattern)];
    if (matches.length === 0) continue;

    const text = cleanLyricText(rawLine.replace(timestampPattern, ""));
    if (!text) continue;

    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (
        !Number.isFinite(minutes) ||
        !Number.isFinite(seconds) ||
        minutes < 0 ||
        seconds < 0 ||
        seconds >= 60
      ) {
        continue;
      }
      const time = minutes * 60 + seconds;
      if (Number.isFinite(time) && time >= 0) lines.push({ time, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

export function buildPreviewTimeline(
  lines: readonly TimedLyricLine[],
  previewStart: number,
  previewWindowSeconds: number,
  transformText: (text: string) => string = (text) => text,
) {
  if (lines.length === 0) return [];
  const safeStart = Number.isFinite(previewStart) ? Math.max(0, previewStart) : 0;
  const safeWindow = Number.isFinite(previewWindowSeconds)
    ? Math.max(0, previewWindowSeconds)
    : 0;

  let startIndex = lines.findIndex((line) => line.time > safeStart);
  if (startIndex === -1) startIndex = lines.length;
  startIndex = Math.max(0, startIndex - 1);

  return normalizeLyricLines(
    lines
      .slice(startIndex)
      .filter((line) => Number.isFinite(line.time) && line.time <= safeStart + safeWindow)
      .map((line) => ({
        at: Math.max(0, Number((line.time - safeStart).toFixed(3))),
        text: cleanLyricText(transformText(line.text)),
      })),
  );
}

export function normalizePlainLyrics(
  input: string | null | undefined,
  transformText: (text: string) => string = (text) => text,
  maxLines = 120,
) {
  if (!input) return "";
  return input
    .split(/\r?\n/)
    .map((line) => cleanLyricText(transformText(line)))
    .filter(Boolean)
    .slice(0, maxLines)
    .join("\n");
}

function findLastLineAtOrBefore(lines: readonly LyricLine[], playbackTime: number) {
  let low = 0;
  let high = lines.length - 1;
  let found = -1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].at <= playbackTime) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

export function locateLyricPosition(
  lines: readonly LyricLine[],
  currentTime: number,
  maxHoldSeconds = LYRIC_MAX_HOLD_SECONDS,
): LyricPosition {
  if (lines.length === 0) {
    return { activeIndex: -1, previousIndex: -1, nextIndex: -1, inInstrumentalGap: false };
  }

  const safeTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  const playbackTime = safeTime + LYRIC_SYNC_EPSILON_SECONDS;
  const rawIndex = findLastLineAtOrBefore(lines, playbackTime);

  if (rawIndex < 0) {
    return { activeIndex: -1, previousIndex: -1, nextIndex: 0, inInstrumentalGap: false };
  }

  const current = lines[rawIndex];
  const nextIndex = rawIndex + 1 < lines.length ? rawIndex + 1 : -1;
  const next = nextIndex >= 0 ? lines[nextIndex] : null;
  const explicitEnd = Number(current.end);
  if (Number.isFinite(explicitEnd) && explicitEnd >= current.at && playbackTime > explicitEnd) {
    return { activeIndex: -1, previousIndex: rawIndex, nextIndex, inInstrumentalGap: true };
  }

  const hold = Number.isFinite(maxHoldSeconds)
    ? Math.max(0, maxHoldSeconds)
    : LYRIC_MAX_HOLD_SECONDS;
  const gapIsLong = !next || next.at - current.at > hold;
  const expired = gapIsLong && playbackTime - current.at > hold;

  if (expired) {
    return { activeIndex: -1, previousIndex: rawIndex, nextIndex, inInstrumentalGap: true };
  }

  return {
    activeIndex: rawIndex,
    previousIndex: rawIndex > 0 ? rawIndex - 1 : -1,
    nextIndex,
    inInstrumentalGap: false,
  };
}
