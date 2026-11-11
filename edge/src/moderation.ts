// Safety gate 3, after generation. Rules always run; the model check runs
// when a key is configured. A failure swaps in a fallback page and the
// session is logged for review.

import type { Env } from "./env";
import { hasModel, moderateWithModel, type Usage } from "./models";
import { BLOCKLIST } from "../../ingest/src/safety";

const WORDS = new RegExp(`\\b(${BLOCKLIST.filter((w) => !["war", "crash", "trial", "flood"].includes(w)).join("|")})\\b`, "i");
// Claims about the person beyond their city break the spell (PRD: presentation rules).
const PERSONAL = /\b(you work (at|for|in)|your (company|employer|boss|job at|office at|age|wife|husband|girlfriend|boyfriend)|as a (developer|engineer|student|nurse|teacher|parent|mom|dad)|people like you|we know (who|where) you)\b/i;
const DATA_GRAB = /<input[^>]+type=["']?(email|tel|password)|\b(enter|type) your (email|name|phone|address|password)\b/i;

export interface ModerationResult { safe: boolean; reason: string; by: "rules" | "model"; usage?: Usage }

export function moderateRules(text: string, html = ""): ModerationResult {
  const w = text.match(WORDS);
  if (w) return { safe: false, reason: `blocked word: ${w[0]}`, by: "rules" };
  const p = text.match(PERSONAL);
  if (p) return { safe: false, reason: `personal claim: ${p[0]}`, by: "rules" };
  if (DATA_GRAB.test(html) || DATA_GRAB.test(text)) return { safe: false, reason: "asks for personal data", by: "rules" };
  return { safe: true, reason: "rules passed", by: "rules" };
}

export async function moderate(env: Env, text: string, html: string): Promise<ModerationResult> {
  const r = moderateRules(text, html);
  if (!r.safe || !hasModel(env)) return r;
  try {
    const m = await moderateWithModel(env, text);
    return { safe: m.safe, reason: m.reason, by: "model", usage: m.usage };
  } catch (err) {
    // A moderation call that fails is not a pass for model-written pages.
    return { safe: false, reason: `moderation unavailable: ${String(err).slice(0, 120)}`, by: "model" };
  }
}

export function moderateFeedback(text: string): string | null {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 280);
  if (!t) return null;
  if (WORDS.test(t) || /https?:\/\//i.test(t) || /\b[\w.+-]+@[\w-]+\.[\w.]+\b/.test(t) || /\+?\d[\d\s().-]{8,}\d/.test(t)) return null;
  return t;
}
