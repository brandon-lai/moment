# Moment

**Moment is a public website that guesses what a visitor needs at this moment and builds that page from scratch on first load, with no input from them.**

It reads coarse facts from the request (city, time zone, device, language, where the link came from, kind of network) and a precompiled brief about the place right now (the weather hour by hour, how unusual today is, the sun and moon, holidays, what the country is reading). Then it streams a one-off page into a sandboxed iframe while the visitor watches it build.

- **Live:** https://moment.flockfield-server.workers.dev
- **Sandbox origin (generated pages, live data API):** https://moment-render.flockfield-server.workers.dev
- **What Moment reads:** https://moment.flockfield-server.workers.dev/what-moment-reads
- **Metrics:** https://moment.flockfield-server.workers.dev/stats

Built from `Moment-System-Design.pdf` (system design, 2026-11-10). This repo covers **Phase 0 and Phase 1**, plus the parts of later phases that were cheap and safe to include (EU mode, spend caps, the bandit). Everything not built is listed below.

---

## What is running, and what is not

| | Status |
|---|---|
| Edge shell, "reading the room" reveal, one-round-trip HTML | **Live** |
| Per-visit Durable Object: routing, client signals, section-by-section generation, streaming to the iframe | **Live** |
| Sandbox on a separate origin, `sandbox="allow-scripts allow-popups"`, the PRD's CSP | **Live** |
| Briefs for 92 metros, rebuilt every 4 hours; any other city compiled on first visit | **Live** (Open-Meteo, Nager.Date, computed sun/moon) |
| How unusual today is (10-year climatology) | **Live** for warm metros; 8 metros filled per run until all are cached |
| Country "trending" via Wikimedia most-read + safety gate 1 | Built; **passes nothing in production** because the classifier needs a model key. Gate 1 is fail-closed: unclassified terms never reach a brief. |
| Router (Claude Haiku 5.5) + specificity judge + generator (Claude Sonnet 5.5) | Built and benchmarked locally; **off in production** (no `ANTHROPIC_API_KEY` set). |
| Template generator (no model): 8 archetypes from the same brief, same section contract | **Live**: this is what production serves today, and it says so in each page footer |
| Moderation (gate 3): rules always, Haiku when a key exists; failure swaps in a fallback page | **Live** (rules) |
| Feedback prompt (Yes/No + 280-char text), one vote per visit, Turnstile, rate-limited | **Live** |
| Behaviour rewards (0.7 / 0.2), retry = 0, nightly Thompson-sampling bandit with parent borrowing | **Live** (nightly cron); priors stay flat until a bucket has 30 rewarded visits |
| Archive of every page; "earlier guess" fallback for the same cell and time of day | **Live** (D1) |
| Hourly spend cap (lite at 80%, archive at 100%), 3 model generations per IP per 10 min | **Live**, applies to model mode |
| EU/EEA/UK/CH mode | **Live** |
| Kill switch (all generation, model only, or per archetype) | **Live** (`POST /admin/kill`) |
| Traces + `/stats` with the PRD's alert conditions | **Live**; alerts are reported in `/stats`, nothing pushes them anywhere yet |

