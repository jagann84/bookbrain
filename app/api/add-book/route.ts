import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function clean(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function normKey(s: string) {
  return clean(s).toLowerCase();
}

function titleCase(s: string) {
  const x = clean(s).toLowerCase();
  if (!x) return "";
  return x
    .split(" ")
    .map((w) => {
      if (!w) return w;
      const m = w.match(/^([^a-z0-9]*)([a-z0-9])(.*)$/i);
      if (!m) return w;
      const [, prefix, first, rest] = m;
      return `${prefix}${first.toUpperCase()}${rest}`;
    })
    .join(" ");
}

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

type Domain = (typeof ALLOWED_DOMAINS)[number];

function normalizeDomain(s: string): Domain {
  const x = clean(s);
  const match = ALLOWED_DOMAINS.find((d) => d.toLowerCase() === x.toLowerCase());
  return match || "General";
}

type BookStatus = "Unread" | "Reading" | "Read";
function normalizeStatus(s: any): BookStatus {
  const x = clean(String(s || ""));
  if (x === "Read") return "Read";
  if (x === "Reading") return "Reading";
  return "Unread";
}

async function pickDomainWithOpenAI(title: string, author: string): Promise<Domain> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "General";

  const prompt = `Choose the best domain for this nonfiction book.

Title: ${title}
Author: ${author || "Unknown"}

Rules:
- Output exactly ONE domain from this list:
${ALLOWED_DOMAINS.join(", ")}
- Output only the domain name. No punctuation.`;

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

  if (!res.ok) return "General";

  const json: any = await res.json();
  const text =
    clean(json?.output_text) ||
    clean(json?.output?.[0]?.content?.[0]?.text) ||
    "";
  return normalizeDomain(text);
}

async function fetchGoogleBooksRating(title: string, author: string): Promise<number> {
  const key = process.env.GOOGLE_BOOKS_API_KEY;
  if (!key) return 0;

  const qTitle = encodeURIComponent(`intitle:${title}`);
  const qAuthor = author ? encodeURIComponent(`inauthor:${author}`) : "";
  const q = qAuthor ? `${qTitle}+${qAuthor}` : qTitle;

  const url = `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=5&printType=books&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return 0;

  const json: any = await res.json();
  const items: any[] = Array.isArray(json?.items) ? json.items : [];

  for (const it of items) {
    const r = it?.volumeInfo?.averageRating;
    if (typeof r === "number" && Number.isFinite(r)) return r;
  }

  return 0;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const rawTitle = clean(body?.title);
    const rawAuthor = clean(body?.author || "");
    const requestedStatus = normalizeStatus(body?.status);

    if (!rawTitle) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    const title = titleCase(rawTitle);
    const author = titleCase(rawAuthor);

    const supabase = supabaseServer();

    // Pull potential matches by title (case-insensitive pattern)
    const { data: existing, error: existErr } = await supabase
      .from("books")
      .select("id, title, author, status, domain, review")
      .ilike("title", title) // note: exact pattern but case-insensitive
      .limit(25);

    if (existErr) {
      return NextResponse.json(
        { error: `Supabase dedupe check failed: ${existErr.message}` },
        { status: 500 }
      );
    }

    const match =
      Array.isArray(existing) &&
      existing.find(
        (r: any) =>
          normKey(r.title) === normKey(title) &&
          normKey(r.author || "") === normKey(author)
      );

    // If it already exists, optionally update status, then RETURN THE ROW
    if (match) {
      let updatedRow = match;

      if (requestedStatus === "Read" && match.status !== "Read") {
        const { data: upd, error: updErr } = await supabase
          .from("books")
          .update({ status: "Read" })
          .eq("id", match.id)
          .select("id, title, author, status, domain, review")
          .single();

        if (updErr) {
          return NextResponse.json(
            { error: `Supabase status update failed: ${updErr.message}` },
            { status: 500 }
          );
        }

        updatedRow = upd;
      }

      return NextResponse.json({
        ok: true,
        alreadyExists: true,
        book: updatedRow,
      });
    }

    // New insert
    const domain = await pickDomainWithOpenAI(title, author);
    const rating = await fetchGoogleBooksRating(title, author);

    const { data, error } = await supabase
      .from("books")
      .insert([
        {
          title,
          author: author || null,
          domain,
          status: requestedStatus, // Unread by default. Read if requested
          review: rating ?? 0,
        },
      ])
      .select("id, title, author, status, domain, review")
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Supabase insert failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, alreadyExists: false, book: data });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown server error." },
      { status: 500 }
    );
  }
}