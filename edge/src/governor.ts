// One global object that holds the hourly spend cap and the per-IP limits
// (PRD: Cost controls, Abuse). IPs arrive here already hashed with a daily
// rotating salt; no raw address is ever held.

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { json } from "./util";

const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_GENERATIONS = 3;
const VOTE_WINDOW_MS = 60 * 60 * 1000;
const VOTE_MAX = 6;

export type SpendLevel = "ok" | "lite" | "archive";

export class Governor extends DurableObject<Env> {
  private gens = new Map<string, number[]>();
  private votes = new Map<string, number[]>();
  private hourKey = "";
  private spentMicros = 0;

  private capMicros(): number {
    return Math.round(Number(this.env.HOURLY_CAP_USD ?? "2") * 1e6);
  }

  private async loadHour(): Promise<void> {
    const key = new Date().toISOString().slice(0, 13);
    if (key !== this.hourKey) {
      this.hourKey = key;
      this.spentMicros = (await this.ctx.storage.get<number>(`spend:${key}`)) ?? 0;
    }
  }

  private level(): SpendLevel {
    const r = this.spentMicros / Math.max(1, this.capMicros());
    return r >= 1 ? "archive" : r >= 0.8 ? "lite" : "ok";
  }

  private prune(m: Map<string, number[]>, windowMs: number, ip: string): number[] {
    const now = Date.now();
    const xs = (m.get(ip) ?? []).filter((t) => now - t < windowMs);
    m.set(ip, xs);
    if (m.size > 50000) m.clear();
    return xs;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    await this.loadHour();
    if (url.pathname === "/check") {
      // Called before a model generation. Counts it if allowed.
      const { ip, count } = (await req.json()) as { ip: string; count: boolean };
      const xs = this.prune(this.gens, IP_WINDOW_MS, ip);
      const ipAllowed = xs.length < IP_MAX_GENERATIONS;
      if (ipAllowed && count) xs.push(Date.now());
      return json({ level: this.level(), ipAllowed, spentUsd: this.spentMicros / 1e6, capUsd: this.capMicros() / 1e6 });
    }
    if (url.pathname === "/spend") {
      const { micros } = (await req.json()) as { micros: number };
      this.spentMicros += Math.max(0, Math.round(micros));
      await this.ctx.storage.put(`spend:${this.hourKey}`, this.spentMicros);
      return json({ level: this.level() });
    }
    if (url.pathname === "/vote") {
      const { ip } = (await req.json()) as { ip: string };
      const xs = this.prune(this.votes, VOTE_WINDOW_MS, ip);
      const genLimited = this.prune(this.gens, IP_WINDOW_MS, ip).length > IP_MAX_GENERATIONS;
      const allowed = xs.length < VOTE_MAX && !genLimited;
      if (allowed) xs.push(Date.now());
      return json({ allowed });
    }
    if (url.pathname === "/status") {
      return json({ level: this.level(), spentUsd: this.spentMicros / 1e6, capUsd: this.capMicros() / 1e6, hour: this.hourKey });
    }
    return new Response("not found", { status: 404 });
  }
}
