import { alignTranscriptToLyrics, normalizeLyricLines, exportLrc, exportSrt, exportTtml, exportAss } from "../src/index.ts";
const $ = (id) => document.getElementById(id);
const state = {lines: [], transcript: [], url: null};
const audio = $("audio");
const fmtTime = n => Number.isFinite(n) ? n.toFixed(2)+"s" : "—";
const setStatus = text => $("status").textContent = text;
const byTime = n => (Number.isFinite(+n) ? +n : 0);
$("audioFile").addEventListener("change",e=>{
 const f=e.target.files?.[0]; if(!f)return;
 if(state.url)URL.revokeObjectURL(state.url);
 state.url=URL.createObjectURL(f);audio.src=state.url;
 setStatus("Audio loaded locally: "+f.name+". For ASR, supply its local path below.");
});
$("transcriptFile").addEventListener("change", async e => {
 const f=e.target.files?.[0];if(!f)return;
 try {const j=JSON.parse(await f.text()); state.transcript=Array.isArray(j)?j:j.segments; if(!Array.isArray(state.transcript))throw Error("Expected array");setStatus("Loaded "+state.transcript.length+" transcript segments");}
 catch(err){setStatus(String(err));}
});
$("transcribe").addEventListener("click", async ()=>{
 const audio_path=$("localPath").value.trim();
 if(!audio_path){setStatus("Provide an absolute path to an audio file on this machine.");return;}
 $("transcribe").disabled=true; setStatus("Transcribing locally; the model may need downloading on first use...");
 try {
  const r=await fetch("/api/transcribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({audio_path,model:$("model").value})});
  const j=await r.json();if(!r.ok)throw Error(j.error||r.statusText);
  state.transcript=j.segments;
  setStatus("Transcribed "+state.transcript.length+" segments ("+j.language+"); now align.");
 }catch(e){setStatus("ASR error: "+e.message);}
 finally{$("transcribe").disabled=false;}
});
$("align").addEventListener("click",()=>{
 const result=alignTranscriptToLyrics($("lyrics").value, state.transcript, audio.duration||undefined);
 if(!result){setStatus("Low similarity: cannot align. Check lyrics vs. audio transcript.");return;}
 state.lines=result.lines;
 render();setStatus("Aligned "+result.lines.length+" lines, confidence "+result.confidence+"; review timing before export.");
});
$("jsonImport").addEventListener("change",async e=>{
 try{const obj=JSON.parse(await e.target.files[0].text()); state.lines=normalizeLyricLines(Array.isArray(obj)?obj:obj.lines);render();setStatus("Imported timeline");}
 catch(e){setStatus(String(e));}
});
$("offset").addEventListener("click",()=>{
 const delta=Number($("delta").value);
 if(!Number.isFinite(delta))return;
 state.lines=state.lines.map(l=>({...l,at:Math.max(0,l.at+delta),end:l.end===undefined?undefined:Math.max(0,l.end+delta),tokens:l.tokens?.map(t=>({...t,at:Math.max(0,t.at+delta),end:Math.max(0,t.end+delta)}))}));
 render();
});
$("editor").addEventListener("change",e=>{
 const el=e.target, i=Number(el.dataset.i),t=el.dataset.token;
 if(!state.lines[i])return;
 const line=state.lines[i];
 if(t!==undefined){
  const token=line.tokens?.[Number(t)];if(!token)return;
  if(el.dataset.field==="text")token.text=el.value;
  else token[el.dataset.field]=Math.max(0,byTime(el.value));
 } else if(el.dataset.field==="text")line.text=el.value;
 else line[el.dataset.field]=Math.max(0,byTime(el.value));
 state.lines=normalizeLyricLines(state.lines);render();
});
$("download").addEventListener("click",()=>{
 if(!state.lines.length){setStatus("No timeline to export");return;}
 const format=$("format").value;
 const content=format==="lrc"?exportLrc(state.lines):format==="srt"?exportSrt(state.lines):format==="ttml"?exportTtml(state.lines):format==="ass"?exportAss(state.lines):JSON.stringify({lines:state.lines},null,2);
 const blob=new Blob([content],{type:"text/plain;charset=utf-8"});
 const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="lyricalign."+format;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
});
let lastIndex=-1;
audio.addEventListener("timeupdate",()=>{
 const t=audio.currentTime;
 const i=state.lines.findIndex(l=>t>=l.at&&t<(l.end??l.at+2));
 if(i!==lastIndex){document.querySelectorAll(".line").forEach((el,j)=>el.classList.toggle("active",j===i));lastIndex=i;}
 $("current").textContent=fmtTime(t);
});
function input(field,value,i, token=undefined){
 const inp=document.createElement("input");inp.value=value;inp.dataset.field=field;inp.dataset.i=i;
 if(token!==undefined)inp.dataset.token=token;
 if(field!=="text"){inp.type="number";inp.step="0.01";inp.min="0";}
 return inp;
}
function render(){
 const editor=$("editor");editor.replaceChildren();
 state.lines.forEach((l,i)=>{
  const line=document.createElement("div");line.className="line";const heading=document.createElement("div");heading.className="fields";
  const start=input("at",l.at,i),end=input("end",l.end??l.at+2,i),text=input("text",l.text,i);
  start.title="Line start";end.title="Line end";text.title="Lyric line";
  const jump=document.createElement("button");jump.textContent="▶";jump.addEventListener("click",()=>{audio.currentTime=l.at;audio.play().catch(()=>{});});
  heading.append(jump,start,end,text);line.append(heading);
  if(l.tokens?.length){
   const tokens=document.createElement("div");tokens.className="tokens";
   l.tokens.forEach((t,j)=>{const span=document.createElement("label");span.append(input("text",t.text,i,j),input("at",t.at,i,j),input("end",t.end,i,j));tokens.append(span);});
   line.append(tokens);
  }
  editor.append(line);
 });
 lastIndex=-1;
}
