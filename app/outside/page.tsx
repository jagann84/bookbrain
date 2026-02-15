"use client";

import { useState } from "react";

type Pick = {
  title: string;
  author: string;
  rating: number | null;
  ratingCount: number;
  domainSeed: string;
  googleBooksId: string;
};

type OutsideResponse = {
  mode?: string;
  dominantDomains?: string[];
  queryUsed?: string;
  count?: number;
  picks?: Pick[];
  stale?: boolean;
  note?: string;
  error?: string;
};

export default function OutsidePage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OutsideResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch("/api/recommend-outside", { cache: "no-store" });
      const text = await res.text();

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error(`API did not return JSON. Got: ${text.slice(0, 120)}...`);
      }

      if (!res.ok) throw new Error(json?.error || "Failed to get recommendations");

      setData(json);
    } catch (e: any) {
      setError(e.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const picks = data?.picks ?? [];

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Outside Recommendations</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        High-quality nonfiction recommendations not already in your Notion list, optimized for intellectual breadth.
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

      {data?.stale && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #f0d58c",
            background: "#fff7db",
            color: "#5a4100",
          }}
        >
          <strong>Showing last saved results.</strong> Google Books rate-limited the app.
          Try again later for fresh picks.
          {data?.note ? <div style={{ marginTop: 6 }}>{data.note}</div> : null}
        </div>
      )}

      {data && (
        <div style={{ marginTop: 20 }}>
          <div style={{ color: "#333" }}>
            <div>
              <strong>Mode:</strong> {data.mode ?? "—"}
            </div>
            <div>
              <strong>Dominant domains:</strong>{" "}
              {(data.dominantDomains ?? []).join(", ") || "—"}
            </div>
            <div>
              <strong>Results:</strong> {typeof data.count === "number" ? data.count : picks.length}
            </div>
          </div>

          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {picks.map((p, idx) => (
              <div key={idx} style={{ border: "1px solid #eee", borderRadius: 12, padding: 12 }}>
                <div style={{ fontWeight: 800 }}>{p.title}</div>
                <div style={{ marginTop: 6, color: "#555" }}>{p.author}</div>
                <div style={{ marginTop: 6, color: "#777" }}>
                  Seed: {p.domainSeed} · Rating: {p.rating ?? "Unrated"} ({p.ratingCount ?? 0})
                </div>
              </div>
            ))}
          </div>

          {data.queryUsed ? (
            <details style={{ marginTop: 18 }}>
              <summary style={{ cursor: "pointer", color: "#555" }}>Show query used</summary>
              <pre
                style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 12,
                  border: "1px solid #eee",
                  background: "#fafafa",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {data.queryUsed}
              </pre>
            </details>
          ) : null}
        </div>
      )}
    </main>
  );
}