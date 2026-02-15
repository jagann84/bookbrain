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
  // Sometimes rating is stored as rich_text
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

async function fetchExistingAndDomainCounts(databaseId: string) {
  const dataSourceId = await getDataSourceId(databaseId);
  const pages = await queryAllPages(dataSourceId);

  const existing = new Set<string>();
  const seen = new Set<string>();
  const domainCounts: Record<string, number> = {};

  for (const page of pages) {
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

  return { existing, domainCounts, pages };
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

function scoreNotion(domain: string, domainCounts: Record<string, number>, rating: number | null) {
  // Prefer underrepresented domains
  const domainCount = domainCounts[domain] ?? 0;
  const underRepBoost = 1 / Math.max(1, domainCount); // smaller count => larger boost
  const ratingBoost = rating ?? 0; // if you have Goodreads rating already, great
  return underRepBoost * 10 + ratingBoost; // boost breadth more than rating
}

export async function GET() {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
    const notionToken = process.env.NOTION_TOKEN;

    if (!notionToken) return NextResponse.json({ error: "Missing NOTION_TOKEN" }, { status: 500 });
    if (!databaseId) return NextResponse.json({ error: "Missing NOTION_DATABASE_ID" }, { status: 500 });

    const limit = 6;

    const { existing, domainCounts, pages } = await fetchExistingAndDomainCounts(databaseId);
    const dominantDomains = topDominantDomains(domainCounts, 2);

    // Try Google if API key exists
    if (apiKey) {
      const query =
        'nonfiction (psychology OR leadership OR history OR business OR economics OR philosophy OR "artificial intelligence" OR technology OR neuroscience OR cognitive)';

      try {
        const data: any = await googleBooksOnce(query, apiKey);
        const items: any[] = data?.items ?? [];

        const candidates: any[] = [];

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
          if (existing.has(key)) continue;

          const seed = pickSeedFromGoogle(v);

          candidates.push({
            title,
            author,
            rating,
            ratingCount,
            domainSeed: seed,
            googleBooksId: it.id,
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
        // fall through to Notion backup on rate limit
        if (!(e?.code === 429 || e?.message === "RATE_LIMITED")) {
          // Non-rate-limit error. Still fall back to Notion, but note it.
        }
      }
    }

    // Notion fallback (rate limit or missing Google key)
    const notionCandidates: any[] = [];

    for (const page of pages) {
      const props = page.properties;
      const title = getText(props["Book name"] ?? props["Book Name"] ?? props["Name"]);
      const author = getText(props["Author"]);
      const domain = getText(props["Book domain"] ?? props["Domain"]) || "Uncategorized";

      const status = getText(props["Status"] ?? props["status"]) || "";
      const rating =
        getNumber(props["Goodreads Rating"] ?? props["Rating"] ?? props["Review"] ?? props["goodreads_rating"]) ?? null;

      if (!norm(title)) continue;
      // Prefer unread, but don’t require it
      const unreadBoost = norm(status) === "unread" ? 1 : 0;

      notionCandidates.push({
        title,
        author,
        rating,
        ratingCount: 0,
        domainSeed: domain,
        score: scoreNotion(domain, domainCounts, rating) + unreadBoost,
      });
    }

    // Dedup by title|author
    const seenNotion = new Set<string>();
    const uniqueNotion = notionCandidates.filter((c) => {
      const k = `${norm(c.title)}|${norm(c.author)}`;
      if (seenNotion.has(k)) return false;
      seenNotion.add(k);
      return true;
    });

    uniqueNotion.sort((a, b) => b.score - a.score);

    // Variety: try to pick unique domains first
    const pickedNotion: any[] = [];
    const usedDomains = new Set<string>();

    for (const c of uniqueNotion) {
      if (pickedNotion.length >= limit) break;
      if (usedDomains.has(c.domainSeed)) continue;
      pickedNotion.push(c);
      usedDomains.add(c.domainSeed);
    }

    // If still not enough, fill remaining
    if (pickedNotion.length < limit) {
      for (const c of uniqueNotion) {
        if (pickedNotion.length >= limit) break;
        if (pickedNotion.some((p) => norm(p.title) === norm(c.title) && norm(p.author) === norm(c.author))) continue;
        pickedNotion.push(c);
      }
    }

    return NextResponse.json({
      mode: "Intellectual Breadth",
      fallbackSource: "notion",
      dominantDomains,
      count: pickedNotion.length,
      picks: pickedNotion.map((p) => ({
        title: p.title,
        author: p.author,
        rating: p.rating,
        ratingCount: 0,
        domainSeed: p.domainSeed,
      })),
      note: "Google Books rate limit hit. Showing recommendations from your Notion library instead.",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}