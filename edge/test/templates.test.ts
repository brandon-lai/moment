import { describe, expect, it } from "vitest";
import briefs from "../../evals/briefs.json";
import { momentView } from "../src/moment";
import { TEMPLATES, renderTemplateSection, templateCandidates } from "../src/templates";
import { docHead, docTail } from "../src/doc";
import { drawArt } from "../src/art";
import { moderateRules } from "../src/moderation";
import { visibleText } from "../src/splitter";
import { heuristicSpecificity } from "../src/router";
import type { Brief, Layer1 } from "../src/types";

type Eval = { id: string; now: string; l1: Partial<Layer1>; brief: Brief };
const cases = (briefs as unknown as Eval[]).map((b) => [b.id, b] as const);

describe("50 Phase 0 briefs through the template generator", () => {
  it.each(cases)("%s", (_id, b) => {
    const now = new Date(b.now);
    const view = momentView(b.brief, b.l1 as Layer1, now);
    expect(view.reveal[0]).toMatch(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{1,2}:\d\d (a|p)\.m\.$/);
    const cands = templateCandidates({ view, l1: b.l1 as Layer1, now, compact: false }, []);
    expect(cands.length).toBeGreaterThanOrEqual(b.brief.weather ? 5 : 2);
    for (const plan of cands) {
      const art = drawArt({ seed: 1, weather: view.weather?.bucket ?? "clear", daypart: view.local.daypart, archetype: plan.archetype });
      const scripts: string[] = [];
      let html = docHead({ title: plan.title, art, dark: null, liveBase: "https://r/live/x", eu: false, tz: view.tz, place: view.place, label: "" });
      const ids = new Set<string>();
      for (const s of plan.sections) {
        const out = renderTemplateSection(plan, s, { view, l1: b.l1 as Layer1, now, compact: false });
        expect(out.html.startsWith(`<section id="${s.id}"`), `${plan.archetype}/${s.id}`).toBe(true);
        ids.add(s.id);
        html += out.html;
        if (out.script) scripts.push(out.script);
      }
      html += docTail([], scripts);
      expect(ids.size).toBe(plan.sections.length);
      const text = visibleText(html);
      expect(text, `${plan.archetype}: ${text.slice(0, 200)}`).not.toMatch(/\bundefined\b|\bNaN\b|\bnull\b|\[object/);
      expect(moderateRules(text, html).safe).toBe(true);
      // Fahrenheit where people read Fahrenheit, never a bare Celsius there.
      if (b.brief.country === "US") expect(text).not.toMatch(/°C/);
      else if (b.brief.weather) expect(text).not.toMatch(/°F/);
      expect(heuristicSpecificity(plan, view)).toBeGreaterThanOrEqual(0);
      // Scripts must at least parse.
      for (const s of scripts) expect(() => new Function(s)).not.toThrow();
    }
  });

  it("covers every template archetype somewhere in the set", () => {
    const seen = new Set<string>();
    for (const [, b] of cases) {
      const now = new Date(b.now);
      const view = momentView(b.brief, b.l1 as Layer1, now);
      for (const p of templateCandidates({ view, l1: b.l1 as Layer1, now, compact: false }, [])) seen.add(p.archetype);
    }
    expect([...seen].sort()).toEqual(TEMPLATES.map((t) => t.archetype).sort());
  });

  it("leads the New York evening with the rain stopping", () => {
    const b = cases.find(([id]) => id === "nyc-rain-clearing-evening")![1];
    const view = momentView(b.brief, b.l1 as Layer1, new Date(b.now));
    expect(view.reveal).toContain("Light rain in Brooklyn, 52°");
    expect(view.signals[0].label).toMatch(/^(light rain|The rain stops around)/i);
    expect(view.signals.some((s) => s.label === "The rain stops around 8 p.m." || /stops around/.test(s.label))).toBe(true);
  });
});
