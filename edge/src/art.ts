// Art direction: a seeded draw from curated sets, chosen by code rather than
// by the model, because models left to choose their own style drift toward
// the same look (PRD: Art direction).

import fonts from "../../design/fonts.json";
import palettes from "../../design/palettes.json";
import layouts from "../../design/layouts.json";
import banned from "../../design/banned.json";
import type { ArtDirection, Daypart, FontPairing, Layout, Palette, WeatherBucket } from "./types";
import { prng } from "./util";

export const FONTS = fonts as FontPairing[];
export const PALETTES = palettes as Palette[];
export const LAYOUTS = layouts as Layout[];
export const BANNED: string[] = banned.patterns;

// Learned style weights (PRD: "styles that keep losing get drawn less often").
export interface StyleWeights { font?: Record<string, number>; palette?: Record<string, number>; layout?: Record<string, number> }

function weighted<T extends { id: string }>(rand: () => number, xs: T[], w?: Record<string, number>): T {
  const ws = xs.map((x) => Math.max(0.05, w?.[x.id] ?? 1));
  const total = ws.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < xs.length; i++) {
    r -= ws[i];
    if (r <= 0) return xs[i];
  }
  return xs[xs.length - 1];
}

export function palettesFor(weather: WeatherBucket, daypart: Daypart): Palette[] {
  const exact = PALETTES.filter((p) => p.weather.includes(weather) && p.dayparts.includes(daypart));
  if (exact.length >= 2) return exact;
  // Fall back to the daypart alone, but never to a palette tagged only for
  // clear skies when it is not clear (no beach palette on a rainy evening).
  return PALETTES.filter((p) => p.dayparts.includes(daypart) && (weather === "clear" || !(p.weather.length === 1 && p.weather[0] === "clear")));
}

export interface ArtInput {
  seed: number;
  weather: WeatherBucket;
  daypart: Daypart;
  reducedMotion?: boolean;
  compact?: boolean;     // multitasking or saving data
  archetype?: string;
  weights?: StyleWeights;
}

export function drawArt(input: ArtInput): ArtDirection {
  const rand = prng(input.seed);
  const layoutPool = input.archetype === "ambient" ? LAYOUTS.filter((l) => ["full-bleed", "poster", "single-column"].includes(l.id)) : LAYOUTS;
  const layout = weighted(rand, layoutPool, input.weights?.layout);
  const terminal = layout.id === "terminal";
  const fontPool = FONTS.filter((f) => (terminal ? f.tags.includes("terminal") : !f.tags.includes("terminal") || f.tags.includes("technical")));
  const font = weighted(rand, fontPool, input.weights?.font);
  let palPool = palettesFor(input.weather, input.daypart);
  if (terminal) {
    const dark = palPool.filter((p) => p.scheme === "dark");
    if (dark.length) palPool = dark;
  }
  const palette = weighted(rand, palPool, input.weights?.palette);
  const motions = ["still", "gentle", "lively"] as const;
  // An ambient page is its motion; it only goes still when the visitor asks.
  const drawn = motions[Math.floor(rand() * 3)];
  const motion = input.reducedMotion ? "still" : input.archetype === "ambient" && drawn === "still" ? "gentle" : drawn;
  const densities = ["airy", "balanced", "dense"] as const;
  const density = input.compact ? "dense" : densities[Math.floor(rand() * 3)];
  const radius = terminal ? 0 : [0, 2, 6, 12, 18][Math.floor(rand() * 5)];
  return { seed: input.seed, font, palette, layout, motion, density, radius };
}

// A dark counterpart for visitors whose system prefers dark, applied with a
// CSS media query so it works in EU mode too, where nothing is posted.
export function darkAlternate(art: ArtDirection, weather: WeatherBucket): Palette | null {
  if (art.palette.scheme === "dark") return null;
  const pool = PALETTES.filter((p) => p.scheme === "dark" && p.weather.includes(weather));
  const list = pool.length ? pool : PALETTES.filter((p) => p.scheme === "dark");
  return list[art.seed % list.length];
}

export function fontsHref(f: FontPairing): string {
  const fam = (name: string, weights: number[]) => {
    const n = name.replace(/ /g, "+");
    return weights.length === 1 && weights[0] === 400 ? `family=${n}` : `family=${n}:wght@${weights.join(";")}`;
  };
  const fams = [fam(f.display, f.displayWeights)];
  if (f.body !== f.display) fams.push(fam(f.body, f.bodyWeights));
  if (f.mono !== f.body && f.mono !== f.display) fams.push(fam(f.mono, [400, 700]));
  return `https://fonts.googleapis.com/css2?${fams.join("&")}&display=swap`;
}

export function artSummary(a: ArtDirection): string {
  return `${a.layout.id} · ${a.font.display}/${a.font.body} · ${a.palette.id} · ${a.motion} · ${a.density}`;
}
