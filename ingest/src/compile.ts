// The brief compiler: boils everything known about one place down to a small,
// ranked record (PRD: Moment Brief). Pure functions; I/O lives in pipeline.ts.

import type { Brief, BriefWeather, Daypart, HourPoint, Signal } from "../../edge/src/types";
import { daypartOf, localParts, clockFromHHMM, fmtTempShort, unitFor, type TempUnit } from "../../edge/src/util";
import { anomaly, anomalyText, bucketOf, describeCode, isWet, type Climatology, type ForecastResult } from "./weather";
import { holidaySignals, holidayToday, type Holiday } from "./holidays";
import { moon } from "./sky";

export interface CellMeta {
  cell: string;
  label: string;
  country: string;
  region: string | null;
  lat: number | null;
  lon: number | null;
  tz: string;
}

export interface CompileInput {
  meta: CellMeta;
  now: Date;
  forecast: ForecastResult | null;
  climatology: Climatology | null;
  holidays: Holiday[];
  trends: { term: string; category: string; rank: number; views: number }[];
  priors: Record<string, number>;
}

// Source weights: how much a signal from each source is worth before
// freshness and local lift. Tuned by hand; the learner tunes archetypes, not these.
export const SOURCE_WEIGHT: Record<string, number> = {
  weather: 0.95, unusual: 0.9, holiday: 0.9, sun: 0.75, trend: 0.6, sky: 0.45, calendar: 0.5,
};

export function score(source: string, freshness: number, lift = 1): number {
  const s = (SOURCE_WEIGHT[source] ?? 0.4) * freshness * Math.min(lift, 2) / 1.0;
  return Math.round(Math.min(1, s) * 100) / 100;
}

export function compileBrief(input: CompileInput): Brief {
  const { meta, now, forecast } = input;
  const tz = forecast?.tz || meta.tz;
  const lp = localParts(now, tz);
  const signals: Signal[] = [];

  let weather: BriefWeather | null = null;
  if (forecast) {
    weather = weatherView(forecast.hourly, forecast.daily, lp.isoDate, lp.hour, 0, unitFor(meta.country));
    const today = forecast.daily.find((d) => d.date === lp.isoDate);
    if (today && input.climatology) {
      const a = anomaly(input.climatology, lp.isoDate, today.tmax);
      const text = anomalyText(a, lp.isoDate, unitFor(meta.country));
      weather.anomaly_z = a?.z ?? null;
      weather.unusual = text;
      if (text && a) signals.push({ kind: "unusual", label: text, category: "weather", score: score("unusual", Math.min(1, 0.55 + Math.abs(a.z) / 4)), source: "open-meteo-archive" });
    }
  }

  for (const h of holidaySignals(input.holidays, lp.isoDate, meta.region, meta.country)) {
    const fresh = h.daysAway === 0 ? 1 : h.daysAway === 1 ? 0.92 : h.daysAway <= 6 ? 0.8 : 0.55;
    signals.push({ kind: "holiday", label: h.label, category: "calendar", score: score("holiday", fresh), at: undefined, source: "nager-date" });
  }

  const m = moon(now);
  if (m.name === "full moon" || m.name === "new moon") {
    signals.push({ kind: "sky", label: `${m.name} tonight`, category: "sky", score: score("sky", 0.9), source: "computed" });
  }

  input.trends.slice(0, 5).forEach((t, i) => {
    // Country-level reading has no metro breakdown, so local lift is 1.
    signals.push({ kind: "trend", label: t.term, category: t.category, score: score("trend", 0.85 - i * 0.08, 1), lift: 1, source: "wikimedia" });
  });

  signals.sort((a, b) => b.score - a.score);

  return {
    cell: meta.cell,
    label: meta.label,
    built_at: now.toISOString(),
    coords: meta.lat != null && meta.lon != null ? { lat: round3(meta.lat), lon: round3(meta.lon) } : undefined,
    country: meta.country,
    local: { tz, weekday: lp.weekday, daypart: daypartOf(lp.hour), holiday: holidayToday(input.holidays, lp.isoDate, meta.region, meta.country) },
    weather,
    signals: signals.slice(0, 12),
    priors: { archetypes: input.priors },
    sources: [forecast ? "open-meteo" : null, input.climatology ? "open-meteo-archive" : null, "nager-date", input.trends.length ? "wikimedia" : null, "computed-sky"].filter(Boolean) as string[],
  };
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

// Weather as seen from a given local hour. The brief carries the hourly
// series, so the edge can re-derive "now" at request time and a brief built
// hours ago still says the right thing about the rain.
export function weatherView(hourly: HourPoint[], daily: ForecastResult["daily"], isoDate: string, hour: number, minute = 0, unit: TempUnit = "C"): BriefWeather {
  const key = `${isoDate}T${String(hour).padStart(2, "0")}:00`;
  let idx = hourly.findIndex((h) => h.t === key);
  if (idx < 0) idx = Math.max(0, hourly.findIndex((h) => h.t > key) - 1);
  const cur = hourly[idx] ?? hourly[0];
  const ahead = hourly.slice(idx, idx + 13);
  const today = daily.find((d) => d.date === isoDate) ?? daily[0];
  const nowDesc = describeCode(cur?.code ?? 0);

  let rainStops: string | null = null, rainStarts: string | null = null;
  if (cur && isWet(cur.code)) {
    const dry = ahead.findIndex((h, i) => i > 0 && !isWet(h.code) && h.pop < 40);
    if (dry > 0) rainStops = ahead[dry].t.slice(11, 16);
  } else {
    const wet = ahead.findIndex((h, i) => i > 0 && isWet(h.code) && h.pop >= 50);
    if (wet > 0) rainStarts = ahead[wet].t.slice(11, 16);
  }

  // Keep a 30-hour window: enough for "tonight" and "tomorrow morning".
  const series = hourly.slice(Math.max(0, idx - 1), idx + 30);

  return {
    now: nowDesc,
    bucket: bucketOf(cur?.code ?? 0),
    code: cur?.code ?? 0,
    temp_c: Math.round(cur?.temp ?? 0),
    next_12h: summarize12h(ahead, rainStops, rainStarts, unit),
    sunrise: today?.sunrise,
    sunset: today?.sunset,
    hourly: series,
    rain_stops: rainStops,
    rain_starts: rainStarts,
    unusual: null,
    anomaly_z: null,
    daily: daily.slice(0, 3),
  } as BriefWeather;
}

export function summarize12h(ahead: HourPoint[], rainStops: string | null, rainStarts: string | null, unit: TempUnit = "C"): string {
  if (ahead.length === 0) return "";
  const temps = ahead.map((h) => h.temp);
  const lo = fmtTempShort(Math.min(...temps), unit), hi = fmtTempShort(Math.max(...temps), unit);
  const parts: string[] = [];
  if (rainStops) parts.push(`clearing after ${clockFromHHMM(rainStops)}`);
  else if (rainStarts) parts.push(`${describeCode(ahead.find((h) => h.t.slice(11, 16) === rainStarts)?.code ?? 61)} from ${clockFromHHMM(rainStarts)}`);
  else if (ahead.every((h) => isWet(h.code))) parts.push("wet throughout");
  else parts.push(describeCode(mode(ahead.map((h) => h.code))));
  parts.push(lo === hi ? lo : `${lo} to ${hi}`);
  return parts.join(", ");
}

function mode(xs: number[]): number {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function daypartAt(now: Date, tz: string): Daypart {
  return daypartOf(localParts(now, tz).hour);
}
