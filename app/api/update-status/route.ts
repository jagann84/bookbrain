import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

function clean(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Use POST with JSON body: { id, status }" },
    { status: 405 }
  );
}

export async function POST(req: Request) {
  const supabase = supabaseServer();

  const body = await req.json();
  const id = clean(body?.id || "");
  const status = clean(body?.status || "");

  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!["Unread", "Reading", "Read"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const { error } = await supabase.from("books").update({ status }).eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, id, status });
}