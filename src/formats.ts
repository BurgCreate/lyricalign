import type { LyricLine } from "./lyric-sync.js";

const time = (n: number, decimals = 2) => {
  const t = Math.max(0, Number.isFinite(n) ? n : 0);
  const m = Math.floor(t / 60);
  const s = (t - m * 60).toFixed(decimals).padStart(3 + decimals, "0");
  return { m, s };
};
export function exportLrc(lines: readonly LyricLine[]): string {
  return lines.map(line => {
    const t = time(line.at);
    return `[${String(t.m).padStart(2, "0")}:${t.s}]${line.text}`;
  }).join("\n") + "\n";
}
function stamp(n: number, sep: string, digits = 3): string {
  const t = Math.max(0, n), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60);
  const s = (t % 60).toFixed(digits).padStart(3 + digits, "0");
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${s.replace(".", sep)}`;
}
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function exportSrt(lines: readonly LyricLine[]): string {
  return lines.map((line, i) => `${i+1}\n${stamp(line.at, ",")} --> ${stamp(Math.max(line.at+.05, line.end ?? line.at+2), ",")}\n${line.text}\n`).join("\n");
}
export function exportTtml(lines: readonly LyricLine[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml"><body><div>\n${lines.map(line => {
    const tokens = line.tokens?.length ? line.tokens.map(token => `<span begin="${stamp(token.at, ".")}" end="${stamp(token.end, ".")}">${escapeXml(token.text)}</span>`).join("") : escapeXml(line.text);
    return `<p begin="${stamp(line.at, ".")}" end="${stamp(Math.max(line.at + .05, line.end ?? line.at + 2), ".")}">${tokens}</p>`;
  }).join("\n")}\n</div></body></tt>\n`;
}
export function exportAss(lines: readonly LyricLine[]): string {
  const assTime = (n: number) => {
    const h = Math.floor(n / 3600), m = Math.floor(n % 3600 / 60), s = (n % 60).toFixed(2).padStart(5,"0");
    return `${h}:${String(m).padStart(2,"0")}:${s}`;
  };
  const esc = (s: string) => s.replace(/\\/g,"\\\\").replace(/[{}]/g,"").replace(/\n/g," ");
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
  return header + lines.map(l => {
    const lyric = l.tokens?.length ? l.tokens.map(t => `{\\k${Math.max(1,Math.round((t.end-t.at)*100))}}${esc(t.text)}`).join("") : esc(l.text);
    return `Dialogue: 0,${assTime(l.at)},${assTime(Math.max(l.at+.05,l.end??l.at+2))},Default,,0,0,0,,${lyric}`;
  }).join("\n") + "\n";
}
