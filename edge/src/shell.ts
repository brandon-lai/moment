// The shell: the only part of Moment that is not generated. It plays the
// "reading the room" reveal, holds the sandboxed iframe, and owns the
// feedback prompt and the retry button, so the model can never break or
// fake them.

import { escapeHtml as e } from "./util";

export interface ShellConfig {
  sid: string;
  render: string;
  eu: boolean;
  firstLine: string;
  turnstileSiteKey: string | null;
}

const BASE_CSS = `:root{--bg:#f3f0e9;--fg:#1b1a17;--muted:#6a645a;--line:#d9d2c3;--accent:#b8430f;--chip:#e9e4d8;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121211;--fg:#ece8e1;--muted:#9c968c;--line:#2e2c29;--accent:#f08a4b;--chip:#1e1d1b;color-scheme:dark}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:15px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}button{font:inherit;color:inherit;background:none;border:1px solid var(--line);border-radius:999px;padding:5px 12px;cursor:pointer;white-space:nowrap}
button:hover{border-color:var(--fg)}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;

export function shellHtml(c: ShellConfig): string {
  const cfg = JSON.stringify({ sid: c.sid, render: c.render, eu: c.eu, ts: c.turnstileSiteKey });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Moment</title>
<meta name="description" content="A page built for this moment, with no input from you.">
<meta name="referrer" content="strict-origin">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='9' fill='%23b8430f'/%3E%3C/svg%3E">
<link rel="preconnect" href="${e(c.render)}">
<style>${BASE_CSS}
body{display:grid;grid-template-rows:auto 1fr auto;height:100dvh;overflow:hidden}
.bar{display:flex;align-items:center;gap:12px;padding:8px 16px;border-bottom:1px solid var(--line);min-height:46px}
.mark{font:600 15px/1 ui-serif,Georgia,serif;letter-spacing:.01em;text-decoration:none;display:flex;align-items:center;gap:8px}
.mark i{width:9px;height:9px;border-radius:50%;background:var(--accent);display:inline-block}
.status{color:var(--muted);font-size:13px;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#stage{position:relative;min-height:0}
#page{position:absolute;inset:0;width:100%;height:100%;border:0;background:var(--bg);opacity:0;transition:opacity .5s ease}
#page.on{opacity:1}
#reveal{position:absolute;inset:0;padding:clamp(20px,8vh,90px) 16px 16px clamp(16px,8vw,120px);display:flex;flex-direction:column;gap:.35em;pointer-events:none;transition:opacity .45s ease}
#reveal.off{opacity:0}
#reveal p{margin:0;font:400 clamp(24px,4.4vw,48px)/1.12 ui-serif,Georgia,"Times New Roman",serif;letter-spacing:-.01em;opacity:0;transform:translateY(6px);transition:opacity .5s ease,transform .5s ease;max-width:22ch}
#reveal p.in{opacity:1;transform:none}
#reveal p.small{font:13px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-top:1.4em;max-width:none}
#reveal p.small::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-right:8px;vertical-align:1px;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.2}}
.foot{display:flex;align-items:center;gap:12px;padding:6px 16px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);min-height:40px;flex-wrap:wrap}
.foot a{color:var(--muted)}
#fb{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--fg);flex-wrap:wrap}
#fb[hidden]{display:none}
#fb textarea{font:inherit;width:min(320px,60vw);height:34px;resize:none;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);padding:6px 8px}
#fb .x{border:0;padding:4px 8px;color:var(--muted)}
.cf-turnstile{position:fixed;bottom:0;right:0}
@media (prefers-reduced-motion:reduce){#reveal p,#page{transition:none}#reveal p.small::before{animation:none}}
@media (max-width:560px){.bar{gap:8px}#again{padding:5px 10px}.hide-sm{display:none}}
</style></head>
<body>
<header class="bar">
  <a class="mark" href="/" aria-label="Moment, start over"><i aria-hidden="true"></i>Moment</a>
  <span class="status" id="status" role="status">Reading the room</span>
  <button type="button" id="again">Try another guess</button>
</header>
<div id="stage">
  <div id="reveal" aria-live="polite"><p class="in">${e(c.firstLine)}</p></div>
  <iframe id="page" title="The page Moment built for this moment" sandbox="allow-scripts allow-popups" referrerpolicy="no-referrer" loading="eager"></iframe>
</div>
<footer class="foot">
  <a href="/what-moment-reads">What Moment reads</a><span class="hide-sm">No cookies. No account. Nothing about you is kept.</span>
  <div id="fb" hidden>
    <span id="fb-q">Was this what you needed?</span>
    <button type="button" data-v="yes">Yes</button><button type="button" data-v="no">No</button>
    <button type="button" class="x" aria-label="Dismiss">✕</button>
  </div>
</footer>
<script>
(()=>{const C=${cfg};let sid=C.sid,es=null,loads=0,expectLoad=true,firstAt=0,completeAt=0,interacted=false,atBottom=false,fbShown=false,voted=false,dismissed=false;const t0=performance.now();
const $=s=>document.querySelector(s),frame=$('#page'),reveal=$('#reveal'),status=$('#status'),fb=$('#fb');
const post=(p,b)=>fetch('/s/'+sid+p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{}),keepalive:true}).catch(()=>null);
const say=t=>{status.textContent=t};
let queue=[],busy=false;const addLine=(t,cls)=>{queue.push([t,cls]);if(!busy)drain()};
function drain(){const n=queue.shift();if(!n){busy=false;return}busy=true;const p=document.createElement('p');p.textContent=n[0];if(n[1])p.className=n[1];const old=reveal.querySelector('.small');if(old&&!n[1])reveal.insertBefore(p,old);else reveal.appendChild(p);requestAnimationFrame(()=>requestAnimationFrame(()=>p.classList.add('in')));setTimeout(drain,matchMedia('(prefers-reduced-motion: reduce)').matches?60:420)}
let shown=new Set([reveal.textContent.trim()]);
function show(){if(frame.classList.contains('on'))return;const wait=Math.max(0,1700-(performance.now()-t0));setTimeout(()=>{frame.classList.add('on');reveal.classList.add('off')},wait)}
function events(){if(es)es.close();es=new EventSource('/s/'+sid+'/events');
es.addEventListener('reveal',m=>{for(const l of JSON.parse(m.data).lines){if(!shown.has(l)){shown.add(l);addLine(l)}}});
es.addEventListener('plan',m=>{const d=JSON.parse(m.data);say('Building: '+d.title);addLine('Building '+(/^[aeiou]/i.test(d.archetype)?'an ':'a ')+d.archetype,'small')});
es.addEventListener('start',m=>{const d=JSON.parse(m.data);if(d.mode==='archive')say('Showing an earlier guess')});
es.addEventListener('first',()=>show());
es.addEventListener('section',m=>{const d=JSON.parse(m.data);if(d.i<d.n)say('Writing part '+(d.i+1)+' of '+d.n)});
es.addEventListener('complete',m=>{const d=JSON.parse(m.data);completeAt=performance.now();show();say(d.mode==='template'?'Built from today\\'s forecast':d.mode==='archive'?'An earlier guess':d.mode==='fallback'?'':'Built for this moment');setTimeout(maybeAsk,15000)});
es.addEventListener('swap',m=>{const d=JSON.parse(m.data);expectLoad=true;loads=0;frame.src=d.url;show();say(d.reason==='moderation'?'Moment replaced that page':'An earlier guess')});
es.onerror=()=>{};}
function attach(){expectLoad=true;loads=0;frame.src=C.render+'/render/'+sid}
frame.addEventListener('load',()=>{loads++;if(loads>1&&!expectLoad){frame.src=C.render+'/fallback';say('Moment replaced that page')}expectLoad=false});
addEventListener('message',ev=>{if(ev.source!==frame.contentWindow)return;const d=ev.data||{};
 if(d.type==='moment:bottom'){atBottom=true;maybeAsk()}
 if(d.type==='moment:interaction'){if(d.taps>0||(d.hovered&&d.hovered.length)||d.scrollSpeed>0)interacted=true;if(!C.eu)post('/interaction',d)}});
function maybeAsk(){if(fbShown||voted||dismissed||!completeAt)return;fbShown=true;fb.hidden=false}
fb.addEventListener('click',async ev=>{const b=ev.target.closest('button');if(!b)return;if(b.classList.contains('x')){fb.hidden=true;dismissed=true;return}
 if(b.dataset.v){voted=true;const token=await turnstileToken();const r=await post('/vote',{vote:b.dataset.v,token});fb.innerHTML='';const ok=r&&r.ok;const s=document.createElement('span');s.textContent=ok?'Thanks. Anything to add?':'Thanks.';fb.appendChild(s);if(ok){const ta=document.createElement('textarea');ta.maxLength=280;ta.setAttribute('aria-label','Anything to add? Up to 280 characters');const send=document.createElement('button');send.textContent='Send';send.onclick=async()=>{if(ta.value.trim())await post('/vote',{vote:'text',text:ta.value});fb.innerHTML='<span>Thanks.</span>';setTimeout(()=>fb.hidden=true,2500)};const x=document.createElement('button');x.className='x';x.textContent='✕';x.setAttribute('aria-label','Dismiss');x.onclick=()=>{fb.hidden=true};fb.append(ta,send,x)}else setTimeout(()=>fb.hidden=true,2500)}});
$('#again').addEventListener('click',async()=>{const b=$('#again');b.disabled=true;say('Trying another guess');const r=await fetch('/s/'+sid+'/retry',{method:'POST'}).then(r=>r.ok?r.json():null).catch(()=>null);b.disabled=false;if(!r||!r.sid){say('Could not start another guess');return}
 sid=r.sid;fb.hidden=true;fbShown=voted=dismissed=false;completeAt=0;interacted=false;frame.classList.remove('on');reveal.classList.remove('off');reveal.innerHTML='';shown=new Set();queue=[];addLine(r.firstLine);shown.add(r.firstLine);start(true)});
let tsWidget=null,tsReady=null;function loadTurnstile(){if(!C.ts)return Promise.resolve(null);if(tsReady)return tsReady;tsReady=new Promise(res=>{window.__tsOnload=()=>{const d=document.createElement('div');d.className='cf-turnstile';document.body.appendChild(d);tsWidget=turnstile.render(d,{sitekey:C.ts,appearance:'interaction-only',execution:'execute',callback:()=>{}});res(tsWidget)};const s=document.createElement('script');s.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__tsOnload&render=explicit';s.async=true;document.head.appendChild(s)});return tsReady}
function turnstileToken(){if(!C.ts)return Promise.resolve(null);return loadTurnstile().then(w=>new Promise(res=>{try{turnstile.reset(w);turnstile.execute(w,{callback:t=>res(t),'error-callback':()=>res(null)})}catch{res(null)}setTimeout(()=>res(null),8000)}))}
async function start(again){events();
 if(!C.eu){post('/signals',{vw:innerWidth,vh:innerHeight,dark:matchMedia('(prefers-color-scheme: dark)').matches,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,touch:matchMedia('(pointer: coarse)').matches,connection:(navigator.connection&&navigator.connection.effectiveType)||null,tz:Intl.DateTimeFormat().resolvedOptions().timeZone})}
 if(C.ts){turnstileToken().then(t=>post('/turnstile',{token:t}))}
 // A tab opened in the background routes, but asks for its page only once someone looks at it.
 if(document.visibilityState==='visible')attach();else document.addEventListener('visibilitychange',function v(){if(document.visibilityState==='visible'){document.removeEventListener('visibilitychange',v);attach()}});}
addEventListener('pagehide',()=>{if(C.eu)return;const dwell=Math.round(performance.now()-t0);navigator.sendBeacon&&navigator.sendBeacon('/s/'+sid+'/end',new Blob([JSON.stringify({dwellMs:dwell,interacted})],{type:'application/json'}))});
start(false);})();
</script>
</body></html>`;
}