**Production is serving template pages, not model pages.** Every page built today says "Built by Moment's template engine from today's forecast, the sun and the calendar." The model path needs a funded key; see [Blocked on you](#blocked-on-you).

## Phase 0: the latency gate

The PRD makes latency the first gate: *median time to first content under 3.5 s*. The harness (`evals/run.mjs`) drives the real flow (session object, router, judge, generator, stream) against a local `wrangler dev` using 50 hand-written briefs (`evals/briefs.json`, from `evals/make-briefs.mjs`).

| Run | First content p50 | Range | Router | Complete |
|---|---|---|---|---|
| Template engine, all 50 briefs | 0.34 s | 0.3–0.4 s | n/a | 0.34 s |
| Model, v1 (one router call writing three plans) | — | — | **4.9–5.5 s**, over its 2.5 s budget, so every visit fell back | — |
| Model, v2 (three parallel lanes + judge overlapped with section 1), 9 briefs | **3.65 s** | 2.8–4.8 s | 1.7–2.5 s | 12.7–25.3 s |

**The gate is not yet passed** (3.65 s against 3.5 s), and the sample is nine pages, because the key used for the benchmark ran out of credit mid-run. What the numbers say:

- Haiku 5.5 streams about 200 tokens/s and Sonnet 5.5 about 160 tokens/s; Sonnet's first token arrives in about 0.8 s with the cached system prompt. Routing is now the larger share of the wait.
- The first call with each router schema pays a one-off grammar compile. Warm runs are the ones that count.
- Measured from the request reaching the edge, not from the iframe request.

The next levers, in the order I would try them: precompute concept plans per warm cell and hour (the PRD's own mitigation for a slow generator) so the live router only re-ranks them; drop each lane's `intent` field; give the judge a shorter budget. All three are measurable with `node evals/run.mjs`.

**Design quality** (looked at, not scored): the model pages were genuinely good: specific, legible, varied, and correct on facts in the brief. Two problems came up, both fixed: (1) one page printed its JavaScript as body text, because the model put `<!--script-->` inside the section; the splitter now handles both placements, and there is a test. (2) Pages added true but out-of-brief background (the history of Armistice Day, the origin of Black Consciousness Day); the São Paulo one failed moderation on the word "death". The prompt now forbids background knowledge outright. Other visible issues (a stat row with crowded labels, a chart whose fill outran its line) are left to the review loop the PRD describes.

## Architecture

```
moment/
  edge/      TypeScript Workers: shell, session Durable Object, governor, render + live APIs, prompts, templates
  ingest/    Pollers, normalizer, safety gate, brief compiler, nightly learner (run on the edge worker's cron)
  design/    30 font pairings, 40 palettes, 10 layouts, banned patterns (JSON)
  schema/    JSON Schemas for signal, brief and plan
  evals/     50 test briefs, the harness, results
  infra/     D1 migrations
  scripts/   CDP probe for rendering checks
```

Two Workers:
- **`moment`** (main origin): `GET /` returns the shell in one round trip and opens a `Session` Durable Object, which starts routing before the browser renders anything. Also owns the `Governor` object (spend cap, per-IP limits), cron triggers, `/stats`, and the admin routes.
- **`moment-render`** (sandbox origin): `/render/:session` streams the page out of the session object; `/live/:lat,:lon/weather` is the live data API generated pages may call. Its CSP allows exactly the PRD's list.

A visit: shell → session object routes (3 Haiku lanes in parallel) → iframe asks for its page once the tab is visible → section 1 of the provisional pick starts streaming while the judge scores the three concepts → Moment writes the document head itself (fonts, palette, layout chosen by a seeded draw) → each section streams through the splitter (preamble dropped, scripts held to the end, frame-navigating elements defanged) → moderation → archive and trace.

## Decisions, and why

I made these calls without asking, as the build instructions direct.

- **Name: `moment`.** The PRD's own name.
- **Cloudflare Workers, not Vercel.** The PRD's whole request path is Workers + Durable Objects + KV, and `request.cf` geo is the point. There is no Vercel project.
- **The sandbox origin is a second `workers.dev` hostname, not a separate registered zone.** `workers.dev` is on the Public Suffix List, so the two hostnames are separate origins but the same site. That is acceptable here because the main site sets no cookies and stores nothing, and the iframe has no `allow-same-origin`, so its origin is opaque anyway. A real second zone (the PRD's `momentrender.app`) is a domain purchase; see below.
- **Ingest is TypeScript on the edge worker's Cron Triggers, not a Rust binary on Fly.io.** No Rust toolchain or Fly account was available, and the PRD's reason for Rust ("thousands of polling jobs an hour across messy third-party formats") is a Phase 2 load. Phase 1 is three free sources across 92 metros: two batched Open-Meteo calls per run. The brief schema in `/schema` is the contract, so a Rust compiler can replace `ingest/` without touching the edge.
- **D1 instead of Postgres (Neon) and R2.** No Neon account was connected, the Supabase free tier is full (two active projects), and R2 is not enabled on the Cloudflare account. D1 is SQL with file migrations, on the same platform, and holds history, feedback, verdicts, traces and the page archive. Moving to Postgres later is mechanical.
- **Briefs carry a 30-hour hourly series and the edge re-derives "now" at request time.** The Workers KV free tier allows 1,000 writes a day, and 92 metros every 15 minutes would be about 8,800. With the series in the brief, a rebuild every 4 hours is as fresh as the forecast itself. On Workers Paid, change the cron to `*/15`.
- **92 warm metros, not 300.** Same KV budget. Every other city is compiled on its first visit (one Open-Meteo call, without making the shell wait) and cached at that edge for 15 minutes, which is the PRD's "rebuild if visited in the last 24 h" behaviour.
- **Wikimedia most-read per country stands in for the paid Trending Now scraper.** It is free, and gate 1 (category allowlist + cached model verdict + manual blocklist) applies to it unchanged.
- **The router is three parallel lanes (useful / playful / read), each proposing one concept.** One call writing three plans took 5 s. Lanes cut the wait to one short concept and make the three different by construction. Each concept carries a specificity self-check. The separate judge still runs, overlapped with section 1, and its verdict wins if it lands within 0.9 s.
- **The document head is written by code, not the model.** That is how "visual style is chosen by code" is enforced, and the iframe paints the right colours on its first bytes. The model writes `<section>` elements only.
- **The template generator** exists so the site works with nothing configured, and as the floor when the model is off, capped, or failing. It follows the generator's contract and never invents a fact.
- **Bot detection is by user agent, purpose headers and HEAD.** Cloudflare's bot score is an Enterprise feature.
- **Reverse-IP company lookup (IPinfo) is not used.** `request.cf.asOrganization` already names the network owner. It is reduced at the edge to one of home / mobile / business / university / in-flight / hosting (plus an industry word for business networks), then dropped. The name itself is never stored, sent or shown.
- **Turnstile** gates model generation and every vote. The widget was created on the account (`moment`, invisible mode).
- **Fahrenheit** for the US and the few other places that read it; Celsius elsewhere.
- **Generator settings:** Sonnet 5.5 with thinking off (`between_tools`) for time to first token, effort `medium`, a 1-hour cached system prompt, and server-side refusal fallbacks (`fallbacks: "default"`).

## The PRD's open risks, and what shipped

| Risk | Shipped answer |
|---|---|
| Scrapers break | No scraper is in the path yet. Trends come from Wikimedia's official API, behind one interface (`ingest/src/trends.ts`) that a paid vendor can sit beside. |
| The generator is too slow | Measured, not assumed (above). Built: parallel router lanes, a speculative first section, sections 1 and 2 generated concurrently, shorter sections. Remaining lever: precomputed concept plans. |
| Pages look generic anyway | Art direction is a seeded draw from 30 × 40 × 10 curated sets, with a banned-pattern list in the prompt. `/admin/review` lists failures and comments for the weekly review. |
| Small places get weak guesses | Every city gets a real forecast-based brief on first visit. The bandit borrows from metro, then country, then global buckets. |
| Few people vote | Behaviour rewards (0.7 for 45 s + interaction, 0.2 for under 8 s), retry = 0, as specified. |
| Feeling watched | Nothing finer than the city; the network owner's name is never shown; the "What Moment reads" link is in every shell footer. |

## Blocked on you

1. **A funded Anthropic API key, to turn on model pages.** The benchmark used the key from `smiski.world/.env.local` (local only; it never went to production), and that key ran out of credit after about $0.80 of this run. Spend is capped at $2/hour by default (`HOURLY_CAP_USD`).
   ```bash
   cd ~/Documents/Dev/moment/edge
   npx wrangler secret put ANTHROPIC_API_KEY        # paste the key
   curl -s https://moment.flockfield-server.workers.dev/health   # "generator":"model"
   ```
   To finish the Phase 0 gate on all 50 briefs (about $5): put the key in `edge/.dev.vars`, run `npm run dev` and `npm run dev:render` in `edge/`, then `node evals/run.mjs`.
2. **Deploys from GitHub.** No OAuth scope can mint a Cloudflare API token. Create one (template "Edit Cloudflare Workers", plus D1 edit), then:
   ```bash
   gh secret set CLOUDFLARE_API_TOKEN -R brandon-lai/moment
   gh secret set CLOUDFLARE_ACCOUNT_ID -R brandon-lai/moment -b 78d3d855efbaa5308c3f0585e34b5d45
   ```
   Until then, `.github/workflows/deploy.yml` runs the tests and skips the deploy step. The live version was deployed with `wrangler deploy` from a `git archive` of the pushed commit, so it matches a commit exactly.
3. **A real sandbox domain** (the PRD's `momentrender.app`) and a main domain. Both are purchases. Afterwards, update `MAIN_ORIGIN` / `RENDER_ORIGIN` in both wrangler configs and the Turnstile widget's domain list.
4. **A privacy lawyer's review of EU mode** before promoting it there (the PRD says so too).
5. **Phase 2 vendor accounts:** Apify (Trends), PredictHQ, BestTime, a sports provider, IPinfo if wanted. Each one is a terms-of-service decision.

## Not built (later phases)

Metro-level trends, PredictHQ, BestTime, sports, the referring-discussion lookup, "what's on", air quality, aurora/meteors, disruptions, academic calendars, rhythm baselines (layer 3), the rule-review queue and exemplar plans, image slots, the "Make it sharper" opt-ins, and the public gallery. The live-data endpoints `/scores`, `/events`, `/trends` and `/busy` answer 404 with "not connected yet". Alerts are computed in `/stats` but not pushed anywhere.

## Running it

```bash
cd edge
npm ci
npm run db:migrate:local
npm run dev            # main worker on :8787
npm run dev:render     # sandbox on :8788 (second terminal)
npm test               # 127 unit tests, including all 50 briefs through the template engine
node ../evals/run.mjs --template      # Phase 0 harness, no model
```

`edge/.dev.vars` (not committed):
```
MAIN_ORIGIN=http://localhost:8787
RENDER_ORIGIN=http://localhost:8788
DEV_EVALS=1
IP_HASH_SECRET=anything
ADMIN_TOKEN=anything
# ANTHROPIC_API_KEY=...   for model mode
```

Admin routes need `Authorization: Bearer $ADMIN_TOKEN` (production's token is in `edge/.admin-token`, which is gitignored):
- `POST /admin/ingest?run=warm|trends|nightly`: run a cron job now
- `POST /admin/kill` with `{"all":true}`, `{"model":true}` or `{"archetypes":["game"]}`; `{}` clears it
- `GET /admin/review`: moderation failures, errors and feedback text
- `GET /stats` (public; with the token it also shows spend)

Data sources: Open-Meteo (free for non-commercial use; a commercial launch needs their paid plan), Nager.Date, Wikimedia REST API. Sun and moon formulas follow SunCalc (BSD).
