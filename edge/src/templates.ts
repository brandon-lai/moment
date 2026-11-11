// The template generator: what Moment builds when no model is configured
// (or the model is down and the archive is empty). It follows the same
// contract as the model generator: one <section> per plan section, scripts
// held back to the end, facts only from the brief. It is deliberately honest
// about being a template: the footer of each page says so.

import type { HourPoint, Layer1, Plan, PlanSection } from "./types";
import type { MomentView } from "./moment";
import { capital, humanMinutes } from "./moment";
import { clock12, escapeHtml as e, fmtTemp, fmtTempShort, localParts, type TempUnit } from "./util";
import { describeCode, isWet } from "../../ingest/src/weather";
import { moon, sunTimes } from "../../ingest/src/sky";

export interface TemplateCtx {
  view: MomentView;
  l1: Layer1 | null;
  now: Date;
  compact: boolean;
}

export interface SectionOut { html: string; script?: string; libs?: string[] }

interface Template {
  archetype: Plan["archetype"];
  applicable(c: TemplateCtx): boolean;
  plan(c: TemplateCtx): Plan;
  section(s: PlanSection, plan: Plan, c: TemplateCtx): SectionOut;
}

// ---- helpers ---------------------------------------------------------------

const T = (c: TemplateCtx, x: number) => fmtTempShort(x, c.view.unit);
const TL = (c: TemplateCtx, x: number) => fmtTemp(x, c.view.unit);

export function hourLabel(t: string): string {
  const h = Number(t.slice(11, 13));
  const m = Number(t.slice(14, 16));
  if (m) return clock12(h, m);
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return `${h % 12} ${h < 12 ? "a.m." : "p.m."}`;
}

export const hhmmLabel = (hhmm: string) => hourLabel(`0000-00-00T${hhmm}`);

export function ahead(c: TemplateCtx, n = 12): HourPoint[] {
  const hs = c.view.weather?.hourly ?? [];
  const key = `${c.view.local.isoDate}T${String(c.view.local.hour).padStart(2, "0")}:00`;
  let i = hs.findIndex((h) => h.t === key);
  if (i < 0) i = 0;
  return hs.slice(i, i + n);
}

const dry = (h: HourPoint) => !isWet(h.code) && h.pop < 40;

function partOfDayPhrase(c: TemplateCtx): string {
  const d = c.view.local.daypart;
  return d === "midday" ? "midday" : d;
}

function sun(c: TemplateCtx) {
  if (!c.view.coords) return null;
  return sunTimes(c.now, c.view.coords.lat, c.view.coords.lon);
}

function localClock(c: TemplateCtx, d: Date | null): string {
  if (!d) return "";
  const p = localParts(d, c.view.tz);
  return clock12(p.hour, p.minute);
}

function minutesUntil(c: TemplateCtx, d: Date | null): number | null {
  return d ? Math.round((d.getTime() - c.now.getTime()) / 60000) : null;
}

// Local "HH:MM" today (or tomorrow if already past) as an epoch, via the
// minutes between now and then on the local clock.
function epochOfLocal(c: TemplateCtx, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  let diff = h * 60 + m - (c.view.local.hour * 60 + c.view.local.minute);
  if (diff < 0) diff += 1440;
  return c.now.getTime() - (c.now.getSeconds() * 1000 + c.now.getMilliseconds()) + diff * 60000;
}

function placeIn(c: TemplateCtx): string {
  return c.view.place ? ` in ${c.view.place}` : "";
}

function footer(): string {
  return `<p class="m-kicker" style="margin-top:2.5em">Built by Moment's template engine from today's forecast, the sun and the calendar.</p>`;
}

function kicker(c: TemplateCtx): string {
  return `<p class="m-kicker">${e(c.view.local.weekday)} · ${e(c.view.local.clock)}${c.view.place ? ` · ${e(c.view.place)}` : ""}</p>`;
}

function bars(c: TemplateCtx, hs: HourPoint[]): string {
  if (!hs.length) return "";
  const lo = Math.min(...hs.map((h) => h.temp)) - 2, hi = Math.max(...hs.map((h) => h.temp)) + 1;
  const items = hs.map((h) => {
    const pct = Math.round(((h.temp - lo) / Math.max(1, hi - lo)) * 100);
    const wet = isWet(h.code);
    return `<i title="${e(hourLabel(h.t))}: ${e(T(c, h.temp))}, ${h.pop}% rain" style="height:${Math.max(6, pct)}%;${wet ? "background:var(--accent-2)" : ""}"></i>`;
  }).join("");
  const labels = hs.filter((_, i) => i % 3 === 0).map((h) => `<span>${e(hourLabel(h.t))}</span>`).join("");
  return `<div class="m-bars" role="img" aria-label="Temperature over the next ${hs.length} hours">${items}</div>
<div class="m-row m-muted m-mono" style="justify-content:space-between;font-size:.75rem;margin-top:.4em">${labels}</div>`;
}

function hourTable(c: TemplateCtx, hs: HourPoint[]): string {
  return `<table><thead><tr><th>Hour</th><th>Sky</th><th>Temp</th><th>Rain</th></tr></thead><tbody>${hs.map((h) =>
    `<tr><td class="m-mono">${e(hourLabel(h.t))}</td><td>${e(describeCode(h.code))}</td><td>${e(T(c, h.temp))}</td><td>${h.pop}%</td></tr>`).join("")}</tbody></table>`;
}

