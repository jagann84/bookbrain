import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// Best-effort in-memory cache (may reset on Vercel cold starts)
let lastGoodPayload: any | null = null;

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

async function googleBooksOnce(q: string, apiKey: string) {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(
    q
  )}&printType=books&maxResults=40&startIndex=0&orderBy=relevance&key=${apiKey}`;

  const res = await fetch(url);

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

function pickSeed(v: any): string {
  const b = blob(v);

  if (b.includes("artificial intelligence") || b.includes("machine learning") || b.includes(" ai "))
    return "AI";
  if (b.includes("psycholog") || b.includes("behavior") || b.includes("cognitive"))
    return "Psychology";
  if (b.includes("leadership") || b.includes("management") || b.includes("team"))
    return "Leadership";
  if (b.includes("history") || b.includes("historical") || b.includes("biography"))
    return "History";
  if (b.includes("econom") || b.includes("market") || b.includes("finance"))
    return "Economics";
  if (b.includes("philosoph")) return "Philosophy";
  if (b.includes("technology") || b.includes("computer") || b.includes("software"))
    return "Technology";

  return "Business";
}

function scoreCandidate(
  rating: number | null,
  ratingCount: number,
  seed: string,
  dominantDomains: string[]
) {
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

export async function GET() {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    const notionToken = process.env.NOTION_TOKEN;

    if (!notionToken)
      return NextResponse.json({ error: "Missing NOTION_TOKEN" }, { status: 500 });
    if (!databaseId)
      return NextResponse.json({ error: "Missing NOTION_DATABASE_ID" }, { status: 500 });
    if (!apiKey)
      return NextResponse.json({ error: "Missing GOOGLE_BOOKS_API_KEY" }, { status: 500 });

    const limit = 6;

    const { existing, domainCounts } = await fetchExistingAndDomains(databaseId);
    const dominantDomains = topDominantDomains(domainCounts, 2);

    const query =
      'nonfiction (psychology OR leadership OR history OR business OR economics OR philosophy OR "artificial intelligence" OR technology OR neuroscience OR cognitive)';

    let data: any;
    try {
      data = await googleBooksOnce(query, apiKey);
    } catch (e: any) {
      // ✅ Rate limit: return stale payload with 200 so UI can show banner
      if (e?.code === 429 || e?.message === "RATE_LIMITED") {
        if (lastGoodPayload) {
          return NextResponse.json(
            { ...lastGoodPayload, stale: true, note: "Google rate-limited. Showing last server-cached results." },
            { status: 200 }
          );
        }

        return NextResponse.json(
          {
            mode: "Intellectual Breadth",
            queryUsed: query,
            dominantDomains,
            count: 0,
            picks: [],
            stale: true,
            note: "Google rate-limited and no server cache exists yet. Try again later or refresh after quota resets.",
          },
          { status: 200 }
        );
      }
      throw e;
    }

    const items: any[] = data?.items ?? [];
    const candidates: any[] = [];

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

      const seed = pickSeed(v);

      candidates.push({
        title,
        author,
        rating,
        ratingCount,
        domainSeed: seed,
        googleBooksId: it.id,
        score: scoreCandidate(rating, ratingCount, seed, dominantDomains),
      });
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
    const perSeed: Record<string, number> = {};

    for (const c of unique) {
      const used = perSeed[c.domainSeed] || 0;
      if (dominantDomains.includes(c.domainSeed) && used >= 1) continue;
      if (used >= 2) continue;

      picked.push(c);
      perSeed[c.domainSeed] = used + 1;

      if (picked.length >= limit) break;
    }

    const payload = {
      mode: "Intellectual Breadth",
      queryUsed: query,
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
      stale: false,
    };

    lastGoodPayload = payload;

    return NextResponse.json(payload, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}