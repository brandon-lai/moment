import type { Daypart } from "./types";

// Seeded PRNG (mulberry32). Art direction and the template generator draw from
// this so a session's look is reproducible from its seed.
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick<T>(rand: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rand() * xs.length) % xs.length];
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function randomId(bytes = 16): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Local wall-clock parts for a timezone, without a date library.
export interface LocalParts {
  year: number; month: number; day: number; hour: number; minute: number;
  weekday: string;      // "Tuesday"
  weekdayShort: string; // "Tue"
  isoDate: string;      // "2026-11-10"
}

export function localParts(date: Date, tz: string): LocalParts {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "long" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "long" });
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const year = +parts.year, month = +parts.month, day = +parts.day;
  return {
    year, month, day,
    hour: +parts.hour % 24, minute: +parts.minute,
    weekday: parts.weekday, weekdayShort: parts.weekday.slice(0, 3),
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function daypartOf(hour: number): Daypart {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "midday";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

export function isWeekend(weekday: string): boolean {
  return weekday === "Saturday" || weekday === "Sunday";
}

// "6:12 p.m." — the PRD's house style for times.
export function clock12(hour: number, minute: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  const ampm = hour < 12 ? "a.m." : "p.m.";
  return `${h}:${String(minute).padStart(2, "0")} ${ampm}`;
}

// Forecast times are whole hours: "7 p.m.", "noon", "midnight".
export function clockFromHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (m) return clock12(h, m);
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return `${h % 12} ${h < 12 ? "a.m." : "p.m."}`;
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([p, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms))]);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// Fahrenheit where people read Fahrenheit.
const F_COUNTRIES = new Set(["US", "PR", "LR", "BS", "KY", "PW", "FM", "MH", "BZ"]);
export type TempUnit = "F" | "C";
export const unitFor = (country: string | null | undefined): TempUnit => (country && F_COUNTRIES.has(country) ? "F" : "C");
export const toF = (c: number) => Math.round((c * 9) / 5 + 32);
export const fmtTemp = (c: number, u: TempUnit) => (u === "F" ? `${toF(c)}°F` : `${Math.round(c)}°C`);
export const fmtTempShort = (c: number, u: TempUnit) => (u === "F" ? `${toF(c)}°` : `${Math.round(c)}°`);
export const fmtDelta = (dc: number, u: TempUnit) => (u === "F" ? `${Math.round(Math.abs(dc) * 9 / 5)}°F` : `${Math.round(Math.abs(dc))}°C`);
