import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

function getText(property: any): string {
  if (!property) return "";
  if (property.type === "title")
    return property.title?.map((t: any) => t.plain_text).join("") ?? "";
  if (property.type === "rich_text")
    return property.rich_text?.map((t: any) => t.plain_text).join("") ?? "";
  if (property.type === "select")
    return property.select?.name ?? "";
  if (property.type === "number")
    return property.number?.toString() ?? "";
  return "";
}

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET() {
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!process.env.NOTION_TOKEN) {
    return NextResponse.json(
      { error: "Missing NOTION_TOKEN in .env.local" },
      { status: 500 }
    );
  }

  if (!databaseId) {
    return NextResponse.json(
      { error: "Missing NOTION_DATABASE_ID in .env.local" },
      { status: 500 }
    );
  }

  // 1) Retrieve database container to get its data source id
  const db: any = await notion.databases.retrieve({
    database_id: databaseId,
  });

  const dataSourceId = db?.data_sources?.[0]?.id;

  if (!dataSourceId) {
    return NextResponse.json(
      {
        error:
          "No data source found on this database. In Notion: Database ⋯ → Manage data sources.",
      },
      { status: 500 }
    );
  }

  // 2) Pull ALL rows with pagination
  let allResults: any[] = [];
  let hasMore = true;
  let cursor: string | undefined = undefined;

  while (hasMore) {
    const response: any = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      start_cursor: cursor,
    });

    allResults = [...allResults, ...response.results];
    hasMore = response.has_more;
    cursor = response.next_cursor ?? undefined;
  }

  // 3) Deduplicate
  const seen = new Set<string>();
  const books: any[] = [];

  for (const page of allResults) {
    const props = page.properties;

    const name = getText(
      props["Book name"] ?? props["Book Name"] ?? props["Name"]
    );
    const author = getText(props["Author"]);
    const domain = getText(props["Book domain"] ?? props["Domain"]);
    const status = getText(props["Status"]);
    const review = getText(props["Review"]);
    const quote = getText(props["Quote"]);

    if (!norm(name)) continue;

    const key = `${norm(name)}|${norm(author)}`;
    if (seen.has(key)) continue;

    seen.add(key);

    books.push({
      id: page.id,
      name,
      author,
      domain,
      status,
      review,
      quote,
    });
  }

  return NextResponse.json({ count: books.length, books });
}