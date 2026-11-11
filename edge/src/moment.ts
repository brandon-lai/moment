// The moment as seen at request time: the brief plus everything that depends
// on the exact minute. Briefs are rebuilt every few hours; this view is
// recomputed on every visit from the hourly series the brief carries.

import type { Brief, BriefWeather, Daypart, Layer1, Signal } from "./types";
import { clock12, clockFromHHMM, daypartOf, fmtTemp, fmtTempShort, isWeekend, localParts, unitFor, type LocalParts, type TempUnit } from "./util";
import { weatherView } from "../../ingest/src/compile";
import { sunTimes } from "../../ingest/src/sky";

export interface MomentView {
  tz: string;
  local: LocalParts & { daypart: Daypart; weekend: boolean; clock: string };
  place: string;          // city-level name for copy: never finer than a city
  weather: BriefWeather | null;
  signals: Signal[];      // brief signals + time-dependent ones, ranked
  reveal: string[];       // lines for the shell's "reading the room"
  coords: { lat: number; lon: number } | null;
  unit: TempUnit;
  country: string;
}

export function momentView(brief: Brief, l1: Layer1 | null, now: Date): MomentView {
  const tz = brief.local.tz && brief.cell !== "global" ? brief.local.tz : l1?.tz || brief.local.tz || "UTC";
  const lp = localParts(now, tz);
  const daypart = daypartOf(lp.hour);
  const weekend = isWeekend(lp.weekday);
  const clock = clock12(lp.hour, lp.minute);
  const place = l1?.city || (brief.cell === "global" ? "" : brief.label);
  const country = brief.country || l1?.country || "XX";
  const unit = unitFor(country);
  const coords = brief.coords ?? (l1?.lat != null && l1?.lon != null ? { lat: l1.lat, lon: l1.lon } : null);

  let weather: BriefWeather | null = null;
  if (brief.weather?.hourly?.length) {
    const daily = brief.weather.daily ?? [];
    weather = { ...weatherView(brief.weather.hourly, daily, lp.isoDate, lp.hour, lp.minute, unit), unusual: brief.weather.unusual ?? null, anomaly_z: brief.weather.anomaly_z ?? null };
  }

  const signals: Signal[] = brief.signals.filter((s) => !(s.kind === "holiday" && /today|tomorrow/.test(s.label) && staleHoliday(brief, lp.isoDate)));
  const minutesNow = lp.hour * 60 + lp.minute;

  if (weather) {
    signals.push({ kind: "weather", label: `${weather.now}, ${fmtTempShort(weather.temp_c, unit)}`, category: "weather", score: 0.95, source: "open-meteo" });
    if (weather.rain_stops) signals.push({ kind: "weather", label: `${capital(weatherWord(weather.code))} stops around ${clockFromHHMM(weather.rain_stops)}`, category: "weather", score: 0.93, at: weather.rain_stops, source: "open-meteo" });
    if (weather.rain_starts) signals.push({ kind: "weather", label: `Rain likely from ${clockFromHHMM(weather.rain_starts)}`, category: "weather", score: 0.9, at: weather.rain_starts, source: "open-meteo" });
    const ahead = weather.hourly?.slice(1, 13) ?? [];
    if (ahead.length) {
      const lo = Math.min(...ahead.map((h) => h.temp));
      if (lo <= 0 && weather.temp_c > 0) signals.push({ kind: "weather", label: `Down to ${fmtTemp(lo, unit)} overnight, below freezing`, category: "weather", score: 0.7, source: "open-meteo" });
    }
  }

  if (coords) {
    const st = sunTimes(now, coords.lat, coords.lon);
    const mins = (d: Date | null) => (d ? Math.round((d.getTime() - now.getTime()) / 60000) : null);
    const toSet = mins(st.sunset), toGold = mins(st.goldenEveningStart), toRise = mins(st.sunrise);
    const fmt = (d: Date | null) => {
      if (!d) return "";
      const p = localParts(d, tz);
      return clock12(p.hour, p.minute);
    };
    if (toGold != null && toSet != null && toGold <= 0 && toSet > 0) {
      signals.push({ kind: "sun", label: `Golden hour now, sunset at ${fmt(st.sunset)}`, category: "sky", score: 0.88, source: "computed" });
    } else if (toSet != null && toSet > 0 && toSet <= 180) {
      signals.push({ kind: "sun", label: `Sunset at ${fmt(st.sunset)}, in ${humanMinutes(toSet)}`, category: "sky", score: 0.82, source: "computed" });
    } else if (toSet != null && toSet <= 0 && toSet > -90) {
      signals.push({ kind: "sun", label: `The sun set at ${fmt(st.sunset)}`, category: "sky", score: 0.55, source: "computed" });
    } else if (toRise != null && toRise > 0 && toRise <= 150) {
      signals.push({ kind: "sun", label: `Sunrise at ${fmt(st.sunrise)}, in ${humanMinutes(toRise)}`, category: "sky", score: 0.8, source: "computed" });
    }
  }

  if (lp.weekday === "Friday" && minutesNow >= 15 * 60) signals.push({ kind: "calendar", label: "The weekend starts tonight", category: "calendar", score: 0.6, source: "computed" });
  if (lp.weekday === "Sunday" && minutesNow >= 16 * 60) signals.push({ kind: "calendar", label: "Back to the week tomorrow", category: "calendar", score: 0.5, source: "computed" });
  if (lp.weekday === "Monday" && minutesNow < 11 * 60) signals.push({ kind: "calendar", label: "First morning of the week", category: "calendar", score: 0.45, source: "computed" });

  signals.sort((a, b) => b.score - a.score);
  const dedup = dedupe(signals).slice(0, 12);

  const reveal: string[] = [`${lp.weekday}, ${clock}`];
  if (weather) reveal.push(`${capital(weather.now)}${place ? ` in ${place}` : ""}, ${fmtTempShort(weather.temp_c, unit)}`);
  else if (place) reveal.push(place);
  for (const s of dedup) {
    if (reveal.length >= 4) break;
    if (s.kind === "weather" && s.label.startsWith(weather?.now ?? "\u0000")) continue;
    if (s.kind === "trend") continue; // trends are for the page, not the reveal
    reveal.push(capital(s.label));
  }

  return { tz, local: { ...lp, daypart, weekend, clock }, place, weather, signals: dedup, reveal, coords, unit, country };
}

function staleHoliday(brief: Brief, today: string): boolean {
  return brief.built_at.slice(0, 10) !== today && !brief.local.holiday;
}

function dedupe(xs: Signal[]): Signal[] {
  const seen = new Set<string>();
  return xs.filter((s) => (seen.has(s.label) ? false : (seen.add(s.label), true)));
}

export function humanMinutes(m: number): string {
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60), r = m % 60;
  if (r < 8) return h === 1 ? "an hour" : `${h} hours`;
  return `${h} h ${r} min`;
}

export function weatherWord(code: number): string {
  if (code >= 71 && code <= 86 && code !== 80 && code !== 81 && code !== 82) return "the snow";
  if (code >= 51 && code <= 57) return "the drizzle";
  if (code >= 95) return "the storm";
  return "the rain";
}

export const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