export function botHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Moment</title><meta name="description" content="Moment builds a one-off web page for whoever opens it, from the time, the weather and what is happening where they are. No input, no account, no cookies.">
<meta property="og:title" content="Moment"><meta property="og:description" content="A page built for this moment, with no input from you.">
<style>${BASE_CSS}body{padding:clamp(24px,8vw,96px) 16px;max-width:40rem;margin:0 auto}h1{font:400 clamp(34px,6vw,56px)/1.05 ui-serif,Georgia,serif;margin:0 0 .6em}p{font-size:18px;line-height:1.55}</style></head>
<body><h1>Moment</h1>
<p>Open this page in a browser and Moment builds a page for you from scratch: for this hour, this weather and the place you are in, with no input from you.</p>
<p>Crawlers and link previews see this description instead, so nothing is generated for them.</p>
<p><a href="/what-moment-reads">What Moment reads</a></p></body></html>`;
}

export function privacyHtml(phase2: string[]): string {
  const li = (s: string) => `<li>${s}</li>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>What Moment reads</title><meta name="description" content="Every signal Moment reads to build a page, in plain language.">
<style>${BASE_CSS}body{padding:clamp(24px,6vw,72px) 16px 72px;max-width:44rem;margin:0 auto;font-size:16.5px;line-height:1.6}
h1{font:400 clamp(32px,5vw,48px)/1.08 ui-serif,Georgia,serif;margin:0 0 .5em}h2{font:600 13px/1.3 ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:2.4em 0 .8em}
ul{padding-left:1.2em}li{margin:.4em 0}code{font:13.5px ui-monospace,Menlo,monospace;background:var(--chip);padding:1px 5px;border-radius:4px}</style></head>
<body>
<p><a href="/">← Back to Moment</a></p>
<h1>What Moment reads</h1>
<p>Moment guesses what might be useful to you right now and builds a page for it. It does this from the moment you are in (the hour, the weather, the calendar where you are), not from who you are. Every visit is a fresh guess. Here is everything it reads.</p>