// Hour-by-hour suggestion, tied only to facts in the hour itself.
function suggestion(c: TemplateCtx, h: HourPoint, light: boolean): string {
  const hr = Number(h.t.slice(11, 13));
  const wet = isWet(h.code), cold = h.temp <= 3, warm = h.temp >= 24;
  if (wet && h.mm >= 2) return "The wettest stretch. A good hour to be indoors.";
  if (wet) return "Light rain. Short trips only, with a hood.";
  if (!light && hr >= 21) return cold ? "Dry and cold. If you go out, go out properly dressed." : "Dry after dark. Good for a late walk.";
  if (!light) return "Dark, but dry.";
  if (warm) return "Warm and dry. Shade and water if you're out long.";
  if (cold) return "Dry but cold. Bright enough for a brisk walk.";
  if (hr >= 17 && hr <= 20) return "Dry, and it's dinner hour: a good time to walk to food.";
  if (hr >= 7 && hr <= 9) return "Dry for the morning commute.";
  return "Dry and comfortable. The easy hour to be outside.";
}

function isLight(c: TemplateCtx, t: string): boolean {
  const s = sun(c);
  if (!s?.sunrise || !s?.sunset) return Number(t.slice(11, 13)) >= 7 && Number(t.slice(11, 13)) < 18;
  const rise = localParts(s.sunrise, c.view.tz), set = localParts(s.sunset, c.view.tz);
  const m = Number(t.slice(11, 13)) * 60;
  return m >= rise.hour * 60 + rise.minute && m < set.hour * 60 + set.minute;
}

// ---- templates -------------------------------------------------------------

const countdown: Template = {
  archetype: "countdown",
  applicable: (c) => !!target(c),
  plan(c) {
    const t = target(c)!;
    return {
      archetype: "countdown",
      title: `${capital(t.what)}${placeIn(c)}: ${t.at}`,
      purpose: `Count down to ${t.what} and show what happens between now and then.`,
      lead_fact: `${capital(t.what)} at ${t.at}`,
      signals_used: [t.signal],
      live_data: ["weather"],
      sections: [
        { id: "count", heading: capital(t.what), intent: "A large live countdown to the moment." },
        { id: "between", heading: "Between now and then", intent: "Hour by hour until it happens." },
        { id: "after", heading: "After that", intent: "What the hours after look like." },
      ],
    };
  },
  section(s, plan, c) {
    const t = target(c)!;
    if (s.id === "count") {
      return {
        html: `<section id="count">${kicker(c)}<h1>${e(plan.title)}</h1>
<div class="m-big m-accent" id="cd" aria-live="off">${e(humanMinutes(Math.max(1, Math.round((t.epoch - c.now.getTime()) / 60000))))}</div>
<p class="m-lead">${e(t.detail)}</p></section>`,
        script: `const left=${t.epoch - c.now.getTime()},t0=performance.now();const el=document.getElementById('cd');const tick=()=>{let s=Math.max(0,Math.round((left-(performance.now()-t0))/1000));const h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;el.textContent=(h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0');if(s===0){el.textContent='Now';return}setTimeout(tick,1000)};tick();`,
      };
    }
    const toTarget = (t.epoch - c.now.getTime()) / 60000;
    const hs = ahead(c, 24);
    // ahead()[i] starts i hours after the top of the current hour.
    const startMin = (i: number) => i * 60 - c.view.local.minute;
    if (s.id === "between") {
      const list = hs.filter((_, i) => startMin(i) < toTarget).slice(0, 8);
      return { html: `<section id="between"><h2>${e(s.heading)}</h2>${hourTable(c, list.length ? list : hs.slice(0, 2))}</section>` };
    }
    const after = hs.filter((_, i) => startMin(i) >= toTarget).slice(0, 6);
    return {
      html: `<section id="after"><h2>${e(s.heading)}</h2>${after.length ? `<p>${e(afterSentence(c, after))}</p>${bars(c, after)}` : `<p>The forecast runs out here.</p>`}${footer()}</section>`,
    };
  },
};

function afterSentence(c: TemplateCtx, hs: HourPoint[]): string {
  const wet = hs.filter((h) => isWet(h.code)).length;
  const lo = Math.min(...hs.map((h) => h.temp)), hi = Math.max(...hs.map((h) => h.temp));
  const sky = wet === 0 ? "dry" : wet === hs.length ? "wet throughout" : `${wet} of the next ${hs.length} hours wet`;
  return `From ${hourLabel(hs[0].t)} to ${hourLabel(hs[hs.length - 1].t)}: ${sky}, ${T(c, lo)} to ${T(c, hi)}.`;
}

interface Target { what: string; at: string; hhmm: string; epoch: number; detail: string; signal: string }

