import type { Device, Layer1, NetworkType, ReferrerType } from "./types";
import { metroCell, metroLabel, metroState } from "./metros";

// EU mode covers the EU, the EEA, the UK and Switzerland (PRD: Safety, privacy, and EU mode).
const EU_MODE = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU",
  "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH",
]);

// Main languages per country, for the "visiting from abroad" situation. Only
// countries listed here can produce that label; elsewhere we leave the weak
// inference out instead of guessing (PRD: presentation rules).
const COUNTRY_LANGS: Record<string, string[]> = {
  US: ["en", "es"], GB: ["en", "cy"], CA: ["en", "fr"], AU: ["en"], NZ: ["en", "mi"], IE: ["en", "ga"],
  FR: ["fr"], DE: ["de"], AT: ["de"], CH: ["de", "fr", "it", "rm"], ES: ["es", "ca", "eu", "gl"], IT: ["it"],
  NL: ["nl"], BE: ["nl", "fr", "de"], PT: ["pt"], BR: ["pt"], MX: ["es"], AR: ["es"], CL: ["es"], CO: ["es"],
  JP: ["ja"], KR: ["ko"], CN: ["zh"], TW: ["zh"], HK: ["zh", "en"], SG: ["en", "zh", "ms", "ta"], IN: ["en", "hi", "bn", "ta", "te", "mr"],
  SE: ["sv"], NO: ["nb", "no", "nn"], DK: ["da"], FI: ["fi", "sv"], PL: ["pl"], CZ: ["cs"], GR: ["el"],
  TR: ["tr"], IL: ["he", "ar"], AE: ["ar", "en"], ZA: ["en", "af", "zu", "xh"], TH: ["th"], VN: ["vi"], ID: ["id"],
};

const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|embedly|quora link preview|outbrain|pinterest|vkshare|w3c_validator|whatsapp|telegram|discordbot|slackbot|skypeuripreview|headlesschrome|python-requests|curl\/|wget|httpclient|go-http-client|axios|node-fetch|okhttp|libwww|scrapy|lighthouse|pagespeed|preview/i;

export function isBot(req: Request): boolean {
  const ua = req.headers.get("user-agent") ?? "";
  if (!ua) return true;
  if (BOT_UA.test(ua)) return true;
  // Prefetches and link unfurlers must never start a model call.
  const purpose = (req.headers.get("sec-purpose") ?? req.headers.get("purpose") ?? "").toLowerCase();
  if (purpose.includes("prefetch") || purpose.includes("prerender")) return true;
  return false;
}

const INFLIGHT = /gogo|intelsat|viasat|panasonic avionics|inmarsat|anuvu|global eagle|sita onair|onair|deutsche telekom.*inflight|aeromobile|smartsky|thales inflyt|row 44/i;
const UNIVERSITY = /universit|college|institute of technology|polytechn|school of|academ|\bedu\b|research network|janet|internet2|renater|dfn|surfnet|switch\b|garr|rediris|aarnet|canarie/i;
const MOBILE = /mobile|wireless|cellular|t-mobile|vodafone|o2 |orange mobile|telcel|movistar|tim |jio|airtel|three |ee limited|verizon wireless|at&t mobility|sprint|us cellular|rogers wireless|telus mobility|docomo|kddi|softbank mobile|sk telecom|lg uplus|singtel mobile|optus mobile|telstra mobile/i;
const HOSTING = /amazon|aws|google cloud|google llc|microsoft|azure|digitalocean|ovh|hetzner|linode|akamai|vultr|oracle cloud|alibaba|tencent cloud|cloudflare|fastly|leaseweb|contabo|scaleway|choopa|m247|datacamp|private internet|nordvpn|expressvpn|mullvad|proton/i;
const HOME_ISP = /comcast|charter|spectrum|cox|verizon|at&t|centurylink|lumen|frontier|optimum|altice|mediacom|windstream|rcn|wow|google fiber|starlink|bt |british telecom|sky |virgin media|talktalk|plusnet|rogers|bell canada|telus|shaw|videotron|cogeco|orange|free sas|sfr|bouygues|deutsche telekom|telekom|vodafone|1&1|telefonica|movistar|telia|telenor|kpn|ziggo|proximus|swisscom|fastweb|tim|iliad|ntt|kddi|softbank|chunghwa|singtel|starhub|telstra|optus|tpg|spark|vocus|reliance|bharti|claro|vivo|oi |telmex|izzi|totalplay|liberty|telkom|ono|digi|ucom|virgin|frontier|ziply|astound|sonic|metronet/i;

export function networkType(asOrg: string | undefined | null): { type: NetworkType; industry: string | null } {
  const o = (asOrg ?? "").trim();
  if (!o) return { type: "unknown", industry: null };
  if (INFLIGHT.test(o)) return { type: "inflight", industry: null };
  if (UNIVERSITY.test(o)) return { type: "university", industry: "education" };
  if (HOSTING.test(o)) return { type: "hosting", industry: null };
  if (MOBILE.test(o)) return { type: "mobile", industry: null };
  if (HOME_ISP.test(o)) return { type: "home", industry: null };
  // Anything else announcing its own ASN is most likely an organisation's own
  // network. The name is reduced to a label here and goes no further: it is
  // never stored, never sent to a model, never shown (PRD: Privacy).
  if (/hospital|health|clinic/i.test(o)) return { type: "business", industry: "healthcare" };
  if (/bank|financ|capital|insurance/i.test(o)) return { type: "business", industry: "finance" };
  if (/government|ministry|city of|county|state of|federal/i.test(o)) return { type: "business", industry: "government" };
  if (/software|tech|systems|networks|digital|data|labs?\b|\.io|\.ai/i.test(o)) return { type: "business", industry: "technology" };
  return { type: "business", industry: "company" };
}

