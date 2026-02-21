import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supabase = supabaseServer();

  const url = new URL(req.url);
  const limit = 1000;

  const { data, error } = await supabase
    .from("books")
    .select("id,title,author,domain,status,review,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const books = (data || []).map((r: any) => ({
    id: r.id,
    name: r.title || "",
    author: r.author || "",
    domain: r.domain || "",
    status: r.status || "Unread",
    review: (r.review ?? 0).toString(),
  }));

  return NextResponse.json({ count: books.length, books });
}