function target(c: TemplateCtx): Target | null {
  const w = c.view.weather;
  if (w?.rain_stops) {
    const what = w.code >= 71 && w.code <= 86 && ![80, 81, 82].includes(w.code) ? "the snow stops" : "the rain stops";
    return { what, at: hhmmLabel(w.rain_stops), hhmm: w.rain_stops, epoch: epochOfLocal(c, w.rain_stops), detail: `${capital(w.now)} now, ${T(c, w.temp_c)}. The forecast turns dry around ${hhmmLabel(w.rain_stops)}.`, signal: "rain stops" };
  }
  const s = sun(c);
  const toSet = minutesUntil(c, s?.sunset ?? null);
  if (s?.sunset && toSet != null && toSet > 10 && toSet <= 240) {
    const p = localParts(s.sunset, c.view.tz);
    const hhmm = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    const gold = localClock(c, s.goldenEveningStart);
    const goldAhead = (minutesUntil(c, s.goldenEveningStart) ?? 0) > 0;
    return { what: "sunset", at: localClock(c, s.sunset), hhmm, epoch: s.sunset.getTime(), detail: `${gold && goldAhead ? `Golden hour starts at ${gold}. ` : ""}${w ? `${capital(w.now)}, ${T(c, w.temp_c)}.` : ""}`, signal: "sunset" };
  }
  if (w?.rain_starts) {
    return { what: "the rain arrives", at: hhmmLabel(w.rain_starts), hhmm: w.rain_starts, epoch: epochOfLocal(c, w.rain_starts), detail: `${capital(w.now)} for now, ${T(c, w.temp_c)}. Anything you need to do outside, do before then.`, signal: "rain starts" };
  }
  const toRise = minutesUntil(c, s?.sunrise ?? null);
  if (s?.sunrise && toRise != null && toRise > 10 && toRise <= 300) {
    const p = localParts(s.sunrise, c.view.tz);
    return { what: "sunrise", at: localClock(c, s.sunrise), hhmm: `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`, epoch: s.sunrise.getTime(), detail: w ? `${capital(w.now)}, ${T(c, w.temp_c)} for now.` : "", signal: "sunrise" };
  }
  if (c.view.local.weekday === "Friday" && c.view.local.hour >= 9 && c.view.local.hour < 17) {
    return { what: "the weekend", at: "5 p.m.", hhmm: "17:00", epoch: epochOfLocal(c, "17:00"), detail: "Five o'clock Friday, by the usual reckoning.", signal: "weekend" };
  }
  return null;
}

const dashboard: Template = {
  archetype: "dashboard",
  applicable: (c) => !!c.view.weather,
  plan(c) {
    const w = c.view.weather!;
    return {
      archetype: "dashboard",
      title: `${capital(c.view.local.weekday)} ${partOfDayPhrase(c)}${placeIn(c)}`,
      purpose: "Every number that matters about here and now, kept live.",
      lead_fact: `${capital(w.now)}, ${T(c, w.temp_c)}`,
      signals_used: ["weather now", "next 12 hours", "sun"],
      live_data: ["weather"],
      sections: [
        { id: "now", heading: "Right now", intent: "Temperature, sky and the clock." },
        { id: "next", heading: "The next twelve hours", intent: "Temperature and rain, hour by hour." },
        { id: "sky", heading: "Light", intent: "Sun and moon." },
      ],
    };
  },
  section(s, _plan, c) {
    const w = c.view.weather!;
    if (s.id === "now") {
      const hs = ahead(c, 4);
      const rain3 = Math.max(0, ...hs.map((h) => h.pop));
      return {
        html: `<section id="now">${kicker(c)}<h1>${e(capital(w.now))}${placeIn(c) ? `<span class="m-muted">${e(placeIn(c))}</span>` : ""}</h1>
<div class="m-big" id="now-temp">${e(T(c, w.temp_c))}</div>
<div class="m-grid" style="margin-top:1.5em">
<div class="m-stat"><b>${rain3}%</b><span class="m-muted">highest rain chance, next 3 hours</span></div>
<div class="m-stat"><b>${e(w.next_12h.split(",").pop()!.trim())}</b><span class="m-muted">range, next 12 hours</span></div>
${w.unusual ? `<div class="m-stat"><b class="m-accent">${e(w.unusual.split(" than")[0])}</b><span class="m-muted">than usual for the date</span></div>` : ""}
</div></section>`,
        script: `fetch(MOMENT.live+'/weather').then(r=>r.ok?r.json():null).then(d=>{if(!d||!d.now)return;const el=document.getElementById('now-temp');const u=${JSON.stringify(c.view.unit)};const t=d.now.temp_c;el.textContent=(u==='F'?Math.round(t*9/5+32):Math.round(t))+'°'}).catch(()=>{});`,
      };
    }
    if (s.id === "next") {
      const hs = ahead(c, 13);
      return { html: `<section id="next"><h2>${e(s.heading)}</h2><p>${e(capital(w.next_12h))}.</p>${bars(c, hs)}${c.compact ? "" : hourTable(c, hs.filter((_, i) => i % 2 === 0))}</section>` };
    }
    const st = sun(c);
    const m = moon(c.now);
    const rows: string[] = [];
    if (st?.sunrise) rows.push(`<div class="m-stat"><b>${e(localClock(c, st.sunrise))}</b><span class="m-muted">sunrise</span></div>`);
    if (st?.sunset) rows.push(`<div class="m-stat"><b>${e(localClock(c, st.sunset))}</b><span class="m-muted">sunset</span></div>`);
    if (st?.sunrise && st?.sunset) {
      const len = Math.round((st.sunset.getTime() - st.sunrise.getTime()) / 60000);
      rows.push(`<div class="m-stat"><b>${Math.floor(len / 60)} h ${len % 60} m</b><span class="m-muted">of daylight today</span></div>`);
    }
    rows.push(`<div class="m-stat"><b>${Math.round(m.illumination * 100)}%</b><span class="m-muted">${e(m.name)}</span></div>`);
    return { html: `<section id="sky"><h2>${e(s.heading)}</h2><div class="m-grid">${rows.join("")}</div>${moonSvg(m.phase)}${footer()}</section>` };
  },
};

