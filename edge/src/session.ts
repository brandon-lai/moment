// One Durable Object per visit. It holds the router result and the client
// signals, runs the generator section by section, and pipes the stream to
// whichever request is reading it (PRD: request lifecycle, steps 2 to 9).
// Nothing in here outlives the visit except the trace and the archived page,
// which hold place-level data only.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { ArtDirection, Brief, ClientSignals, Interaction, Layer1, Plan } from "./types";
import { momentView, type MomentView } from "./moment";
import { artSummary, darkAlternate, drawArt, type StyleWeights } from "./art";
import { docHead, docTail, fallbackPage } from "./doc";
export { fallbackPage };
import { route, usageCost, type RouteResult } from "./router";
import { costMicros, generateSection, hasModel, type Usage } from "./models";
import { renderTemplateSection, type TemplateCtx } from "./templates";
import { SectionSplitter, libsUsed, visibleText } from "./splitter";
import { moderate, moderateFeedback } from "./moderation";
import { armsFor, bucketKeys, type BucketContext } from "../../ingest/src/learner";
import { getPriorTable, KV } from "../../ingest/src/pipeline";
import { escapeHtml, hashString, json, localParts, prng, withTimeout } from "./util";
import { ARCHETYPES } from "./types";

export interface InitPayload {
  id: string;
  createdAt: number;     // ms epoch when the visitor's request reached the edge
  shellMs: number;
  l1: Layer1;
  cell: string;
  brief: Brief;
  awaitingExact: boolean;
  exclude: string[];
  ipHash: string;
  turnstile: boolean;
  evalMode?: boolean;
  forceTemplate?: boolean;
  now?: string;          // eval mode only: the moment the brief describes
}

interface Kill { all?: boolean; model?: boolean; archetypes?: string[] }

const enc = new TextEncoder();
const CLIENT_SIGNAL_WAIT_MS = 300;
const EXACT_BRIEF_WAIT_MS = 1200;
const TURNSTILE_WAIT_MS = 8000;

class Channel {
  private buf: string[] = [];
  private waiters: (() => void)[] = [];
  done = false;
  error: unknown = null;
  push(s: string) { if (s) { this.buf.push(s); this.wake(); } }
  end(err?: unknown) { this.done = true; this.error = err ?? null; this.wake(); }
  private wake() { const w = this.waiters; this.waiters = []; w.forEach((f) => f()); }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.buf.length) { yield this.buf.shift()!; continue; }
      if (this.done) { if (this.error) throw this.error; return; }
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }
}

