import { describe, expect, it } from "vitest";
import { FONTS, LAYOUTS, PALETTES, drawArt, fontsHref, palettesFor } from "../src/art";
import type { Daypart, WeatherBucket } from "../src/types";

function lum(hex: string): number {
  const c = hex.replace("#", "").match(/../g)!.map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const WEATHER: WeatherBucket[] = ["clear", "cloudy", "fog", "rain", "snow", "storm"];
const DAYPARTS: Daypart[] = ["morning", "midday", "afternoon", "evening", "night"];

describe("curated design sets", () => {
  it("has the sizes the PRD names", () => {
    expect(FONTS).toHaveLength(30);
    expect(PALETTES).toHaveLength(40);
    expect(LAYOUTS).toHaveLength(10);
  });

  it.each(PALETTES.map((p) => [p.id, p] as const))("palette %s is legible", (_id, p) => {
    expect(contrast(p.fg, p.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(p.muted, p.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.accent, p.bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(p.fg, p.surface)).toBeGreaterThanOrEqual(7);
  });

  it("offers at least two palettes for every weather and time of day", () => {
    for (const w of WEATHER) for (const d of DAYPARTS) expect(palettesFor(w, d).length, `${w}/${d}`).toBeGreaterThanOrEqual(2);
  });

  it("never gives a rainy evening a clear-sky-only palette", () => {
    for (const p of palettesFor("rain", "evening")) expect(p.weather).toContain("rain");
    for (const p of palettesFor("rain", "midday")) expect(p.weather.length === 1 && p.weather[0] === "clear").toBe(false);
  });

  it("pairs the terminal layout with monospace fonts and draws deterministically", () => {
    for (let seed = 0; seed < 400; seed++) {
      const a = drawArt({ seed, weather: "rain", daypart: "evening" });
      if (a.layout.id === "terminal") expect(a.font.tags).toContain("terminal");
      expect(drawArt({ seed, weather: "rain", daypart: "evening" })).toEqual(a);
    }
  });

  it("goes still for reduced motion and dense when compact", () => {
    const a = drawArt({ seed: 7, weather: "clear", daypart: "morning", reducedMotion: true, compact: true });
    expect(a.motion).toBe("still");
    expect(a.density).toBe("dense");
  });

  it("builds valid Google Fonts URLs", () => {
    for (const f of FONTS) {
      const u = new URL(fontsHref(f));
      expect(u.host).toBe("fonts.googleapis.com");
      expect(u.searchParams.getAll("family").length).toBeGreaterThanOrEqual(1);
      expect(u.toString()).not.toMatch(/undefined/);
    }
  });
});
