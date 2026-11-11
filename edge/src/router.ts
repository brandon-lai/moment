// Concept selection: three candidates (from the router model, or from the
// template catalog), a specificity score for each, learned priors, and a 15%
// exploration pick (PRD: Router, The specificity test).

import type { Env } from "./env";
import type { Layer1, Plan } from "./types";
import { ARCHETYPES } from "./types";
import type { MomentView } from "./moment";
import { costMicros, hasModel, judgeWithModel, routeWithModel, type Usage } from "./models";
import { templateCandidates, type TemplateCtx } from "./templates";
import { sampleBeta, type Arm } from "../../ingest/src/learner";

export const EXPLORE_RATE = 0.15;
export const ROUTER_BUDGET_MS = 2500;
export const JUDGE_BUDGET_MS = 1200;

export interface RouteResult {
  plan: Plan;
  candidates: Plan[];
  specificity: number[];
  picked: number;
  how: "model" | "template" | "prior-fallback";
  explored: boolean;
  routerMs: number;
  usage: Usage[];
  error?: string;
}

export interface RouteInput {
  env: Env;
  view: MomentView;
  l1: Layer1;
  arms: Record<string, Arm>;
  exclude: string[];
  lite: boolean;            // spend cap at 80%: simpler pages
  templateOnly: boolean;    // no model available, or kill switch on model
  rand: () => number;
  tctx: TemplateCtx;
  killed: string[];         // archetypes switched off in KV
}

// Facts only: what the router model sees. Company names never get here; at
// most an industry label. Nothing finer than the metro.
export function routerPayload(r: RouteInput, prior: Record<string, number>) {
  const v = r.view;
  return {
    visit: {
      country: r.l1.country,
      metro: v.place || null,
      device: r.l1.device,
      language: r.l1.language,
      arrived_from: r.l1.referrerType,
      network: r.l1.network,
      network_industry: r.l1.industry,
      situations: r.l1.situations,
    },
    local_time: { weekday: v.local.weekday, time: v.local.clock, daypart: v.local.daypart, weekend: v.local.weekend },
    brief: {
      weather_now: v.weather ? `${v.weather.now}` : null,
      temperature_unit: v.unit,
      next_12h: v.weather?.next_12h ?? null,
      unusual: v.weather?.unusual ?? null,
      signals: v.signals.map((s) => ({ kind: s.kind, label: s.label, category: s.category, score: s.score })),
    },
    learned_archetype_success: prior,
    exclude_archetypes: [...r.exclude, ...r.killed],
    live_data_available: v.coords ? ["weather"] : [],
    constraints: r.lite ? "Budget mode: propose simple archetypes (editorial, checklist, countdown, dashboard) with at most 3 sections." : null,
  };
}

// Heuristic specificity, used when the judge model is unavailable or slow:
// pages built on time-bound, place-bound facts score high.
export function heuristicSpecificity(p: Plan, v: MomentView): number {
  const text = `${p.title} ${p.purpose} ${p.lead_fact ?? ""} ${p.signals_used.join(" ")}`.toLowerCase();
  let s = 0.25;
  if (/\d{1,2}(:\d\d)?\s?(a\.m\.|p\.m\.)|tonight|this (morning|evening|afternoon)|now|today/.test(text)) s += 0.2;
  if (v.place && text.includes(v.place.toLowerCase())) s += 0.15;
  if (/rain|snow|sunset|sunrise|golden|storm|fog|°/.test(text)) s += 0.2;
  if (/holiday|weekend|tomorrow|day/.test(text) && v.signals.some((x) => x.kind === "holiday")) s += 0.1;
  if (p.archetype === "editorial" || p.archetype === "ambient") s -= 0.05;
  return Math.max(0, Math.min(1, s));
}

export function choose(cands: Plan[], spec: number[], arms: Record<string, Arm>, rand: () => number): { index: number; explored: boolean } {
  if (cands.length === 1) return { index: 0, explored: false };
  if (rand() < EXPLORE_RATE) return { index: Math.floor(rand() * cands.length), explored: true };
  let best = -1, bi = 0;
  cands.forEach((c, i) => {
    const arm = arms[c.archetype] ?? [1, 1];
    const w = sampleBeta(arm, rand) * (0.4 + 0.6 * (spec[i] ?? 0.5));
    if (w > best) { best = w; bi = i; }
  });
  return { index: bi, explored: false };
}

