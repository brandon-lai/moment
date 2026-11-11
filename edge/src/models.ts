// Model calls. Router, judge, moderation and the safety classifier are short
// structured calls on Claude Haiku 5.5; the generator streams on Claude Sonnet
// 5.5 (PRD: Architecture and stack). Nothing here runs without ANTHROPIC_API_KEY;
// callers check hasModel() and fall back to code paths.

import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "./env";
import { CLASSIFIER_SYSTEM } from "../../ingest/src/safety";
import { CLASSIFY_SCHEMA, GENERATOR_SYSTEM, JUDGE_SCHEMA, JUDGE_SYSTEM, MODERATION_SCHEMA, MODERATION_SYSTEM, ROUTER_SCHEMA, ROUTER_SYSTEM } from "./prompts";
import type { Plan } from "./types";

export const ROUTER_MODEL = "claude-haiku-5-5";
export const GENERATOR_MODEL = "claude-sonnet-5-5";

export function hasModel(env: Env): boolean {
  return !!env.ANTHROPIC_API_KEY && env.MODEL_MODE !== "off";
}

const clients = new WeakMap<object, Anthropic>();
function client(env: Env): Anthropic {
  let c = clients.get(env as object);
  if (!c) {
    c = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 });
    clients.set(env as object, c);
  }
  return c;
}

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; model: string }

// USD per million tokens (cached: 2026-11-03).
const PRICE: Record<string, { in: number; out: number; cacheRead: number }> = {
  [ROUTER_MODEL]: { in: 0.1, out: 0.5, cacheRead: 0.01 },
  [GENERATOR_MODEL]: { in: 2, out: 10, cacheRead: 0.1 },
};

export function costMicros(u: Usage): number {
  const p = PRICE[u.model] ?? PRICE[GENERATOR_MODEL];
  const usd = (u.input * p.in + u.cacheWrite * p.in * 1.25 + u.cacheRead * p.cacheRead + u.output * p.out) / 1e6;
  return Math.round(usd * 1e6);
}

function usageOf(model: string, u: Anthropic.Usage | undefined | null): Usage {
  return {
    model,
    input: u?.input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
    cacheRead: u?.cache_read_input_tokens ?? 0,
    cacheWrite: u?.cache_creation_input_tokens ?? 0,
  };
}

function textOf(msg: Anthropic.Message): string {
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

async function structured<T>(env: Env, system: string, user: string, schema: object, maxTokens: number, timeoutMs: number): Promise<{ data: T; usage: Usage }> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const msg = await client(env).messages.create(
      {
        model: ROUTER_MODEL,
        max_tokens: maxTokens,
        // Short structured output: speed over depth. Haiku 5.5 accepts
        // thinking disabled at effort high or below.
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: { type: "json_schema", schema: schema as Record<string, unknown> } },
        system,
        messages: [{ role: "user", content: user }],
      },
      { signal: ac.signal, timeout: timeoutMs },
    );
    if (msg.stop_reason === "refusal") throw new Error("refusal");
    return { data: JSON.parse(textOf(msg)) as T, usage: usageOf(ROUTER_MODEL, msg.usage) };
  } finally {
    clearTimeout(timer);
  }
}

export async function routeWithModel(env: Env, input: object, timeoutMs: number): Promise<{ candidates: Plan[]; usage: Usage }> {
  const { data, usage } = await structured<{ candidates: Plan[] }>(env, ROUTER_SYSTEM, JSON.stringify(input), ROUTER_SCHEMA, 2500, timeoutMs);
  return { candidates: data.candidates, usage };
}

export async function judgeWithModel(env: Env, candidates: Plan[], place: string, when: string, timeoutMs: number) {
  const user = JSON.stringify({ place, when, concepts: candidates.map((c, i) => ({ index: i, title: c.title, purpose: c.purpose, lead_fact: c.lead_fact, signals_used: c.signals_used })) });
  return structured<{ verdicts: { index: number; could_exist_tomorrow: boolean; could_exist_elsewhere: boolean }[] }>(env, JUDGE_SYSTEM, user, JUDGE_SCHEMA, 400, timeoutMs);
}

export async function moderateWithModel(env: Env, text: string): Promise<{ safe: boolean; reason: string; usage: Usage }> {
  const { data, usage } = await structured<{ safe: boolean; reason: string }>(env, MODERATION_SYSTEM, text.slice(0, 24000), MODERATION_SCHEMA, 300, 15000);
  return { ...data, usage };
}

export async function classifyTerms(env: Env, terms: string[]): Promise<{ labels: { term: string; category: string }[]; usage: Usage }> {
  const { data, usage } = await structured<{ labels: { term: string; category: string }[] }>(env, CLASSIFIER_SYSTEM, JSON.stringify({ terms }), CLASSIFY_SCHEMA, 3000, 30000);
  return { ...data, usage };
}

// One generator call per section. Yields text as it arrives.
export async function* generateSection(env: Env, user: string, signal: AbortSignal, onUsage: (u: Usage) => void): AsyncGenerator<string> {
  const stream = client(env).beta.messages.stream(
    {
      model: GENERATOR_MODEL,
      max_tokens: 12000,
      // Thinking off for time to first token; Sonnet 5.5 turns it off with
      // between_tools, accepted at effort high or below.
      thinking: { type: "between_tools" },
      output_config: { effort: (env.GEN_EFFORT as "low" | "medium" | "high") || "medium" },
      // A declined section is re-run on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: GENERATOR_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
      messages: [{ role: "user", content: user }],
    },
    { signal },
  );
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
  }
  const final = await stream.finalMessage();
  onUsage(usageOf(GENERATOR_MODEL, final.usage as unknown as Anthropic.Usage));
  if (final.stop_reason === "refusal") throw new Error("generator refusal");
}