export class Session extends DurableObject<Env> {
  private init?: InitPayload;
  private brief?: Brief;
  private exactResolve?: (b: Brief) => void;
  private exactBrief?: Promise<Brief>;
  private view?: MomentView;
  private routed?: Promise<RouteResult>;
  private routeResult?: RouteResult;
  private art?: ArtDirection;
  private client: ClientSignals | null = null;
  private clientResolve?: () => void;
  private clientPosted?: Promise<void>;
  private turnstileResolve?: (ok: boolean) => void;
  private turnstilePromise?: Promise<boolean>;
  private interactions: Interaction[] = [];
  private html = "";
  private readers: WritableStreamDefaultWriter<Uint8Array>[] = [];
  private finished = false;
  private started = false;
  private events: string[] = [];
  private sse: WritableStreamDefaultWriter<Uint8Array>[] = [];
  private abort = new AbortController();
  private usage: Usage[] = [];
  private firstContentAt = 0;
  private completeAt = 0;
  private mode: "model" | "template" | "archive" | "fallback" = "template";
  private moderation: { safe: boolean; reason: string } | null = null;
  private errorText: string | null = null;
  private pendingVote: { vote: string; text: string | null } | null = null;
  private traced = false;
  private rewarded = false;
  private swapUrl: string | null = null;

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    try {
      if (p === "/init" && req.method === "POST") return this.onInit((await req.json()) as InitPayload);
      if (p === "/brief" && req.method === "POST") { this.exactResolve?.((await req.json()) as Brief); return json({ ok: true }); }
      if (p === "/signals" && req.method === "POST") return this.onSignals((await req.json()) as ClientSignals);
      if (p === "/interaction" && req.method === "POST") { if (!this.init?.l1.eu) this.pushInteraction((await req.json()) as Interaction); return json({ ok: true }); }
      if (p === "/turnstile" && req.method === "POST") return this.onTurnstile((await req.json()) as { ok: boolean });
      if (p === "/render") return this.onRender();
      if (p === "/archive") return this.onArchive();
      if (p === "/events") return this.onEvents();
      if (p === "/vote" && req.method === "POST") return this.onVote((await req.json()) as { vote: string; text?: string });
      if (p === "/end" && req.method === "POST") return this.onEnd((await req.json()) as { dwellMs: number; interacted: boolean });
      if (p === "/retry" && req.method === "POST") return this.onRetry();
      if (p === "/state") return json({ plan: this.routeResult?.plan ?? null, routeError: this.routeResult?.error ?? null, mode: this.mode, finished: this.finished, moderation: this.moderation, art: this.art ? artSummary(this.art) : null, firstContentMs: this.firstContentAt ? this.firstContentAt - (this.init?.createdAt ?? 0) : null, completeMs: this.completeAt ? this.completeAt - (this.init?.createdAt ?? 0) : null, routerMs: this.routeResult?.routerMs ?? null, judgeMs: this.routeResult?.judgeMs ?? null, judged: this.routeResult?.judged ?? null, how: this.routeResult?.how ?? null, usage: this.usage, error: this.errorText });
      return new Response("not found", { status: 404 });
    } catch (err) {
      console.error("session", p, err);
      return json({ error: String(err) }, { status: 500 });
    }
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  // ---- lifecycle -----------------------------------------------------------

  // The moment being built for. Real time, except in the Phase 0 harness,
  // where each hand-written brief describes a fixed moment.
  private clock(): Date {
    return this.init?.evalMode && this.init.now ? new Date(this.init.now) : new Date();
  }

  private async onInit(init: InitPayload): Promise<Response> {
    if (this.init) return json({ ok: true, already: true });
    this.init = init;
    this.brief = init.brief;
    if (init.awaitingExact) this.exactBrief = new Promise((r) => (this.exactResolve = r));
    this.clientPosted = new Promise((r) => (this.clientResolve = r));
    if (init.l1.eu) this.clientResolve?.(); // EU mode: no client signal post
    this.turnstilePromise = new Promise((r) => (this.turnstileResolve = r));
    if (!init.turnstile) this.turnstileResolve?.(true);
    await this.ctx.storage.setAlarm(Date.now() + 3 * 3600 * 1000);
    // The router call starts right away, before the browser renders anything.
    this.routed = this.prepare();
    this.ctx.waitUntil(this.routed.catch(() => undefined));
    return json({ ok: true });
  }

  private async prepare(): Promise<RouteResult> {
    const init = this.init!;
    if (this.exactBrief) {
      const b = await withTimeout(this.exactBrief, EXACT_BRIEF_WAIT_MS);
      if (b !== "timeout") this.brief = b;
    }
    const now = this.clock();
    this.view = momentView(this.brief!, init.l1, now);
    this.emit("reveal", { lines: this.view.reveal });

    const [table, kill] = await Promise.all([
      getPriorTable(this.env).catch(() => ({})),
      this.env.BRIEFS.get<Kill>(KV.kill, { type: "json", cacheTtl: 30 }).catch(() => null),
    ]);
    const arms = armsFor(table, bucketKeys(this.bucket()), ARCHETYPES);
    const rand = prng(hashString(init.id));
    const compact = init.l1.saveData || init.l1.situations.includes("saving-data");
    const tctx: TemplateCtx = { view: this.view, l1: init.l1, now, compact };
    const templateOnly = !!init.forceTemplate || !hasModel(this.env) || !!kill?.model || !!kill?.all;

    let lite = false;
    if (!templateOnly) {
      const g = await this.governor("/status", {}).catch(() => null);
      lite = g?.level === "lite";
    }
    const r = await route({ env: this.env, view: this.view, l1: init.l1, arms, exclude: init.exclude, lite, templateOnly, rand, tctx, killed: kill?.archetypes ?? [] });
    this.routeResult = r;
    this.usage.push(...r.usage);
    if (r.usage.length) this.spend(usageCost(r.usage));
    this.emit("plan", { title: r.plan.title, archetype: r.plan.archetype, how: r.how });
    return r;
  }

