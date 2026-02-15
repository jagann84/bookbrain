import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Simple in-memory cache (best-effort)
type CacheEntry = { ts: number; items: any[] };
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const seedCache = new Map<string, CacheEntry>();

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
  if (property.type === "number") return property.number?.toString() ?? "";
  return "";
}

async function fetchExistingAndDomains(databaseId: string) {
  const db: any = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = db?.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("No data source found");

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

function topDominantDomains(domainCounts: Record<string, number>, n: number) {
  return Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([d]) => d);
}

async function googleBooksRaw(q: string, apiKey: string) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
    q
  )}&printType=books&maxResults=40&startIndex=0&orderBy=relevance&key=${apiKey}`;
  const res = await fetch(url);

  // Google Books uses 429 for rate limiting
  if (res.status === 429) {
    const err: any = new Error("RATE_LIMITED");
    err.code = 429;
    throw err;
  }

  if (!res.ok) return null;
  return (await res.json()) as any;
}

function blob(v: any): string {
  const title = (v?.title ?? "").toString();
  const subtitle = (v?.subtitle ?? "").toString();
  const desc = (v?.description ?? "").toString();
  const cats: string[] = v?.categories ?? [];
  return `${title} ${subtitle} ${cats.join(" ")} ${desc}`.toLowerCase();
}

function isJunk(v: any): boolean {
  const b = blob(v);
  if (b.includes("fiction")) return true;

  const junkTerms = [
    "grades k",
    "k-5",
    "curriculum",
    "lesson plan",
    "teacher",
    "classroom",
    "text-dependent",
    "workbook",
    "study guide",
    "test prep",
    "exam",
    "student",
    "library",
    "librarian",
    "school library",
    "writer's market",
    "writers market",
    "book proposal",
    "proposals",
    "handbook",
    "manual",
    "encyclopedia",
    "year book",
    "yearbook",
    "proceedings",
    "conference",
  ];

  return junkTerms.some((t) => b.includes(t));
}

function weightedRating(rating: number, count: number) {
  const PRIOR = 4.2;
  const M = 200;
  return (count / (count + M)) * rating + (M / (count + M)) * PRIOR;
}

function score(rating: number | null, ratingCount: number, seed: string, dominantDomains: string[]) {
  const MIN_MEANINGFUL_COUNT = 50;

  let base = 0;

  if (rating !== null && ratingCount >= MIN_MEANINGFUL_COUNT) {
    base = weightedRating(rating, ratingCount);
  } else if (rating !== null) {
    base = weightedRating(rating, Math.min(ratingCount, 10)) - 1.2;
  } else {
    base = 1.8;
  }

  const breadth = dominantDomains.includes(seed) ? -0.5 : 0.4;
  const countBonus = Math.log10(Math.max(1, ratingCount)) * 0.1;

  return base + breadth + countBonus;
}

async function getSeedItems(seed: string, apiKey: string) {
  const now = Date.now();
  const cached = seedCache.get(seed);
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.items;

  const q = `"best ${seed} nonfiction books"`;
  const data = await googleBooksRaw(q, apiKey);
  const items: any[] = data?.items ?? [];

  seedCache.set(seed, { ts: now, items });
  return items;
}

export async function GET() {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    const notionToken = process.env.NOTION_TOKEN;

    if (!notionToken) return NextResponse.json({ error: "Missing NOTION_TOKEN" }, { status: 500 });
    if (!databaseId) return NextResponse.json({ error: "Missing NOTION_DATABASE_ID" }, { status: 500 });
    if (!apiKey) return NextResponse.json({ error: "Missing GOOGLE_BOOKS_API_KEY" }, { status: 500 });

    const limit = 6;

    const { existing, domainCounts } = await fetchExistingAndDomains(databaseId);
    const dominantDomains = topDominantDomains(domainCounts, 2);

    const seeds = ["Psychology", "Leadership", "History", "Business", "Economics", "Philosophy", "Technology", "AI"];

    const candidates: any[] = [];

    for (const seed of seeds) {
      let items: any[] = [];
      try {
        items = await getSeedItems(seed, apiKey);
      } catch (e: any) {
        // If rate limited, try cached results
        const cached = seedCache.get(seed);
        if (cached) {
          items = cached.items;
        } else {
          // No cache, skip this seed
          continue;
        }
      }

      for (const it of items) {
        const v = it.volumeInfo || {};
        const title = (v.title ?? "").toString();
        const authors: string[] = v.authors ?? [];
        const author = (authors[0] ?? "").toString();
        if (!title) continue;

        if (isJunk(v)) continue;

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
          score: score(rating, ratingCount, seed, dominantDomains),
        });
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

    unique.sort((a, b) => b.score - a.score);

    // Variety rules
    const picked: any[] = [];
    const perSeed: Record<string, number> = {};

    for (const c of unique) {
      const used = perSeed[c.domainSeed] || 0;
      if (dominantDomains.includes(c.domainSeed) && used >= 1) continue;
      if (used >= 2) continue;

      picked.push(c);
      perSeed[c.domainSeed] = used + 1;

      if (picked.length >= limit) break;
    }

    return NextResponse.json({
      mode: "Intellectual Breadth",
      dominantDomains,
      count: picked.length,
      picks: picked.map((p) => ({
        title: p.title,
        author: p.author,
        rating: p.rating,
        ratingCount: p.ratingCount,
        domainSeed: p.domainSeed,
        googleBooksId: p.googleBooksId,
      })),
      note: "Reduced Google Books calls and added caching to avoid rate limits.",
    });
  } catch (e: any) {
    // If the entire request was rate limited and no cache existed
    if (e?.code === 429 || e?.message === "RATE_LIMITED") {
      return NextResponse.json(
        { error: "You have been rate limited. Please try again in a few minutes." },
        { status: 429 }
      );
    }
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}