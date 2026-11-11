// The edge request path (PRD: Request lifecycle). Reads the visitor's
// request, finds a brief, opens a session and streams the shell back in one
// round trip. Also the home of the scheduled ingest.

import type { Env } from "./env";
import type { Brief, Layer1 } from "./types";
import { cellChain, cellLabel, isBot, layer1 } from "./geo";
import { botHtml, privacyHtml, shellHtml } from "./shell";
import { clock12, hmacHex, json, localParts, randomId } from "./util";
import { compileLazy, compileWarm, globalBrief, KV, nightly, refreshTrends } from "../../ingest/src/pipeline";
import { findMetro } from "./metros";
import type { InitPayload } from "./session";
import { hasModel } from "./models";

export { Session } from "./session";
export { Governor } from "./governor";

const PHASE2 = ["metro-level search trends", "events (PredictHQ)", "venue busyness (BestTime)", "live sports", "the discussion you came from", "what's on (TV, film, music charts)", "air quality and pollen", "aurora and meteor forecasts", "airport and transit disruptions", "university and school calendars", "rhythm baselines"];

const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin",
  "permissions-policy": "geolocation=(), camera=(), microphone=(), interest-cohort=()",
};

function html(body: string, extra: Record<string, string> = {}, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...SECURITY_HEADERS, ...extra } });
}

function shellCsp(env: Env): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
    "style-src 'unsafe-inline'",
    `frame-src ${env.RENDER_ORIGIN} https://challenges.cloudflare.com`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

async function ipHash(env: Env, req: Request): Promise<string> {
  const ip = req.headers.get("cf-connecting-ip") ?? "0.0.0.0";
  // Daily rotating salt: the same address hashes differently tomorrow, and the
  // address itself never leaves this function.
  return (await hmacHex(env.IP_HASH_SECRET ?? "dev-only-secret", `${new Date().toISOString().slice(0, 10)}|${ip}`)).slice(0, 32);
}

async function findBrief(env: Env, chain: string[]): Promise<{ brief: Brief | null; cell: string | null }> {
  const got = await Promise.all(chain.map((c) => env.BRIEFS.get<Brief>(KV.brief(c), { type: "json", cacheTtl: 300 }).catch(() => null)));
  const i = got.findIndex(Boolean);
  return i >= 0 ? { brief: got[i], cell: chain[i] } : { brief: null, cell: null };
}

const BRIEF_CACHE = "https://moment-cache.internal/brief/";

async function cachedBrief(cell: string): Promise<Brief | null> {
  const hit = await caches.default.match(BRIEF_CACHE + encodeURIComponent(cell)).catch(() => undefined);
  return hit ? ((await hit.json()) as Brief) : null;
}

async function cacheBrief(cell: string, b: Brief): Promise<void> {
  await caches.default.put(BRIEF_CACHE + encodeURIComponent(cell), new Response(JSON.stringify(b), { headers: { "content-type": "application/json", "cache-control": "public, max-age=900" } })).catch(() => {});
}

interface Opened { sid: string; firstLine: string; l1: Layer1 }

async function openSession(req: Request, env: Env, ctx: ExecutionContext, t0: number, exclude: string[] = [], override?: { brief: Brief; l1?: Partial<Layer1>; forceTemplate?: boolean; now?: string }): Promise<Opened> {
  const url = new URL(req.url);
  const l1 = { ...layer1(req, url.hostname), ...(override?.l1 ?? {}) } as Layer1;
  const chain = cellChain(l1);
  const exact = chain[0];
  let brief: Brief | null = override?.brief ?? null;
  let awaitingExact = false;
  let lazy: Promise<Brief> | null = null;

  if (!brief) {
    const found = await findBrief(env, chain);
    if (found.cell === exact) brief = found.brief;
    else {
      brief = (await cachedBrief(exact)) ?? null;
      if (!brief && exact !== "global") {
        // A cell nobody has visited recently: compile it now, without making
        // the shell wait. The session gets it as soon as it is ready.
        const metro = findMetro(exact);
        const parts = exact.split("/");
        lazy = compileLazy(env, {
          cell: exact, label: metro?.label ?? cellLabel(exact, l1), country: l1.country,
          region: l1.country === "US" ? parts[1] : l1.region,
          lat: metro?.lat ?? (l1.lat != null ? Math.round(l1.lat * 100) / 100 : null),
          lon: metro?.lon ?? (l1.lon != null ? Math.round(l1.lon * 100) / 100 : null),
          tz: metro?.tz ?? l1.tz,
        });
        awaitingExact = true;
      }
      brief ??= found.brief ?? globalBrief(new Date());
    }
  }

  const sid = randomId(16);
  const stub = env.SESSION.get(env.SESSION.idFromName(sid));
  const init: InitPayload = {
    id: sid, createdAt: t0, shellMs: Date.now() - t0, l1, cell: exact, brief: brief ?? globalBrief(new Date()), awaitingExact, exclude,
    ipHash: await ipHash(env, req), turnstile: !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET) && hasModel(env),
    evalMode: !!override, forceTemplate: override?.forceTemplate, now: override?.now,
  };
  await stub.fetch("https://session/init", { method: "POST", body: JSON.stringify(init) });
  if (lazy) {
    ctx.waitUntil(lazy.then(async (b) => {
      await stub.fetch("https://session/brief", { method: "POST", body: JSON.stringify(b) });
      await cacheBrief(exact, b);
    }).catch((err) => console.warn("lazy brief", exact, String(err))));
  }
  const b = brief ?? globalBrief(new Date());
  const lp = localParts(new Date(), b.cell === "global" ? l1.tz : b.local.tz || l1.tz);
  return { sid, firstLine: `${lp.weekday}, ${clock12(lp.hour, lp.minute)}`, l1 };
}

