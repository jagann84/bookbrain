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
  if (property.type === "title") return property.title?.map((t: any) => t.plain_text).join("") ?? "";
  if (property.type === "rich_text") return property.rich_text?.map((t: any) => t.plain_text).join("") ?? "";
  if (property.type === "select") return property.select?.name ?? "";
  if (property.type === "number") return property.number?.toString() ?? "";
  return "";
}

function getNumber(property: any): number | null {
  if (!property) return null;
  if (property.type === "number" && typeof property.number === "number") return property.number;
  return null;
}

function getDateISO(property: any): string | null {
  if (!property) return null;
  if (property.type === "date" && property.date?.start) return property.date.start as string;
  return null;
}

// Remove common junk that hurts Google Books matching
function cleanTitle(title: string): string {
  let t = (title || "").trim();

  // Remove trailing parens/brackets at the end: (Kindle Edition), [Abridged], etc.
  t = t.replace(/\s*\([^)]*\)\s*$/g, "");
  t = t.replace(/\s*\[[^\]]*\]\s*$/g, "");

  // Remove common tokens
  t = t.replace(/kindle\s*edition/gi, "");
  t = t.replace(/audible\s*audiobook/gi, "");
  t = t.replace(/unabridged/gi, "");

  // If title has " by" glued content, cut it off
  const byIdx = t.toLowerCase().indexOf(" by");
  if (byIdx > 0) t = t.slice(0, byIdx).trim();

  // collapse spaces
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function cleanAuthor(author: string): string {
  let a = (author || "").trim();
  if (!a) return "";

  // Take first chunk before separators
  a = a.split(",")[0];
  a = a.split(" and ")[0];
  a = a.split("&")[0];

  return a.trim();
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function isOlderThan(dateISO: string | null, days: number): boolean {
  if (!dateISO) return true; // if missing, treat as stale
  const then = new Date(dateISO).getTime();
  const cutoff = new Date(daysAgoISO(days)).getTime();
  return then < cutoff;
}

async function fetchAllNotionPages(databaseId: string) {
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

  // Deduplicate by normalized title + author
  const seen = new Set<string>();
  const rows: Array<{
    id: string;
    title: string;
    author: string;
    reviewNumber: number | null;
    lastCheckISO: string | null;
    props: any;
  }> = [];

  for (const page of allResults) {
    const props = page.properties;
    const title = getText(props["Book name"] ?? props["Book Name"] ?? props["Name"]);
    const author = getText(props["Author"]);

    if (!norm(title)) continue;

    const key = `${norm(title)}|${norm(author)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const reviewNumber = getNumber(props["Review"]);
    const lastCheckISO = getDateISO(props["Last rating check"]);

    rows.push({
      id: page.id,
      title,
      author,
      reviewNumber,
      lastCheckISO,
      props,
    });
  }

  return rows;
}

async function fetchGoogleBooks(q: string, apiKey: string) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&printType=books&maxResults=10&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as any;
}

function pickBest(items: any[]): { rating: number; ratingCount: number | null; title: string } | null {
  const candidates = (items || [])
    .map((it) => it.volumeInfo || {})
    .filter((v) => typeof v.averageRating === "number")
    .sort((a, b) => (b.ratingsCount ?? 0) - (a.ratingsCount ?? 0));

  if (!candidates.length) return null;

  const best = candidates[0];
  return {
    rating: best.averageRating as number,
    ratingCount: (best.ratingsCount ?? null) as number | null,
    title: (best.title ?? "") as string,
  };
}

async function googleBooksRating(title: string, author: string, apiKey: string) {
  const t = cleanTitle(title);
  const a = cleanAuthor(author);

  // Strategy 1: strict
  let data = await fetchGoogleBooks(`intitle:${t} ${a ? `inauthor:${a}` : ""}`.trim(), apiKey);
  let best = data?.items ? pickBest(data.items) : null;
  if (best) return { ...best, strategy: "strict", cleanedQuery: { title: t, author: a } };

  // Strategy 2: loose (no operators)
  data = await fetchGoogleBooks(`${t} ${a}`.trim(), apiKey);
  best = data?.items ? pickBest(data.items) : null;
  if (best) return { ...best, strategy: "loose", cleanedQuery: { title: t, author: a } };

  // Strategy 3: title only
  data = await fetchGoogleBooks(`${t}`.trim(), apiKey);
  best = data?.items ? pickBest(data.items) : null;
  if (best) return { ...best, strategy: "title_only", cleanedQuery: { title: t, author: a } };

  return null;
}

export async function GET(req: Request) {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;

    if (!process.env.NOTION_TOKEN) return NextResponse.json({ error: "Missing NOTION_TOKEN" }, { status: 500 });
    if (!databaseId) return NextResponse.json({ error: "Missing NOTION_DATABASE_ID" }, { status: 500 });
    if (!apiKey) return NextResponse.json({ error: "Missing GOOGLE_BOOKS_API_KEY" }, { status: 500 });

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") ?? "20"), 50));
    const dryRun = (url.searchParams.get("dryRun") ?? "true").toLowerCase() !== "false";

    // mode:
    // - missing: only books with Review <= 0 or null
    // - stale: missing + books whose last check is older than staleDays
    // - force: update everything
    const mode = (url.searchParams.get("mode") ?? "missing").toLowerCase();
    const staleDays = Math.max(7, Math.min(Number(url.searchParams.get("staleDays") ?? "30"), 365));

    const rows = await fetchAllNotionPages(databaseId);

    const toUpdate = rows
      .filter((r) => {
        const review = r.reviewNumber;
        const missing = review === null || review <= 0;

        if (mode === "force") return true;
        if (mode === "stale") {
          const stale = isOlderThan(r.lastCheckISO, staleDays);
          return missing || stale;
        }
        // default: "missing"
        return missing;
      })
      .slice(0, limit);

    const results: any[] = [];
    let updated = 0;

    for (const r of toUpdate) {
      const match = await googleBooksRating(r.title, r.author, apiKey);

      if (!match) {
        results.push({
          book: r.title,
          status: "no_match",
          cleanedQuery: { title: cleanTitle(r.title), author: cleanAuthor(r.author) },
        });
        continue;
      }

      if (!dryRun) {
        const properties: any = {
          Review: { number: match.rating },
        };

        // Optional fields if they exist in your Notion DB
        if (r.props["Last rating check"]?.type === "date") {
          properties["Last rating check"] = { date: { start: new Date().toISOString() } };
        }
        if (r.props["Rating source"]?.type === "rich_text") {
          properties["Rating source"] = {
            rich_text: [{ type: "text", text: { content: "Google Books" } }],
          };
        }

        await notion.pages.update({
          page_id: r.id,
          properties,
        });

        updated += 1;
      }

      results.push({
        book: r.title,
        status: dryRun ? "would_update" : "updated",
        rating: match.rating,
        matchedTitle: match.title,
        strategy: match.strategy,
      });
    }

    return NextResponse.json({
      dryRun,
      mode,
      staleDays,
      limit,
      candidates: toUpdate.length,
      updated,
      results,
      note:
        "Default mode=missing (Review <= 0). Use mode=stale to refresh old ratings. Add dryRun=false to update Notion.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}