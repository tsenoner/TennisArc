// Build an interactive computed-vs-retrieved Elo scatter from the board replay.
//   computed  = our reproduction = replay board(prev) + window matches forward to board(cur)
//   retrieved = TA's actual published board(cur)
// One point per listed player; hover shows name + computed + retrieved + discrepancy. Tour + transition
// selectors. Self-contained HTML (no deps) at ingest/elo-reverse/elo-scatter.html (gitignored).
//   npx tsx ingest/elo-reverse/scatter.ts   (or `pnpm elo:scatter` to build + open)
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadBoards, loadMatches, nameIndex, windowMatches, fullKey, dayNum, keepForElo } from "./lib";

const SEED = 1200, N_TRANSITIONS = 8;
const winP = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));
const kOf = (n: number) => 250 / (n + 5) ** 0.4;

interface Pt { name: string; ret: number; comp: number; d: number; m: number; status: "played" | "idle" | "new" }
interface Trans { date: number; prevDate: number; gap: number; pts: Pt[]; stats: Record<string, number> }

function buildTour(tour: "ATP" | "WTA"): Trans[] {
  const boards = loadBoards()[tour];
  const all = loadMatches(tour, 2010);
  const { keyToId } = nameIndex(all);
  const matches = all.filter(keepForElo);
  const boardIds = boards.map((b) => new Map(b.players.map((p) => [keyToId.get(fullKey(p.name)) ?? "", p] as const).filter(([id]) => id)));
  const cd = new Map<string, number[]>();
  for (const m of matches) for (const id of [m.winnerId, m.loserId]) { const a = cd.get(id) ?? []; a.push(m.date); cd.set(id, a); }
  const prior = (id: string, b: number) => { const a = cd.get(id); if (!a) return 0; let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < b) lo = mid + 1; else hi = mid; } return lo; };

  const latest = new Map<string, number>();
  const out: Trans[] = [];
  for (let i = 0; i < boards.length; i++) {
    const prev = i > 0 ? boards[i - 1] : null, cur = boards[i];
    if (prev) {
      const gap = dayNum(cur.lastUpdate) - dayNum(prev.lastUpdate);
      if (gap <= 45) {
        const win = windowMatches(matches, prev.lastUpdate, cur.lastUpdate);
        const st = new Map<string, { ov: number; n: number }>();
        const mcount = new Map<string, number>();
        const get = (id: string) => { let s = st.get(id); if (!s) { s = { ov: latest.get(id) ?? SEED, n: prior(id, prev.lastUpdate) }; st.set(id, s); } return s; };
        for (const m of win) {
          const w = get(m.winnerId), l = get(m.loserId);
          const e = winP(w.ov, l.ov);
          w.ov += kOf(w.n) * (1 - e); l.ov += kOf(l.n) * (-(1 - e)); w.n++; l.n++;
          mcount.set(m.winnerId, (mcount.get(m.winnerId) ?? 0) + 1); mcount.set(m.loserId, (mcount.get(m.loserId) ?? 0) + 1);
        }
        const pts: Pt[] = [];
        for (const [id, p] of boardIds[i]) {
          const had = latest.has(id);
          const comp = st.get(id)?.ov ?? latest.get(id) ?? SEED;
          const status: Pt["status"] = !had ? "new" : (st.has(id) ? "played" : "idle");
          pts.push({ name: p.name, ret: round1(p.overall), comp: round1(comp), d: round1(comp - p.overall), m: mcount.get(id) ?? 0, status });
        }
        // exclude recompute-boundary transitions (idle players shifted en masse)
        const idleD = pts.filter((p) => p.status === "idle").map((p) => p.d).sort((a, b) => a - b);
        const boundary = idleD.length >= 5 && Math.abs(idleD[idleD.length >> 1]) > 25;
        if (!boundary && pts.length) {
          const scored = pts.filter((p) => p.status !== "new");
          const abs = scored.map((p) => Math.abs(p.d)).sort((a, b) => a - b);
          out.push({
            date: cur.lastUpdate, prevDate: prev.lastUpdate, gap, pts,
            stats: {
              n: scored.length, exact: abs.filter((x) => x <= 0.1).length, medAbs: round1(abs[abs.length >> 1] ?? 0),
              w5: Math.round(100 * abs.filter((x) => x <= 5).length / abs.length),
              w10: Math.round(100 * abs.filter((x) => x <= 10).length / abs.length), debuts: pts.length - scored.length,
            },
          });
        }
      }
    }
    for (const [id, p] of boardIds[i]) latest.set(id, p.overall);
  }
  return out.slice(-N_TRANSITIONS).reverse();
}
const round1 = (x: number) => Math.round(x * 10) / 10;

