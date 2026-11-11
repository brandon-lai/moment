// The frame every generated page is written into. Moment writes the head
// (fonts, palette, layout, base CSS) itself, so the visual style is chosen by
// code, and so the iframe paints the right colors on its very first bytes.
// The model only ever writes <section> markup and the scripts for it.

import type { ArtDirection, Palette } from "./types";
import { fontsHref } from "./art";
import { escapeHtml } from "./util";

export const LIBS: Record<string, string> = {
  anime: "https://cdnjs.cloudflare.com/ajax/libs/animejs/3.2.2/anime.min.js",
  d3: "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js",
  three: "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
};

export interface DocConfig {
  title: string;
  art: ArtDirection;
  dark: Palette | null;
  liveBase: string;       // e.g. https://render.example/live/<cell token>
  eu: boolean;
  tz: string;
  place: string;
  label: string;          // "earlier guess" banner text, if any
}

function vars(p: Palette): string {
  return `--bg:${p.bg};--fg:${p.fg};--muted:${p.muted};--accent:${p.accent};--accent-2:${p.accent2};--surface:${p.surface};--line:${p.line};color-scheme:${p.scheme};`;
}

export function baseCss(c: DocConfig): string {
  const a = c.art;
  const dw = Math.max(...a.font.displayWeights);
  const size = a.density === "dense" ? 15 : a.density === "airy" ? 18 : 16.5;
  const gap = a.density === "dense" ? 0.7 : a.density === "airy" ? 1.35 : 1;
  const serifish = /serif|slab/.test(a.font.tags.join(" ")) ? "serif" : "sans-serif";
  return `:root{${vars(a.palette)}--font-display:'${a.font.display}',${serifish};--font-body:'${a.font.body}',system-ui,sans-serif;--font-mono:'${a.font.mono}',ui-monospace,monospace;--radius:${a.radius}px;--gap:${gap}}
${c.dark ? `@media (prefers-color-scheme:dark){:root{${vars(c.dark)}}}` : ""}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font-body);font-size:${size}px;line-height:1.55;overflow-wrap:break-word;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{font-family:var(--font-display);font-weight:${dw};line-height:1.05;letter-spacing:-.01em;margin:0 0 calc(.5em*var(--gap));text-wrap:balance}
h1{font-size:clamp(30px,min(6.4vw,11cqi),84px)}h2{font-size:clamp(22px,min(3.6vw,8cqi),44px)}h3{font-size:clamp(18px,2.2vw,24px)}
p{margin:0 0 calc(1em*var(--gap));max-width:68ch;text-wrap:pretty}
a{color:var(--accent);text-underline-offset:.18em}
button{font:inherit;color:var(--fg);background:transparent;border:1px solid var(--fg);border-radius:var(--radius);padding:.55em 1em;cursor:pointer}
button:hover{background:var(--fg);color:var(--bg)}
button:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
input[type=range]{accent-color:var(--accent);width:100%}
table{border-collapse:collapse;width:100%}td,th{padding:.45em .6em;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.85em}
svg{max-width:100%;height:auto}canvas{max-width:100%;display:block}
img{max-width:100%}
.m-kicker{font-family:var(--font-mono);font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 .9em}
.m-big{font-family:var(--font-display);font-size:clamp(44px,16cqi,170px);line-height:.88;letter-spacing:-.03em;font-weight:${dw}}
.m-lead{font-size:1.25em;line-height:1.4;max-width:40ch}
.m-muted{color:var(--muted)}.m-accent{color:var(--accent)}.m-accent-2{color:var(--accent-2)}
.m-mono{font-family:var(--font-mono)}
.m-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:calc(16px*var(--gap))}
.m-row{display:flex;flex-wrap:wrap;gap:calc(12px*var(--gap));align-items:baseline}
.m-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:calc(18px*var(--gap))}
.m-stat{display:flex;flex-direction:column;gap:.2em}.m-stat b{font-family:var(--font-display);font-size:clamp(26px,7cqi,52px);line-height:1;font-weight:${dw}}
.m-rule{border:0;border-top:1px solid var(--line);margin:calc(24px*var(--gap)) 0}
.m-chip{display:inline-block;font-family:var(--font-mono);font-size:.78rem;padding:.25em .6em;border:1px solid var(--line);border-radius:999px;color:var(--muted)}
.m-list{list-style:none;padding:0;margin:0}.m-list li{padding:.6em 0;border-bottom:1px solid var(--line)}
.m-bars{display:flex;align-items:flex-end;gap:3px;height:120px}.m-bars i{flex:1;background:var(--accent);border-radius:2px 2px 0 0;min-height:2px}
main>section{scroll-margin-top:16px;container-type:inline-size}
${a.motion !== "still" ? `main>section{animation:m-in ${a.motion === "lively" ? ".5s" : ".9s"} cubic-bezier(.2,.7,.2,1) both}@keyframes m-in{from{opacity:0;transform:translateY(${a.motion === "lively" ? 18 : 8}px)}}` : ""}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
#m-building{position:fixed;left:12px;bottom:12px;font-family:var(--font-mono);font-size:12px;color:var(--muted);background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:6px 12px;z-index:5}
#m-building::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:1px;animation:m-pulse 1.2s ease-in-out infinite}
@keyframes m-pulse{50%{opacity:.25}}
.m-earlier{font-family:var(--font-mono);font-size:12px;color:var(--muted);padding:10px 16px;border-bottom:1px solid var(--line)}
${a.layout.css}`;
}