<h2>From your request, every visit</h2>
<ul>
${li("Your approximate location from your IP address, at city level. Moment never stores the IP address and never uses anything finer than the city.")}
${li("Your time zone, so times on the page are local.")}
${li("Whether you are on a phone, tablet or computer.")}
${li("Your browser's preferred language.")}
${li("Which site linked you here, if your browser says (for example, a search engine or a discussion site), and a <code>?via=</code> tag if the link carries one.")}
${li("The kind of network you are on (home, mobile, university, in-flight, business). Moment reads the network owner's name only to make this one-word label; the name itself is never stored, sent to a model or shown.")}
${li("Whether your browser asks to save data.")}
</ul>

<h2>From your browser, outside the EU, UK and Switzerland</h2>
<ul>
${li("Window size, light or dark mode, reduced-motion setting, touch screen, connection speed and your device's time zone. Sent once, used to shape this one page, then discarded.")}
${li("While the page is open: how fast you scroll, which parts you hover or tap, and how long you pause, summarised every two seconds. Later sections of the page are written with this in mind. These summaries live only in the session and are thrown away when you leave.")}
${li("How long you stayed and whether you interacted, sent once when you leave, as a signal of whether the guess was useful.")}
</ul>

<h2>In the EU, the EEA, the UK and Switzerland</h2>
<p>Only what your request carries on its own: location from the IP address, language, referring site and the browser's default hints. Nothing is posted from your browser, and nothing is written to browser storage. The page still adapts to dark mode, reduced motion and screen width through CSS, which sends nothing anywhere.</p>

