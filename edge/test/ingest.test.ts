import { describe, expect, it } from "vitest";
import { moon, sunTimes } from "../../ingest/src/sky";
import { anomaly, anomalyText, bucketOf, climatologyFrom } from "../../ingest/src/weather";
import { holidaySignals } from "../../ingest/src/holidays";
import { weatherView, summarize12h } from "../../ingest/src/compile";
import { blocked, gate } from "../../ingest/src/safety";
import { localParts } from "../src/util";

describe("sky", () => {
  it("puts New York's sunset on 10 Nov 2026 at about 4:44 p.m.", () => {
    const st = sunTimes(new Date("2026-11-10T17:00:00Z"), 40.713, -74.006);
    const p = localParts(st.sunset!, "America/New_York");
    expect(p.hour).toBe(16);
    expect(Math.abs(p.minute - 44)).toBeLessThanOrEqual(2);
    expect(st.goldenEveningStart!.getTime()).toBeLessThan(st.sunset!.getTime());
  });
  it("handles polar night without inventing a sunset", () => {
    const st = sunTimes(new Date("2026-12-21T12:00:00Z"), 78.22, 15.65); // Longyearbyen
    expect(st.sunset).toBeNull();
  });
  it("knows the full moon of 24 Nov 2026", () => {
    expect(moon(new Date("2026-11-24T15:00:00Z")).name).toBe("full moon");
  });
});

describe("weather", () => {
  const hourly = Array.from({ length: 14 }, (_, k) => ({ t: `2026-11-10T${String(17 + k > 23 ? 17 + k - 24 : 17 + k).padStart(2, "0")}:00`.replace(/T0/, k + 17 > 23 ? "T0" : "T0").replace("2026-11-10T0", k + 17 > 23 ? "2026-11-11T0" : "2026-11-10T0"), temp: 9 - k * 0.3, pop: k < 2 ? 85 : 10, mm: k < 2 ? 1.2 : 0, code: k < 2 ? 61 : 3 }));
  it("finds when the rain stops", () => {
    const w = weatherView(hourly, [], "2026-11-10", 17);
    expect(w.bucket).toBe("rain");
    expect(w.rain_stops).toBe("19:00");
    expect(w.next_12h).toMatch(/^clearing after 7 p\.m\., /);
  });
  it("writes Fahrenheit for Fahrenheit countries", () => {
    expect(summarize12h(hourly.slice(2), null, null, "F")).toMatch(/°$/);
    expect(summarize12h([{ t: "2026-11-10T19:00", temp: 0, pop: 0, mm: 0, code: 0 }], null, null, "F")).toBe("clear, 32°");
  });
  it("calls a day unusual only when it is", () => {
    const dates: string[] = [], highs: number[] = [];
    for (let y = 2016; y < 2026; y++) for (let d = 1; d <= 28; d++) { dates.push(`${y}-11-${String(d).padStart(2, "0")}`); highs.push(10 + ((d * 7 + y) % 5) - 2); }
    const clim = climatologyFrom(dates, highs);
    expect(anomalyText(anomaly(clim, "2026-11-10", 10), "2026-11-10")).toBeNull();
    expect(anomalyText(anomaly(clim, "2026-11-10", 17), "2026-11-10")).toBe("7°C warmer than a typical November 10");
    expect(anomalyText(anomaly(clim, "2026-11-10", 17), "2026-11-10", "F")).toBe("13°F warmer than a typical November 10");
  });
  it("buckets WMO codes", () => {
    expect([0, 3, 45, 61, 73, 95].map(bucketOf)).toEqual(["clear", "cloudy", "fog", "rain", "snow", "storm"]);
  });
});

describe("holidays", () => {
  const hols = [
    { date: "2026-11-11", name: "Veterans Day", regions: null },
    { date: "2026-11-26", name: "Thanksgiving Day", regions: null },
    { date: "2026-11-27", name: "Day after Thanksgiving", regions: ["US-CA"] },
  ];
  it("says tomorrow, and how far off the big one is", () => {
    const s = holidaySignals(hols, "2026-11-10", "NY", "US");
    expect(s.map((h) => h.label)).toEqual(["Veterans Day tomorrow", "Thanksgiving Day in 16 days"]);
  });
  it("applies regional holidays only in their region", () => {
    expect(holidaySignals(hols, "2026-11-24", "CA", "US").map((h) => h.name)).toContain("Day after Thanksgiving");
    expect(holidaySignals(hols, "2026-11-24", "NY", "US").map((h) => h.name)).not.toContain("Day after Thanksgiving");
  });
});

describe("safety gate 1", () => {
  it("passes only terms with an allowed, cached verdict", () => {
    const v = new Map([
      ["taylor swift", { term: "Taylor Swift", category: "entertainment", allowed: true }],
      ["some senator", { term: "Some Senator", category: "politics", allowed: false }],
    ]);
    const out = gate([{ term: "Taylor Swift" }, { term: "Some Senator" }, { term: "Unclassified Thing" }], v);
    expect(out.map((x) => x.term)).toEqual(["Taylor Swift"]);
  });
  it("blocklist beats any verdict", () => {
    const v = new Map([["death of a salesman", { term: "Death of a Salesman", category: "arts", allowed: true }]]);
    expect(blocked("Death of a Salesman")).toBe(true);
    expect(gate([{ term: "Death of a Salesman" }], v)).toHaveLength(0);
  });
});
