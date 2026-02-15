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
  if (property.type === "number") return property.number?.toString() ?? "";
  return "";
}

function getNumber(property: any): number | null {
  if (!property) return null;
  if (property.type === "number") return typeof property.number === "number" ? property.number : null;
  if (property.type === "rich_text") {
    const raw = property.rich_text?.map((t: any) => t.plain_text).join("") ?? "";
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

async function getDataSourceId(databaseId: string) {
  const db: any = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = db?.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("No data source found");
  return dataSourceId;
}

async function queryAllPages(dataSourceId: string) {
  let results: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;

  while (hasMore) {
    const resp: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      start_cursor: cursor,
    });

    results = results.concat(resp.results);
    hasMore = resp.has_more;
    cursor = resp.next_cursor ?? undefined;
  }

  return results;
}

async function fetchNotionPagesAndCounts(databaseId: string) {
  const dataSourceId = await getDataSourceId(databaseId);
  const pages = await queryAllPages(dataSourceId);

  const seen = new Set<string>();
  const domainCountsAll: Record<string, number> = {};
  const domainCountsUnread: Record<string, number> = {};

  for (const page of pages) {
    const props = page.properties;
    const title = getText(props["Book name"] ?? props["Book Name"] ?? props["Name"]);
    const author = getText(props["Author"]);
    const domain = getText(props["Book domain"] ?? props["Domain"]) || "Uncategorized";
    const status = getText(props["Status"] ?? props["status"]) || "";

    if (!norm(title)) continue;

    const key = `${norm(title)}|${norm(author)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    domainCountsAll[domain] = (domainCountsAll[domain] || 0) + 1;

    if (norm(status) === "unread") {
      domainCountsUnread[domain] = (domainCountsUnread[domain] || 0) + 1;
    }
  }

  return { pages, domainCountsAll, domainCountsUnread };
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

function isJunkGoogle(v: any): boolean {
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

function pickSeedFromGoogle(v: any): string {
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

function weightedRating(rating: number, count: number) {
  const PRIOR = 4.2;
  const M = 200;
  return (count / (count + M)) * rating + (M / (count + M)) * PRIOR;
}

function scoreGoogle(rating: number | null, ratingCount: number, seed: string, dominantDomains: string[]) {
  const MIN_MEANINGFUL_COUNT = 50;

  let base = 0;
  if (rating !== null && ratingCount >= MIN_MEANINGFUL_COUNT) base = weightedRating(rating, ratingCount);
  else if (rating !== null) base = weightedRating(rating, Math.min(ratingCount, 10)) - 1.2;
  else base = 1.8;

  const breadth = dominantDomains.includes(seed) ? -0.5 : 0.4;
  const countBonus = Math.log10(Math.max(1, ratingCount)) * 0.1;

  return base + breadth + countBonus;
}

/**
 * Notion fallback selection rules (breadth):
 * - Prefer Unread books.
 * - Enforce domain diversity: try to pick 6 distinct domains first.
 * - Prefer underrepresented domains within Unread set.
 * - Use rating as tie-breaker.
 */
function notionBreadthPicks(args: {
  pages: any[];
  limit: number;
  domainCountsUnread: Record<string, number>;
  domainCountsAll: Record<string, number>;
}) {
  const { pages, limit, domainCountsUnread, domainCountsAll } = args;

  const extract = (page: any) => {
    const props = page.properties;
    const title = getText(props["Book name"] ?? props["Book Name"] ?? props["Name"]);
    const author = getText(props["Author"]);
    const domain = getText(props["Book domain"] ?? props["Domain"]) || "Uncategorized";
    const status = getText(props["Status"] ?? props["status"]) || "";
    const rating =
      getNumber(props["Goodreads Rating"] ?? props["Rating"] ?? props["Review"] ?? props["goodreads_rating"]) ?? null;

    return { title, author, domain, status, rating };
  };

  const seen = new Set<string>();
  const all = pages
    .map(extract)
    .filter((b) => {
      if (!norm(b.title)) return false;
      const key = `${norm(b.title)}|${norm(b.author)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const unread = all.filter((b) => norm(b.status) === "unread");
  const pool = unread.length >= limit ? unread : all;

  const usingUnreadOnly = pool === unread;

  // Score: underrepresented unread domains win. Rating is tie-breaker.
  const domainCounts = usingUnreadOnly ? domainCountsUnread : domainCountsAll;

  const score = (b: any) => {
    const count = domainCounts[b.domain] ?? 0;
    const underRep = 1 / Math.max(1, count); // smaller count => bigger score
    const ratingBoost = b.rating ?? 0;
    const unreadBoost = norm(b.status) === "unread" ? 1 : 0;
    return underRep * 10 + ratingBoost + unreadBoost;
  };

  const ranked = [...pool].sort((a, b) => score(b) - score(a));

  // Pass 1: pick distinct domains
  const picked: any[] = [];
  const usedDomains = new Set<string>();

  for (const b of ranked) {
    if (picked.length >= limit) break;
    if (usedDomains.has(b.domain)) continue;
    picked.push(b);
    usedDomains.add(b.domain);
  }

  // Pass 2: fill remaining regardless of domain
  if (picked.length < limit) {
    for (const b of ranked) {
      if (picked.length >= limit) break;
      if (picked.some((p) => norm(p.title) === norm(b.title) && norm(p.author) === norm(b.author))) continue;
      picked.push(b);
    }
  }

  return { picks: picked.slice(0, limit), usingUnreadOnly };
}

export async function GET() {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    const notionToken = process.env.NOTION_TOKEN;

    if (!notionToken) return NextResponse.json({ error: "Missing NOTION_TOKEN" }, { status: 500 });
    if (!databaseId) return NextResponse.json({ error: "Missing NOTION_DATABASE_ID" }, { status: 500 });

    const limit = 6;

    const { pages, domainCountsAll, domainCountsUnread } = await fetchNotionPagesAndCounts(databaseId);
    const dominantDomains = topDominantDomains(domainCountsAll, 2);

    // Try Google if key exists
    if (apiKey) {
      const query =
        'nonfiction (psychology OR leadership OR history OR business OR economics OR philosophy OR "artificial intelligence" OR technology OR neuroscience OR cognitive)';

      try {
        const data: any = await googleBooksOnce(query, apiKey);
        const items: any[] = data?.items ?? [];

        const candidates: any[] = [];

        // Need the Notion existing keys to exclude duplicates
        const existingKeys = new Set<string>();
        for (const page of pages) {
          const props = page.properties;
          const title = getText(props["Book name"] ?? props["Book Name"] ?? props["Name"]);
          const author = getText(props["Author"]);
          if (!norm(title)) continue;
          existingKeys.add(`${norm(title)}|${norm(author)}`);
        }

        for (const it of items) {
          const v = it.volumeInfo || {};
          const title = (v.title ?? "").toString();
          const authors: string[] = v.authors ?? [];
          const author = (authors[0] ?? "").toString();
          if (!title) continue;

          if (isJunkGoogle(v)) continue;

          const rating = typeof v.averageRating === "number" ? v.averageRating : null;
          const ratingCount = typeof v.ratingsCount === "number" ? v.ratingsCount : 0;

          const key = `${norm(title)}|${norm(author)}`;
          if (existingKeys.has(key)) continue;

          const seed = pickSeedFromGoogle(v);

          candidates.push({
            title,
            author,
            rating,
            ratingCount,
            domainSeed: seed,
            score: scoreGoogle(rating, ratingCount, seed, dominantDomains),
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

        return NextResponse.json({
          mode: "Intellectual Breadth",
          fallbackSource: "google",
          dominantDomains,
          count: picked.length,
          picks: picked.map((p) => ({
            title: p.title,
            author: p.author,
            rating: p.rating,
            ratingCount: p.ratingCount,
            domainSeed: p.domainSeed,
          })),
        });
      } catch (e: any) {
        // If rate limited. fall back to Notion
      }
    }

    const { picks, usingUnreadOnly } = notionBreadthPicks({
      pages,
      limit,
      domainCountsUnread,
      domainCountsAll,
    });

    return NextResponse.json({
      mode: "Intellectual Breadth",
      fallbackSource: "notion",
      dominantDomains,
      count: picks.length,
      picks: picks.map((p) => ({
        title: p.title,
        author: p.author,
        rating: p.rating,
        ratingCount: 0,
        domainSeed: p.domain,
      })),
      note: usingUnreadOnly
        ? "Google Books rate limit hit. Showing breadth picks from your Notion Unread list."
        : "Google Books rate limit hit. Not enough Unread books. Showing breadth picks from your full Notion library.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}