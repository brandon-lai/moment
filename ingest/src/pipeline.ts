// Scheduled ingest: the slow work done before any visitor arrives (PRD:
// "Do slow work before the visitor arrives"). Runs on the edge worker's Cron
// Triggers. See README for why this is TypeScript, not the PRD's Rust binary.

import type { Env } from "../../edge/src/env";
import type { Brief } from "../../edge/src/types";
import { METROS, type Metro } from "../../edge/src/metros";
import { localParts } from "../../edge/src/util";
import { classifyTerms, hasModel } from "../../edge/src/models";
import { compileBrief, type CellMeta } from "./compile";
import { fetchClimatology, fetchForecasts, type Climatology, type ForecastResult } from "./weather";
import { fetchHolidays, type Holiday } from "./holidays";
import { fetchTopPerCountry } from "./trends";
import { blocked, categoryAllowed, gate, type Verdict } from "./safety";
import { learn, type PriorTable } from "./learner";

export const KV = {
  brief: (cell: string) => `brief:${cell}`,
  clim: (cell: string) => `clim:${cell}`,
  hol: (cc: string, y: number) => `hol:${cc}:${y}`,
  trends: (cc: string) => `trends:${cc}`,
  priors: "priors:v1",
  styles: "styles:v1",
  kill: "kill",
  lastRun: "ingest:last",
};

export interface StoredTrend { term: string; category: string; rank: number; views: number }

export async function getHolidays(env: Env, country: string, year: number, fetchIfMissing: boolean): Promise<Holiday[]> {
  const cached = await env.BRIEFS.get<Holiday[]>(KV.hol(country, year), { type: "json", cacheTtl: 3600 });
  if (cached) return cached;
  if (!fetchIfMissing) return [];
  const hols = await fetchHolidays(country, year).catch((err) => { console.warn("holidays", country, String(err)); return null; });
  if (hols) await env.BRIEFS.put(KV.hol(country, year), JSON.stringify(hols), { expirationTtl: 400 * 86400 }).catch(() => {});
  return hols ?? [];
}

export async function getPriorTable(env: Env): Promise<PriorTable> {
  return (await env.BRIEFS.get<PriorTable>(KV.priors, { type: "json", cacheTtl: 600 })) ?? {};
}

export interface CompileDeps {
  forecast: ForecastResult | null;
  climatology: Climatology | null;
  holidays: Holiday[];
  trends: StoredTrend[];
}

export function metaOf(m: Metro): CellMeta {
  const parts = m.cell.split("/");
  return { cell: m.cell, label: m.label, country: m.country, region: m.country === "US" ? parts[1] : null, lat: m.lat, lon: m.lon, tz: m.tz };
}

