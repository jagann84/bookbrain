"use client";

import { useState } from "react";

type Result = {
  book: string;
  status: string;
  rating?: number;
  matchedTitle?: string;
  strategy?: string;
};

export default function RatingsPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<null | {
    dryRun: boolean;
    mode: string;
    staleDays: number;
    limit: number;
    candidates: number;
    updated: number;
    results: Result[];
    note?: string;
  }>(null);
  const [error, setError] = useState<string | null>(null);

  async function runRefresh(params: string) {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch(`/api/refresh-ratings${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Request failed");
      setData(json);
    } catch (e: any) {
      setError(e.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const wouldUpdate = data?.results?.filter((r) => r.status === "would_update").length ?? 0;
  const noMatch = data?.results?.filter((r) => r.status === "no_match").length ?? 0;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Ratings Refresh</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        Use Dry Run first. Then Update Notion in small batches.
      </p>

      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          onClick={() => runRefresh("?limit=10&mode=stale&staleDays=30")}
          disabled={loading}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
          }}
        >
          Dry run (10)
        </button>

        <button
          onClick={() => runRefresh("?limit=10&mode=stale&staleDays=30&dryRun=false")}
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
          Update Notion (10)
        </button>

        <button
          onClick={() => runRefresh("?limit=30&mode=stale&staleDays=30")}
          disabled={loading}
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "white",
            cursor: "pointer",
          }}
        >
          Dry run (30)
        </button>
      </div>

      {loading && <p style={{ marginTop: 16 }}>Running...</p>}

      {error && (
        <p style={{ marginTop: 16, color: "crimson" }}>
          Error: {error}
        </p>
      )}

      {data && (
        <div style={{ marginTop: 20 }}>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", color: "#333" }}>
            <div><strong>Mode:</strong> {data.mode}</div>
            <div><strong>Dry Run:</strong> {String(data.dryRun)}</div>
            <div><strong>Limit:</strong> {data.limit}</div>
            <div><strong>Stale Days:</strong> {data.staleDays}</div>
            <div><strong>Would Update:</strong> {wouldUpdate}</div>
            <div><strong>No match:</strong> {noMatch}</div>
            <div><strong>Updated:</strong> {data.updated}</div>
          </div>

          {data.note && <p style={{ marginTop: 10, color: "#666" }}>{data.note}</p>}

          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {data.results.map((r, idx) => (
              <div
                key={idx}
                style={{
                  border: "1px solid #eee",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div style={{ fontWeight: 700 }}>{r.book}</div>
                <div style={{ marginTop: 6, color: "#555" }}>
                  Status: <strong>{r.status}</strong>
                  {typeof r.rating === "number" ? ` · Rating: ${r.rating}` : ""}
                  {r.strategy ? ` · Strategy: ${r.strategy}` : ""}
                </div>
                {r.matchedTitle && (
                  <div style={{ marginTop: 6, color: "#777" }}>
                    Matched: {r.matchedTitle}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}