const data = { ATP: buildTour("ATP"), WTA: buildTour("WTA") };
// yElo datasets (computed via the season-reset / real-opponent model, ingest/elo-reverse/yelo-fit.ts --scatter)
const ydata: Record<string, unknown> = { ATP: [], WTA: [] };
for (const t of ["ATP", "WTA"] as const) {
  const p = resolve(process.cwd(), `ingest/elo-reverse/yelo-scatter-${t}.json`);
  if (existsSync(p)) ydata[t] = JSON.parse(readFileSync(p, "utf8"));
}
const OUT = resolve(process.cwd(), "ingest/elo-reverse/elo-scatter.html");
writeFileSync(OUT, html(JSON.stringify(data), JSON.stringify(ydata)));
console.log(`wrote ${OUT}`);
for (const t of ["ATP", "WTA"] as const) {
  const latestT = data[t][0];
  console.log(`${t} Elo latest transition ${latestT.prevDate}->${latestT.date}: n=${latestT.stats.n} medAbs=${latestT.stats.medAbs} exact=${latestT.stats.exact} within±5=${latestT.stats.w5}%`);
  const yl = (ydata[t] as { date: number; stats: { n: number; medAbs: number; w5: number } }[])[0];
  if (yl) console.log(`${t} yElo latest board ${yl.date}: n=${yl.stats.n} medAbs=${yl.stats.medAbs} within±5=${yl.stats.w5}%`);
}

