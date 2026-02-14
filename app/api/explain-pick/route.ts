import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { pick, alternates, mostCommonDomain } = body;

    if (!pick?.name) {
      return NextResponse.json({ error: "Missing pick" }, { status: 400 });
    }

    const prompt = `
Write a short explanation for why this non-fiction book should be the next read.
Constraints:
- 3 to 5 short sentences.
- Mention rating if present.
- Mention variety. Avoid over-indexing on the most common unread domain: "${mostCommonDomain}".
- Be direct. No hype. No emojis.

Pick:
Title: ${pick.name}
Author: ${pick.author || "Unknown"}
Domain: ${pick.domain || "Uncategorized"}
Rating: ${pick.review || "N/A"}

Alternates:
${(alternates || [])
  .map((b: any) => `- ${b.name} (${b.domain || "Uncategorized"}, ${b.review || "N/A"})`)
  .join("\n")}
`.trim();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: "You are concise, practical, and direct." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: text }, { status: 500 });
    }

    const data: any = await resp.json();
    const explanation =
      data.choices?.[0]?.message?.content?.trim() || "";

    return NextResponse.json({ explanation });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}