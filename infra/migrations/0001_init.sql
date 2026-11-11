-- Moment: history, feedback, safety verdicts, traces and the page archive.
-- D1 (SQLite) stands in for the PRD's Postgres (Neon) and R2; see README.
-- No column holds a raw IP address or a company name.

CREATE TABLE IF NOT EXISTS traces (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  cell TEXT NOT NULL,
  country TEXT,
  daypart TEXT,
  weekpart TEXT,
  device TEXT,
  referrer TEXT,
  network TEXT,
  weather TEXT,
  eu INTEGER NOT NULL DEFAULT 0,
  mode TEXT,               -- model | template | archive | fallback
  route_how TEXT,          -- model | template | prior-fallback
  explored INTEGER NOT NULL DEFAULT 0,
  archetype TEXT,
  title TEXT,
  plan_json TEXT,
  candidates_json TEXT,
  specificity_json TEXT,
  font TEXT,
  palette TEXT,
  layout TEXT,
  bucket_json TEXT,
  shell_ms INTEGER,
  router_ms INTEGER,
  first_content_ms INTEGER,
  complete_ms INTEGER,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  moderation TEXT,         -- pass | fail
  moderation_reason TEXT,
  error TEXT,
  reward REAL,
  reward_source TEXT,      -- vote | behaviour | retry
  vote TEXT,               -- yes | no
  feedback_text TEXT,      -- moderated, cleared after 90 days
  retried INTEGER NOT NULL DEFAULT 0,
  dwell_ms INTEGER
);
CREATE INDEX IF NOT EXISTS traces_created ON traces (created_at);
CREATE INDEX IF NOT EXISTS traces_reward ON traces (created_at) WHERE reward IS NOT NULL;

CREATE TABLE IF NOT EXISTS pages (
  session_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  cell TEXT NOT NULL,
  daypart TEXT NOT NULL,
  archetype TEXT,
  mode TEXT,
  title TEXT,
  brief_json TEXT,
  plan_json TEXT,
  html TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pages_lookup ON pages (cell, daypart, created_at);
CREATE INDEX IF NOT EXISTS pages_daypart ON pages (daypart, created_at);

CREATE TABLE IF NOT EXISTS verdicts (
  term TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  allowed INTEGER NOT NULL,
  decided_at TEXT NOT NULL,
  decided_by TEXT NOT NULL
);
