"use client";

import { useEffect, useState } from "react";

type Pick = {
  title: string;
  author: string;
  rating: number | null;
  ratingCount: number;
  domainSeed: string;
};

type OutsideResponse = {
  mode?: string;
  dominantDomains?: string[];
  count?: number;
  picks?: Pick[];
  fallbackSource?: "google" | "notion";
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

    try {
      const res = await fetch("/api/recommend-outside", { cache: "no-store" });
      const json = (await res.json()) as OutsideResponse;

      if (!res.ok) throw new Error(json?.error || "Failed to get recommendations");

      setData(json);
    } catch (e: any) {
      setError(e.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const picks = data?.picks ?? [];

  const showFallback = data?.fallbackSource === "notion";

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Outside Recommendations</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        High-quality nonfiction recommendations, optimized for intellectual breadth.
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

      {showFallback && (
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
          <strong>Google Books rate limit hit.</strong> Showing recommendations from your Notion library instead.
        </div>
      )}

      {error && <p style={{ marginTop: 16, color: "crimson" }}>Error: {error}</p>}

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
                  Seed: {p.domainSeed} · Rating: {p.rating ?? "—"}
                </div>
              </div>
            ))}
          </div>

          {data.note ? <p style={{ marginTop: 14, color: "#666" }}>{data.note}</p> : null}
        </div>
      )}
    </main>
  );
}