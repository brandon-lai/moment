export interface Env {
  BRIEFS: KVNamespace;               // Moment Briefs, priors, kill switch, caches
  DB: D1Database;                    // history, feedback, verdicts, traces, archive (stands in for Postgres + R2)
  SESSION: DurableObjectNamespace;   // one object per visit
  GOVERNOR: DurableObjectNamespace;  // spend cap and per-IP limit
  ANTHROPIC_API_KEY?: string;
  MODEL_MODE?: string;               // "off" forces template mode even with a key
  GEN_EFFORT?: string;
  IP_HASH_SECRET?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  ADMIN_TOKEN?: string;
  RENDER_ORIGIN: string;             // sandbox origin, e.g. https://moment-render.x.workers.dev
  MAIN_ORIGIN: string;
  HOURLY_CAP_USD?: string;           // spend cap per hour, default 2
  ROUTER_BUDGET_MS?: string;          // default 2500 (PRD: router slower than 2.5 s falls back)
  JUDGE_BUDGET_MS?: string;           // default 900
  DEV_EVALS?: string;                // "1" enables /eval/<id> brief injection (local only)
}
