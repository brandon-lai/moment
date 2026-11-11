// Nager.Date: public holidays per country and year. Fetched once per country
// per year and cached; holidays are computed against local dates at compile time.

export interface Holiday { date: string; name: string; regions: string[] | null }

export async function fetchHolidays(country: string, year: number, fetcher: typeof fetch = fetch): Promise<Holiday[]> {
  const res = await fetcher(`https://date.nager.at/api/v3/PublicHolidays/${year}/${country}`, { headers: { "user-agent": "moment-brief-compiler" } });
  if (res.status === 404 || res.status === 204) return []; // country not covered
  if (!res.ok) throw new Error(`nager ${country} ${res.status}`);
  const text = await res.text();
  if (!text) return [];
  const rows = JSON.parse(text) as { date: string; name: string; localName: string; global: boolean; counties: string[] | null; types?: string[] }[];
  return rows
    .filter((r) => !r.types || r.types.includes("Public") || r.types.includes("Bank"))
    .map((r) => ({ date: r.date, name: r.name, regions: r.global ? null : r.counties }));
}

const DAY = 86400000;
const toUtc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const weekdayOf = (iso: string) => new Date(toUtc(iso)).getUTCDay(); // 0 Sun

export interface HolidaySignal { label: string; daysAway: number; name: string; longWeekend: boolean }

// What matters about holidays right now in this place: today, tomorrow, a
// long weekend coming up, or a big one within three weeks.
export function holidaySignals(hols: Holiday[], today: string, region: string | null, country: string): HolidaySignal[] {
  const applies = (h: Holiday) => !h.regions || (region != null && h.regions.includes(`${country}-${region}`));
  const out: HolidaySignal[] = [];
  const t0 = toUtc(today);
  const seen = new Set<string>();
  for (const h of hols) {
    if (!applies(h) || seen.has(h.name)) continue;
    const days = Math.round((toUtc(h.date) - t0) / DAY);
    if (days < 0 || days > 21) continue;
    seen.add(h.name);
    const wd = weekdayOf(h.date);
    const longWeekend = wd === 1 || wd === 5;
    let label: string;
    if (days === 0) label = `${h.name} today`;
    else if (days === 1) label = `${h.name} tomorrow`;
    else if (days <= 6) label = `${h.name} this ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][wd]}${longWeekend ? ", a long weekend" : ""}`;
    else label = `${h.name} in ${days} days`;
    out.push({ label, daysAway: days, name: h.name, longWeekend });
  }
  return out.sort((a, b) => a.daysAway - b.daysAway).slice(0, 3);
}

export function holidayToday(hols: Holiday[], today: string, region: string | null, country: string): string | null {
  const h = hols.find((x) => x.date === today && (!x.regions || (region != null && x.regions.includes(`${country}-${region}`))));
  return h?.name ?? null;
}
