// Builds the 50 Phase 0 test briefs (PRD: "Compare generator models on 50
// test briefs"). Each scenario is written by hand: a real place, a real local
// moment in November 2026, a weather pattern and the calendar facts that
// were true then. The hourly series is synthesised from the pattern with a
// seeded PRNG so the set is reproducible.
//
//   node --experimental-strip-types evals/make-briefs.mjs   -> evals/briefs.json

import { writeFileSync } from "node:fs";
import { sunTimes } from "../ingest/src/sky.ts";

const S = [
  // id, cell, label, country, region, lat, lon, tz, local time, pattern, base °C, extras
  ["nyc-rain-clearing-evening", "US/NY/501", "New York metro", "US", "NY", 40.713, -74.006, "America/New_York", "2026-11-10T18:12", "rain-clearing", 9, { city: "Brooklyn", holidays: ["Veterans Day tomorrow", "Thanksgiving in 16 days"] }],
  ["nyc-clear-morning", "US/NY/501", "New York metro", "US", "NY", 40.713, -74.006, "America/New_York", "2026-11-13T07:40", "clear", 6, { city: "New York" }],
  ["chicago-cold-clear-night", "US/IL/602", "Chicago metro", "US", "IL", 41.878, -87.63, "America/Chicago", "2026-11-18T22:05", "cold-clear", -3, { city: "Chicago", unusual: [-7, -1.6] }],
  ["chicago-snow-afternoon", "US/IL/602", "Chicago metro", "US", "IL", 41.878, -87.63, "America/Chicago", "2026-11-24T15:20", "snow", -1, { city: "Chicago", holidays: ["Thanksgiving this Thursday"] }],
  ["la-golden-hour", "US/CA/803", "Los Angeles metro", "US", "CA", 34.052, -118.244, "America/Los_Angeles", "2026-11-12T16:15", "clear", 21, { city: "Los Angeles" }],
  ["la-heat-midday", "US/CA/803", "Los Angeles metro", "US", "CA", 34.052, -118.244, "America/Los_Angeles", "2026-11-04T12:30", "heat", 30, { city: "Pasadena", unusual: [8, 2.1] }],
  ["sf-fog-morning", "US/CA/807", "San Francisco Bay Area", "US", "CA", 37.775, -122.419, "America/Los_Angeles", "2026-11-09T08:10", "fog-lifting", 12, { city: "San Francisco" }],
  ["seattle-drizzle-commute", "US/WA/819", "Seattle–Tacoma", "US", "WA", 47.606, -122.332, "America/Los_Angeles", "2026-11-17T17:35", "drizzle", 8, { city: "Seattle" }],
  ["seattle-rain-coming-lunch", "US/WA/819", "Seattle–Tacoma", "US", "WA", 47.606, -122.332, "America/Los_Angeles", "2026-11-20T11:50", "rain-coming", 10, { city: "Bellevue" }],
  ["austin-friday-afternoon", "US/TX/635", "Austin metro", "US", "TX", 30.267, -97.743, "America/Chicago", "2026-11-13T15:45", "clear", 24, { city: "Austin" }],
  ["houston-storm-evening", "US/TX/618", "Houston metro", "US", "TX", 29.76, -95.37, "America/Chicago", "2026-11-05T19:10", "storm", 22, { city: "Houston" }],
  ["miami-warm-night", "US/FL/528", "Miami–Fort Lauderdale", "US", "FL", 25.762, -80.192, "America/New_York", "2026-11-14T21:30", "clear", 25, { city: "Miami" }],
  ["boston-thanksgiving-eve", "US/MA/506", "Boston metro", "US", "MA", 42.36, -71.059, "America/New_York", "2026-11-25T17:05", "cloudy", 4, { city: "Cambridge", holidays: ["Thanksgiving tomorrow"], network: "university" }],
  ["denver-snow-morning", "US/CO/751", "Denver metro", "US", "CO", 39.739, -104.99, "America/Denver", "2026-11-19T06:50", "snow", -4, { city: "Denver" }],
  ["phoenix-sunday-evening", "US/AZ/753", "Phoenix metro", "US", "AZ", 33.448, -112.074, "America/Phoenix", "2026-11-15T18:40", "clear", 22, { city: "Phoenix" }],
  ["atlanta-rain-clearing-noon", "US/GA/524", "Atlanta metro", "US", "GA", 33.749, -84.388, "America/New_York", "2026-11-11T12:05", "rain-clearing", 14, { city: "Atlanta", holidays: ["Veterans Day today"] }],
  ["dc-monday-morning", "US/DC/511", "Washington, D.C. metro", "US", "DC", 38.907, -77.037, "America/New_York", "2026-11-16T08:20", "cloudy", 7, { city: "Washington" }],
  ["minneapolis-first-freeze", "US/MN/613", "Minneapolis–St. Paul", "US", "MN", 44.978, -93.265, "America/Chicago", "2026-11-03T19:45", "cold-clear", 2, { city: "Minneapolis" }],
  ["nashville-rain-coming-evening", "US/TN/659", "Nashville metro", "US", "TN", 36.163, -86.781, "America/Chicago", "2026-11-21T17:30", "rain-coming", 13, { city: "Nashville" }],
  ["portland-drizzle-sunday", "US/OR/820", "Portland, Oregon metro", "US", "OR", 45.515, -122.679, "America/Los_Angeles", "2026-11-22T10:15", "drizzle", 9, { city: "Portland" }],
  ["london-rain-clearing-evening", "GB/m/London", "London", "GB", "ENG", 51.507, -0.128, "Europe/London", "2026-11-10T17:20", "rain-clearing", 10, { city: "London" }],
  ["london-fog-morning", "GB/m/London", "London", "GB", "ENG", 51.507, -0.128, "Europe/London", "2026-11-19T08:05", "fog-lifting", 6, { city: "London" }],
  ["manchester-drizzle-friday", "GB/m/Manchester", "Manchester", "GB", "ENG", 53.481, -2.243, "Europe/London", "2026-11-13T16:40", "drizzle", 9, { city: "Manchester" }],
  ["dublin-sunday-afternoon", "IE/m/Dublin", "Dublin", "IE", "L", 53.35, -6.26, "Europe/Dublin", "2026-11-15T14:30", "cloudy", 10, { city: "Dublin" }],
  ["paris-armistice", "FR/m/Paris", "Paris", "FR", "IDF", 48.857, 2.352, "Europe/Paris", "2026-11-11T11:00", "cloudy", 9, { city: "Paris", holidays: ["Armistice Day today"] }],
  ["paris-golden-hour", "FR/m/Paris", "Paris", "FR", "IDF", 48.857, 2.352, "Europe/Paris", "2026-11-06T16:30", "clear", 12, { city: "Paris" }],
  ["berlin-cold-night", "DE/m/Berlin", "Berlin", "DE", "BE", 52.52, 13.405, "Europe/Berlin", "2026-11-26T23:10", "cold-clear", -2, { city: "Berlin", moon: "full moon tonight" }],
  ["munich-snow-saturday", "DE/m/Munich", "Munich", "DE", "BY", 48.137, 11.575, "Europe/Berlin", "2026-11-28T10:30", "snow", 0, { city: "Munich" }],
  ["amsterdam-rain-coming", "NL/m/Amsterdam", "Amsterdam", "NL", "NH", 52.37, 4.895, "Europe/Amsterdam", "2026-11-12T15:10", "rain-coming", 9, { city: "Amsterdam" }],
  ["madrid-warm-unusual", "ES/m/Madrid", "Madrid", "ES", "MD", 40.417, -3.704, "Europe/Madrid", "2026-11-07T14:00", "clear", 22, { city: "Madrid", unusual: [6, 1.9] }],
  ["barcelona-evening", "ES/m/Barcelona", "Barcelona", "ES", "CT", 41.389, 2.159, "Europe/Madrid", "2026-11-20T20:30", "clear", 15, { city: "Barcelona" }],
  ["lisbon-storm", "PT/m/Lisbon", "Lisbon", "PT", "11", 38.722, -9.139, "Europe/Lisbon", "2026-11-18T13:20", "storm", 15, { city: "Lisbon" }],
  ["rome-sunday-lunch", "IT/m/Rome", "Rome", "IT", "62", 41.903, 12.496, "Europe/Rome", "2026-11-22T12:40", "clear", 16, { city: "Rome" }],
  ["stockholm-dark-afternoon", "SE/m/Stockholm", "Stockholm", "SE", "AB", 59.329, 18.069, "Europe/Stockholm", "2026-11-24T15:05", "cloudy", 2, { city: "Stockholm" }],
  ["toronto-snow-commute", "CA/m/Toronto", "Toronto", "CA", "ON", 43.653, -79.383, "America/Toronto", "2026-11-23T17:15", "snow", -1, { city: "Toronto" }],
  ["vancouver-rain-all-day", "CA/m/Vancouver", "Vancouver", "CA", "BC", 49.283, -123.121, "America/Vancouver", "2026-11-10T13:00", "drizzle", 8, { city: "Vancouver", holidays: ["Remembrance Day tomorrow"] }],
  ["mexico-city-revolution-day", "MX/m/Mexico City", "Mexico City", "MX", "CMX", 19.433, -99.133, "America/Mexico_City", "2026-11-16T10:20", "clear", 18, { city: "Mexico City", holidays: ["Revolution Day today"] }],
  ["sao-paulo-storm-afternoon", "BR/m/São Paulo", "São Paulo", "BR", "SP", -23.551, -46.633, "America/Sao_Paulo", "2026-11-20T16:10", "storm", 26, { city: "São Paulo", holidays: ["Black Consciousness Day today"] }],
  ["buenos-aires-spring-evening", "AR/m/Buenos Aires", "Buenos Aires", "AR", "C", -34.604, -58.382, "America/Argentina/Buenos_Aires", "2026-11-14T19:30", "clear", 23, { city: "Buenos Aires" }],
  ["tokyo-labor-thanksgiving", "JP/m/Tokyo", "Tokyo", "JP", "13", 35.676, 139.65, "Asia/Tokyo", "2026-11-23T09:40", "clear", 13, { city: "Tokyo", holidays: ["Labour Thanksgiving Day today"] }],
  ["tokyo-rain-night", "JP/m/Tokyo", "Tokyo", "JP", "13", 35.676, 139.65, "Asia/Tokyo", "2026-11-10T22:15", "rain-clearing", 12, { city: "Tokyo" }],
  ["seoul-cold-morning", "KR/m/Seoul", "Seoul", "KR", "11", 37.567, 126.978, "Asia/Seoul", "2026-11-26T07:30", "cold-clear", -1, { city: "Seoul" }],
  ["singapore-afternoon-storm", "SG/m/Singapore", "Singapore", "SG", "01", 1.352, 103.82, "Asia/Singapore", "2026-11-12T15:30", "storm", 30, { city: "Singapore" }],
  ["mumbai-evening", "IN/m/Mumbai", "Mumbai", "IN", "MH", 19.076, 72.878, "Asia/Kolkata", "2026-11-09T19:15", "clear", 29, { city: "Mumbai" }],
  ["bengaluru-monday-morning", "IN/m/Bengaluru", "Bengaluru", "IN", "KA", 12.972, 77.595, "Asia/Kolkata", "2026-11-16T08:45", "cloudy", 20, { city: "Bengaluru" }],
  ["sydney-saturday-beach", "AU/m/Sydney", "Sydney", "AU", "NSW", -33.869, 151.209, "Australia/Sydney", "2026-11-14T11:30", "clear", 26, { city: "Sydney" }],
  ["melbourne-four-seasons", "AU/m/Melbourne", "Melbourne", "AU", "VIC", -37.814, 144.963, "Australia/Melbourne", "2026-11-17T14:10", "rain-coming", 19, { city: "Melbourne" }],
  ["dubai-evening", "AE/m/Dubai", "Dubai", "AE", "DU", 25.205, 55.271, "Asia/Dubai", "2026-11-19T18:30", "clear", 27, { city: "Dubai" }],
  ["nairobi-afternoon-rain", "KE/m/Nairobi", "Nairobi", "KE", "30", -1.292, 36.822, "Africa/Nairobi", "2026-11-11T15:00", "rain-clearing", 21, { city: "Nairobi" }],
  ["global-no-weather", "global", "the world", "XX", null, null, null, "UTC", "2026-11-10T12:00", "none", 0, {}],
];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

