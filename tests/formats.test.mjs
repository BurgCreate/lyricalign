import assert from "node:assert/strict";
import { exportLrc, exportSrt, exportTtml, exportAss } from "../dist/formats.js";
const lines=[{text:"Hello & 世界",at:1.2,end:3.2,tokens:[{text:"Hi",at:1.2,end:2}]}];
assert.match(exportLrc(lines), /\[00:01\.20\]/);
assert.match(exportSrt(lines), /00:00:01,200 --> 00:00:03,200/);
assert.match(exportTtml(lines), /<span begin="00:00:01\.200"/);
assert.match(exportAss(lines), /Dialogue: 0,0:00:01\.20/);
console.log("ok - 4 export format tests");
