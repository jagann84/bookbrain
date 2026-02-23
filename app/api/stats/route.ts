import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const supabase = supabaseServer();

    const { data, error } = await supabase.rpc("bookbrain_stats");

    if (error) {
      return NextResponse.json(
        { error: `Supabase RPC failed: ${error.message}` },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // rpc returns an array for table-returning functions
    const row = Array.isArray(data) ? data[0] : null;

    if (!row) {
      return NextResponse.json(
        { error: "No stats returned from bookbrain_stats()" },
        { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        total: Number(row.total || 0),
        unread: Number(row.unread || 0),
        reading: Number(row.reading || 0),
        read: Number(row.read || 0),
        avgRating: Number(row.avg_rating || 0),
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unknown server error" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}