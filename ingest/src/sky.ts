// Sun and moon, computed rather than fetched (PRD: "Sun position — computed,
// no API"; "moon computed"). Formulas follow the well-known SunCalc
// derivation (Vladimir Agafonkin, BSD), reduced to what Moment uses.

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toJulian = (d: Date) => d.valueOf() / DAY_MS - 0.5 + J1970;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
const toDays = (d: Date) => toJulian(d) - J2000;

const rightAscension = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
const siderealTime = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw;
const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M: number) => {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  return M + C + RAD * 102.9372 + Math.PI;
};

export function sunAltitude(date: Date, lat: number, lon: number): number {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(date);
  const L = eclipticLongitude(solarMeanAnomaly(d));
  const dec = declination(L, 0), ra = rightAscension(L, 0);
  const H = siderealTime(d, lw) - ra;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / RAD;
}

const J0 = 0.0009;
const julianCycle = (d: number, lw: number) => Math.round(d - J0 - lw / (2 * Math.PI));
const approxTransit = (Ht: number, lw: number, n: number) => J0 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds: number, M: number, L: number) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h: number, phi: number, d: number) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)));

export interface SunTimes {
  sunrise: Date | null;
  sunset: Date | null;
  goldenEveningStart: Date | null; // sun drops below 6°
  goldenMorningEnd: Date | null;   // sun climbs above 6°
  dusk: Date | null;               // civil dusk, -6°
  noon: Date;
}

export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const lw = RAD * -lon, phi = RAD * lat;
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const Jnoon = solarTransitJ(ds, M, L);
  const at = (deg: number): [Date | null, Date | null] => {
    const w = hourAngle(deg * RAD, phi, dec);
    if (Number.isNaN(w)) return [null, null];
    const a = approxTransit(w, lw, n);
    const Jset = solarTransitJ(a, M, L);
    const Jrise = Jnoon - (Jset - Jnoon);
    return [fromJulian(Jrise), fromJulian(Jset)];
  };
  const [sunrise, sunset] = at(-0.833);
  const [goldenMorningEnd, goldenEveningStart] = at(6);
  const [, dusk] = at(-6);
  return { sunrise, sunset, goldenEveningStart, goldenMorningEnd, dusk, noon: fromJulian(Jnoon) };
}

export interface MoonInfo { phase: number; illumination: number; name: string }

// Phase 0 = new, 0.5 = full.
export function moon(date: Date): MoonInfo {
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const sDec = declination(L, 0), sRa = rightAscension(L, 0);
  const Lm = RAD * (218.316 + 13.176396 * d);
  const Mm = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = Lm + RAD * 6.289 * Math.sin(Mm);
  const b = RAD * 5.128 * Math.sin(F);
  const dist = 385001 - 20905 * Math.cos(Mm);
  const mRa = rightAscension(l, b), mDec = declination(l, b);
  const sdist = 149598000;
  const phi = Math.acos(Math.sin(sDec) * Math.sin(mDec) + Math.cos(sDec) * Math.cos(mDec) * Math.cos(sRa - mRa));
  const inc = Math.atan2(sdist * Math.sin(phi), dist - sdist * Math.cos(phi));
  const angle = Math.atan2(Math.cos(sDec) * Math.sin(sRa - mRa), Math.sin(sDec) * Math.cos(mDec) - Math.cos(sDec) * Math.sin(mDec) * Math.cos(sRa - mRa));
  const illumination = (1 + Math.cos(inc)) / 2;
  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
  return { phase, illumination, name: moonName(phase) };
}

export function moonName(p: number): string {
  if (p < 0.03 || p > 0.97) return "new moon";
  if (p < 0.22) return "waxing crescent";
  if (p < 0.28) return "first quarter";
  if (p < 0.47) return "waxing gibbous";
  if (p < 0.53) return "full moon";
  if (p < 0.72) return "waning gibbous";
  if (p < 0.78) return "last quarter";
  return "waning crescent";
}
