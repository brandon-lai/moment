// Phase 0 harness: runs hand-written briefs through the real edge flow
// (session object, router, generator, stream into the sandbox) on a local
// `wrangler dev`, and measures what the visitor would see.
//
//   node evals/run.mjs [--template] [--limit N] [--only id,id] [--base http://localhost:8787]
//
// Writes evals/results/<run>.json with per-brief timings, and the pages
// themselves under evals/results/<run>/.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = opt("--base", "http://localhost:8787");
const TEMPLATE = flag("--template");
const LIMIT = Number(opt("--limit", "50"));
const ONLY = opt("--only", "")?.split(",").filter(Boolean);
const EXCLUDE = opt("--exclude", "")?.split(",").filter(Boolean);
const CONC = Number(opt("--concurrency", "3"));

const briefs = JSON.parse(readFileSync(new URL("./briefs.json", import.meta.url))).filter((b) => !ONLY.length || ONLY.includes(b.id)).slice(0, LIMIT);
const run = `${TEMPLATE ? "template" : "model"}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
const dir = new URL(`./results/${run}/`, import.meta.url);
mkdirSync(dir, { recursive: true });

async function one(b) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/eval`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ brief: b.brief, l1: b.l1, now: b.now, template: TEMPLATE, exclude: EXCLUDE }) });
  if (!res.ok) return { id: b.id, error: `eval ${res.status}` };
  const { sid, render } = await res.json();
  const tShell = performance.now() - t0;
  // The iframe asks for its page as soon as the shell has loaded.
  const r = await fetch(render);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let html = "", tFirstByte = 0, tFirstSection = 0, tFirstText = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const now = performance.now() - t0;
    if (!tFirstByte) tFirstByte = now;
    html += dec.decode(value, { stream: true });
    if (!tFirstSection && /<section\b/i.test(html)) tFirstSection = now;
    if (!tFirstText && /<section[\s\S]*?<(h1|h2|p)[^>]*>[^<]{8,}/i.test(html)) tFirstText = now;
  }
  const tDone = performance.now() - t0;
  const state = await fetch(`${BASE}/s/${sid}/state`).then((x) => x.json());
  writeFileSync(new URL(`${b.id}.html`, dir), html);
  const tokens = (state.usage ?? []).reduce((a, u) => ({ in: a.in + u.input + u.cacheRead + u.cacheWrite, out: a.out + u.output, cacheRead: a.cacheRead + u.cacheRead }), { in: 0, out: 0, cacheRead: 0 });
  return {
    id: b.id, archetype: state.plan?.archetype, title: state.plan?.title, how: state.how, mode: state.mode, art: state.art,
    shell_ms: Math.round(tShell), router_ms: state.routerMs, first_byte_ms: Math.round(tFirstByte), first_content_ms: Math.round(tFirstText || tFirstSection), complete_ms: Math.round(tDone),
    server_first_content_ms: state.firstContentMs, moderation: state.moderation, error: state.error, bytes: html.length, tokens,
  };
}

const results = [];
let i = 0;
async function worker() {
  while (i < briefs.length) {
    const b = briefs[i++];
    try {
      const r = await one(b);
      results.push(r);
      console.log(`${r.id.padEnd(34)} ${String(r.archetype).padEnd(10)} first content ${String(r.first_content_ms).padStart(6)} ms  complete ${String(r.complete_ms).padStart(6)} ms  ${r.moderation?.safe === false ? "MODERATION FAIL" : ""}${r.error ? " ERR " + r.error : ""}`);
    } catch (err) {
      results.push({ id: b.id, error: String(err) });
      console.log(`${b.id} failed: ${err}`);
    }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const ok = results.filter((r) => r.first_content_ms > 0);
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))] : null; };
const summary = {
  run, n: results.length, failures: results.filter((r) => r.error || !r.first_content_ms).length,
  first_content_ms: { p50: q(ok.map((r) => r.first_content_ms), 0.5), p95: q(ok.map((r) => r.first_content_ms), 0.95) },
  complete_ms: { p50: q(ok.map((r) => r.complete_ms), 0.5), p95: q(ok.map((r) => r.complete_ms), 0.95) },
  router_ms: { p50: q(ok.map((r) => r.router_ms ?? 0), 0.5) },
  moderation_failures: results.filter((r) => r.moderation?.safe === false).length,
  archetypes: Object.fromEntries([...new Set(ok.map((r) => r.archetype))].map((a) => [a, ok.filter((r) => r.archetype === a).length])),
  tokens: ok.reduce((a, r) => ({ in: a.in + (r.tokens?.in ?? 0), out: a.out + (r.tokens?.out ?? 0), cacheRead: a.cacheRead + (r.tokens?.cacheRead ?? 0) }), { in: 0, out: 0, cacheRead: 0 }),
  gate: "median time to first content under 3.5 s",
};
summary.gate_passed = summary.first_content_ms.p50 != null && summary.first_content_ms.p50 < 3500;
writeFileSync(new URL(`./results/${run}.json`, import.meta.url), JSON.stringify({ summary, results }, null, 1));
console.log(JSON.stringify(summary, null, 1));
