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
    const title = getText(
      props["Book name"] ?? props["Book Name"] ?? props["Name"]
    );
    const author = getText(props["Author"]);
    const domain =
      getText(props["Book domain"] ?? props["Domain"]) || "Uncategorized";

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

function weightedRating(rating: number, count: number) {
  const PRIOR = 4.2;
  const M = 200;
  return (count / (count + M)) * rating + (M / (count + M)) * PRIOR;
}

function breadthScore(
  rating: number | null,
  ratingCount: number,
  domainSeed: string,
  dominantDomains: string[],
  minRatedCount: number
) {
  let base = 0;

  if (rating !== null && ratingCount >= minRatedCount) {
    base = weightedRating(rating, ratingCount);
  } else if (rating !== null) {
    base = weightedRating(rating, Math.min(ratingCount, 10)) - 1.0;
  } else {
    base = 2.0;
  }

  const countBonus = Math.log10(Math.max(1, ratingCount)) * 0.1;
  const dominancePenalty = dominantDomains.includes(domainSeed) ? -0.6 : 0.4;

  return base + countBonus + dominancePenalty;
}

export async function GET() {
  try {
    // ✅ Make env vars explicit strings (fixes Vercel TS build)
    const databaseId = process.env.NOTION_DATABASE_ID;
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    const notionToken = process.env.NOTION_TOKEN;

    if (!notionToken) {
      return NextResponse.json({ error: "Missing NOTION_TOKEN" }, { status: 500 });
    }
    if (!databaseId) {
      return NextResponse.json(
        { error: "Missing NOTION_DATABASE_ID" },
        { status: 500 }
      );
    }
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GOOGLE_BOOKS_API_KEY" },
        { status: 500 }
      );
    }

    const limit = 6;
    const minRatedCount = 50;

    const { existing, domainCounts } = await fetchExistingAndDomains(databaseId);

    const dominantDomains = topDominantDomains(domainCounts, 2);

    const seeds = [
      "Psychology",
      "Leadership",
      "History",
      "Business",
      "Economics",
      "Philosophy",
      "Technology",
      "AI",
    ];

    const startIndexes = [0, 40];

    const candidates: any[] = [];

    for (const seed of seeds) {
      for (const startIndex of startIndexes) {
        const data = await googleBooks(`${seed} nonfiction`, apiKey, startIndex);
        const items: any[] = data?.items ?? [];

        for (const it of items) {
          const v = it.volumeInfo || {};
          const title = (v.title ?? "").toString();
          const authors: string[] = v.authors ?? [];
          const author = (authors[0] ?? "").toString();

          if (!title) continue;
          if (isProbablyFiction(v)) continue;

          const rating =
            typeof v.averageRating === "number" ? v.averageRating : null;
          const ratingCount =
            typeof v.ratingsCount === "number" ? v.ratingsCount : 0;

          const key = `${norm(title)}|${norm(author)}`;
          if (existing.has(key)) continue;

          candidates.push({
            title,
            author,
            rating,
            ratingCount,
            domainSeed: seed,
            googleBooksId: it.id,
            score: breadthScore(
              rating,
              ratingCount,
              seed,
              dominantDomains,
              minRatedCount
            ),
          });
        }
      }
    }

    const seen = new Set<string>();
    const unique = candidates.filter((c) => {
      const k = `${norm(c.title)}|${norm(c.author)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    unique.sort((a, b) => b.score - a.score);

    const picked: any[] = [];
    const perDomain: Record<string, number> = {};

    for (const c of unique) {
      const used = perDomain[c.domainSeed] || 0;

      if (dominantDomains.includes(c.domainSeed) && used >= 1) continue;
      if (used >= 2) continue;

      picked.push(c);
      perDomain[c.domainSeed] = used + 1;

      if (picked.length >= limit) break;
    }

    return NextResponse.json({
      mode: "Intellectual Breadth",
      dominantDomains,
      minRatedCount,
      count: picked.length,
      picks: picked.map((p) => ({
        title: p.title,
        author: p.author,
        rating: p.rating,
        ratingCount: p.ratingCount,
        domainSeed: p.domainSeed,
        googleBooksId: p.googleBooksId,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}