function moonSvg(phase: number): string {
  // Lit fraction drawn as two arcs; phase 0 new, 0.5 full.
  const r = 40, k = Math.cos(phase * 2 * Math.PI);
  const sweep = phase < 0.5 ? 1 : 0;
  const rx = Math.abs(k) * r;
  const inner = k > 0 ? (phase < 0.5 ? 0 : 1) : (phase < 0.5 ? 1 : 0);
  return `<svg viewBox="0 0 100 100" width="96" height="96" role="img" aria-label="Moon phase" style="margin-top:1em"><circle cx="50" cy="50" r="${r}" fill="var(--surface)" stroke="var(--line)"/><path d="M50 ${50 - r} A${r} ${r} 0 0 ${sweep} 50 ${50 + r} A${rx.toFixed(1)} ${r} 0 0 ${inner} 50 ${50 - r}Z" fill="var(--fg)" opacity=".85"/></svg>`;
}

const checklist: Template = {
  archetype: "checklist",
  applicable: (c) => !!c.view.weather && items(c).length >= 3,
  plan(c) {
    const its = items(c);
    return {
      archetype: "checklist",
      title: `Before you head out this ${partOfDayPhrase(c)}`,
      purpose: "What to take and when it matters, from the forecast.",
      lead_fact: its[0].why,
      signals_used: its.map((i) => i.signal),
      live_data: [],
      sections: [
        { id: "take", heading: "Take", intent: "A short checklist built from the forecast." },
        { id: "when", heading: "When it matters", intent: "The hours behind each item." },
      ],
    };
  },
  section(s, plan, c) {
    const its = items(c);
    if (s.id === "take") {
      return {
        html: `<section id="take">${kicker(c)}<h1>${e(plan.title)}</h1><ul class="m-list" id="cl">${its.map((it, i) =>
          `<li><button type="button" data-m="check-${i}" aria-pressed="false" style="border:0;padding:0;text-align:left;width:100%;display:flex;gap:.8em;align-items:baseline"><span class="m-mono m-accent" aria-hidden="true">[ ]</span><span><b>${e(it.what)}</b><br><span class="m-muted">${e(it.why)}</span></span></button></li>`).join("")}</ul></section>`,
        script: `document.querySelectorAll('#cl button').forEach(b=>b.addEventListener('click',()=>{const on=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(on));b.querySelector('span').textContent=on?'[x]':'[ ]';b.style.opacity=on?'.55':'1'}));`,
      };
    }
    return { html: `<section id="when"><h2>${e(s.heading)}</h2>${hourTable(c, ahead(c, 9))}${footer()}</section>` };
  },
};

function items(c: TemplateCtx): { what: string; why: string; signal: string }[] {
  const w = c.view.weather;
  if (!w) return [];
  const hs = ahead(c, 8);
  const out: { what: string; why: string; signal: string }[] = [];
  const wetNow = isWet(w.code);
  const firstWet = hs.find((h) => isWet(h.code) && h.pop >= 50);
  if (wetNow) out.push({ what: "Umbrella or a hood", why: w.rain_stops ? `${capital(w.now)} until about ${hhmmLabel(w.rain_stops)}.` : `${capital(w.now)}, and it keeps up for the next few hours.`, signal: "rain now" });
  else if (firstWet) out.push({ what: "Umbrella", why: `Rain likely from ${hourLabel(firstWet.t)} (${firstWet.pop}% chance).`, signal: "rain later" });
  const lo = Math.min(...hs.map((h) => h.temp));
  if (lo <= 6) out.push({ what: "A warm layer", why: `${TL(c, w.temp_c)} now, down to ${TL(c, lo)} by ${hourLabel(hs.find((h) => h.temp === lo)!.t)}.`, signal: "cold" });
  if (w.temp_c >= 27) out.push({ what: "Water", why: `${TL(c, w.temp_c)} now.`, signal: "heat" });
  if (lo <= 0) out.push({ what: "Shoes with grip", why: `Below freezing by ${hourLabel(hs.find((h) => h.temp <= 0)!.t)}; wet ground can ice.`, signal: "freezing" });
  const st = sun(c);
  const toSet = minutesUntil(c, st?.sunset ?? null);
  if (toSet != null && toSet > 0 && toSet < 240) out.push({ what: "A light, if you're biking or walking back", why: `Sunset at ${localClock(c, st!.sunset)}, in ${humanMinutes(toSet)}.`, signal: "sunset" });
  if (toSet != null && toSet <= 0 && c.view.local.hour < 23) out.push({ what: "Something reflective", why: `It's been dark since ${localClock(c, st!.sunset)}.`, signal: "dark" });
  const hol = c.view.signals.find((s) => s.kind === "holiday" && /today|tomorrow/.test(s.label));
  if (hol) out.push({ what: "A check of opening hours", why: `${capital(hol.label)}.`, signal: "holiday" });
  if (!wetNow && !firstWet) out.push({ what: "No umbrella needed", why: `Dry for the next ${hs.length} hours.`, signal: "dry" });
  return out.slice(0, 6);
}