// Warm run: every metro on the warm list, in two forecast calls. Runs every four hours: 93 writes x 6 runs stays under the KV free tier with room for trends and calendars.
export async function compileWarm(env: Env, now = new Date()): Promise<{ written: number; errors: string[] }> {
  const errors: string[] = [];
  const year = Number(now.toISOString().slice(0, 4));
  const countries = [...new Set(METROS.map((m) => m.country))];

  // Fill at most ten missing holiday calendars and eight climatologies per
  // run, to stay inside the free plan's 50 subrequests per invocation.
  let fetchBudget = 10;
  const hols = new Map<string, Holiday[]>();
  for (const cc of countries) {
    const cached = await env.BRIEFS.get<Holiday[]>(KV.hol(cc, year), { type: "json" });
    if (cached) hols.set(cc, cached);
    else if (fetchBudget-- > 0) hols.set(cc, await getHolidays(env, cc, year, true));
    else hols.set(cc, []);
  }
  const trends = new Map<string, StoredTrend[]>();
  for (const cc of countries) trends.set(cc, (await env.BRIEFS.get<StoredTrend[]>(KV.trends(cc), { type: "json" })) ?? []);

  let climBudget = 8;
  const clims = new Map<string, Climatology | null>();
  for (const m of METROS) {
    let c = await env.BRIEFS.get<Climatology>(KV.clim(m.cell), { type: "json" });
    if (!c && climBudget-- > 0) {
      c = await fetchClimatology(m, year).catch((err) => { errors.push(`clim ${m.cell}: ${String(err)}`); return null; });
      if (c) await env.BRIEFS.put(KV.clim(m.cell), JSON.stringify(c)).catch(() => {});
    }
    clims.set(m.cell, c);
  }

  const forecasts: (ForecastResult | null)[] = [];
  for (let i = 0; i < METROS.length; i += 50) {
    const batch = METROS.slice(i, i + 50);
    const res = await fetchForecasts(batch).catch((err) => { errors.push(`forecast batch ${i}: ${String(err)}`); return null; });
    forecasts.push(...(res ?? batch.map(() => null)));
  }

  const table = await getPriorTable(env);
  let written = 0;
  for (let i = 0; i < METROS.length; i++) {
    const m = METROS[i];
    const brief = compileBrief({
      meta: metaOf(m), now, forecast: forecasts[i], climatology: clims.get(m.cell) ?? null,
      holidays: hols.get(m.country) ?? [], trends: trends.get(m.country) ?? [], priors: cellPriors(table, m.cell),
    });
    try {
      await env.BRIEFS.put(KV.brief(m.cell), JSON.stringify(brief), { expirationTtl: 8 * 3600 });
      written++;
    } catch (err) {
      errors.push(`kv ${m.cell}: ${String(err)}`);
      break; // most likely the daily write quota; stop spending attempts
    }
  }
  await env.BRIEFS.put(KV.brief("global"), JSON.stringify(globalBrief(now, table)), { expirationTtl: 8 * 3600 }).catch(() => {});
  return { written, errors };
}

export function globalBrief(now: Date, table: PriorTable = {}): Brief {
  return {
    cell: "global", label: "the world", built_at: now.toISOString(),
    local: { tz: "UTC", weekday: localParts(now, "UTC").weekday, holiday: null },
    weather: null, signals: [], priors: { archetypes: cellPriors(table, "*") }, sources: ["computed-sky"],
  };
}

// The brief carries a readable summary of the learned priors for its cell.
export function cellPriors(table: PriorTable, cell: string): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = Object.entries(table).filter(([k]) => k === "*" || k.startsWith(`${cell}|`));
  for (const [, arms] of rows) for (const [a, [al, be]] of Object.entries(arms)) {
    if (al + be - 2 < 30) continue;
    out[a] = Math.round((al / (al + be)) * 100) / 100;
  }
  return out;
}

// Lazily compile a cell nobody has visited before: one forecast call.
export async function compileLazy(env: Env, meta: CellMeta, now = new Date()): Promise<Brief> {
  const year = Number(now.toISOString().slice(0, 4));
  const [forecast, holidays, trends, clim, table] = await Promise.all([
    meta.lat != null && meta.lon != null ? fetchForecasts([{ lat: meta.lat, lon: meta.lon }]).then((r) => r[0]).catch(() => null) : Promise.resolve(null),
    getHolidays(env, meta.country, year, true),
    env.BRIEFS.get<StoredTrend[]>(KV.trends(meta.country), { type: "json", cacheTtl: 3600 }).then((x) => x ?? []),
    env.BRIEFS.get<Climatology>(KV.clim(meta.cell), { type: "json", cacheTtl: 3600 }),
    getPriorTable(env),
  ]);
  return compileBrief({ meta, now, forecast, climatology: clim, holidays, trends, priors: cellPriors(table, meta.cell) });
}