  private bucket(): BucketContext {
    const init = this.init!;
    const v = this.view;
    const lp = localParts(this.clock(), v?.tz ?? init.l1.tz);
    return {
      cell: init.cell, country: init.l1.country, daypart: v?.local.daypart ?? "night",
      weekpart: lp.weekday === "Saturday" || lp.weekday === "Sunday" ? "weekend" : "weekday",
      device: init.l1.device, referrer: init.l1.referrerType, weather: v?.weather?.bucket ?? "unknown", network: init.l1.network,
    };
  }

  private onSignals(s: ClientSignals): Response {
    if (this.init?.l1.eu) return json({ ok: true, ignored: true });
    this.client = {
      vw: clampN(s.vw, 200, 8000), vh: clampN(s.vh, 200, 8000), dark: !!s.dark, reducedMotion: !!s.reducedMotion,
      touch: !!s.touch, connection: typeof s.connection === "string" ? s.connection.slice(0, 12) : null,
      tz: typeof s.tz === "string" ? s.tz.slice(0, 64) : null, localTime: null,
    };
    const l1 = this.init?.l1;
    if (l1 && this.client.tz && this.client.tz !== l1.tz && !l1.situations.includes("just-traveled")) l1.situations.push("just-traveled");
    if (l1 && l1.device === "desktop" && this.client.vw < 900 && !l1.situations.includes("multitasking")) l1.situations.push("multitasking");
    if (l1 && /^(slow-2g|2g)$/.test(this.client.connection ?? "") && !l1.situations.includes("saving-data")) l1.situations.push("saving-data");
    this.clientResolve?.();
    return json({ ok: true });
  }

  private onTurnstile(b: { ok: boolean }): Response {
    this.turnstileResolve?.(!!b.ok);
    return json({ ok: true });
  }

  private pushInteraction(i: Interaction): void {
    this.interactions.push({
      section: typeof i.section === "string" ? i.section.slice(0, 40) : null,
      scrollSpeed: clampN(i.scrollSpeed, 0, 20000), hovered: (Array.isArray(i.hovered) ? i.hovered : []).slice(0, 12).map((h) => String(h).slice(0, 40)),
      taps: clampN(i.taps, 0, 1000), idleMs: clampN(i.idleMs, 0, 3600000), atBottom: !!i.atBottom,
    });
    if (this.interactions.length > 120) this.interactions.shift();
  }

  // ---- streaming out -------------------------------------------------------

