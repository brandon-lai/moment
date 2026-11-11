// Open-Meteo pollers: forecast (every rebuild) and climatology for "how
// unusual today is" (fetched once per cell, then cached forever).
// Open-Meteo's free API is for non-commercial use; see README.

import type { HourPoint, WeatherBucket } from "../../edge/src/types";

export interface Coord { lat: number; lon: number }

export interface ForecastResult {
  tz: string;
  hourly: HourPoint[];             // local hours, from the start of today
  daily: { date: string; sunrise: string; sunset: string; tmax: number; tmin: number; code: number }[];
}

const HOURLY = "temperature_2m,precipitation_probability,precipitation,weather_code";
const DAILY = "sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code";

export async function fetchForecasts(coords: Coord[], fetcher: typeof fetch = fetch): Promise<ForecastResult[]> {
  if (coords.length === 0) return [];
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", coords.map((c) => c.lat.toFixed(3)).join(","));
  url.searchParams.set("longitude", coords.map((c) => c.lon.toFixed(3)).join(","));
  url.searchParams.set("hourly", HOURLY);
  url.searchParams.set("daily", DAILY);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "3");
  const res = await fetcher(url.toString(), { headers: { "user-agent": "moment-brief-compiler" } });
  if (!res.ok) throw new Error(`open-meteo forecast ${res.status}`);
  const body = (await res.json()) as unknown;
  const list = (Array.isArray(body) ? body : [body]) as OpenMeteoForecast[];
  return list.map(normalizeForecast);
}

interface OpenMeteoForecast {
  timezone: string;
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; precipitation: number[]; weather_code: number[] };
  daily: { time: string[]; sunrise: string[]; sunset: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] };
}

export function normalizeForecast(f: OpenMeteoForecast): ForecastResult {
  const h = f.hourly;
  const hourly: HourPoint[] = h.time.map((t, i) => ({
    t,
    temp: Math.round(h.temperature_2m[i] * 10) / 10,
    pop: h.precipitation_probability[i] ?? 0,
    mm: Math.round((h.precipitation[i] ?? 0) * 10) / 10,
    code: h.weather_code[i] ?? 0,
  }));
  const d = f.daily;
  return {
    tz: f.timezone,
    hourly,
    daily: d.time.map((date, i) => ({
      date,
      sunrise: d.sunrise[i]?.slice(11, 16) ?? "",
      sunset: d.sunset[i]?.slice(11, 16) ?? "",
      tmax: d.temperature_2m_max[i],
      tmin: d.temperature_2m_min[i],
      code: d.weather_code[i],
    })),
  };
}

// Climatology: mean and spread of the daily high for each day of the year,
// from the ten most recent complete years, smoothed over a ±7 day window.
export interface Climatology { mean: number[]; sd: number[] } // index = day of year 0..365

export async function fetchClimatology(c: Coord, year: number, fetcher: typeof fetch = fetch): Promise<Climatology> {
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", c.lat.toFixed(2));
  url.searchParams.set("longitude", c.lon.toFixed(2));
  url.searchParams.set("start_date", `${year - 10}-01-01`);
  url.searchParams.set("end_date", `${year - 1}-12-31`);
  url.searchParams.set("daily", "temperature_2m_max");
  url.searchParams.set("timezone", "auto");
  const res = await fetcher(url.toString(), { headers: { "user-agent": "moment-brief-compiler" } });
  if (!res.ok) throw new Error(`open-meteo archive ${res.status}`);
  const body = (await res.json()) as { daily: { time: string[]; temperature_2m_max: (number | null)[] } };
  return climatologyFrom(body.daily.time, body.daily.temperature_2m_max);
}

export function dayOfYear(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
}

export function climatologyFrom(dates: string[], highs: (number | null)[]): Climatology {
  const buckets: number[][] = Array.from({ length: 366 }, () => []);
  dates.forEach((date, i) => {
    const v = highs[i];
    if (v == null) return;
    buckets[Math.min(365, dayOfYear(date))].push(v);
  });
  const mean: number[] = [], sd: number[] = [];
  for (let doy = 0; doy < 366; doy++) {
    const vals: number[] = [];
    for (let k = -7; k <= 7; k++) vals.push(...buckets[(doy + k + 366) % 366]);
    const m = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
    const v = vals.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, vals.length - 1);
    mean.push(Math.round(m * 10) / 10);
    sd.push(Math.round(Math.sqrt(v) * 10) / 10);
  }
  return { mean, sd };
}

export function anomaly(clim: Climatology | null, isoDate: string, tmax: number): { z: number; delta: number } | null {
  if (!clim) return null;
  const doy = Math.min(365, dayOfYear(isoDate));
  const m = clim.mean[doy], s = clim.sd[doy];
  if (!Number.isFinite(m) || !s) return null;
  return { z: Math.round(((tmax - m) / s) * 100) / 100, delta: Math.round(tmax - m) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function anomalyText(a: { z: number; delta: number } | null, isoDate: string, unit: "F" | "C" = "C"): string | null {
  if (!a || Math.abs(a.z) < 1.2 || Math.abs(a.delta) < 3) return null;
  const [, m, d] = isoDate.split("-").map(Number);
  const word = a.delta > 0 ? "warmer" : "colder";
  const deg = unit === "F" ? `${Math.round(Math.abs(a.delta) * 9 / 5)}°F` : `${Math.abs(a.delta)}°C`;
  return `${deg} ${word} than a typical ${MONTHS[m - 1]} ${d}`;
}

// WMO weather interpretation codes.
export function describeCode(code: number): string {
  if (code === 0) return "clear";
  if (code === 1) return "mostly clear";
  if (code === 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 55) return "drizzle";
  if (code === 56 || code === 57) return "freezing drizzle";
  if (code === 61) return "light rain";
  if (code === 63) return "rain";
  if (code === 65) return "heavy rain";
  if (code === 66 || code === 67) return "freezing rain";
  if (code === 71) return "light snow";
  if (code === 73) return "snow";
  if (code === 75) return "heavy snow";
  if (code === 77) return "snow grains";
  if (code === 80) return "light showers";
  if (code === 81) return "showers";
  if (code === 82) return "heavy showers";
  if (code === 85 || code === 86) return "snow showers";
  if (code === 95) return "thunderstorms";
  if (code >= 96) return "thunderstorms with hail";
  return "mixed weather";
}

export function bucketOf(code: number): WeatherBucket {
  if (code <= 1) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "cloudy";
}

export const isWet = (code: number) => bucketOf(code) === "rain" || bucketOf(code) === "storm" || bucketOf(code) === "snow";
