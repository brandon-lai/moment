// Shared shapes. The JSON Schemas in /schema are the contract between the
// ingest half and the request half; these types mirror them.

export type Daypart = "morning" | "midday" | "afternoon" | "evening" | "night";
export type WeatherBucket = "clear" | "cloudy" | "fog" | "rain" | "snow" | "storm";

export const ARCHETYPES = [
  "tool", "guide", "dashboard", "game", "toy", "editorial", "map",
  "countdown", "checklist", "quiz", "ambient", "directory",
] as const;
export type Archetype = (typeof ARCHETYPES)[number] | "other";

export type SignalKind =
  | "weather" | "unusual" | "sun" | "sky" | "holiday" | "trend"
  | "event" | "rhythm" | "busy" | "calendar";

export interface Signal {
  kind: SignalKind;
  label: string;
  category: string;
  score: number;
  lift?: number;
  at?: string;
  source?: string;
}

export interface HourPoint {
  t: string;        // local ISO hour, "2026-11-10T19:00"
  temp: number;     // °C
  pop: number;      // precipitation probability, %
  mm: number;       // precipitation, mm
  code: number;     // WMO weather code
}

export interface BriefWeather {
  now: string;
  bucket: WeatherBucket;
  code: number;
  temp_c: number;
  feels_c?: number;
  wind_kph?: number;
  next_12h: string;
  sunrise?: string;   // local "HH:MM"
  sunset?: string;    // local "HH:MM"
  unusual?: string | null;
  anomaly_z?: number | null;
  hourly?: HourPoint[];
  rain_stops?: string | null;  // local "HH:MM" when a current rain is forecast to stop
  rain_starts?: string | null; // local "HH:MM" when rain is forecast to start
  daily?: { date: string; sunrise: string; sunset: string; tmax: number; tmin: number; code: number }[];
}

export interface Brief {
  cell: string;
  label: string;
  built_at: string;
  coords?: { lat: number; lon: number };
  country?: string;
  local: { tz: string; weekday?: string; daypart?: Daypart; holiday?: string | null };
  weather?: BriefWeather | null;
  signals: Signal[];
  priors: { archetypes: Record<string, number> };
  sources?: string[];
}

export interface PlanSection { id: string; heading: string; intent: string }

export interface Plan {
  archetype: Archetype;
  other_archetype?: string;
  title: string;
  purpose: string;
  lead_fact?: string;
  signals_used: string[];
  live_data: string[];
  sections: PlanSection[];
}

export type NetworkType = "home" | "mobile" | "business" | "university" | "inflight" | "hosting" | "unknown";
export type Device = "mobile" | "tablet" | "desktop";
export type ReferrerType = "direct" | "hn" | "reddit" | "social" | "search" | "owner" | "other";

// Layer 1: what the request carries. Coarse on purpose: nothing here is finer
// than a city, and nothing identifies a person.
export interface Layer1 {
  country: string;
  region: string | null;       // ISO region code, e.g. "NY"
  regionName: string | null;
  city: string | null;
  metroCode: string | null;    // US DMA
  lat: number | null;
  lon: number | null;
  tz: string;
  eu: boolean;
  device: Device;
  language: string | null;     // primary Accept-Language tag, e.g. "en-US"
  referrerType: ReferrerType;
  referrerHost: string | null;
  via: string | null;          // owner-shared channel tag (?via=)
  network: NetworkType;
  industry: string | null;     // reduced label, never a company name
  saveData: boolean;
  situations: string[];
}

// Client signals the shell posts outside EU mode.
export interface ClientSignals {
  vw: number; vh: number;
  dark: boolean;
  reducedMotion: boolean;
  touch: boolean;
  connection: string | null;
  tz: string | null;
  localTime: string | null;
}

export interface Interaction {
  section: string | null;   // section id most on screen
  scrollSpeed: number;      // px/s, averaged over the window
  hovered: string[];        // short element descriptors, capped
  taps: number;
  idleMs: number;
  atBottom: boolean;
}

export interface ArtDirection {
  seed: number;
  font: FontPairing;
  palette: Palette;
  layout: Layout;
  motion: "still" | "gentle" | "lively";
  density: "airy" | "balanced" | "dense";
  radius: number;
}

export interface FontPairing {
  id: string;
  display: string; displayWeights: number[];
  body: string; bodyWeights: number[];
  mono: string;
  tags: string[];
}

export interface Palette {
  id: string;
  scheme: "light" | "dark";
  bg: string; fg: string; muted: string; accent: string; accent2: string; surface: string; line: string;
  weather: WeatherBucket[];
  dayparts: Daypart[];
}

export interface Layout { id: string; describe: string; css: string }
