import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function clean(s: any) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const page = Math.max(1, Number(url.searchParams.get("page") || "1"));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "100")));
    const offset = (page - 1) * limit;

    const supabase = supabaseServer();

    const { data, error, count } = await supabase
      .from("books")
      .select("id, title, author, domain, status, review, created_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: `Supabase fetch failed: ${error.message}` }, { status: 500 });
    }

    const books = (data || []).map((b: any) => ({
      id: b.id,
      title: clean(b.title),
      author: clean(b.author),
      domain: clean(b.domain) || "General",
      status: clean(b.status) || "Unread",
      review: typeof b.review === "number" ? b.review : Number(b.review) || 0,
    }));

    return NextResponse.json({
      ok: true,
      total: count ?? books.length,
      page,
      limit,
      books,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown server error" }, { status: 500 });
  }
}