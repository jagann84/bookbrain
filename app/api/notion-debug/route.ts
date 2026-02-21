import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

export async function GET() {
  try {
    const databaseId = process.env.NOTION_DATABASE_ID;
    if (!databaseId) {
      return NextResponse.json({ ok: false, error: "Missing NOTION_DATABASE_ID" }, { status: 500 });
    }

    const db: any = await notion.databases.retrieve({ database_id: databaseId });

    const props = db?.properties || null;
    const keys = props ? Object.keys(props) : null;

    return NextResponse.json({
      ok: true,
      databaseId,
      title: db?.title?.map((t: any) => t.plain_text).join("") ?? "",
      hasProperties: !!props,
      propertyCount: keys ? keys.length : 0,
      propertyNames: keys || [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}