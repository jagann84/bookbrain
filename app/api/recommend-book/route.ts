import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function clean(s: string) {
  return (s || "").toString().replace(/\s+/g, " ").trim();
}

function norm(s: string) {
  return clean(s).toLowerCase();
}

function keyTitleAuthor(title: string, author: string) {
  return `${norm(title)}::${norm(author || "")}`;
}

async function fetchGoogleBooksRating(title: string, author: string): Promise<number | null> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) return null;

  const qTitle = encodeURIComponent(`intitle:${title}`);
  const qAuthor = author ? encodeURIComponent(`inauthor:${author}`) : "";
  const q = qAuthor ? `${qTitle}+${qAuthor}` : qTitle;

  const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5&printType=books&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;

  const json: any = await res.json();
  const items: any[] = Array.isArray(json?.items) ? json.items : [];

  for (const it of items) {
    const r = it?.volumeInfo?.averageRating;
    if (typeof r === "number" && Number.isFinite(r)) return r;
  }
  return null;
}

async function getListSnapshot() {
  const supabase = supabaseServer();

  const { data, error } = await supabase
    .from("books")
    .select("title, author, domain, status, review")
    .limit(3000);

  if (error) throw new Error(`Supabase read failed: ${error.message}`);

  const rows = Array.isArray(data) ? data : [];

  // Two sets:
  // 1) strict: title+author key
  // 2) loose: title-only
  const existingStrict = new Set<string>();
  const existingTitles = new Set<string>();

  const domainCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const ratedDomains: Record<string, { sum: number; n: number }> = {};

  for (const r of rows) {
    const title = clean((r as any)?.title);
    const author = clean((r as any)?.author);

    if (title) {
      existingTitles.add(norm(title));
      existingStrict.add(keyTitleAuthor(title, author));
    }

    const domain = clean((r as any)?.domain) || "General";
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;

    const status = clean((r as any)?.status) || "Unread";
    statusCounts[status] = (statusCounts[status] || 0) + 1;

    const reviewNum = Number((r as any)?.review);
    if (Number.isFinite(reviewNum) && reviewNum > 0) {
      ratedDomains[domain] = ratedDomains[domain] || { sum: 0, n: 0 };
      ratedDomains[domain].sum += reviewNum;
      ratedDomains[domain].n += 1;
    }
  }

  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([domain, count]) => ({ domain, count }));

  const avgRatingByDomain = Object.entries(ratedDomains)
    .map(([domain, v]) => ({ domain, avg: v.sum / Math.max(1, v.n), n: v.n }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);

  return {
    existingTitles,
    existingStrict,
    topDomains,
    statusCounts,
    avgRatingByDomain,
    total: rows.length,
  };
}

type Rec = {
  title: string;
  author: string;
  domain: string;
  reason: string;
};

function safeParseJson(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function callOpenAI(openaiKey: string, prompt: string) {
  const oaiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: prompt,
    }),
  });

  if (!oaiRes.ok) {
    const text = await oaiRes.text();
    throw new Error(`OpenAI error: ${text.slice(0, 200)}`);
  }

  const oaiJson: any = await oaiRes.json();
  const rawText =
    clean(oaiJson?.output_text) ||
    clean(oaiJson?.output?.[0]?.content?.[0]?.text) ||
    "";

  const parsed = safeParseJson(rawText);
  if (!parsed?.title || !parsed?.author || !parsed?.domain || !parsed?.reason) {
    throw new Error("OpenAI returned invalid JSON.");
  }

  const rec: Rec = {
    title: clean(parsed.title),
    author: clean(parsed.author),
    domain: clean(parsed.domain),
    reason: clean(parsed.reason),
  };

  return rec;
}

export async function GET() {
  try {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const snap = await getListSnapshot();

    // Try multiple times before giving up.
    const MAX_ATTEMPTS = 6;
    let lastErr: string | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const nonce = `${Date.now()}-${attempt}`;

      const prompt = `You are a book recommender for a nonfiction reader.

Reader profile signals (from their personal database):
- Total books in list: ${snap.total}
- Status counts: ${JSON.stringify(snap.statusCounts)}
- Top domains by volume: ${JSON.stringify(snap.topDomains)}
- Domains with highest average ratings (from their list): ${JSON.stringify(snap.avgRatingByDomain)}

Hard requirements:
- Recommend ONE nonfiction book that is NOT already in the user's list.
- Ensure intellectual breadth: pick something adjacent but not redundant with their most dominant domain.
- Do NOT recommend catalogs, library-admin manuals, or writing-market directories. Recommend real reader-facing nonfiction.

Existing titles and strict keys:
- Title-only set size: ${snap.existingTitles.size}
- Strict (title+author) set size: ${snap.existingStrict.size}

Uniqueness rules you must follow:
- The recommended title must NOT match any existing title in the user's list.
- Also avoid close repeats of extremely famous books likely already present.

Non-repeat nonce (avoid repeating your last output): ${nonce}

Output format:
Return ONLY valid JSON with exactly these keys:
{
  "title": "...",
  "author": "...",
  "domain": "...",
  "reason": "..."
}

Reason rules:
- 2 to 4 sentences max.
- Tie directly to the user’s domain mix and desire for variety.
- No generic fluff.`;

      try {
        const rec = await callOpenAI(openaiKey, prompt);

        const strictKey = keyTitleAuthor(rec.title, rec.author);
        const titleKey = norm(rec.title);

        // Hard guard: reject if title matches anything in list.
        if (snap.existingTitles.has(titleKey) || snap.existingStrict.has(strictKey)) {
          lastErr = "Recommendation matched an existing title.";
          continue;
        }

        const rating = await fetchGoogleBooksRating(rec.title, rec.author);

        return NextResponse.json({
          ok: true,
          recommendation: {
            ...rec,
            rating: rating ?? null,
          },
        });
      } catch (e: any) {
        lastErr = e?.message || "Unknown error during recommendation.";
        continue;
      }
    }

    return NextResponse.json(
      { error: `${lastErr || "Could not find a unique recommendation."} Try refresh.` },
      { status: 500 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown server error." },
      { status: 500 }
    );
  }
}