const editorial: Template = {
  archetype: "editorial",
  applicable: () => true,
  plan(c) {
    const w = c.view.weather;
    const title = w ? `${capital(c.view.local.weekday)} ${partOfDayPhrase(c)}, ${w.now}` : `${capital(c.view.local.weekday)}, ${c.view.local.clock}`;
    const hasReading = c.view.signals.some((s) => s.kind === "trend");
    const hasCal = c.view.signals.some((s) => s.kind === "holiday" || s.kind === "calendar");
    const sections: PlanSection[] = [{ id: "lead", heading: title, intent: "The moment in a few plain sentences." }];
    if (c.view.coords) sections.push({ id: "light", heading: "The light", intent: "Where the sun and moon are." });
    if (hasCal) sections.push({ id: "calendar", heading: "On the calendar", intent: "What the week holds." });
    if (hasReading) sections.push({ id: "reading", heading: "What the country is reading", intent: "Yesterday's most-read pages, safe topics only." });
    if (sections.length < 2) sections.push({ id: "hours", heading: "The next hours", intent: "What comes next." });
    return { archetype: "editorial", title, purpose: "A short read about this moment in this place.", lead_fact: c.view.reveal[1] ?? c.view.reveal[0], signals_used: c.view.signals.slice(0, 4).map((s) => s.label), live_data: [], sections };
  },
  section(s, plan, c) {
    const w = c.view.weather;
    if (s.id === "lead") {
      const ps: string[] = [];
      ps.push(`It is ${c.view.local.clock} on ${c.view.local.weekday}${placeIn(c)}.`);
      if (w) {
        ps.push(`${capital(w.now)}, ${TL(c, w.temp_c)}.${w.rain_stops ? ` The forecast has it dry by ${hhmmLabel(w.rain_stops)}.` : w.rain_starts ? ` Rain is likely from ${hhmmLabel(w.rain_starts)}.` : ""} Over the next twelve hours: ${w.next_12h}.`);
        if (w.unusual) ps.push(`That is ${w.unusual}.`);
      }
      return { html: `<section id="lead">${kicker(c)}<h1>${e(plan.title)}</h1>${ps.map((p, i) => `<p${i === 0 ? ' class="m-lead"' : ""}>${e(p)}</p>`).join("")}</section>` };
    }
    if (s.id === "light") {
      const st = sun(c)!;
      const m = moon(c.now);
      const toSet = minutesUntil(c, st.sunset), toRise = minutesUntil(c, st.sunrise);
      const ps: string[] = [];
      if (toSet != null && toSet > 0) ps.push(`The sun sets at ${localClock(c, st.sunset)}, in ${humanMinutes(toSet)}.${st.goldenEveningStart && minutesUntil(c, st.goldenEveningStart)! > 0 ? ` Golden hour begins at ${localClock(c, st.goldenEveningStart)}.` : ""}`);
      else if (toSet != null && toSet <= 0 && toRise != null && toRise < 0) ps.push(`The sun went down at ${localClock(c, st.sunset)}.`);
      else if (toRise != null && toRise > 0) ps.push(`Sunrise is at ${localClock(c, st.sunrise)}.`);
      ps.push(`The moon is a ${m.name}, ${Math.round(m.illumination * 100)}% lit.`);
      return { html: `<section id="light"><h2>${e(s.heading)}</h2>${ps.map((p) => `<p>${e(p)}</p>`).join("")}${moonSvg(m.phase)}</section>` };
    }
    if (s.id === "calendar") {
      const cal = c.view.signals.filter((x) => x.kind === "holiday" || x.kind === "calendar");
      return { html: `<section id="calendar"><h2>${e(s.heading)}</h2><ul class="m-list">${cal.map((x) => `<li>${e(capital(x.label))}</li>`).join("")}</ul></section>` };
    }
    if (s.id === "reading") {
      const tr = c.view.signals.filter((x) => x.kind === "trend");
      return { html: `<section id="reading"><h2>${e(s.heading)}</h2><p class="m-muted">The most-read Wikipedia articles here yesterday, after Moment's safety filter.</p><ol>${tr.map((x) => `<li>${e(x.label)} <span class="m-chip">${e(x.category)}</span></li>`).join("")}</ol>${footer()}</section>` };
    }
    return { html: `<section id="${e(s.id)}"><h2>${e(s.heading)}</h2>${w ? bars(c, ahead(c, 12)) : `<p>${e(c.view.reveal.join(". "))}.</p>`}${footer()}</section>` };
  },
};