// Code by hour offset from "now" (0 = current hour).
function codeAt(pattern, k, rand) {
  switch (pattern) {
    case "rain-clearing": return k <= 1 ? (k === 0 ? 61 : 80) : k <= 2 ? 3 : 2;
    case "rain-coming": return k < 3 ? 2 : k < 7 ? 63 : 3;
    case "clear": return rand() < 0.15 ? 1 : 0;
    case "cold-clear": return 0;
    case "cloudy": return rand() < 0.3 ? 2 : 3;
    case "snow": return k < 5 ? 73 : k < 7 ? 71 : 3;
    case "fog-lifting": return k < 2 ? 45 : k < 4 ? 3 : 1;
    case "storm": return k < 2 ? 95 : k < 4 ? 63 : 3;
    case "heat": return 0;
    case "drizzle": return k < 8 ? 53 : 3;
    default: return 0;
  }
}

const wetCode = (c) => (c >= 51 && c <= 67) || (c >= 71 && c <= 86) || c >= 95;

function pad(n) { return String(n).padStart(2, "0"); }

function localIsoPlus(local, hours) {
  // Walk local wall-clock hours (ignoring DST: no transitions in these windows).
  const [d, t] = local.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const h = Number(t.slice(0, 2));
  const dt = new Date(Date.UTC(y, m - 1, day, h + hours));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:00`;
}

function utcOf(local, tz) {
  // Find the UTC instant whose wall clock in tz equals `local`.
  const guess = Date.parse(local + ":00Z");
  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const wall = Date.parse(fmt.format(new Date(guess)).replace(" ", "T") + ":00Z");
  return new Date(guess - (wall - guess));
}

function hhmm(date, tz) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

const weekdayOf = (local) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(local.slice(0, 10) + "T12:00:00Z").getUTCDay()];

const out = S.map(([id, cell, label, country, region, lat, lon, tz, local, pattern, base, x]) => {
  const rand = mulberry(hash(id));
  const now = utcOf(local, tz);
  const hourly = [];
  if (pattern !== "none") {
    for (let k = -1; k < 30; k++) {
      const t = localIsoPlus(local, k);
      const hr = Number(t.slice(11, 13));
      const diurnal = Math.sin(((hr - 9) / 24) * 2 * Math.PI) * (pattern === "cold-clear" ? 5 : pattern === "heat" ? 6 : 3.5);
      const code = codeAt(pattern, Math.max(0, k), rand);
      const wet = wetCode(code);
      hourly.push({ t, temp: Math.round((base + diurnal + (rand() - 0.5) * 1.2 - (k > 0 ? k * 0.05 : 0)) * 10) / 10, pop: wet ? 70 + Math.round(rand() * 25) : Math.round(rand() * 20), mm: wet ? Math.round((code >= 63 ? 1.5 + rand() * 3 : 0.2 + rand() * 0.8) * 10) / 10 : 0, code });
    }
  }
  const signals = [];
  for (const h of x.holidays ?? []) signals.push({ kind: "holiday", label: h, category: "calendar", score: /today/.test(h) ? 0.9 : /tomorrow/.test(h) ? 0.83 : 0.5, source: "hand-written" });
  if (x.moon) signals.push({ kind: "sky", label: x.moon, category: "sky", score: 0.4, source: "hand-written" });
  let unusual = null, z = null;
  if (x.unusual) {
    const [delta, zz] = x.unusual;
    const deg = country === "US" ? `${Math.round(Math.abs(delta) * 9 / 5)}°F` : `${Math.abs(delta)}°C`;
    const [, mo, dd] = local.slice(0, 10).split("-").map(Number);
    unusual = `${deg} ${delta > 0 ? "warmer" : "colder"} than a typical ${["January","February","March","April","May","June","July","August","September","October","November","December"][mo - 1]} ${dd}`;
    z = zz;
    signals.push({ kind: "unusual", label: unusual, category: "weather", score: 0.85, source: "hand-written" });
  }
  let weather = null;
  if (hourly.length) {
    const st = sunTimes(now, lat, lon);
    const tmr = sunTimes(new Date(now.getTime() + 86400000), lat, lon);
    const day = local.slice(0, 10), nextDay = localIsoPlus(local, 24).slice(0, 10);
    const temps = hourly.map((h) => h.temp);
    weather = {
      now: "", bucket: "clear", code: hourly[1].code, temp_c: Math.round(hourly[1].temp), next_12h: "",
      sunrise: st.sunrise ? hhmm(st.sunrise, tz) : "", sunset: st.sunset ? hhmm(st.sunset, tz) : "",
      unusual, anomaly_z: z, hourly,
      daily: [
        { date: day, sunrise: st.sunrise ? hhmm(st.sunrise, tz) : "", sunset: st.sunset ? hhmm(st.sunset, tz) : "", tmax: Math.max(...temps.slice(0, 18)), tmin: Math.min(...temps.slice(0, 18)), code: hourly[1].code },
        { date: nextDay, sunrise: tmr.sunrise ? hhmm(tmr.sunrise, tz) : "", sunset: tmr.sunset ? hhmm(tmr.sunset, tz) : "", tmax: Math.max(...temps.slice(18)), tmin: Math.min(...temps.slice(18)), code: hourly[25]?.code ?? 0 },
      ],
    };
  }
  return {
    id,
    now: now.toISOString(),
    l1: { country, region, city: x.city ?? null, tz, network: x.network ?? "home", device: "desktop", eu: ["GB", "IE", "FR", "DE", "NL", "ES", "PT", "IT", "SE"].includes(country), situations: x.network === "university" ? ["on-campus"] : [] },
    brief: {
      cell, label, built_at: new Date(now.getTime() - 40 * 60000).toISOString(),
      coords: lat == null ? undefined : { lat, lon }, country: country === "XX" ? undefined : country,
      local: { tz, weekday: weekdayOf(local), holiday: (x.holidays ?? []).find((h) => /today/.test(h))?.replace(/ today$/, "") ?? null },
      weather, signals, priors: { archetypes: {} }, sources: ["hand-written"],
    },
  };
});

writeFileSync(new URL("./briefs.json", import.meta.url), JSON.stringify(out, null, 1));
console.log(`wrote ${out.length} briefs`);
