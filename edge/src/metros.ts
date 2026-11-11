// Warm cells: metros whose briefs the compiler keeps fresh whether or not
// anyone has visited (PRD: "always for the largest metros, so most first
// visits hit a warm brief"). The PRD says 300; this list is 92, sized to the
// Workers KV free tier's 1,000 writes a day at one rebuild every three hours.
// Any other cell is compiled on its first visit and cached at that edge.

export interface Metro {
  cell: string;
  label: string;
  country: string;
  lat: number;
  lon: number;
  tz: string;
}

// US Nielsen DMAs: code, label, primary state, lat, lon, tz.
const US: [string, string, string, number, number, string][] = [
  ["501", "New York metro", "NY", 40.713, -74.006, "America/New_York"],
  ["803", "Los Angeles metro", "CA", 34.052, -118.244, "America/Los_Angeles"],
  ["602", "Chicago metro", "IL", 41.878, -87.63, "America/Chicago"],
  ["504", "Philadelphia metro", "PA", 39.953, -75.165, "America/New_York"],
  ["623", "Dallas–Fort Worth", "TX", 32.777, -96.797, "America/Chicago"],
  ["807", "San Francisco Bay Area", "CA", 37.775, -122.419, "America/Los_Angeles"],
  ["511", "Washington, D.C. metro", "DC", 38.907, -77.037, "America/New_York"],
  ["618", "Houston metro", "TX", 29.76, -95.37, "America/Chicago"],
  ["506", "Boston metro", "MA", 42.36, -71.059, "America/New_York"],
  ["524", "Atlanta metro", "GA", 33.749, -84.388, "America/New_York"],
  ["539", "Tampa Bay", "FL", 27.951, -82.457, "America/New_York"],
  ["753", "Phoenix metro", "AZ", 33.448, -112.074, "America/Phoenix"],
  ["505", "Detroit metro", "MI", 42.331, -83.046, "America/Detroit"],
  ["819", "Seattle–Tacoma", "WA", 47.606, -122.332, "America/Los_Angeles"],
  ["613", "Minneapolis–St. Paul", "MN", 44.978, -93.265, "America/Chicago"],
  ["528", "Miami–Fort Lauderdale", "FL", 25.762, -80.192, "America/New_York"],
  ["751", "Denver metro", "CO", 39.739, -104.99, "America/Denver"],
  ["510", "Cleveland–Akron", "OH", 41.499, -81.694, "America/New_York"],
  ["534", "Orlando metro", "FL", 28.538, -81.379, "America/New_York"],
  ["862", "Sacramento metro", "CA", 38.582, -121.494, "America/Los_Angeles"],
  ["609", "St. Louis metro", "MO", 38.627, -90.199, "America/Chicago"],
  ["820", "Portland, Oregon metro", "OR", 45.515, -122.679, "America/Los_Angeles"],
  ["527", "Indianapolis metro", "IN", 39.768, -86.158, "America/Indiana/Indianapolis"],
  ["560", "Raleigh–Durham", "NC", 35.78, -78.639, "America/New_York"],
  ["659", "Nashville metro", "TN", 36.163, -86.781, "America/Chicago"],
  ["512", "Baltimore metro", "MD", 39.29, -76.612, "America/New_York"],
  ["825", "San Diego metro", "CA", 32.716, -117.161, "America/Los_Angeles"],
  ["517", "Charlotte metro", "NC", 35.227, -80.843, "America/New_York"],
  ["535", "Columbus, Ohio metro", "OH", 39.961, -82.999, "America/New_York"],
  ["641", "San Antonio metro", "TX", 29.424, -98.494, "America/Chicago"],
  ["616", "Kansas City metro", "MO", 39.1, -94.578, "America/Chicago"],
  ["839", "Las Vegas metro", "NV", 36.17, -115.14, "America/Los_Angeles"],
  ["617", "Milwaukee metro", "WI", 43.039, -87.906, "America/Chicago"],
  ["515", "Cincinnati metro", "OH", 39.103, -84.512, "America/New_York"],
  ["770", "Salt Lake City metro", "UT", 40.761, -111.891, "America/Denver"],
  ["635", "Austin metro", "TX", 30.267, -97.743, "America/Chicago"],
  ["622", "New Orleans metro", "LA", 29.951, -90.072, "America/Chicago"],
  ["508", "Pittsburgh metro", "PA", 40.441, -79.996, "America/New_York"],
];

