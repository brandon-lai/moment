// Country-level "what people are reading": Wikimedia's most-viewed articles
// per country, yesterday. This stands in for the PRD's paid Trending Now
// scraper, which needs a vendor account (see README). Every term then has to
// pass the safety gate before it can reach a brief.

export interface RawTrend { term: string; project: string; views: number; rank: number }

const SKIP = /^(Main_Page|Special:|Wikipedia:|File:|Portal:|Help:|Category:|Template:|Talk:|User:|-$|Hauptseite|Accueil|Pagina_principale|Página_principal|Portada|Hoofdpagina|メインページ|Заглавная_страница|Wikipedia$)/i;

export async function fetchTopPerCountry(country: string, isoDate: string, fetcher: typeof fetch = fetch): Promise<RawTrend[]> {
  const [y, m, d] = isoDate.split("-");
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/${country}/all-access/${y}/${m}/${d}`;
  const res = await fetcher(url, { headers: { "user-agent": "Moment/0.1 (zero-input generative website; brief compiler)" } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`wikimedia ${country} ${res.status}`);
  const body = (await res.json()) as { items?: { articles: { article: string; project: string; views_ceil: number; rank: number }[] }[] };
  const arts = body.items?.[0]?.articles ?? [];
  return arts
    .filter((a) => a.project.endsWith("wikipedia") && !SKIP.test(a.article) && !a.article.includes(":"))
    .slice(0, 25)
    .map((a) => ({ term: a.article.replace(/_/g, " "), project: a.project, views: a.views_ceil, rank: a.rank }));
}
