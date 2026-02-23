import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function clean(s: any) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}
function norm(s: any) {
  return clean(s).toLowerCase();
}

type Rec = {
  title: string;
  author: string;
  domain: string;
  rating?: number | null;
  reason: string;
};

const ALLOWED_DOMAINS = [
  "Psychology",
  "Business Strategy",
  "Leadership",
  "AI",
  "History",
  "Creativity",
  "Personal Finance",
  "Health & Longevity",
  "Spirituality",
  "Political Philosophy",
  "Design",
  "Product",
  "Mental Models",
  "General",
] as const;

async function fetchGoogleBooksRating(title: string, author: string) {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) return null;

  const qTitle = encodeURIComponent(`intitle:${title}`);
  const qAuthor = author ? encodeURIComponent(`inauthor:${author}`) : "";
  const q = qAuthor ? `${qTitle}+${qAuthor}` : qTitle;

  const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5&printType=books&key=${key}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return null;

  const json: any = await res.json().catch(() => null);
  const items: any[] = Array.isArray(json?.items) ? json.items : [];

  for (const it of items) {
    const r = it?.volumeInfo?.averageRating;
    if (typeof r === "number" && Number.isFinite(r)) return r;
  }
  return null;
}

async function openAIRecommend(seedDomains: string[], doNotRecommend: string[]) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing");

  const prompt = `Recommend ONE highly rated nonfiction book.

User likes these domains:
${seedDomains.join(", ")}

Hard constraints:
- Nonfiction only.
- Do NOT recommend any title in this list (exact or near-exact match):
${doNotRecommend.map((t) => `- ${t}`).join("\n")}

Output JSON only with EXACT keys:
{
  "title": "...",
  "author": "...",
  "domain": "...",
  "reason": "..."
}

Rules:
- domain must be exactly one of: ${ALLOWED_DOMAINS.join(", ")}
- reason must be 1-2 sentences and specific.`;

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: prompt,
    }),
  });

  const json: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(clean(json?.error?.message) || "OpenAI request failed");

  const text = clean(json?.output_text) || clean(json?.output?.[0]?.content?.[0]?.text) || "";
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Try to salvage embedded JSON if needed
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("OpenAI returned non-JSON.");
    parsed = JSON.parse(m[0]);
  }

  const title = clean(parsed?.title);
  const author = clean(parsed?.author);
  const domain = clean(parsed?.domain) || "General";
  const reason = clean(parsed?.reason);

  if (!title || !author || !reason) throw new Error("Invalid recommendation payload from OpenAI");

  return { title, author, domain, reason };
}

async function getTopDomainsFromDB() {
  const supabase = supabaseServer();
  const { data, error } = await supabase.from("books").select("domain").limit(300);
  if (error) return ["Psychology", "AI", "Leadership", "History"];

  const counts: Record<string, number> = {};
  for (const r of data || []) {
    const d = clean((r as any).domain) || "General";
    counts[d] = (counts[d] || 0) + 1;
  }
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([d]) => d);

  return sorted.slice(0, 4).length ? sorted.slice(0, 4) : ["Psychology", "AI", "Leadership", "History"];
}

async function fetchRecentSeenTitles(limit = 30): Promise<string[]> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("recommendation_history")
    .select("title")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return [];
  return (data || []).map((r: any) => clean(r.title)).filter(Boolean);
}

async function existsInBooks(title: string): Promise<boolean> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("books")
    .select("id, title")
    .ilike("title", title)
    .limit(25);

  if (error) return false;
  const target = norm(title);
  return (data || []).some((r: any) => norm(r.title) === target);
}

async function existsInSeen(title: string): Promise<boolean> {
  const supabase = supabaseServer();
  const { data, error } = await supabase
    .from("recommendation_history")
    .select("id, title")
    .ilike("title", title)
    .limit(25);

  if (error) return false;
  const target = norm(title);
  return (data || []).some((r: any) => norm(r.title) === target);
}

async function saveSeen(title: string) {
  const supabase = supabaseServer();
  await supabase.from("recommendation_history").insert([{ title }]);
}

async function cleanupSeen(keepLast = 500) {
  // Optional. keep the table small-ish.
  const supabase = supabaseServer();

  const { data } = await supabase
    .from("recommendation_history")
    .select("id")
    .order("created_at", { ascending: false })
    .range(keepLast, keepLast + 1000);

  const ids = (data || []).map((r: any) => r.id).filter(Boolean);
  if (ids.length) {
    await supabase.from("recommendation_history").delete().in("id", ids);
  }
}

export async function GET() {
  try {
    const seedDomains = await getTopDomainsFromDB();

    const recentSeen = await fetchRecentSeenTitles(30);

    // Also exclude the last shown title explicitly
    const doNotRecommend = recentSeen.slice(0, 30);

    const MAX_TRIES = 8;

    for (let i = 0; i < MAX_TRIES; i++) {
      const base = await openAIRecommend(seedDomains, doNotRecommend);

      // Hard checks. Not in your list. Not in recently seen.
      const dupeInBooks = await existsInBooks(base.title);
      if (dupeInBooks) continue;

      const dupeInSeen = await existsInSeen(base.title);
      if (dupeInSeen) continue;

      const rating = await fetchGoogleBooksRating(base.title, base.author);

      const rec: Rec = {
        title: base.title,
        author: base.author,
        domain: base.domain,
        rating: typeof rating === "number" ? rating : null,
        reason: base.reason,
      };

      await saveSeen(rec.title);
      cleanupSeen(500).catch(() => {});

      return NextResponse.json(
        { ok: true, recommendation: rec, tries: i + 1 },
        { headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json(
      { error: "Could not find a fresh recommendation after several tries. Try again." },
      { status: 409, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown server error" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}