function html(json: string, yjson: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TennisArc Elo — computed vs retrieved</title>
<style>
  :root{--bg:#0f1115;--panel:#181b22;--ink:#e8eaed;--mut:#9aa0aa;--grid:#2a2e37;--diag:#4a5160;--accent:#5db0ff}
  *{box-sizing:border-box} html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  header{padding:16px 20px 6px} h1{font-size:17px;margin:0 0 2px} .sub{color:var(--mut);font-size:12.5px}
  .controls{display:flex;gap:18px;align-items:center;flex-wrap:wrap;padding:10px 20px}
  .controls label{color:var(--mut);font-size:12px;margin-right:6px}
  .seg{display:inline-flex;border:1px solid var(--grid);border-radius:7px;overflow:hidden}
  .seg button{background:var(--panel);color:var(--ink);border:0;padding:6px 14px;cursor:pointer;font:inherit}
  .seg button[aria-pressed=true]{background:var(--accent);color:#06121f;font-weight:600}
  select{background:var(--panel);color:var(--ink);border:1px solid var(--grid);border-radius:7px;padding:6px 10px;font:inherit}
  .stats{padding:2px 20px 10px;color:var(--mut);font-size:12.5px} .stats b{color:var(--ink)}
  .wrap{padding:0 12px 24px} svg{width:100%;height:auto;display:block;max-width:1100px;margin:0 auto}
  .pt{cursor:pointer} .pt:hover{stroke:#fff;stroke-width:1.5}
  #tip{position:fixed;pointer-events:none;background:#0b0d11ee;border:1px solid var(--grid);border-radius:8px;padding:8px 10px;font-size:12.5px;opacity:0;transition:opacity .08s;max-width:260px;z-index:9}
  #tip .nm{font-weight:600;margin-bottom:3px} #tip .row{color:var(--mut)} #tip .d{font-weight:600}
  .legend{display:flex;gap:14px;align-items:center;color:var(--mut);font-size:12px;padding:0 20px 14px;flex-wrap:wrap}
  .chip{display:inline-flex;align-items:center;gap:5px} .dot{width:10px;height:10px;border-radius:50%}
</style></head><body>
<header><h1>TennisArc Elo / yElo — computed vs retrieved</h1>
<div class="sub" id="subtitle"></div></header>
<div class="controls">
  <span><label>Rating</label><span class="seg" id="mode"><button data-m="elo" aria-pressed="true">Elo</button><button data-m="yelo">yElo (season)</button></span></span>
  <span><label>Tour</label><span class="seg" id="tour"><button data-t="ATP" aria-pressed="true">ATP</button><button data-t="WTA">WTA</button></span></span>
  <span><label id="translabel">Transition</label><select id="trans"></select></span>
  <span><label>Show</label><span class="seg" id="filter"><button data-f="scored" aria-pressed="true">matched</button><button data-f="all">+ unmatched</button></span></span>
</div>
<div class="stats" id="stats"></div>
<div class="legend">
  <span class="chip"><span class="dot" style="background:#3fbf6f"></span>|Δ|≤2</span>
  <span class="chip"><span class="dot" style="background:#e0c341"></span>≤10</span>
  <span class="chip"><span class="dot" style="background:#e8843c"></span>≤30</span>
  <span class="chip"><span class="dot" style="background:#e0524a"></span>&gt;30</span>
  <span class="chip"><span class="dot" style="background:#7d6cff"></span>debut (Elo) / W/L≠TA (yElo)</span>
</div>
<div class="wrap"><svg id="plot" viewBox="0 0 1100 760" preserveAspectRatio="xMidYMid meet"></svg></div>
<div id="tip"></div>
<script>
const DATA = ${json};
const YDATA = ${yjson};
let mode="elo", tour="ATP", ti=0, filter="scored";
const NS="http://www.w3.org/2000/svg";
const tip=document.getElementById("tip"), plot=document.getElementById("plot");
const cur=()=> (mode==="elo"?DATA:YDATA)[tour] || [];
const hidden=p=> mode==="elo" ? p.status==="new" : p.status==="wl"; // elo: debuts; yelo: W/L-mismatch
function colour(p){ if(hidden(p)) return "#7d6cff"; const a=Math.abs(p.d); return a<=2?"#3fbf6f":a<=10?"#e0c341":a<=30?"#e8843c":"#e0524a"; }
function fmtDate(d){const s=String(d);return s.slice(0,4)+"-"+s.slice(4,6)+"-"+s.slice(6,8);}
function transList(){const sel=document.getElementById("trans");sel.innerHTML="";cur().forEach((t,i)=>{const o=document.createElement("option");o.value=i;const lbl=mode==="elo"?(fmtDate(t.prevDate)+" → "+fmtDate(t.date)):("season "+String(t.date).slice(0,4)+" → "+fmtDate(t.date));o.textContent=lbl+"  (med|Δ| "+t.stats.medAbs+")";sel.appendChild(o);});sel.value=ti;
  document.getElementById("translabel").textContent = mode==="elo"?"Transition (prev → board)":"Season board (Jan 1 → board)";
  document.getElementById("subtitle").innerHTML = mode==="elo"
    ? "computed = board-replay (TA board[prev] + window matches → board[cur]) · retrieved = TA's published board[cur]. Diagonal = exact."
    : "computed = season-reset yElo (every player reset to 1500 on Jan 1, replayed vs opponents' REAL Elo) · retrieved = TA's published yElo board. Diagonal = exact. Purple = our match-count (W/L) differs from TA's (latest-event boundary), so its Δ is not a rating error.";}
function el(tag,attrs,text){const n=document.createElementNS(NS,tag);for(const k in attrs)n.setAttribute(k,attrs[k]);if(text!=null)n.textContent=text;plot.appendChild(n);return n;}
function draw(){
  const t=cur()[ti]; if(!t){plot.innerHTML="";return;} const pts=t.pts.filter(p=>filter==="all"||!hidden(p));
  const W=1100,H=760,m={l:64,r:22,t:18,b:54};
  const vals=pts.flatMap(p=>[p.ret,p.comp]); let lo=Math.min(...vals),hi=Math.max(...vals);
  const pad=(hi-lo)*0.04||10; lo-=pad; hi+=pad;
  const sx=v=>m.l+(v-lo)/(hi-lo)*(W-m.l-m.r), sy=v=>H-m.b-(v-lo)/(hi-lo)*(H-m.t-m.b);
  while(plot.firstChild)plot.removeChild(plot.firstChild);
  // plot frame
  el("rect",{x:m.l,y:m.t,width:W-m.l-m.r,height:H-m.t-m.b,fill:"none",stroke:"#333845","stroke-width":1});
  // gridlines + ticks
  const step=(hi-lo)>900?200:100; const t0=Math.ceil(lo/step)*step;
  for(let v=t0;v<=hi;v+=step){const x=sx(v),y=sy(v);
    el("line",{x1:x,y1:m.t,x2:x,y2:H-m.b,stroke:"#2f343d","stroke-width":1});
    el("line",{x1:m.l,y1:y,x2:W-m.r,y2:y,stroke:"#2f343d","stroke-width":1});
    el("text",{x:x,y:H-m.b+18,fill:"#9aa0aa","font-size":11.5,"text-anchor":"middle"},v);
    el("text",{x:m.l-9,y:y+4,fill:"#9aa0aa","font-size":11.5,"text-anchor":"end"},v);
  }
  // diagonal y=x (perfect reproduction)
  el("line",{x1:sx(lo),y1:sy(lo),x2:sx(hi),y2:sy(hi),stroke:"#6b7380","stroke-width":1.6,"stroke-dasharray":"6 5"});
  // axis titles
  el("text",{x:m.l+(W-m.l-m.r)/2,y:H-14,fill:"#e8eaed","font-size":13,"text-anchor":"middle"},mode==="elo"?"retrieved — TA published Elo":"retrieved — TA published yElo");
  el("text",{transform:"translate(18,"+(m.t+(H-m.t-m.b)/2)+") rotate(-90)",fill:"#e8eaed","font-size":13,"text-anchor":"middle"},mode==="elo"?"computed — board replay":"computed — season-reset yElo");
  // points (sorted so big residuals draw on top)
  pts.slice().sort((a,b)=>Math.abs(a.d)-Math.abs(b.d)).forEach(p=>{
    const c=document.createElementNS(NS,"circle");
    c.setAttribute("cx",sx(p.ret));c.setAttribute("cy",sy(p.comp));c.setAttribute("r",hidden(p)?3.2:3.7);
    c.setAttribute("fill",colour(p));c.setAttribute("fill-opacity","0.85");c.setAttribute("class","pt");
    const tag = mode==="elo" ? (p.status==="new"?' · debut':'') : (p.status==="wl"?' · W/L≠TA':'');
    const span = mode==="elo" ? ' this window' : ' this season';
    c.addEventListener("mousemove",e=>{tip.style.opacity=1;tip.style.left=Math.min(e.clientX+14,innerWidth-270)+"px";tip.style.top=(e.clientY+14)+"px";
      tip.innerHTML='<div class="nm">'+p.name+tag+'</div>'+
        '<div class="row">retrieved (TA): <b style="color:var(--ink)">'+p.ret+'</b></div>'+
        '<div class="row">computed: <b style="color:var(--ink)">'+p.comp+'</b></div>'+
        '<div class="d" style="color:'+colour(p)+'">discrepancy: '+(p.d>0?'+':'')+p.d+'</div>'+
        '<div class="row">'+p.m+' match'+(p.m===1?'':'es')+span+' · '+p.status+'</div>';});
    c.addEventListener("mouseleave",()=>tip.style.opacity=0);
    plot.appendChild(c);
  });
  const st=t.stats;
  const tail = mode==="elo" ? st.debuts+' debuts (seeded, "+ debuts")' : st.debuts+' W/L≠TA (latest-event boundary, "+ unmatched")';
  const noun = mode==="elo" ? "established players" : "W/L-matched players";
  document.getElementById("stats").innerHTML='<b>'+st.n+'</b> '+noun+' · median |Δ| <b>'+st.medAbs+'</b> Elo · within ±5 <b>'+st.w5+'%</b> · within ±10 <b>'+st.w10+'%</b> · byte-exact (|Δ|≤0.1) <b>'+st.exact+'</b> · '+tail;
}
document.getElementById("mode").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;mode=b.dataset.m;ti=0;[...e.currentTarget.children].forEach(x=>x.setAttribute("aria-pressed",x===b));transList();draw();});
document.getElementById("tour").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;tour=b.dataset.t;ti=0;[...e.currentTarget.children].forEach(x=>x.setAttribute("aria-pressed",x===b));transList();draw();});
document.getElementById("filter").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;filter=b.dataset.f;[...e.currentTarget.children].forEach(x=>x.setAttribute("aria-pressed",x===b));draw();});
document.getElementById("trans").addEventListener("change",e=>{ti=+e.target.value;draw();});
transList();draw();
</script></body></html>`;
}