export function highestPrior(cands: Plan[], arms: Record<string, Arm>): number {
  let bi = 0, best = -1;
  cands.forEach((c, i) => {
    const a = arms[c.archetype] ?? [1, 1];
    const m = a[0] / (a[0] + a[1]);
    if (m > best) { best = m; bi = i; }
  });
  return bi;
}

function sanitizePlan(p: Plan): Plan | null {
  if (!p || !Array.isArray(p.sections) || p.sections.length < 1) return null;
  const archetype = ([...ARCHETYPES, "other"] as string[]).includes(p.archetype) ? p.archetype : "other";
  const seen = new Set<string>();
  const sections = p.sections.slice(0, 5).map((s, i) => {
    let id = (s.id || `s${i + 1}`).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || `s${i + 1}`;
    if (/^\d/.test(id)) id = `s-${id}`;
    while (seen.has(id)) id += "-2";
    seen.add(id);
    return { id, heading: String(s.heading ?? "").slice(0, 120), intent: String(s.intent ?? "").slice(0, 300) };
  });
  return {
    ...p,
    archetype,
    title: String(p.title ?? "").slice(0, 120),
    purpose: String(p.purpose ?? "").slice(0, 300),
    live_data: (p.live_data ?? []).filter((d) => d === "weather"), // Phase 1 serves weather only
    signals_used: (p.signals_used ?? []).slice(0, 8),
    sections: sections.length >= 2 ? sections : [...sections, { id: "more", heading: "More", intent: "Continue the page." }],
  };
}

export async function route(r: RouteInput): Promise<RouteResult> {
  const t0 = Date.now();
  const usage: Usage[] = [];
  const prior = Object.fromEntries(Object.entries(r.arms).map(([k, a]) => [k, Math.round((a[0] / (a[0] + a[1])) * 100) / 100]));
  const exclude = [...r.exclude, ...r.killed];
  const fallbackTemplates = () => {
    let c = templateCandidates(r.tctx, exclude);
    if (r.lite) c = c.filter((p) => ["editorial", "checklist", "countdown", "dashboard"].includes(p.archetype));
    if (c.length === 0) c = templateCandidates(r.tctx, []);
    return c;
  };

  if (!r.templateOnly && hasModel(r.env)) {
    try {
      const res = await routeWithModel(r.env, routerPayload(r, prior), ROUTER_BUDGET_MS);
      usage.push(res.usage);
      const cands = res.candidates.map(sanitizePlan).filter((p): p is Plan => !!p && !exclude.includes(p.archetype)).slice(0, 3);
      if (cands.length === 0) throw new Error("router returned no usable candidates");
      const routerMs = Date.now() - t0;
      let spec = cands.map((c) => heuristicSpecificity(c, r.view));
      try {
        const j = await judgeWithModel(r.env, cands, r.view.place || r.l1.country, `${r.view.local.weekday} ${r.view.local.clock}`, JUDGE_BUDGET_MS);
        usage.push(j.usage);
        spec = cands.map((_, i) => {
          const v = j.data.verdicts.find((x) => x.index === i);
          return v ? 1 - (v.could_exist_tomorrow ? 0.4 : 0) - (v.could_exist_elsewhere ? 0.4 : 0) : spec[i];
        });
      } catch (err) {
        console.warn("judge skipped", String(err));
      }
      const { index, explored } = choose(cands, spec, r.arms, r.rand);
      return { plan: cands[index], candidates: cands, specificity: spec, picked: index, how: "model", explored, routerMs, usage };
    } catch (err) {
      // Router slower than 2.5 s or failing: code picks the archetype with
      // the highest prior and proceeds (PRD: Retries and fallbacks).
      const cands = fallbackTemplates();
      const idx = highestPrior(cands, r.arms);
      return { plan: cands[idx], candidates: cands, specificity: cands.map((c) => heuristicSpecificity(c, r.view)), picked: idx, how: "prior-fallback", explored: false, routerMs: Date.now() - t0, usage, error: String(err) };
    }
  }

  const all = fallbackTemplates();
  // Three candidates, like the model router: rank by specificity, keep the top three.
  const ranked = all.map((p) => ({ p, s: heuristicSpecificity(p, r.view) })).sort((a, b) => b.s - a.s).slice(0, 3);
  const cands = ranked.map((x) => x.p), spec = ranked.map((x) => x.s);
  const { index, explored } = choose(cands, spec, r.arms, r.rand);
  return { plan: cands[index], candidates: cands, specificity: spec, picked: index, how: "template", explored, routerMs: Date.now() - t0, usage };
}

export const usageCost = (us: Usage[]) => us.reduce((a, u) => a + costMicros(u), 0);
