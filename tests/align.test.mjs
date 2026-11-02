import fs from "node:fs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

function transpile(path, requireFn = require) {
  const source = fs.readFileSync(path, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("exports", "module", "require", js)(module.exports, module, requireFn);
  return module.exports;
}

const syncPath = new URL("../src/lyric-sync.ts", import.meta.url);
const sync = transpile(syncPath);
const alignPath = new URL("../src/align.ts", import.meta.url);
const align = transpile(alignPath, (id) => {
  if (id === "./lyric-sync.js") return sync;
  return require(id);
});

const { alignTranscriptToLyrics, normalizeLyricSourceText, segmentLyricLine } = align;

let passed = 0;
function test(name, run) {
  run();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

test("normalizes pasted lyrics without changing line order", () => {
  assert.equal(normalizeLyricSourceText(" 第一行  \n\n第二行 "), "第一行\n第二行");
});

test("keeps Chinese characters as draggable tokens", () => {
  assert.deepEqual(segmentLyricLine("我 爱你"), ["我 ", "爱", "你"]);
});

test("finds the preview section inside full lyrics", () => {
  const result = alignTranscriptToLyrics(
    "春风吹过\n我要回家\n今夜月光\n天亮以后",
    [
      { text: "我要回家", start: 1.2, end: 3.2 },
      { text: "今夜月光", start: 3.6, end: 5.6 },
    ],
    8,
  );
  assert.ok(result);
  assert.equal(result.matchedLineStart, 1);
  assert.equal(result.matchedLineEnd, 2);
  assert.deepEqual(result.lines.map((line) => line.text), ["我要回家", "今夜月光"]);
  assert.ok(result.lines.every((line) => line.tokens?.length === 4));
});

test("tolerates one recognition typo but preserves standard lyric text", () => {
  const result = alignTranscriptToLyrics(
    "春风吹过\n我要回家\n今夜月光\n天亮以后",
    [
      { text: "我要回夹", start: 1.1, end: 3.1 },
      { text: "今夜月光", start: 3.5, end: 5.5 },
    ],
    8,
  );
  assert.ok(result);
  assert.equal(result.lines[0].text, "我要回家");
  assert.ok(result.confidence > 0.45);
});

test("produces monotonic token timing suitable for dragging", () => {
  const result = alignTranscriptToLyrics(
    "A quick line\nAnother line",
    [{ text: "quick line another line", start: 2, end: 6 }],
    10,
  );
  assert.ok(result);
  const tokens = result.lines.flatMap((line) => line.tokens ?? []);
  for (let index = 1; index < tokens.length; index += 1) {
    assert.ok(tokens[index].at >= tokens[index - 1].at);
    assert.ok(tokens[index].end > tokens[index].at);
  }
});

test("rejects unrelated transcript instead of fabricating a timeline", () => {
  const result = alignTranscriptToLyrics(
    "完全不同的歌词内容\n第二句也不同",
    [{ text: "abcdefg xyz", start: 0, end: 4 }],
    6,
  );
  assert.equal(result, null);
});

console.log(`music lyric auto alignment regression: ${passed}/${passed} passed`);