<h2>About the place, prepared ahead of time</h2>
<ul>
${li("Weather now and for the next 30 hours, and how unusual today is for the date (Open-Meteo).")}
${li("Sunrise, sunset, golden hour and the moon, computed.")}
${li("Public holidays and long weekends (Nager.Date).")}
${li("What people in your country read most on Wikipedia yesterday, kept only if the topic is food, sports, entertainment, arts, technology, travel, weather, shopping, hobbies, games or science. News, politics, health, deaths, crime, disasters, adult content and gambling are dropped before any model sees them.")}
${phase2.length ? li(`Not yet connected: ${phase2.join(", ")}.`) : ""}
</ul>

<h2>What is kept</h2>
<ul>
${li("No cookies, no fingerprint, no account, and no identity in browser storage. The session ID is random and lasts one visit.")}
${li("A record of each page: the place (metro level), the hour, the kind of network, the plan, timing, and whether you said it helped. No IP address and no company name.")}
${li("The page itself, so Moment can show an earlier guess if the generator fails. Pages are deleted after 30 days.")}
${li("If you leave a comment after voting, it is checked for personal details, kept for 90 days, and never placed into a prompt.")}
</ul>

<h2>What Moment does not do</h2>
<ul>
${li("It does not identify people, match you to profiles, read your browsing history, or fingerprint your device.")}
${li("It never claims to know anything about you beyond your city and what you do on the page.")}
${li("Generated pages run on a separate domain inside a sandbox. They cannot read this site, submit forms, or send data anywhere except Moment's read-only weather feed.")}
</ul>
<p style="color:var(--muted);font-size:14px;margin-top:3em">EU mode is a design decision, not legal advice.</p>
</body></html>`;
}