// The trusted reporter. Written by Moment, never by the model: it measures
// how the visitor uses the page (scroll speed, which section is on screen,
// hovers, taps, idle time) and posts it to the shell, which is the only thing
// allowed to talk to Moment's servers. In EU mode it reports only reaching
// the bottom, which stays in the browser and opens the feedback prompt.
function reporter(eu: boolean): string {
  return `(()=>{const EU=${eu};let lastY=scrollY,lastT=performance.now(),speed=0,taps=0,idle=0,lastAct=performance.now(),hov=new Set(),bottom=false;
const desc=e=>{const el=e.closest&&e.closest('[data-m],button,a,svg,canvas,table,li,figure,h2,h3');if(!el)return null;return(el.getAttribute('data-m')||el.tagName.toLowerCase()+(el.className&&typeof el.className==='string'?'.'+el.className.split(' ')[0]:'')).slice(0,40)};
const act=()=>{lastAct=performance.now()};
addEventListener('scroll',()=>{const t=performance.now(),dy=Math.abs(scrollY-lastY);speed=.7*speed+.3*(dy/Math.max(16,t-lastT)*1000);lastY=scrollY;lastT=t;act();const b=innerHeight+scrollY>=document.documentElement.scrollHeight-40;if(b&&!bottom){bottom=true;parent.postMessage({type:'moment:bottom'},'*')}},{passive:true});
addEventListener('pointerover',e=>{if(EU)return;const d=desc(e.target);if(d&&hov.size<12)hov.add(d)},{passive:true});
addEventListener('pointerdown',()=>{taps++;act()},{passive:true});addEventListener('keydown',act);
const onScreen=()=>{let best=null,area=0;for(const s of document.querySelectorAll('main>section')){const r=s.getBoundingClientRect(),v=Math.max(0,Math.min(innerHeight,r.bottom)-Math.max(0,r.top));if(v>area){area=v;best=s.id||null}}return best};
setInterval(()=>{idle=performance.now()-lastAct;if(EU)return;parent.postMessage({type:'moment:interaction',section:onScreen(),scrollSpeed:Math.round(speed),hovered:[...hov],taps,idleMs:Math.round(idle),atBottom:bottom},'*');hov.clear();speed*=.5},2000);
})();`;
}

export function docHead(c: DocConfig): string {
  const a = c.art;
  const cfg = { live: c.liveBase, tz: c.tz, place: c.place, eu: c.eu };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(c.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fontsHref(a.font)}">
<style>${baseCss(c)}</style>
<script>window.MOMENT=${JSON.stringify(cfg)};${reporter(c.eu)}</script>
</head><body class="layout-${a.layout.id} motion-${a.motion} density-${a.density}">
${c.label ? `<div class="m-earlier">${escapeHtml(c.label)}</div>` : ""}<div id="m-building" role="status">Writing this page</div>
<main>
`;
}

export function docTail(libs: string[], scripts: string[]): string {
  const libTags = libs.filter((l) => LIBS[l]).map((l) => `<script src="${LIBS[l]}"></script>`).join("\n");
  const body = scripts
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<script>(()=>{try{\n${s.replace(/<\/script/gi, "<\\/script")}\n}catch(e){console.error('moment section script',e)}})();</script>`)
    .join("\n");
  return `</main>
<style>#m-building{display:none}</style>
${libTags}
${body}
<script>parent.postMessage({type:'moment:complete'},'*')</script>
</body></html>`;
}

export function fallbackPage(message: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moment</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f0e9;color:#1b1a17;font:17px/1.5 ui-serif,Georgia,serif;padding:24px}
@media(prefers-color-scheme:dark){body{background:#121212;color:#ece8e1}}p{max-width:30ch}</style></head>
<body><main><p>${escapeHtml(message)}</p></main><script>parent.postMessage({type:'moment:complete'},'*')</script></body></html>`;
}