const ambient: Template = {
  archetype: "ambient",
  applicable: () => true,
  plan(c) {
    const w = c.view.weather;
    return {
      archetype: "ambient",
      title: w ? `${capital(w.now)}${placeIn(c)}` : `${c.view.local.clock}${placeIn(c)}`,
      purpose: "A calm moving picture of the weather and the light outside.",
      lead_fact: c.view.reveal[1] ?? c.view.reveal[0],
      signals_used: ["weather now", "time of day"],
      live_data: [],
      sections: [
        { id: "scene", heading: "Outside", intent: "A full-window animated scene of the sky right now." },
        { id: "soon", heading: "Soon", intent: "One line about the next hours." },
      ],
    };
  },
  section(s, plan, c) {
    const w = c.view.weather;
    if (s.id === "scene") {
      const kind = !w ? (c.view.local.daypart === "night" ? "stars" : "haze") : w.bucket === "rain" || w.bucket === "storm" ? "rain" : w.bucket === "snow" ? "snow" : w.bucket === "fog" ? "fog" : c.view.local.daypart === "night" ? "stars" : "haze";
      return {
        html: `<section id="scene" style="position:relative;min-height:92vh;padding:0;overflow:hidden"><canvas id="sky" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%"></canvas>
<div style="position:relative;padding:clamp(20px,6vw,80px);min-height:92vh;display:flex;flex-direction:column;justify-content:flex-end">${kicker(c)}<h1>${e(plan.title)}</h1>${w ? `<p class="m-lead">${e(T(c, w.temp_c))}. ${e(capital(w.next_12h))}.</p>` : ""}</div></section>`,
        script: `const cv=document.getElementById('sky'),x=cv.getContext('2d');const cs=getComputedStyle(document.documentElement);const fg=cs.getPropertyValue('--fg').trim(),ac=cs.getPropertyValue('--accent').trim();const kind=${JSON.stringify(kind)};const still=matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.classList.contains('motion-still');let W,H,ps=[];const fit=()=>{const r=cv.getBoundingClientRect();W=cv.width=r.width*devicePixelRatio;H=cv.height=r.height*devicePixelRatio;const n=kind==='rain'?Math.round(W*H/9000):kind==='snow'?Math.round(W*H/16000):kind==='stars'?Math.round(W*H/7000):40;ps=Array.from({length:Math.min(n,900)},()=>({x:Math.random()*W,y:Math.random()*H,v:.5+Math.random(),r:Math.random()}))};fit();addEventListener('resize',fit);const draw=t=>{x.clearRect(0,0,W,H);if(kind==='haze'||kind==='fog'){for(const p of ps){x.globalAlpha=kind==='fog'?.05:.06;x.fillStyle=kind==='fog'?fg:ac;x.beginPath();x.arc((p.x+t*.01*p.v)%W,p.y,120*devicePixelRatio*(.5+p.r),0,7);x.fill()}}else if(kind==='stars'){for(const p of ps){x.globalAlpha=.25+.5*Math.abs(Math.sin(t/1400*p.v+p.r*9));x.fillStyle=fg;x.fillRect(p.x,p.y,1.4*devicePixelRatio,1.4*devicePixelRatio)}}else if(kind==='rain'){x.strokeStyle=fg;x.lineWidth=1.3*devicePixelRatio;for(const p of ps){x.globalAlpha=.3+.4*p.r;const y=(p.y+t*.6*p.v*devicePixelRatio)%H;x.beginPath();x.moveTo(p.x,y);x.lineTo(p.x-3*devicePixelRatio,y+22*devicePixelRatio*p.v);x.stroke()}}else{x.fillStyle=fg;for(const p of ps){x.globalAlpha=.35+.4*p.r;const y=(p.y+t*.05*p.v*devicePixelRatio)%H;x.beginPath();x.arc(p.x+Math.sin(t/900+p.r*6)*8,y,(1+p.r*2)*devicePixelRatio,0,7);x.fill()}}x.globalAlpha=1;if(!still)requestAnimationFrame(draw)};requestAnimationFrame(draw);`,
      };
    }
    return { html: `<section id="soon"><h2>${e(s.heading)}</h2>${w ? `<p>${e(capital(w.next_12h))}.</p>${bars(c, ahead(c, 12))}` : `<p>${e(c.view.reveal.slice(1).join(". ") || c.view.local.clock)}.</p>`}${footer()}</section>` };
  },
};