  private onRender(): Response {
    const ts = new TransformStream<Uint8Array, Uint8Array>();
    const w = ts.writable.getWriter();
    if (this.html) w.write(enc.encode(this.html)).catch(() => {});
    if (this.finished) w.close().catch(() => {});
    else this.readers.push(w);
    // The iframe asks for its page only once the tab is visible, so a tab
    // opened in the background routes but does not generate until looked at.
    if (!this.started) {
      this.started = true;
      this.ctx.waitUntil(this.generate().catch((err) => console.error("generate", err)));
    }
    return new Response(ts.readable, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  private write(s: string): void {
    if (!s) return;
    this.html += s;
    const bytes = enc.encode(s);
    this.readers = this.readers.filter((w) => {
      w.write(bytes).catch(() => { this.readers = this.readers.filter((x) => x !== w); });
      return true;
    });
  }

  private closeReaders(): void {
    this.finished = true;
    for (const w of this.readers) w.close().catch(() => {});
    this.readers = [];
  }

  private onEvents(): Response {
    const ts = new TransformStream<Uint8Array, Uint8Array>();
    const w = ts.writable.getWriter();
    w.write(enc.encode(`retry: 3000\n\n${this.events.join("")}`)).catch(() => {});
    this.sse.push(w);
    const ping = setInterval(() => {
      w.write(enc.encode(`: ping\n\n`)).catch(() => { clearInterval(ping); this.sse = this.sse.filter((x) => x !== w); });
    }, 15000);
    return new Response(ts.readable, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
  }

  private emit(event: string, data: unknown): void {
    const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.events.push(line);
    const bytes = enc.encode(line);
    for (const w of this.sse) w.write(bytes).catch(() => { this.sse = this.sse.filter((x) => x !== w); });
  }

  private markFirstContent(): void {
    if (this.firstContentAt) return;
    this.firstContentAt = Date.now();
    this.emit("first", { ms: this.firstContentAt - this.init!.createdAt });
  }

  // ---- generation ----------------------------------------------------------

  private async generate(): Promise<void> {
    const init = this.init!;
    const r = await this.routed!;
    let plan = r.plan;
    // Wait up to 300 ms for client signals, then proceed without them.
    await withTimeout(this.clientPosted!, CLIENT_SIGNAL_WAIT_MS);

    const kill = await this.env.BRIEFS.get<Kill>(KV.kill, { type: "json", cacheTtl: 30 }).catch(() => null);
    const styles = await this.env.BRIEFS.get<StyleWeights>(KV.styles, { type: "json", cacheTtl: 600 }).catch(() => null);
    const v = this.view!;
    const compact = init.l1.situations.includes("saving-data") || init.l1.situations.includes("multitasking");
    this.art = drawArt({
      seed: hashString(`${init.id}:art`), weather: v.weather?.bucket ?? "clear", daypart: v.local.daypart,
      reducedMotion: this.client?.reducedMotion, compact, archetype: plan.archetype, weights: styles ?? undefined,
    });

    if (kill?.all) { await this.serveArchive("Generation is paused. Here is an earlier guess for this place and time of day."); return; }

    let useModel = r.how === "model";
    if (useModel) {
      // Turnstile must pass before the generator starts (model mode only:
      // the template engine costs nothing to run).
      const ts = await withTimeout(this.turnstilePromise!, TURNSTILE_WAIT_MS);
      const g = await this.governor("/check", { ip: init.ipHash, count: ts === true && !init.evalMode }).catch(() => null);
      // The local Phase 0 harness sends every brief from one address.
      const ipAllowed = init.evalMode ? true : g?.ipAllowed;
      if (ts !== true || !ipAllowed || g?.level === "archive") {
        const why = ts !== true ? "turnstile" : !ipAllowed ? "per-ip limit" : "spend cap";
        this.errorText = `model skipped: ${why}`;
        const served = await this.serveArchive(null, true);
        if (served) return;
        useModel = false;
      }
    }

    // Section 1 of the provisional pick starts now, while the judge scores
    // the candidates. If the judge changes the pick, it is thrown away.
    let first: { ch: Channel; scripts: string[]; abort: AbortController } | null = null;
    if (useModel && r.confirm) {
      first = this.streamSection(plan, 0, [], new AbortController());
      const c = await r.confirm;
      this.usage.push(...c.usage);
      if (c.usage.length) this.spend(usageCost(c.usage));
      r.specificity = c.specificity;
      r.judged = c.judged;
      r.judgeMs = c.judgeMs;
      if (c.index !== r.picked) {
        first.abort.abort();
        first = null;
        r.picked = c.index;
        r.plan = plan = r.candidates[c.index];
        this.emit("plan", { title: plan.title, archetype: plan.archetype, how: r.how, judged: true });
      }
    }

    this.mode = useModel ? "model" : "template";
    this.emit("start", { mode: this.mode });
    const dark = this.client?.dark === false ? null : darkAlternate(this.art, v.weather?.bucket ?? "clear");
    this.write(docHead({
      title: plan.title, art: this.art, dark, liveBase: v.coords ? `${this.env.RENDER_ORIGIN}/live/${v.coords.lat.toFixed(2)},${v.coords.lon.toFixed(2)}` : `${this.env.RENDER_ORIGIN}/live/none`,
      eu: init.l1.eu, tz: v.tz, place: v.place, label: "",
    }));

    const scripts: string[] = [];
    try {
      if (useModel) await this.generateWithModel(plan, scripts, first);
      else this.generateWithTemplates(plan, scripts);
    } catch (err) {
      this.errorText = String(err).slice(0, 300);
      this.abort.abort();
      console.error("generator failed", err);
      if (!this.firstContentAt) {
        // Generator failing: serve a recent page from the archive for the same
        // cell and time of day, labeled as an earlier guess.
        this.swapUrl = `${this.env.RENDER_ORIGIN}/render/${init.id}?archive=1`;
        this.emit("swap", { url: this.swapUrl, reason: "generator" });
      } else {
        this.write(`<section id="m-cut"><p class="m-muted">This page stopped partway through. Try another guess.</p></section>`);
      }
    }
    const libs = init.l1.situations.includes("saving-data") ? [] : libsUsed(scripts);
    this.write(docTail(libs, scripts));
    this.completeAt = Date.now();
    this.closeReaders();
    this.emit("complete", { ms: this.completeAt - init.createdAt, mode: this.mode });
    await this.afterComplete(plan);
  }

  private generateWithTemplates(plan: Plan, scripts: string[]): void {
    const init = this.init!;
    const tctx: TemplateCtx = { view: this.view!, l1: init.l1, now: this.clock(), compact: init.l1.situations.includes("multitasking") };
    plan.sections.forEach((s, i) => {
      const out = renderTemplateSection(plan, s, tctx);
      this.write(out.html + "\n");
      if (i === 0) this.markFirstContent();
      if (out.script) scripts.push(out.script);
      this.emit("section", { i: i + 1, n: plan.sections.length, id: s.id });
    });
  }

  // One generator call for one section, streamed through the splitter into a
  // channel that the writer drains in order.
  private streamSection(plan: Plan, i: number, texts: string[], abort: AbortController): { ch: Channel; scripts: string[]; abort: AbortController } {
    const ch = new Channel();
    const sp = new SectionSplitter();
    const user = this.sectionPrompt(plan, i, texts);
    const onParent = () => abort.abort();
    this.abort.signal.addEventListener("abort", onParent);
    const run = async () => {
      try {
        for await (const t of generateSection(this.env, user, abort.signal, (u) => { this.usage.push(u); this.spend(costMicros(u)); })) ch.push(sp.push(t));
        ch.push(sp.finish());
        ch.end();
      } catch (err) {
        ch.push(sp.finish());
        ch.end(err);
      } finally {
        this.abort.signal.removeEventListener("abort", onParent);
      }
    };
    this.ctx.waitUntil(run());
    return { ch, scripts: sp.scripts, abort };
  }

  private async generateWithModel(plan: Plan, scripts: string[], first: { ch: Channel; scripts: string[] } | null): Promise<void> {
    const sections = plan.sections;
    const streams: { ch: Channel; scripts: string[] }[] = [];
    const texts: string[] = [];
    streams[0] = first ?? this.streamSection(plan, 0, texts, new AbortController());
    // Section 2 is written from the plan alone, so it starts alongside
    // section 1 and is held until section 1 has finished streaming.
    if (sections.length > 1) streams[1] = this.streamSection(plan, 1, texts, new AbortController());
    for (let i = 0; i < sections.length; i++) {
      // Section 3 onward also sees how the visitor used the ones before.
      streams[i] ??= this.streamSection(plan, i, texts, new AbortController());
      let text = "";
      for await (const chunk of streams[i].ch) {
        this.write(chunk);
        text += chunk;
        if (/<\/?[a-z]/i.test(chunk) && visibleText(text).length > 20) this.markFirstContent();
      }
      if (!text.trim()) throw new Error(`section ${i + 1} produced no markup`);
      texts[i] = visibleText(text);
      scripts.push(...streams[i].scripts);
      this.emit("section", { i: i + 1, n: sections.length, id: sections[i].id });
    }
  }

  private sectionPrompt(plan: Plan, i: number, texts: string[]): string {
    const init = this.init!;
    const v = this.view!;
    const a = this.art!;
    const s = plan.sections[i];
    const fmt = (c: number) => (v.unit === "F" ? `${Math.round((c * 9) / 5 + 32)}°F (${Math.round(c)}°C)` : `${Math.round(c)}°C`);
    const hourly = (v.weather?.hourly ?? []).slice(0, 13).map((h) => ({ time: h.t.slice(11, 16), temp: fmt(h.temp), rain_chance: `${h.pop}%`, rain_mm: h.mm, sky_code: h.code }));
    const recent = i >= 2 ? summarizeInteractions(this.interactions) : null;
    return JSON.stringify({
      page: { title: plan.title, purpose: plan.purpose, archetype: plan.archetype, lead_fact: plan.lead_fact, sections: plan.sections.map((x) => ({ id: x.id, heading: x.heading })) },
      write_section: { number: i + 1, of: plan.sections.length, id: s.id, heading: s.heading, intent: s.intent },
      moment: {
        place: v.place || null, country: v.country, local_time: v.local.clock, weekday: v.local.weekday, daypart: v.local.daypart, weekend: v.local.weekend, date: v.local.isoDate,
        temperature_unit: v.unit,
        weather: v.weather ? { now: v.weather.now, temperature: fmt(v.weather.temp_c), next_12h: v.weather.next_12h, unusual: v.weather.unusual, rain_stops_around: v.weather.rain_stops, rain_likely_from: v.weather.rain_starts, sunrise: v.weather.sunrise, sunset: v.weather.sunset, hourly_local: hourly } : null,
        signals: v.signals.map((x) => ({ kind: x.kind, label: x.label })),
      },
      visitor: { device: init.l1.device, situations: init.l1.situations, prefers_dark: this.client?.dark ?? null, reduced_motion: this.client?.reducedMotion ?? null, viewport: this.client ? `${this.client.vw}x${this.client.vh}` : null },
      art: { layout: a.layout.describe, motion: a.motion, density: a.density, palette_scheme: a.palette.scheme },
      allowed_libs: init.l1.situations.includes("saving-data") ? [] : ["anime", "d3"],
      live_data_available: plan.live_data,
      earlier_sections: texts.slice(0, i).map((t, k) => ({ id: plan.sections[k].id, text: t.slice(0, 400) })),
      interaction_summary: recent,
    });
  }

  private async serveArchive(label: string | null, quietIfNone = false): Promise<boolean> {
    const init = this.init!;
    const row = await this.findArchive();
    if (!row) {
      if (quietIfNone) return false;
      this.write(fallbackPage("Moment is resting. Come back in a little while."));
      this.mode = "fallback";
    } else {
      const when = new Date(row.created_at);
      const lp = localParts(when, this.view?.tz ?? init.l1.tz);
      const text = label ?? `An earlier guess for this place, from ${lp.weekday} ${lp.hour % 12 || 12}${lp.hour < 12 ? " a.m." : " p.m."}.`;
      this.write(labelEarlier(row.html, text));
      this.mode = "archive";
    }
    this.markFirstContent();
    this.completeAt = Date.now();
    this.closeReaders();
    this.emit("start", { mode: this.mode });
    this.emit("complete", { ms: this.completeAt - init.createdAt, mode: this.mode });
    await this.writeTrace(this.routeResult?.plan ?? null);
    return true;
  }

  private async findArchive(): Promise<{ html: string; created_at: string } | null> {
    const init = this.init!;
    const daypart = this.view?.local.daypart ?? "night";
    const exact = await this.env.DB.prepare("SELECT html, created_at FROM pages WHERE cell = ? AND daypart = ? ORDER BY created_at DESC LIMIT 1").bind(init.cell, daypart).first<{ html: string; created_at: string }>().catch(() => null);
    return exact;
  }

  private async onArchive(): Promise<Response> {
    const row = await this.findArchive();
    const html = row ? labelEarlier(row.html, "An earlier guess for this place and time of day.") : fallbackPage("This page could not be written. Try another guess.");
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  private async afterComplete(plan: Plan): Promise<void> {
    const init = this.init!;
    if (this.mode === "model" || this.mode === "template") {
      const text = visibleText(this.html);
      const m = await moderate(this.env, text, this.html);
      if (m.usage) { this.usage.push(m.usage); this.spend(costMicros(m.usage)); }
      this.moderation = { safe: m.safe, reason: m.reason };
      this.emit("moderation", { safe: m.safe });
      if (!m.safe) {
        this.swapUrl = `${this.env.RENDER_ORIGIN}/fallback`;
        this.emit("swap", { url: this.swapUrl, reason: "moderation" });
        console.warn("moderation failure", init.id, m.reason);
      } else if (!init.evalMode && !this.errorText) {
        await this.env.DB.prepare("INSERT OR REPLACE INTO pages (session_id, created_at, cell, daypart, archetype, mode, title, brief_json, plan_json, html) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(init.id, new Date().toISOString(), init.cell, this.view!.local.daypart, plan.archetype, this.mode, plan.title, JSON.stringify(this.brief), JSON.stringify(plan), this.html)
          .run().catch((err) => console.error("archive", err));
      }
    }
    await this.writeTrace(plan);
  }

  private async writeTrace(plan: Plan | null): Promise<void> {
    const init = this.init!;
    if (init.evalMode || this.traced) return;
    this.traced = true;
    const r = this.routeResult;
    const b = this.bucket();
    const tokensIn = this.usage.reduce((a, u) => a + u.input + u.cacheRead + u.cacheWrite, 0);
    const tokensOut = this.usage.reduce((a, u) => a + u.output, 0);
    const cost = this.usage.reduce((a, u) => a + costMicros(u), 0);
    await this.env.DB.prepare(`INSERT OR REPLACE INTO traces (session_id, created_at, cell, country, daypart, weekpart, device, referrer, network, weather, eu, mode, route_how, explored, archetype, title, plan_json, candidates_json, specificity_json, font, palette, layout, bucket_json, shell_ms, router_ms, first_content_ms, complete_ms, tokens_in, tokens_out, cost_micros, moderation, moderation_reason, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(init.id, new Date(init.createdAt).toISOString(), init.cell, init.l1.country, b.daypart, b.weekpart, b.device, b.referrer, b.network, b.weather, init.l1.eu ? 1 : 0,
        this.mode, r?.how ?? null, r?.explored ? 1 : 0, plan?.archetype ?? null, plan?.title ?? null, plan ? JSON.stringify(plan) : null,
        r ? JSON.stringify(r.candidates.map((c) => ({ archetype: c.archetype, title: c.title }))) : null, r ? JSON.stringify(r.specificity) : null,
        this.art?.font.id ?? null, this.art?.palette.id ?? null, this.art?.layout.id ?? null, JSON.stringify(b), init.shellMs, r?.routerMs ?? null,
        this.firstContentAt ? this.firstContentAt - init.createdAt : null, this.completeAt ? this.completeAt - init.createdAt : null,
        tokensIn, tokensOut, cost, this.moderation ? (this.moderation.safe ? "pass" : "fail") : null, this.moderation?.reason ?? null, this.errorText)
      .run().catch((err) => console.error("trace", err));
    if (this.pendingVote) await this.recordVote(this.pendingVote.vote, this.pendingVote.text);
  }

  // ---- feedback ------------------------------------------------------------

  private async onVote(b: { vote: string; text?: string }): Promise<Response> {
    if (b.vote !== "yes" && b.vote !== "no" && b.vote !== "text") return json({ error: "bad vote" }, { status: 400 });
    const voted = await this.ctx.storage.get<string>("voted");
    const text = b.text ? moderateFeedback(b.text) : null;
    if (b.vote === "text") {
      // Follow-up text after a tap. Text never reaches a prompt (PRD: Privacy).
      if (!voted) return json({ error: "vote first" }, { status: 409 });
      if (text) await this.env.DB.prepare("UPDATE traces SET feedback_text = ? WHERE session_id = ?").bind(text, this.init?.id ?? "").run().catch(() => {});
      return json({ ok: true, kept: !!text });
    }
    if (voted) return json({ error: "already voted" }, { status: 409 });
    await this.ctx.storage.put("voted", b.vote);
    if (!this.traced) this.pendingVote = { vote: b.vote, text };
    else await this.recordVote(b.vote, text);
    return json({ ok: true });
  }

  private async recordVote(vote: string, text: string | null): Promise<void> {
    this.rewarded = true;
    await this.ctx.storage.put("rewarded", true);
    await this.env.DB.prepare("UPDATE traces SET vote = ?, reward = ?, reward_source = 'vote', feedback_text = COALESCE(?, feedback_text) WHERE session_id = ?")
      .bind(vote, vote === "yes" ? 1 : 0, text, this.init?.id ?? "").run().catch((err) => console.error("vote", err));
  }

  private async onEnd(b: { dwellMs: number; interacted: boolean }): Promise<Response> {
    if (!this.init || this.init.l1.eu) return json({ ok: true, ignored: true });
    // Behaviour rewards stop the bandit starving when few people vote, but an
    // explicit vote or a retry always outweighs them.
    const already = this.rewarded || (await this.ctx.storage.get<boolean>("rewarded"));
    const dwell = clampN(b.dwellMs, 0, 6 * 3600000);
    if (already || !this.traced) {
      await this.env.DB.prepare("UPDATE traces SET dwell_ms = ? WHERE session_id = ?").bind(dwell, this.init.id).run().catch(() => {});
      return json({ ok: true });
    }
    const { behaviourReward } = await import("../../ingest/src/learner");
    const r = behaviourReward(dwell, !!b.interacted);
    await this.env.DB.prepare("UPDATE traces SET dwell_ms = ?, reward = ?, reward_source = CASE WHEN ? IS NULL THEN NULL ELSE 'behaviour' END WHERE session_id = ?")
      .bind(dwell, r, r, this.init.id).run().catch(() => {});
    if (r != null) { this.rewarded = true; await this.ctx.storage.put("rewarded", true); }
    return json({ ok: true, reward: r });
  }

  private async onRetry(): Promise<Response> {
    this.abort.abort();
    // "Try another guess" counts as a quiet no.
    if (!this.rewarded) {
      this.rewarded = true;
      await this.ctx.storage.put("rewarded", true);
      if (this.traced) await this.env.DB.prepare("UPDATE traces SET retried = 1, reward = 0, reward_source = 'retry' WHERE session_id = ?").bind(this.init?.id ?? "").run().catch(() => {});
    }
    return json({ archetype: this.routeResult?.plan.archetype ?? null, exclude: [...(this.init?.exclude ?? []), this.routeResult?.plan.archetype].filter(Boolean) });
  }

  // ---- governor ------------------------------------------------------------

  private async governor(path: string, body: object): Promise<{ level: string; ipAllowed?: boolean }> {
    const stub = this.env.GOVERNOR.get(this.env.GOVERNOR.idFromName("global"));
    const res = await stub.fetch(`https://governor${path}`, { method: "POST", body: JSON.stringify(body) });
    return res.json();
  }

  private spend(micros: number): void {
    if (micros <= 0) return;
    this.ctx.waitUntil(this.governor("/spend", { micros }).catch(() => {}));
  }
}

function clampN(x: unknown, lo: number, hi: number): number {
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : lo;
}

export function summarizeInteractions(xs: Interaction[]): object | null {
  if (!xs.length) return null;
  const bySection = new Map<string, number>();
  for (const x of xs) if (x.section) bySection.set(x.section, (bySection.get(x.section) ?? 0) + 2);
  const hovered = [...new Set(xs.flatMap((x) => x.hovered))].slice(0, 10);
  const speeds = xs.map((x) => x.scrollSpeed);
  const avg = Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length);
  return {
    seconds_on_each_section: Object.fromEntries(bySection),
    average_scroll_speed_px_s: avg,
    reading_style: avg > 1500 ? "scanning fast" : avg > 400 ? "steady" : "lingering",
    hovered_or_tapped: hovered,
    taps: xs.reduce((a, x) => a + x.taps, 0) - (xs.length > 1 ? 0 : 0),
    idle_seconds_now: Math.round(xs[xs.length - 1].idleMs / 1000),
  };
}

function labelEarlier(html: string, text: string): string {
  return html.replace(/<body([^>]*)>/i, `<body$1><div class="m-earlier" role="note">${escapeHtml(text)}</div>`);
}

