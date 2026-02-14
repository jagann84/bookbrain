"use client";

import { useState } from "react";

type Pick = {
  title: string;
  author: string;
  rating: number;
  ratingCount: number;
  domainSeed: string;
  googleBooksId: string;
};

export default function OutsidePage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<null | {
    domainsUsed: string[];
    limit: number;
    minRating: number;
    count: number;
    picks: Pick[];
  }>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch("/api/recommend-outside?limit=6&minRating=4.3");
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to get recommendations");
      setData(json);
    } catch (e: any) {
      setError(e.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Outside Recommendations</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        High-rated nonfiction suggestions not already in your Notion list.
      </p>

      <div style={{ marginTop: 16 }}>
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
          {loading ? "Loading..." : "Recommend outside my list"}
        </button>
      </div>

      {error && <p style={{ marginTop: 16, color: "crimson" }}>Error: {error}</p>}

      {data && (
        <div style={{ marginTop: 20 }}>
          <div style={{ color: "#333" }}>
            <div><strong>Domains used:</strong> {data.domainsUsed.join(", ")}</div>
            <div><strong>Min rating:</strong> {data.minRating}</div>
            <div><strong>Results:</strong> {data.count}</div>
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {data.picks.map((p, idx) => (
              <div key={idx} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 800 }}>{p.title}</div>
                <div style={{ marginTop: 6, color: "#555" }}>{p.author}</div>
                <div style={{ marginTop: 6, color: "#777" }}>
                  Seed: {p.domainSeed} · Rating: {p.rating} ({p.ratingCount})
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}