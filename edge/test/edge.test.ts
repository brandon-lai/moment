import { describe, expect, it } from "vitest";
import { cellChain, isBot, networkType, visitingFromAbroad } from "../src/geo";
import type { Layer1 } from "../src/types";
import { SectionSplitter, defang, visibleText } from "../src/splitter";
import { moderateFeedback, moderateRules } from "../src/moderation";
import { armsFor, bucketKeys, learn, sampleBeta, behaviourReward, MIN_REWARDED } from "../../ingest/src/learner";
import { choose, EXPLORE_RATE } from "../src/router";
import { prng } from "../src/util";
import type { Plan } from "../src/types";

const l1 = (o: Partial<Layer1>): Layer1 => ({ country: "US", region: "NJ", regionName: "New Jersey", city: "Hoboken", metroCode: "501", lat: 40.74, lon: -74.03, tz: "America/New_York", eu: false, device: "desktop", language: "en-US", referrerType: "direct", referrerHost: null, via: null, network: "home", industry: null, saveData: false, situations: [], ...o });

describe("geo cells", () => {
  it("keys a DMA by its primary state so the whole metro shares a brief", () => {
    expect(cellChain(l1({}))).toEqual(["US/NY/501", "US/NJ", "US", "global"]);
  });
  it("uses the city as the metro elsewhere", () => {
    expect(cellChain(l1({ country: "GB", region: "ENG", city: "London", metroCode: null }))).toEqual(["GB/m/London", "GB/ENG", "GB", "global"]);
  });
  it("falls back to the global brief with nothing to go on", () => {
    expect(cellChain(l1({ country: "XX", region: null, city: null, metroCode: null }))).toEqual(["global"]);
  });
});

describe("layer 1", () => {
  it("labels networks and never keeps the company name", () => {
    expect(networkType("Gogo Business Aviation").type).toBe("inflight");
    expect(networkType("Massachusetts Institute of Technology").type).toBe("university");
    expect(networkType("Comcast Cable Communications").type).toBe("home");
    expect(networkType("T-Mobile USA").type).toBe("mobile");
    const biz = networkType("Acme Software Systems Inc");
    expect(biz).toEqual({ type: "business", industry: "technology" });
    expect(JSON.stringify(biz)).not.toMatch(/acme/i);
  });
  it("spots a visitor from abroad only where it knows the languages", () => {
    expect(visitingFromAbroad("ja-JP", "FR")).toBe(true);
    expect(visitingFromAbroad("fr-FR", "FR")).toBe(false);
    expect(visitingFromAbroad("ja-JP", "ZZ")).toBe(false);
  });
  it("treats crawlers, previews and prefetches as bots", () => {
    const r = (ua: string, h: Record<string, string> = {}) => new Request("https://x/", { headers: { "user-agent": ua, ...h } });
    expect(isBot(r("Mozilla/5.0 (compatible; Googlebot/2.1)"))).toBe(true);
    expect(isBot(r("Slackbot-LinkExpanding 1.0"))).toBe(true);
    expect(isBot(r("Mozilla/5.0 (Macintosh) Chrome/131 Safari/537.36", { "sec-purpose": "prefetch" }))).toBe(true);
    expect(isBot(r("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"))).toBe(false);
  });
});

