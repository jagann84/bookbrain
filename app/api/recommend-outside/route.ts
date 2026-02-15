import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getText(property: any): string {
  if (!property) return "";
  if (property.type === "title")
    return property.title?.map((t: any) => t.plain_text).join("") ?? "";
  if (property.type === "rich_text")
    return property.rich_text?.map((t: any) => t.plain_text).join("") ?? "";
  if (property.type === "select") return property.select?.name ?? "";
  if (property.type === "number")
    return property.number?.toString() ?? "";
  return "";
}

const BAD_DOMAIN_SEEDS = new Set(["general", "uncategorized", "other", "misc", "n/a", "na"]);

async function fetchExistingAndDomains(databaseId: string) {
  const db: any = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = db?.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("No data source found for this database");

  let allResults: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;

  while (hasMore) {
    const response: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      start_cursor: cursor,
    });

    allResults = [...allResults, ...response.results];
    hasMore = response.has_more;
    cursor = response.next_cursor ?? undefined;
  }

  const existing = new Set<string>();
  const seen = new Set<string>();
  const domainCounts: Record<string, number> = {};

  for (const page of allResults) {
    const props = page.properties;
    const title = getText(props["Book name"] ?? props["Book Name"] ?? props["Name"]);
    const author = getText(props["Author"]);
    const domain = getText(props["Book domain"] ?? props["Domain"]) || "Uncategorized";

    if (!norm(title)) continue;

    const key = `${norm(title)}|${norm(author)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    existing.add(key);
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  }

  return { existing, domainCounts };
}

function topDomains(domainCounts: Record<string, number>, n: number) {
  return Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d)
    .filter((d) => !BAD_DOMAIN_SEEDS.has(norm(d)))
    .slice(0, n);
}

async function googleBooks(q: string, apiKey: string, startIndex: number) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
    q
  )}&printType=books&maxResults=40&startIndex=${startIndex}&orderBy=relevance&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as any;
}

function isProbablyFiction(v: any): boolean {
  const cats: string[] = v?.categories ?? [];
  return cats.join(" ").toLowerCase().includes("fiction");
}

function score(rating: number | null, ratingCount: number) {
  // Rated books win. Unrated books are allowed but score much lower.
  const r = rating ?? 0;
  const ratedBoost = rating === null ? -2.0 : 0; // push unrated down, but not out
  const countBonus = Math.log10(Math.max(1, ratingCount)) * 0.2;
  return r + countBonus + ratedBoost;
}

type Candidate = {
  title: string;
  author: string;
  rating: number | null;
  ratingCount: number;
  domainSeed: string;
  googleBooksId: string;
  score: number;
};

export async function GET(req: Request) {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

    if (!process.env.NOTION_TOKEN) return NextResponse.json({ error: "Missing NOTION_TOKEN" }, { status: 500 });
    if (!databaseId) return NextResponse.json({ error: "Missing NOTION_DATABASE_ID" }, { status: 500 });
    if (!apiKey) return NextResponse.json({ error: "Missing GOOGLE_BOOKS_API_KEY" }, { status: 500 });

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? "6"), 12));
    const maxPerDomain = Math.max(1, Math.min(Number(url.searchParams.get("maxPerDomain") ?? "2"), 6));

    const { existing, domainCounts } = await fetchExistingAndDomains(databaseId);

    const domains = topDomains(domainCounts, 5);
    const seeds = domains.length ? domains : ["Psychology", "Leadership", "History", "Business", "Technology"];

    const startIndexes = [0, 40, 80];

    const candidates: Candidate[] = [];

    for (const seed of seeds) {
      const queries = [
        `subject:${seed} nonfiction`,
        `"${seed}" nonfiction best books`,
        `${seed} non-fiction`,
      ];

      for (const q of queries) {
        for (const startIndex of startIndexes) {
          const data = await googleBooks(q, apiKey, startIndex);
          const items: any[] = data?.items ?? [];

          for (const it of items) {
            const v = it.volumeInfo || {};
            const title = (v.title ?? "").toString();
            const authors: string[] = v.authors ?? [];
            const author = (authors[0] ?? "").toString();

            if (!title) continue;
            if (isProbablyFiction(v)) continue;

            const rating = typeof v.averageRating === "number" ? v.averageRating : null;
            const ratingCount = typeof v.ratingsCount === "number" ? v.ratingsCount : 0;

            const key = `${norm(title)}|${norm(author)}`;
            if (existing.has(key)) continue;

            candidates.push({
              title,
              author,
              rating,
              ratingCount,
              domainSeed: seed,
              googleBooksId: it.id,
              score: score(rating, ratingCount),
            });
          }
        }
      }
    }

    // Dedup
    const seen = new Set<string>();
    const unique = candidates.filter((c) => {
      const k = `${norm(c.title)}|${norm(c.author)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Rank
    unique.sort((a, b) => (b.score - a.score) || ((b.ratingCount ?? 0) - (a.ratingCount ?? 0)));

    // Variety: maxPerDomain
    const picked: Candidate[] = [];
    const perDomain: Record<string, number> = {};

    for (const c of unique) {
      const used = perDomain[c.domainSeed] || 0;
      if (used >= maxPerDomain) continue;

      picked.push(c);
      perDomain[c.domainSeed] = used + 1;
      if (picked.length >= limit) break;
    }

    return NextResponse.json({
      domainsUsed: seeds,
      limit,
      maxPerDomain,
      count: picked.length,
      picks: picked.map((p) => ({
        title: p.title,
        author: p.author,
        rating: p.rating,
        ratingCount: p.ratingCount,
        domainSeed: p.domainSeed,
        googleBooksId: p.googleBooksId,
      })),
      note:
        "Google Books often omits ratings. This returns top picks by ranking rated books first, then fills with unrated results, excluding your Notion list and enforcing variety.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}