const tool: Template = {
  archetype: "tool",
  applicable: (c) => ahead(c, 12).length >= 8,
  plan(c) {
    const anyWet = ahead(c, 12).some((h) => isWet(h.code));
    return {
      archetype: "tool",
      title: anyWet ? `Find the dry hours${placeIn(c)}` : `The best hours to be outside${placeIn(c)}`,
      purpose: "Pick how long you need outside; get the best window in the next twelve hours.",
      lead_fact: c.view.weather!.next_12h,
      signals_used: ["next 12 hours", "sun"],
      live_data: [],
      sections: [
        { id: "planner", heading: "Window finder", intent: "A slider for hours needed and the best window it finds." },
        { id: "timeline", heading: "The hours", intent: "Each hour scored, so the choice is visible." },
      ],
    };
  },
  section(s, plan, c) {
    const hs = ahead(c, 12);
    const data = hs.map((h) => ({ t: hourLabel(h.t), temp: T(c, h.temp), c: h.temp, pop: h.pop, wet: isWet(h.code), light: isLight(c, h.t), desc: describeCode(h.code) }));
    if (s.id === "planner") {
      return {
        html: `<section id="planner">${kicker(c)}<h1>${e(plan.title)}</h1>
<label for="need" class="m-kicker" style="display:block">I need <b id="need-v">1 hour</b> outside</label>
<input id="need" type="range" min="1" max="4" step="1" value="1" data-m="need-slider">
<p class="m-lead" id="answer" aria-live="polite" style="margin-top:1em"></p></section>`,
        script: `const H=${JSON.stringify(data)};const sc=h=>(h.wet?0:1)*(100-h.pop)+(h.light?25:0)-Math.abs(h.c-18);const run=()=>{const n=+document.getElementById('need').value;document.getElementById('need-v').textContent=n+(n===1?' hour':' hours');let best=-1,bi=-1;for(let i=0;i+n<=H.length;i++){const w=H.slice(i,i+n);if(w.some(h=>h.wet))continue;const s=w.reduce((a,h)=>a+sc(h),0)/n;if(s>best){best=s;bi=i}}const a=document.getElementById('answer');if(bi<0){a.textContent='No dry stretch that long in the next twelve hours. The driest single hour is '+H.reduce((m,h)=>h.pop<m.pop?h:m).t+'.';}else{const w=H.slice(bi,bi+n);a.textContent='Best window: '+(w[0].t+(n>1?' to '+(H[bi+n]?H[bi+n].t:'the end of the forecast'):'')).replace(/\\.$/,'')+'. '+w.map(h=>h.desc).filter((v,i,x)=>x.indexOf(v)===i).join(', ')+', '+w[0].temp+(w.every(h=>h.light)?', in daylight.':'.');}document.querySelectorAll('#tl li').forEach((li,i)=>{li.style.background=bi>=0&&i>=bi&&i<bi+n?'var(--surface)':''})};document.getElementById('need').addEventListener('input',run);run();`,
      };
    }
    return {
      html: `<section id="timeline"><h2>${e(s.heading)}</h2><ul class="m-list" id="tl">${data.map((h) => `<li class="m-row" style="justify-content:space-between;padding-inline:.5em"><span class="m-mono">${e(h.t)}</span><span>${e(h.desc)}${h.light ? "" : ' <span class="m-chip">dark</span>'}</span><span>${e(h.temp)} · ${h.pop}%</span></li>`).join("")}</ul>${footer()}</section>`,
    };
  },
};

const quiz: Template = {
  archetype: "quiz",
  applicable: (c) => !!c.view.weather && !!c.view.coords,
  plan(c) {
    return {
      archetype: "quiz",
      title: `How well do you know this ${partOfDayPhrase(c)}${placeIn(c)}?`,
      purpose: "Three quick questions about the sky outside, answered by the forecast.",
      lead_fact: c.view.reveal[1] ?? "",
      signals_used: ["sun", "next 12 hours", "unusual weather"],
      live_data: [],
      sections: [
        { id: "questions", heading: "Three questions", intent: "Multiple choice, answers revealed on tap." },
        { id: "score", heading: "Score", intent: "The tally." },
      ],
    };
  },
  section(s, plan, c) {
    if (s.id === "questions") {
      const qs = questions(c);
      return {
        html: `<section id="questions">${kicker(c)}<h1>${e(plan.title)}</h1>${qs.map((q, i) => `<div class="m-card" style="margin:1em 0" data-q="${i}"><p><b>${i + 1}. ${e(q.q)}</b></p><div class="m-row">${q.options.map((o, j) => `<button type="button" data-m="q${i}-${j}" data-ok="${j === q.answer}">${e(o)}</button>`).join("")}</div><p class="m-muted" hidden style="margin-top:.8em">${e(q.fact)}</p></div>`).join("")}</section>`,
        script: `let right=0,done=0;document.querySelectorAll('#questions [data-q]').forEach(card=>{card.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{if(card.dataset.done)return;card.dataset.done='1';done++;const ok=b.dataset.ok==='true';if(ok)right++;b.style.background=ok?'var(--accent)':'var(--surface)';b.style.color=ok?'var(--bg)':'';card.querySelector('[data-ok="true"]').style.outline='2px solid var(--accent)';card.querySelector('p[hidden]').hidden=false;const s=document.getElementById('tally');if(s)s.textContent=right+' of '+done;}))});`,
      };
    }
    return { html: `<section id="score"><h2>${e(s.heading)}</h2><div class="m-accent" id="tally" style="font-family:var(--font-display);font-size:clamp(40px,7vw,88px);line-height:1;white-space:nowrap">0 of 0</div>${footer()}</section>` };
  },
};