export function deviceOf(req: Request): Device {
  const ua = req.headers.get("user-agent") ?? "";
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return "tablet";
  if (req.headers.get("sec-ch-ua-mobile") === "?1") return "mobile";
  if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) return "mobile";
  return "desktop";
}

export function referrerOf(req: Request, selfHost: string): { type: ReferrerType; host: string | null; via: string | null } {
  const url = new URL(req.url);
  const via = (url.searchParams.get("via") ?? "").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || null;
  if (via) return { type: "owner", host: null, via };
  const ref = req.headers.get("referer");
  if (!ref) return { type: "direct", host: null, via: null };
  let host: string;
  try { host = new URL(ref).hostname.toLowerCase(); } catch { return { type: "other", host: null, via: null }; }
  if (host === selfHost) return { type: "direct", host: null, via: null };
  if (host.endsWith("ycombinator.com")) return { type: "hn", host, via: null };
  if (host.endsWith("reddit.com") || host === "redd.it") return { type: "reddit", host, via: null };
  if (/(^|\.)(t\.co|x\.com|twitter\.com|facebook\.com|instagram\.com|linkedin\.com|threads\.net|bsky\.app|mastodon\.social|tiktok\.com|lnkd\.in)$/.test(host)) return { type: "social", host, via: null };
  if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|ecosia\.org|kagi\.com|search\.brave\.com)$/.test(host)) return { type: "search", host, via: null };
  return { type: "other", host, via: null };
}

export function primaryLanguage(req: Request): string | null {
  const al = req.headers.get("accept-language");
  if (!al) return null;
  const first = al.split(",")[0]?.split(";")[0]?.trim();
  return first && /^[a-z]{2,3}(-[A-Za-z0-9]{2,4})?$/i.test(first) ? first : null;
}

export function visitingFromAbroad(language: string | null, country: string): boolean {
  if (!language) return false;
  const langs = COUNTRY_LANGS[country];
  if (!langs) return false;
  const base = language.split("-")[0].toLowerCase();
  return !langs.includes(base);
}

export function isEuMode(country: string, cf?: { isEUCountry?: string }): boolean {
  return cf?.isEUCountry === "1" || EU_MODE.has(country);
}

// Minimal view of request.cf that we read. Typed loosely because the local dev
// server fills it with the developer's own location.
export interface CfLike {
  country?: string; region?: string; regionCode?: string; city?: string; metroCode?: string;
  latitude?: string; longitude?: string; timezone?: string; asOrganization?: string; isEUCountry?: string;
}

export function layer1(req: Request, selfHost: string): Layer1 {
  const cf = ((req as unknown as { cf?: CfLike }).cf ?? {}) as CfLike;
  const country = (cf.country ?? "XX").toUpperCase();
  const lat = cf.latitude ? Number(cf.latitude) : null;
  const lon = cf.longitude ? Number(cf.longitude) : null;
  const net = networkType(cf.asOrganization);
  const ref = referrerOf(req, selfHost);
  const language = primaryLanguage(req);
  const saveData = req.headers.get("save-data") === "on" || /^(slow-2g|2g)$/.test(req.headers.get("ect") ?? "");
  const situations: string[] = [];
  if (net.type === "inflight") situations.push("in-flight");
  if (net.type === "university") situations.push("on-campus");
  if (visitingFromAbroad(language, country)) situations.push("visiting-from-abroad");
  if (saveData) situations.push("saving-data");
  return {
    country,
    region: cf.regionCode ?? null,
    regionName: cf.region ?? null,
    city: cf.city ?? null,
    metroCode: cf.metroCode && cf.metroCode !== "0" ? String(cf.metroCode) : null,
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
    tz: cf.timezone || "UTC",
    eu: isEuMode(country, cf),
    device: deviceOf(req),
    language,
    referrerType: ref.type,
    referrerHost: ref.host,
    via: ref.via,
    network: net.type,
    industry: net.industry,
    saveData,
    situations,
  };
}

// Geo cells, most specific first: metro, then state or region, then country,
// then the global brief (PRD: Places).
export function cellChain(l1: Layer1): string[] {
  const chain: string[] = [];
  if (l1.country === "US" && l1.metroCode) chain.push(`US/${metroState(l1.metroCode) ?? l1.region ?? "-"}/${l1.metroCode}`);
  else if (l1.city && l1.country !== "XX") chain.push(metroCell(l1.country, l1.city));
  if (l1.region && l1.country !== "XX") chain.push(`${l1.country}/${l1.region}`);
  if (l1.country !== "XX") chain.push(l1.country);
  chain.push("global");
  return [...new Set(chain)];
}

export function cellLabel(cell: string, l1?: Pick<Layer1, "city" | "regionName">): string {
  const parts = cell.split("/");
  if (cell === "global") return "the world";
  if (parts.length === 3) {
    if (parts[0] === "US") return metroLabel(parts[2]) ?? (l1?.city ? `${l1.city} area` : "this metro");
    return parts[2];
  }
  if (parts.length === 2) return l1?.regionName ?? parts[1];
  return countryName(parts[0]);
}

export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
