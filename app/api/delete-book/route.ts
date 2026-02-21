import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const id = body?.id;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    const supabase = supabaseServer();

    const { error } = await supabase.from("books").delete().eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: `Supabase delete failed: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown server error" },
      { status: 500 }
    );
  }
}