// Elsewhere the metro is the city: country, city as Cloudflare names it, lat, lon, tz.
const WORLD: [string, string, number, number, string][] = [
  ["GB", "London", 51.507, -0.128, "Europe/London"],
  ["GB", "Manchester", 53.481, -2.243, "Europe/London"],
  ["IE", "Dublin", 53.35, -6.26, "Europe/Dublin"],
  ["FR", "Paris", 48.857, 2.352, "Europe/Paris"],
  ["FR", "Lyon", 45.764, 4.836, "Europe/Paris"],
  ["DE", "Berlin", 52.52, 13.405, "Europe/Berlin"],
  ["DE", "Munich", 48.137, 11.575, "Europe/Berlin"],
  ["DE", "Hamburg", 53.551, 9.994, "Europe/Berlin"],
  ["NL", "Amsterdam", 52.37, 4.895, "Europe/Amsterdam"],
  ["BE", "Brussels", 50.85, 4.352, "Europe/Brussels"],
  ["ES", "Madrid", 40.417, -3.704, "Europe/Madrid"],
  ["ES", "Barcelona", 41.389, 2.159, "Europe/Madrid"],
  ["PT", "Lisbon", 38.722, -9.139, "Europe/Lisbon"],
  ["IT", "Rome", 41.903, 12.496, "Europe/Rome"],
  ["IT", "Milan", 45.464, 9.19, "Europe/Rome"],
  ["CH", "Zurich", 47.377, 8.542, "Europe/Zurich"],
  ["AT", "Vienna", 48.208, 16.373, "Europe/Vienna"],
  ["SE", "Stockholm", 59.329, 18.069, "Europe/Stockholm"],
  ["DK", "Copenhagen", 55.676, 12.568, "Europe/Copenhagen"],
  ["NO", "Oslo", 59.914, 10.752, "Europe/Oslo"],
  ["FI", "Helsinki", 60.17, 24.938, "Europe/Helsinki"],
  ["PL", "Warsaw", 52.23, 21.012, "Europe/Warsaw"],
  ["CZ", "Prague", 50.075, 14.438, "Europe/Prague"],
  ["GR", "Athens", 37.984, 23.728, "Europe/Athens"],
  ["TR", "Istanbul", 41.008, 28.978, "Europe/Istanbul"],
  ["CA", "Toronto", 43.653, -79.383, "America/Toronto"],
  ["CA", "Vancouver", 49.283, -123.121, "America/Vancouver"],
  ["CA", "Montreal", 45.502, -73.567, "America/Toronto"],
  ["MX", "Mexico City", 19.433, -99.133, "America/Mexico_City"],
  ["BR", "São Paulo", -23.551, -46.633, "America/Sao_Paulo"],
  ["BR", "Rio de Janeiro", -22.907, -43.173, "America/Sao_Paulo"],
  ["AR", "Buenos Aires", -34.604, -58.382, "America/Argentina/Buenos_Aires"],
  ["CL", "Santiago", -33.449, -70.669, "America/Santiago"],
  ["CO", "Bogotá", 4.711, -74.072, "America/Bogota"],
  ["JP", "Tokyo", 35.676, 139.65, "Asia/Tokyo"],
  ["JP", "Osaka", 34.694, 135.502, "Asia/Tokyo"],
  ["KR", "Seoul", 37.567, 126.978, "Asia/Seoul"],
  ["TW", "Taipei", 25.033, 121.565, "Asia/Taipei"],
  ["HK", "Hong Kong", 22.319, 114.169, "Asia/Hong_Kong"],
  ["SG", "Singapore", 1.352, 103.82, "Asia/Singapore"],
  ["IN", "Mumbai", 19.076, 72.878, "Asia/Kolkata"],
  ["IN", "Bengaluru", 12.972, 77.595, "Asia/Kolkata"],
  ["IN", "Delhi", 28.704, 77.102, "Asia/Kolkata"],
  ["AU", "Sydney", -33.869, 151.209, "Australia/Sydney"],
  ["AU", "Melbourne", -37.814, 144.963, "Australia/Melbourne"],
  ["NZ", "Auckland", -36.848, 174.763, "Pacific/Auckland"],
  ["ZA", "Johannesburg", -26.204, 28.047, "Africa/Johannesburg"],
  ["AE", "Dubai", 25.205, 55.271, "Asia/Dubai"],
  ["IL", "Tel Aviv", 32.085, 34.782, "Asia/Jerusalem"],
  ["TH", "Bangkok", 13.756, 100.502, "Asia/Bangkok"],
  ["ID", "Jakarta", -6.208, 106.846, "Asia/Jakarta"],
  ["PH", "Manila", 14.6, 120.984, "Asia/Manila"],
  ["NG", "Lagos", 6.524, 3.379, "Africa/Lagos"],
  ["KE", "Nairobi", -1.292, 36.822, "Africa/Nairobi"],
];

export const METROS: Metro[] = [
  ...US.map(([code, label, state, lat, lon, tz]) => ({ cell: `US/${state}/${code}`, label, country: "US", lat, lon, tz })),
  ...WORLD.map(([country, city, lat, lon, tz]) => ({ cell: metroCell(country, city), label: city, country, lat, lon, tz })),
];

const US_BY_CODE = new Map(US.map((r) => [r[0], r]));

export function metroLabel(dma: string): string | null {
  return US_BY_CODE.get(dma)?.[1] ?? null;
}

// A DMA spans states; key it by the DMA's primary state so a visitor in New
// Jersey and one in Manhattan share the New York metro brief.
export function metroState(dma: string): string | null {
  return US_BY_CODE.get(dma)?.[2] ?? null;
}

export function metroCell(country: string, city: string): string {
  return `${country}/m/${city}`;
}

export function findMetro(cell: string): Metro | undefined {
  return METROS.find((m) => m.cell === cell);
}
