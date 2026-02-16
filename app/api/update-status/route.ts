import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

function clean(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// Optional. Lets you open /api/update-status in browser without confusion.
export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Use POST with JSON body: { id, status }" },
    { status: 405 }
  );
}

export async function POST(req: Request) {
  try {
    const notionToken = process.env.NOTION_TOKEN;
    if (!notionToken) {
      return NextResponse.json({ error: "Missing NOTION_TOKEN" }, { status: 500 });
    }

    const body = await req.json();
    const pageId = clean(body?.id || "");
    const status = clean(body?.status || "");

    if (!pageId) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    if (!status) return NextResponse.json({ error: "Missing status" }, { status: 400 });

    if (!["Unread", "Read", "Reading"].includes(status)) {
      return NextResponse.json(
        { error: `Invalid status "${status}". Use Unread, Reading, or Read.` },
        { status: 400 }
      );
    }

    await notion.pages.update({
      page_id: pageId,
      properties: {
        Status: { status: { name: status } }, // Notion Status property
      },
    });

    return NextResponse.json({ ok: true, id: pageId, status });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}