function questions(c: TemplateCtx): { q: string; options: string[]; answer: number; fact: string }[] {
  const out: { q: string; options: string[]; answer: number; fact: string }[] = [];
  const st = sun(c)!;
  const rot = (xs: string[], ans: number, seed: number) => {
    const k = seed % xs.length;
    return { options: [...xs.slice(k), ...xs.slice(0, k)], answer: (ans - k + xs.length) % xs.length };
  };
  if (st.sunset) {
    const set = localParts(st.sunset, c.view.tz);
    const opts = [-47, 0, 38].map((d) => {
      const m = set.hour * 60 + set.minute + d;
      return clock12(Math.floor(m / 60) % 24, ((m % 60) + 60) % 60);
    });
    const r = rot(opts, 1, set.minute);
    const past = st.sunset.getTime() < c.now.getTime();
    out.push({ q: past ? "What time did the sun set today?" : "What time does the sun set today?", ...r, fact: `${localClock(c, st.sunset)}.${st.goldenEveningStart ? ` Golden hour starts at ${localClock(c, st.goldenEveningStart)}.` : ""}` });
  }
  const hs = ahead(c, 4);
  const rainSoon = hs.slice(1).some((h) => isWet(h.code) && h.pop >= 50);
  out.push({ q: "Will it rain in the next three hours?", options: ["Yes", "No"], answer: rainSoon ? 0 : 1, fact: `Highest chance in the next three hours: ${Math.max(0, ...hs.slice(1).map((h) => h.pop))}%.` });
  const w = c.view.weather!;
  if (w.anomaly_z != null && w.unusual) {
    out.push({ q: "Compared with a typical day at this time of year, today's high is…", options: ["Warmer", "About normal", "Colder"], answer: w.anomaly_z > 0 ? 0 : 2, fact: capital(w.unusual) + "." });
  } else if (w.anomaly_z != null) {
    out.push({ q: "Compared with a typical day at this time of year, today's high is…", options: ["Warmer", "About normal", "Colder"], answer: 1, fact: "Within the normal range for the date." });
  } else {
    const all = ahead(c, 12).map((h) => h.temp);
    const hi = Math.max(...all);
    const r = rot([T(c, hi - 4), T(c, hi), T(c, hi + 5)], 1, Math.round(hi));
    out.push({ q: "How warm does it get in the next twelve hours?", ...r, fact: `Up to ${TL(c, hi)}.` });
  }
  return out;
}

const guide: Template = {
  archetype: "guide",
  applicable: (c) => ahead(c, 5).length >= 4,
  plan(c) {
    return {
      archetype: "guide",
      title: `The next four hours${placeIn(c)}, hour by hour`,
      purpose: "What each hour is good for, judged from the forecast and the light.",
      lead_fact: c.view.reveal[1] ?? "",
      signals_used: ["next 12 hours", "sun"],
      live_data: [],
      sections: [
        { id: "hours", heading: "Hour by hour", intent: "Each of the next four hours with a plain suggestion." },
        { id: "best", heading: "If you do one thing", intent: "The best hour, and why." },
      ],
    };
  },
  section(s, plan, c) {
    const hs = ahead(c, 5).slice(1, 5);
    if (s.id === "hours") {
      return {
        html: `<section id="hours">${kicker(c)}<h1>${e(plan.title)}</h1>${hs.map((h) => `<div style="display:grid;grid-template-columns:minmax(5.5em,auto) 1fr;gap:1em;padding:1em 0;border-top:1px solid var(--line)"><div class="m-mono m-accent">${e(hourLabel(h.t))}</div><div><b>${e(capital(describeCode(h.code)))}, ${e(T(c, h.temp))}</b><br>${e(suggestion(c, h, isLight(c, h.t)))}</div></div>`).join("")}</section>`,
      };
    }
    const scored = hs.map((h) => ({ h, s: (dry(h) ? 100 : 0) - h.pop + (isLight(c, h.t) ? 30 : 0) - Math.abs(h.temp - 18) }));
    const best = scored.sort((a, b) => b.s - a.s)[0].h;
    return { html: `<section id="best"><h2>${e(s.heading)}</h2><p class="m-lead">Go out at <b class="m-accent">${e(hourLabel(best.t))}</b>: ${e(describeCode(best.code))}, ${e(T(c, best.temp))}, ${best.pop}% chance of rain${isLight(c, best.t) ? ", still light" : ""}.</p>${footer()}</section>` };
  },
};

export const TEMPLATES: Template[] = [countdown, dashboard, checklist, guide, tool, quiz, editorial, ambient];

export function templateFor(archetype: string): Template | undefined {
  return TEMPLATES.find((t) => t.archetype === archetype);
}

export function templateCandidates(c: TemplateCtx, exclude: string[]): Plan[] {
  return TEMPLATES.filter((t) => !exclude.includes(t.archetype) && t.applicable(c)).map((t) => t.plan(c));
}

// "a.m." at the end of a sentence takes no second period.
const tidy = (s: string) => s.replace(/([ap])\.m\.\./g, "$1.m.");

export function renderTemplateSection(plan: Plan, s: PlanSection, c: TemplateCtx): SectionOut {
  const t = templateFor(plan.archetype) ?? editorial;
  try {
    const out = t.section(s, plan, c);
    return { ...out, html: tidy(out.html) };
  } catch (err) {
    console.error("template section failed", plan.archetype, s.id, err);
    return { html: `<section id="${e(s.id)}"><h2>${e(s.heading)}</h2><p>${e(c.view.reveal.join(". "))}.</p></section>` };
  }
}
