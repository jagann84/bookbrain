"use client";

import { useMemo, useState } from "react";

type Book = {
  id: string;
  name: string;
  author: string;
  domain: string;
  status: string;
  review: string;
  quote: string;
};

function num(n: string) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export default function ReadNextPage() {
  const [loading, setLoading] = useState(false);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState<string>("");

  async function load() {
    setLoading(true);
    setError(null);
    setExplanation("");

    try {
      const res = await fetch("/api/books");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to load books");
      setBooks(json.books as Book[]);
    } catch (e: any) {
      setError(e.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const recommendation = useMemo(() => {
    if (!books) return null;

    const unread = books.filter((b) => (b.status || "").toLowerCase() !== "read");

    const domainCounts: Record<string, number> = {};
    unread.forEach((b) => {
      const d = b.domain || "Uncategorized";
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    });

    let mostCommonDomain = "Uncategorized";
    let max = 0;
    for (const [d, c] of Object.entries(domainCounts)) {
      if (c > max) {
        max = c;
        mostCommonDomain = d;
      }
    }

    const scored = unread
      .map((b) => {
        const rating = num(b.review);
        const varietyBonus = (b.domain || "Uncategorized") === mostCommonDomain ? 0 : 0.35;
        return { b, score: rating + varietyBonus };
      })
      .sort((a, b) => b.score - a.score);

    const pick = scored[0]?.b ?? null;
    const alternates = scored.slice(1, 4).map((x) => x.b);

    return { pick, alternates, mostCommonDomain, unreadCount: unread.length };
  }, [books]);

  async function explain() {
    if (!recommendation?.pick) return;

    setExplaining(true);
    setExplanation("");
    setError(null);

    try {
      const res = await fetch("/api/explain-pick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pick: recommendation.pick,
          alternates: recommendation.alternates,
          mostCommonDomain: recommendation.mostCommonDomain,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to get explanation");
      setExplanation(json.explanation || "");
    } catch (e: any) {
      setError(e.message || "Unknown error");
    } finally {
      setExplaining(false);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Read Next</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        Picks a high-rated unread book, with a bias toward variety. Then generates a short explanation.
      </p>

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={load}
          disabled={loading}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#111",
            color: "white",
            cursor: "pointer",
          }}
        >
          {loading ? "Loading..." : "Recommend a book"}
        </button>

        <button
          onClick={explain}
          disabled={!recommendation?.pick || explaining}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
          }}
        >
          {explaining ? "Explaining..." : "Explain why"}
        </button>
      </div>

      {error && <p style={{ marginTop: 16, color: "crimson" }}>Error: {error}</p>}

      {recommendation && (
        <div style={{ marginTop: 20 }}>
          <div style={{ color: "#333" }}>
            <div><strong>Unread books considered:</strong> {recommendation.unreadCount}</div>
            <div><strong>Most common unread domain:</strong> {recommendation.mostCommonDomain}</div>
          </div>

          <div style={{ marginTop: 16 }}>
            <h2 style={{ marginBottom: 8 }}>Your Pick</h2>
            {recommendation.pick ? (
              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 18 }}>
                  {recommendation.pick.name || "(Untitled)"}
                </div>
                <div style={{ marginTop: 6, color: "#444" }}>{recommendation.pick.author}</div>
                <div style={{ marginTop: 6, color: "#777" }}>
                  {recommendation.pick.domain}{" "}
                  {recommendation.pick.review ? `· ${recommendation.pick.review}` : ""}
                </div>
              </div>
            ) : (
              <div>No pick available.</div>
            )}
          </div>

          {explanation && (
            <div style={{ marginTop: 16 }}>
              <h2 style={{ marginBottom: 8 }}>Explanation</h2>
              <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 12, color: "#333" }}>
                {explanation}
              </div>
            </div>
          )}

          <div style={{ marginTop: 20 }}>
            <h2 style={{ marginBottom: 8 }}>Alternates</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {recommendation.alternates.map((b) => (
                <div key={b.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 700 }}>{b.name}</div>
                  <div style={{ marginTop: 6, color: "#555" }}>{b.author}</div>
                  <div style={{ marginTop: 6, color: "#777" }}>
                    {b.domain} {b.review ? `· ${b.review}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}