describe("section splitter (model output is untrusted)", () => {
  const sample = `Sure! Here is the section:\n<section id="a"><h2>Rain</h2><p>Stops at 7.</p><script>alert(1)</script><p>More</p></section>\n<!--script-->\nconst x = 1;\ndocument.getElementById('a');\n`;
  it("drops preface, holds scripts back, keeps markup", () => {
    const sp = new SectionSplitter();
    const out = sp.push(sample) + sp.finish();
    expect(out).toBe(`<section id="a"><h2>Rain</h2><p>Stops at 7.</p><p>More</p></section>`);
    expect(sp.scripts).toEqual(["alert(1)", "const x = 1;\ndocument.getElementById('a');"]);
  });
  it("gives the same result however the stream is chunked", () => {
    const sp = new SectionSplitter();
    let out = "";
    for (const ch of sample) out += sp.push(ch);
    out += sp.finish();
    expect(out).toBe(`<section id="a"><h2>Rain</h2><p>Stops at 7.</p><p>More</p></section>`);
    expect(sp.scripts).toHaveLength(2);
  });
  it("defangs anything that could navigate the frame or load elsewhere", () => {
    const bad = `<section id="b"><meta http-equiv="refresh" content="0;url=https://evil"><iframe src="x"></iframe><form action="/x"><a href="javascript:alert(1)">x</a></section>`;
    const sp = new SectionSplitter();
    const out = sp.push(bad) + sp.finish();
    expect(out).not.toMatch(/<meta|<iframe|<form|javascript:/i);
  });
  it("closes a section the model never finished", () => {
    const sp = new SectionSplitter();
    expect(sp.push(`<section id="c"><p>cut off`) + sp.finish()).toBe(`<section id="c"><p>cut off</section>`);
  });
  it("extracts visible text", () => {
    expect(visibleText(`<style>x{}</style><h1>Hi &amp; bye</h1><script>no()</script>`)).toBe("Hi & bye");
    expect(defang("<link rel=stylesheet href=x>")).toBe("&lt;link rel=stylesheet href=x>");
  });
});

describe("moderation rules", () => {
  it("passes an ordinary page and fails personal claims", () => {
    expect(moderateRules("The rain stops around 7 p.m. Bring a hood.").safe).toBe(true);
    expect(moderateRules("As a developer at your company you deserve a break").safe).toBe(false);
    expect(moderateRules("A shooting downtown").safe).toBe(false);
    expect(moderateRules("", `<input type="email">`).safe).toBe(false);
  });
  it("drops feedback that carries contact details", () => {
    expect(moderateFeedback("loved it")).toBe("loved it");
    expect(moderateFeedback("email me at a@b.com")).toBeNull();
    expect(moderateFeedback("call 212 555 0199 ok")).toBeNull();
    expect(moderateFeedback("x".repeat(400))!.length).toBe(280);
  });
});

describe("learning", () => {
  const ctx = { cell: "US/NY/501", country: "US", daypart: "evening", weekpart: "weekday" as const, device: "mobile", referrer: "direct", weather: "rain", network: "home" };
  it("moves priors only after 30 rewarded visits, borrowing from parents", () => {
    const rows = Array.from({ length: MIN_REWARDED + 2 }, (_, i) => ({ bucket_json: JSON.stringify({ ...ctx, device: i % 2 ? "mobile" : "desktop" }), archetype: "tool", reward: 1 }));
    const t = learn(rows);
    const arms = armsFor(t, bucketKeys(ctx), ["tool", "game"]);
    expect(arms.game).toEqual([1, 1]);
    // the full bucket has ~16 visits; the metro-daypart parent has 32 and is used
    expect(arms.tool[0] + arms.tool[1] - 2).toBe(MIN_REWARDED + 2);
    expect(arms.tool[0]).toBeGreaterThan(arms.tool[1]);
  });
  it("samples Beta with the right mean", () => {
    const r = prng(1);
    const xs = Array.from({ length: 4000 }, () => sampleBeta([8, 2], r));
    expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - 0.8)).toBeLessThan(0.02);
  });
  it("explores about 15% of the time", () => {
    const plans = (["tool", "guide", "game"] as const).map((a) => ({ archetype: a } as Plan));
    const r = prng(42);
    let explored = 0;
    for (let i = 0; i < 5000; i++) if (choose(plans, [0.5, 0.5, 0.5], {}, r).explored) explored++;
    expect(Math.abs(explored / 5000 - EXPLORE_RATE)).toBeLessThan(0.02);
  });
  it("maps behaviour to the PRD's rewards", () => {
    expect(behaviourReward(50000, true)).toBe(0.7);
    expect(behaviourReward(5000, false)).toBe(0.2);
    expect(behaviourReward(20000, true)).toBeNull();
  });
});