async function verifyTurnstile(env: Env, token: unknown): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true;
  if (typeof token !== "string" || !token) return false;
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET);
  body.set("response", token);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body }).catch(() => null);
  if (!res?.ok) return false;
  return !!((await res.json()) as { success?: boolean }).success;
}

function sessionStub(env: Env, sid: string) {
  return env.SESSION.get(env.SESSION.idFromName(sid));
}

async function stats(env: Env, admin: boolean): Promise<Response> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const day = new Date(Date.now() - 86400000).toISOString();
  const q = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b);
  const [byMode, ttfc, votes, mod, errs, gov] = await Promise.all([
    q("SELECT mode, COUNT(*) n FROM traces WHERE created_at > ? GROUP BY mode", since).all<{ mode: string; n: number }>(),
    q("SELECT mode, first_content_ms ms FROM traces WHERE created_at > ? AND first_content_ms IS NOT NULL ORDER BY first_content_ms", since).all<{ mode: string; ms: number }>(),
    q("SELECT vote, COUNT(*) n FROM traces WHERE created_at > ? AND vote IS NOT NULL GROUP BY vote", since).all<{ vote: string; n: number }>(),
    q("SELECT COUNT(*) n FROM traces WHERE created_at > ? AND moderation = 'fail'", day).first<{ n: number }>(),
    q("SELECT COUNT(*) n, SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) e FROM traces WHERE created_at > ?", day).first<{ n: number; e: number }>(),
    env.GOVERNOR.get(env.GOVERNOR.idFromName("global")).fetch("https://governor/status").then((r) => r.json()).catch(() => null),
  ]);
  const pct = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor((xs.length - 1) * p))] : null);
  const per = (mode: string) => (ttfc.results ?? []).filter((r) => r.mode === mode).map((r) => r.ms);
  const model = per("model"), template = per("template");
  const yes = votes.results?.find((v) => v.vote === "yes")?.n ?? 0, no = votes.results?.find((v) => v.vote === "no")?.n ?? 0;
  const alerts: string[] = [];
  if ((pct(model, 0.95) ?? 0) > 5000) alerts.push("p95 time to first content over 5 s (model pages)");
  if (errs && errs.n > 20 && errs.e / errs.n > 0.02) alerts.push("errors over 2% in the last 24 h");
  if ((mod?.n ?? 0) > 0) alerts.push(`${mod!.n} moderation failure(s) in the last 24 h`);
  const body: Record<string, unknown> = {
    window: "7 days",
    generator: hasModel(env) ? "model" : "template (no ANTHROPIC_API_KEY)",
    visits: Object.fromEntries((byMode.results ?? []).map((r) => [r.mode ?? "unfinished", r.n])),
    time_to_first_content_ms: { model: { p50: pct(model, 0.5), p95: pct(model, 0.95), n: model.length }, template: { p50: pct(template, 0.5), p95: pct(template, 0.95), n: template.length } },
    votes: { yes, no, yes_rate: yes + no ? Math.round((yes / (yes + no)) * 100) / 100 : null },
    moderation_failures_24h: mod?.n ?? 0,
    alerts,
  };
  if (admin) body.spend = gov;
  return json(body);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const t0 = Date.now();
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/" && (req.method === "GET" || req.method === "HEAD")) {
      if (req.method === "HEAD" || isBot(req)) return html(botHtml(), { "cache-control": "public, max-age=3600", "content-security-policy": shellCsp(env) });
      const kill = await env.BRIEFS.get<{ all?: boolean }>(KV.kill, { type: "json", cacheTtl: 30 }).catch(() => null);
      void kill; // the session decides what to serve when generation is off
      const s = await openSession(req, env, ctx, t0);
      return html(shellHtml({ sid: s.sid, render: env.RENDER_ORIGIN, eu: s.l1.eu, firstLine: s.firstLine, turnstileSiteKey: hasModel(env) && env.TURNSTILE_SECRET ? env.TURNSTILE_SITE_KEY ?? null : null }), {
        "content-security-policy": shellCsp(env), "server-timing": `shell;dur=${Date.now() - t0}`,
      });
    }
    if (p === "/what-moment-reads") return html(privacyHtml(PHASE2), { "cache-control": "public, max-age=600", "content-security-policy": shellCsp(env) });
    if (p === "/health") return json({ ok: true, generator: hasModel(env) ? "model" : "template", turnstile: !!env.TURNSTILE_SECRET, time: new Date().toISOString() });
    if (p === "/stats") return stats(env, !!env.ADMIN_TOKEN && req.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`);
    if (p === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain" } });

    const m = p.match(/^\/s\/([0-9a-f]{32})\/(events|signals|interaction|turnstile|vote|end|retry|state)$/);
    if (m) {
      const [, sid, action] = m;
      const stub = sessionStub(env, sid);
      if (action === "events" && req.method === "GET") return stub.fetch("https://session/events");
      if (req.method !== "POST" && action !== "state") return json({ error: "method" }, { status: 405 });
      if (action === "state") {
        if (!env.DEV_EVALS && !(env.ADMIN_TOKEN && req.headers.get("authorization") === `Bearer ${env.ADMIN_TOKEN}`)) return json({ error: "unauthorized" }, { status: 401 });
        return stub.fetch("https://session/state");
      }
      const body = await req.text();
      if (body.length > 4096) return json({ error: "too large" }, { status: 413 });
      if (action === "turnstile") {
        const { token } = JSON.parse(body || "{}") as { token?: string };
        const ok = await verifyTurnstile(env, token);
        await stub.fetch("https://session/turnstile", { method: "POST", body: JSON.stringify({ ok }) });
        return json({ ok });
      }
      if (action === "vote") {
        const b = JSON.parse(body || "{}") as { vote?: string; text?: string; token?: string };
        if (b.vote !== "text") {
          // One vote per visit, a valid Turnstile token, and no votes from
          // rate-limited addresses (PRD: Feedback rules).
          if (!(await verifyTurnstile(env, b.token))) return json({ error: "turnstile" }, { status: 403 });
          const g = await env.GOVERNOR.get(env.GOVERNOR.idFromName("global")).fetch("https://governor/vote", { method: "POST", body: JSON.stringify({ ip: await ipHash(env, req) }) }).then((r) => r.json() as Promise<{ allowed: boolean }>);
          if (!g.allowed) return json({ error: "rate limited" }, { status: 429 });
        }
        return stub.fetch("https://session/vote", { method: "POST", body: JSON.stringify({ vote: b.vote, text: b.text }) });
      }
      if (action === "retry") {
        const r = (await stub.fetch("https://session/retry", { method: "POST" }).then((x) => x.json())) as { exclude: string[] };
        const s = await openSession(req, env, ctx, t0, (r.exclude ?? []).slice(-6));
        return json({ sid: s.sid, firstLine: s.firstLine });
      }
      return stub.fetch(`https://session/${action}`, { method: "POST", body });
    }

    // Phase 0 harness: inject a hand-written brief. Local development only.
    if (p === "/eval" && req.method === "POST" && env.DEV_EVALS === "1") {
      const b = (await req.json()) as { brief: Brief; l1?: Partial<Layer1>; template?: boolean; now?: string; exclude?: string[] };
      const s = await openSession(req, env, ctx, t0, b.exclude ?? [], { brief: b.brief, l1: b.l1, forceTemplate: b.template, now: b.now });
      return json({ sid: s.sid, render: `${env.RENDER_ORIGIN}/render/${s.sid}` });
    }

    if (p === "/admin/kill" && req.method === "POST") {
      if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, { status: 401 });
      const b = await req.json();
      await env.BRIEFS.put(KV.kill, JSON.stringify(b));
      return json({ ok: true, kill: b });
    }
    if (p === "/admin/review") {
      if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, { status: 401 });
      const rows = await env.DB.prepare("SELECT session_id, created_at, cell, archetype, title, moderation, moderation_reason, error, vote, feedback_text FROM traces WHERE moderation = 'fail' OR error IS NOT NULL OR feedback_text IS NOT NULL ORDER BY created_at DESC LIMIT 100").all();
      return json(rows.results);
    }
    if (p === "/admin/ingest" && req.method === "POST") {
      if (!env.ADMIN_TOKEN || req.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) return json({ error: "unauthorized" }, { status: 401 });
      const which = url.searchParams.get("run") ?? "warm";
      const out = which === "trends" ? await refreshTrends(env) : which === "nightly" ? await nightly(env) : await compileWarm(env);
      return json(out);
    }

    return html("<!doctype html><title>Not found</title><p>Not found. <a href=\"/\">Back to Moment</a></p>", {}, 404);
  },

  async scheduled(ev: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (ev.cron === "23 6 * * *") {
      ctx.waitUntil(refreshTrends(env).then((r) => console.log("trends", JSON.stringify(r))).then(() => nightly(env)).then((r) => console.log("nightly", JSON.stringify(r))));
    } else {
      ctx.waitUntil(compileWarm(env).then((r) => console.log("warm", JSON.stringify(r))));
    }
  },
} satisfies ExportedHandler<Env>;
