// Safety gate 1, at ingest (PRD: Three safety gates). A trend reaches a brief
// only if (a) its topic category is on the allowlist, (b) a classifier has
// already ruled on it and the verdict is cached, and (c) it is not on the
// manual blocklist. Terms still waiting for a verdict never reach a brief.

export const ALLOWED_CATEGORIES = [
  "food", "sports", "entertainment", "arts", "technology", "travel", "weather", "shopping", "hobbies", "games", "science",
] as const;

export const DROPPED_CATEGORIES = [
  "news", "politics", "law and government", "health", "deaths", "crime", "disasters", "adult", "gambling", "religion", "people", "other",
] as const;

export type Category = (typeof ALLOWED_CATEGORIES)[number] | (typeof DROPPED_CATEGORIES)[number];

// The manual blocklist sits on top of every verdict. Matching is on words.
export const BLOCKLIST = [
  "murder", "killed", "killing", "shooting", "shooter", "massacre", "terror", "bomb", "war", "invasion", "genocide",
  "suicide", "overdose", "death", "dies", "died", "funeral", "obituary", "assassination", "rape", "abuse", "porn",
  "nude", "sex", "onlyfans", "casino", "betting", "lottery", "election", "president", "senate", "trump", "biden",
  "putin", "hamas", "israel", "gaza", "ukraine", "russia", "cancer", "covid", "pandemic", "earthquake", "hurricane",
  "flood", "wildfire", "tsunami", "crash", "accident", "arrest", "trial", "lawsuit", "scandal", "epstein",
];

const BLOCK_RE = new RegExp(`\\b(${BLOCKLIST.join("|")})\\b`, "i");

export function blocked(term: string): boolean {
  return BLOCK_RE.test(term);
}

export function categoryAllowed(category: string): boolean {
  return (ALLOWED_CATEGORIES as readonly string[]).includes(category);
}

export interface Verdict { term: string; category: string; allowed: boolean }

// Gate: pass only terms with a cached, allowed verdict and no blocklist hit.
export function gate<T extends { term: string }>(items: T[], verdicts: Map<string, Verdict>): (T & { category: string })[] {
  const out: (T & { category: string })[] = [];
  for (const it of items) {
    if (blocked(it.term)) continue;
    const v = verdicts.get(it.term.toLowerCase());
    if (!v || !v.allowed || !categoryAllowed(v.category)) continue;
    out.push({ ...it, category: v.category });
  }
  return out;
}

export const CLASSIFIER_SYSTEM = `You label search and reading topics for a public website that must stay safe for work and free of news, politics and tragedy.

For each term, pick the single best category:
food, sports, entertainment, arts, technology, travel, weather, shopping, hobbies, games, science,
news, politics, law and government, health, deaths, crime, disasters, adult, gambling, religion, people, other.

Rules:
- A living person who is mainly an athlete, musician, actor or creator takes the category of their work (sports, entertainment, arts).
- A person who recently died, or a topic trending because someone died, is "deaths".
- Politicians, elections, governments, courts and wars are "politics" or "law and government".
- Illness, medicine and drugs are "health".
- Anything sexual is "adult".
- If a term is ambiguous or you do not recognise it, use "other".`;
