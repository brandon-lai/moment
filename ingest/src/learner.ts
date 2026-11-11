// Learning loop 1: which archetypes work where (PRD: Three ways the system
// learns). A Thompson-sampling bandit keeps a Beta(successes, failures) per
// archetype per context bucket. Sparse buckets borrow from their parents.

export const MIN_REWARDED = 30; // priors move only after this many rewarded visits

export interface BucketContext {
  cell: string; country: string; daypart: string; weekpart: "weekday" | "weekend";
  device: string; referrer: string; weather: string; network: string;
}

// Most specific first. The last key is the global bucket.
export function bucketKeys(c: BucketContext): string[] {
  return [
    `${c.cell}|${c.daypart}|${c.weekpart}|${c.device}|${c.referrer}|${c.weather}|${c.network}`,
    `${c.cell}|${c.daypart}|${c.weekpart}`,
    `${c.country}|${c.daypart}|${c.weekpart}`,
    `*|${c.daypart}|${c.weekpart}`,
    `*`,
  ];
}

export type Arm = [number, number]; // [alpha, beta], both include the Beta(1,1) prior
export type PriorTable = Record<string, Record<string, Arm>>; // bucket -> archetype -> arm

// Reward in [0,1] adds `r` to alpha and `1-r` to beta (fractional Bernoulli).
export function update(arm: Arm, r: number): Arm {
  return [arm[0] + r, arm[1] + (1 - r)];
}

// For each archetype, the arm of the most specific bucket with enough data.
export function armsFor(table: PriorTable, keys: string[], archetypes: readonly string[]): Record<string, Arm> {
  const out: Record<string, Arm> = {};
  for (const a of archetypes) {
    out[a] = [1, 1];
    for (const k of keys) {
      const arm = table[k]?.[a];
      if (arm && arm[0] + arm[1] - 2 >= MIN_REWARDED) { out[a] = arm; break; }
    }
  }
  return out;
}

export function meanOf(arm: Arm): number {
  return arm[0] / (arm[0] + arm[1]);
}

// Gamma(k,1) by Marsaglia–Tsang, for Beta sampling.
function gamma(k: number, rand: () => number): number {
  if (k < 1) return gamma(k + 1, rand) * Math.pow(rand(), 1 / k);
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      const u1 = rand() || 1e-12, u2 = rand();
      x = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function sampleBeta(arm: Arm, rand: () => number): number {
  const x = gamma(arm[0], rand), y = gamma(arm[1], rand);
  return x / (x + y);
}

// Nightly: fold every rewarded visit into every level of its bucket chain.
export interface RewardRow { bucket_json: string; archetype: string; reward: number }

export function learn(rows: RewardRow[]): PriorTable {
  const table: PriorTable = {};
  for (const r of rows) {
    let ctx: BucketContext;
    try { ctx = JSON.parse(r.bucket_json); } catch { continue; }
    for (const k of bucketKeys(ctx)) {
      table[k] ??= {};
      table[k][r.archetype] = update(table[k][r.archetype] ?? [1, 1], Math.max(0, Math.min(1, r.reward)));
    }
  }
  return table;
}

// Behaviour rewards (PRD: Reward). Explicit votes always outweigh behaviour.
export function behaviourReward(dwellMs: number, interacted: boolean): number | null {
  if (dwellMs >= 45000 && interacted) return 0.7;
  if (dwellMs < 8000) return 0.2;
  return null; // in between says nothing; no reward recorded
}
