// The sandbox domain. Generated pages are served from here, never from the
// main site, inside <iframe sandbox="allow-scripts allow-popups"> and under a
// strict content security policy (PRD: Sandbox). Also the live data API.

import { fallbackPage } from "./doc";
import { describeCode, fetchForecasts } from "../../ingest/src/weather";

interface RenderEnv {
  SESSION: DurableObjectNamespace;
  RENDER_ORIGIN: string;
  MAIN_ORIGIN: string;
}

function csp(env: RenderEnv): string {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' https://cdnjs.cloudflare.com",
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "img-src data: blob:",
    `connect-src ${env.RENDER_ORIGIN}`,
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors ${env.MAIN_ORIGIN}`,
  ].join("; ");
}

function page(body: BodyInit | null, env: RenderEnv, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": csp(env),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-resource-policy": "cross-origin",
    },
  });
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET", "content-type": "application/json; charset=utf-8" };

async function liveWeather(lat: number, lon: number): Promise<Response> {
  const key = `https://moment-live.internal/weather/${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = await caches.default.match(key).catch(() => undefined);
  if (hit) return new Response(hit.body, { headers: { ...CORS, "cache-control": "public, max-age=300", "x-cache": "hit" } });
  const [f] = await fetchForecasts([{ lat, lon }]);
  const now = new Date();
  const local = new Intl.DateTimeFormat("sv-SE", { timeZone: f.tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).format(now).replace(" ", "T").slice(0, 13) + ":00";
  let i = f.hourly.findIndex((h) => h.t === local);
  if (i < 0) i = 0;
  const cur = f.hourly[i];
  const today = f.daily.find((d) => d.date === local.slice(0, 10)) ?? f.daily[0];
  const body = JSON.stringify({
    now: { temp_c: cur.temp, desc: describeCode(cur.code), code: cur.code },
    hourly: f.hourly.slice(i, i + 24),
    sunrise: today?.sunrise ?? null,
    sunset: today?.sunset ?? null,
    tz: f.tz,
    source: "open-meteo",
  });
  await caches.default.put(key, new Response(body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=600" } })).catch(() => {});
  return new Response(body, { headers: { ...CORS, "cache-control": "public, max-age=300" } });
}

export default {
  async fetch(req: Request, env: RenderEnv): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    const r = p.match(/^\/render\/([0-9a-f]{32})$/);
    if (r && req.method === "GET") {
      const stub = env.SESSION.get(env.SESSION.idFromName(r[1]));
      const res = await stub.fetch(url.searchParams.get("archive") ? "https://session/archive" : "https://session/render");
      return page(res.body, env, res.status);
    }
    if (p === "/fallback") return page(fallbackPage("Moment set that page aside. Try another guess from the bar above."), env);

    const live = p.match(/^\/live\/(-?\d{1,2}\.\d{1,3}),(-?\d{1,3}\.\d{1,3})\/(weather|scores|events|trends|busy)$/);
    if (live) {
      if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
      const [, la, lo, kind] = live;
      if (kind !== "weather") {
        return new Response(JSON.stringify({ available: false, reason: "Not connected yet (a Phase 2 source)." }), { status: 404, headers: CORS });
      }
      try {
        return await liveWeather(Number(la), Number(lo));
      } catch (err) {
        return new Response(JSON.stringify({ available: false, reason: "upstream" }), { status: 502, headers: CORS });
      }
    }
    if (p.startsWith("/live/")) return new Response(JSON.stringify({ available: false }), { status: 404, headers: CORS });
    if (p === "/") return Response.redirect(env.MAIN_ORIGIN, 302);
    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<RenderEnv>;
