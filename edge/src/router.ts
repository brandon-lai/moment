// Concept selection: three candidates (from the router model, or from the
// template catalog), a specificity score for each, learned priors, and a 15%
// exploration pick (PRD: Router, The specificity test).

import type { Env } from "./env";
import type { Layer1, Plan } from "./types";
import { ARCHETYPES } from "./types";
import type { MomentView } from "./moment";
import { costMicros, hasModel, judgeWithModel, routeLane, type RouterCandidate, type Usage } from "./models";
import { LANES } from "./prompts";
import { templateCandidates, type TemplateCtx } from "./templates";
import { sampleBeta, type Arm } from "../../ingest/src/learner";

export const EXPLORE_RATE = 0.15;
export const ROUTER_BUDGET_MS = 2500;
// The judge runs after the router, on the critical path, so it gets a hard
// budget; when it misses, the router's own specificity self-check stands in.
export const JUDGE_BUDGET_MS = 900;

export interface RouteResult {
  plan: Plan;
  candidates: Plan[];
  specificity: number[];
  picked: number;
  how: "model" | "template" | "prior-fallback";
  explored: boolean;
  routerMs: number;
  judgeMs?: number;
  judged?: boolean;
  usage: Usage[];
  error?: string;
  // Model routing only: settles once the judge has scored the candidates (or
  // missed its budget). The plan above is provisional until then.
  confirm?: Promise<{ index: number; specificity: number[]; judged: boolean; judgeMs: number; usage: Usage[] }>;
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

// The random part of a pick (Thompson samples, the exploration roll) is drawn
// once, so the same draw can be re-scored when the judge's verdict arrives.
export interface Draw { samples: number[]; explore: boolean; exploreIndex: number }

export function drawFor(cands: Plan[], arms: Record<string, Arm>, rand: () => number): Draw {
  const explore = rand() < EXPLORE_RATE;
  const exploreIndex = Math.floor(rand() * cands.length);
  return { samples: cands.map((c) => sampleBeta(arms[c.archetype] ?? [1, 1], rand)), explore, exploreIndex };
}

export function pick(d: Draw, spec: number[]): number {
  if (d.explore) return d.exploreIndex;
  let best = -1, bi = 0;
  d.samples.forEach((s, i) => {
    const w = s * (0.4 + 0.6 * (spec[i] ?? 0.5));
    if (w > best) { best = w; bi = i; }
  });
  return bi;
}

export function choose(cands: Plan[], spec: number[], arms: Record<string, Arm>, rand: () => number): { index: number; explored: boolean } {
  if (cands.length === 1) return { index: 0, explored: false };
  const d = drawFor(cands, arms, rand);
  return { index: pick(d, spec), explored: d.explore };
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
    const budget = Number(r.env.ROUTER_BUDGET_MS) || ROUTER_BUDGET_MS;
    const payload = routerPayload(r, prior);
    const lanes = LANES.map((l) => ({ ...l, archetypes: l.archetypes.filter((a) => !exclude.includes(a) && (!r.lite || ["guide", "checklist", "dashboard", "editorial", "countdown", "quiz"].includes(a))) })).filter((l) => l.archetypes.length);
    const settled = await Promise.allSettled(lanes.map((l) => routeLane(r.env, payload, l.archetypes, budget)));
    const raw: RouterCandidate[] = [];
    for (const x of settled) if (x.status === "fulfilled") { raw.push(x.value.candidate); usage.push(x.value.usage); }
    const cands = raw.map((c) => sanitizePlan({ ...c, signals_used: [], live_data: r.view.coords ? ["weather"] : [] } as Plan)).filter((p): p is Plan => !!p);
    const routerMs = Date.now() - t0;
    if (cands.length === 0) {
      // Router slower than 2.5 s or failing: code picks the archetype with
      // the highest prior and proceeds (PRD: Retries and fallbacks).
      const fb = fallbackTemplates();
      const idx = highestPrior(fb, r.arms);
      const why = settled.map((x) => (x.status === "rejected" ? String(x.reason).slice(0, 80) : "")).filter(Boolean).join("; ");
      return { plan: fb[idx], candidates: fb, specificity: fb.map((c) => heuristicSpecificity(c, r.view)), picked: idx, how: "prior-fallback", explored: false, routerMs, usage, error: why || "router returned nothing" };
    }
    const self = raw.map((c) => 1 - (c.could_exist_tomorrow ? 0.4 : 0) - (c.could_exist_elsewhere ? 0.4 : 0));
    const draw = drawFor(cands, r.arms, r.rand);
    const provisional = pick(draw, self);
    const judgeBudget = Number(r.env.JUDGE_BUDGET_MS) || JUDGE_BUDGET_MS;
    const tj = Date.now();
    const confirm = (async () => {
      if (cands.length < 2) return { index: 0, specificity: self, judged: false, judgeMs: 0, usage: [] as Usage[] };
      try {
        const j = await judgeWithModel(r.env, cands, r.view.place || r.l1.country, `${r.view.local.weekday} ${r.view.local.clock}`, judgeBudget);
        const spec = cands.map((_, i) => {
          const v = j.data.verdicts.find((x) => x.index === i);
          return v ? 1 - (v.could_exist_tomorrow ? 0.4 : 0) - (v.could_exist_elsewhere ? 0.4 : 0) : self[i];
        });
        return { index: pick(draw, spec), specificity: spec, judged: true, judgeMs: Date.now() - tj, usage: [j.usage] };
      } catch {
        // The judge missed its budget: the router's own self-check stands in.
        return { index: provisional, specificity: self, judged: false, judgeMs: Date.now() - tj, usage: [] as Usage[] };
      }
    })();
    return { plan: cands[provisional], candidates: cands, specificity: self, picked: provisional, how: "model", explored: draw.explore, routerMs, usage, confirm };
  }

  const all = fallbackTemplates();
  // Three candidates, like the model router: rank by specificity, keep the top three.
  const ranked = all.map((p) => ({ p, s: heuristicSpecificity(p, r.view) })).sort((a, b) => b.s - a.s).slice(0, 3);
  const cands = ranked.map((x) => x.p), spec = ranked.map((x) => x.s);
  const { index, explored } = choose(cands, spec, r.arms, r.rand);
  return { plan: cands[index], candidates: cands, specificity: spec, picked: index, how: "template", explored, routerMs: Date.now() - t0, usage };
}

export const usageCost = (us: Usage[]) => us.reduce((a, u) => a + costMicros(u), 0);
