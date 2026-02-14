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

async function fetchAllNotionBooks(databaseId: string) {
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

  // Deduplicate and build set of existing books to exclude
  const seen = new Set<string>();
  const existing = new Set<string>();
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

function topDomains(domainCounts: Record<string, number>, n: number) {
  return Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([d]) => d);
}

async function googleBooksSearch(subject: string, apiKey: string) {
  const q = encodeURIComponent(`subject:${subject} nonfiction`);
  const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&printType=books&maxResults=20&orderBy=relevance&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as any;
}

export async function GET(req: Request) {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

    if (!process.env.NOTION_TOKEN) {
      return NextResponse.json(
        { error: "Missing NOTION_TOKEN" },
        { status: 500 }
      );
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

    const url = new URL(req.url);
    const limit = Math.max(
      3,
      Math.min(Number(url.searchParams.get("limit") ?? "6"), 12)
    );
    const minRating = Math.max(
      3.5,
      Math.min(Number(url.searchParams.get("minRating") ?? "4.3"), 5)
    );

    const { existing, domainCounts } = await fetchAllNotionBooks(databaseId);

    const domains = topDomains(domainCounts, 3);
    const fallbackDomains = domains.length
      ? domains
      : ["Psychology", "Business", "Leadership"];

    const candidates: any[] = [];

    for (const d of fallbackDomains) {
      const data = await googleBooksSearch(d, apiKey);
      const items: any[] = data?.items ?? [];

      for (const it of items) {
        const v = it.volumeInfo || {};
        const title = (v.title ?? "").toString();
        const authors: string[] = v.authors ?? [];
        const author = (authors[0] ?? "").toString();

        const rating =
          typeof v.averageRating === "number" ? v.averageRating : null;
        const ratingCount =
          typeof v.ratingsCount === "number" ? v.ratingsCount : 0;

        if (!title) continue;
        if (rating === null || rating < minRating) continue;
        if (ratingCount < 50) continue; // quality filter

        const key = `${norm(title)}|${norm(author)}`;
        if (existing.has(key)) continue;

        // Basic nonfiction guard
        const cats: string[] = v.categories ?? [];
        const catBlob = cats.join(" ").toLowerCase();
        if (catBlob.includes("fiction")) continue;

        candidates.push({
          title,
          author,
          rating,
          ratingCount,
          domainSeed: d,
          googleBooksId: it.id,
        });
      }
    }

    // Deduplicate candidates
    const seen = new Set<string>();
    const unique = candidates.filter((c) => {
      const k = `${norm(c.title)}|${norm(c.author)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Sort best-first
    unique.sort(
      (a, b) => (b.rating - a.rating) || (b.ratingCount - a.ratingCount)
    );

    const picks = unique.slice(0, limit);

    return NextResponse.json({
      domainsUsed: fallbackDomains,
      limit,
      minRating,
      count: picks.length,
      picks,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}