// Daily run, part 1: what each country is reading, through safety gate 1.
export async function refreshTrends(env: Env, now = new Date()): Promise<{ countries: number; passed: number; classified: number; errors: string[] }> {
  const errors: string[] = [];
  const day = new Date(now.getTime() - 86400000).toISOString().slice(0, 10);
  const countries = [...new Set(METROS.map((m) => m.country))];
  const raw = new Map<string, { term: string; rank: number; views: number }[]>();
  for (const cc of countries) {
    const items = await fetchTopPerCountry(cc, day).catch((err) => { errors.push(`wiki ${cc}: ${String(err)}`); return []; });
    raw.set(cc, items.filter((t) => !blocked(t.term)));
  }
  const allTerms = [...new Set([...raw.values()].flat().map((t) => t.term))];
  const verdicts = await loadVerdicts(env, allTerms);
  const pending = allTerms.filter((t) => !verdicts.has(t.toLowerCase()));
  let classified = 0;
  if (pending.length && hasModel(env)) {
    for (let i = 0; i < pending.length && i < 400; i += 100) {
      try {
        const { labels } = await classifyTerms(env, pending.slice(i, i + 100));
        const stmts = labels.map((l) => env.DB.prepare("INSERT OR REPLACE INTO verdicts (term, category, allowed, decided_at, decided_by) VALUES (?, ?, ?, ?, ?)").bind(l.term.toLowerCase(), l.category, categoryAllowed(l.category) ? 1 : 0, now.toISOString(), "claude-haiku-5-5"));
        if (stmts.length) await env.DB.batch(stmts);
        for (const l of labels) verdicts.set(l.term.toLowerCase(), { term: l.term, category: l.category, allowed: categoryAllowed(l.category) });
        classified += labels.length;
      } catch (err) {
        errors.push(`classify: ${String(err)}`);
        break;
      }
    }
  }
  let passed = 0;
  for (const [cc, items] of raw) {
    const ok = gate(items, verdicts).slice(0, 8);
    passed += ok.length;
    await env.BRIEFS.put(KV.trends(cc), JSON.stringify(ok), { expirationTtl: 3 * 86400 }).catch((err) => errors.push(`kv trends ${cc}: ${String(err)}`));
  }
  return { countries: countries.length, passed, classified, errors };
}

async function loadVerdicts(env: Env, terms: string[]): Promise<Map<string, Verdict>> {
  const m = new Map<string, Verdict>();
  for (let i = 0; i < terms.length; i += 90) {
    const chunk = terms.slice(i, i + 90).map((t) => t.toLowerCase());
    const rows = await env.DB.prepare(`SELECT term, category, allowed FROM verdicts WHERE term IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all<{ term: string; category: string; allowed: number }>();
    for (const r of rows.results ?? []) m.set(r.term, { term: r.term, category: r.category, allowed: !!r.allowed });
  }
  return m;
}

// Daily run, part 2: the nightly learner and retention.
export async function nightly(env: Env, now = new Date()): Promise<{ rewarded: number; buckets: number }> {
  const since = new Date(now.getTime() - 60 * 86400000).toISOString();
  const rows = await env.DB.prepare("SELECT bucket_json, archetype, reward FROM traces WHERE reward IS NOT NULL AND created_at > ?").bind(since).all<{ bucket_json: string; archetype: string; reward: number }>();
  const table = learn(rows.results ?? []);
  await env.BRIEFS.put(KV.priors, JSON.stringify(table));

  // Styles that keep losing get drawn less often: weight = smoothed mean reward.
  const style = await env.DB.prepare("SELECT font, palette, layout, reward FROM traces WHERE reward IS NOT NULL AND created_at > ?").bind(since).all<{ font: string; palette: string; layout: string; reward: number }>();
  const agg = (k: "font" | "palette" | "layout") => {
    const s = new Map<string, [number, number]>();
    for (const r of style.results ?? []) { const a = s.get(r[k]) ?? [1, 2]; s.set(r[k], [a[0] + r.reward, a[1] + 1]); }
    return Object.fromEntries([...s].filter(([, [, n]]) => n >= 32).map(([id, [sum, n]]) => [id, Math.round((sum / n) * 2 * 100) / 100]));
  };
  await env.BRIEFS.put(KV.styles, JSON.stringify({ font: agg("font"), palette: agg("palette"), layout: agg("layout") }));

  // Retention: feedback text 90 days, archived pages 30 days, traces 180 days.
  const d = (days: number) => new Date(now.getTime() - days * 86400000).toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE traces SET feedback_text = NULL WHERE feedback_text IS NOT NULL AND created_at < ?").bind(d(90)),
    env.DB.prepare("DELETE FROM pages WHERE created_at < ?").bind(d(30)),
    env.DB.prepare("DELETE FROM traces WHERE created_at < ?").bind(d(180)),
  ]);
  return { rewarded: rows.results?.length ?? 0, buckets: Object.keys(table).length };
}
