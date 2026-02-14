"use client";

import { useEffect, useMemo, useState } from "react";

type Book = {
  id: string;
  name: string;
  author: string;
  domain: string;
  status: string;
  review: string;
};

function num(n: string) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/books");
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed to fetch books");
        setBooks(json.books || []);
      } catch (e: any) {
        setError(e.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    run();
  }, []);

  const derived = useMemo(() => {
    const total = books.length;
    const unread = books.filter((b) => (b.status || "").toLowerCase() !== "read");

    const domainCounts: Record<string, number> = {};
    books.forEach((b) => {
      const d = b.domain || "Uncategorized";
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    });

    const topRatedUnread = unread
      .filter((b) => num(b.review) > 0)
      .sort((a, b) => num(b.review) - num(a.review))
      .slice(0, 5);

    return { total, unreadCount: unread.length, domainCounts, topRatedUnread };
  }, [books]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>BookBrain Dashboard</h1>

      {loading && <p style={{ marginTop: 16 }}>Loading…</p>}

      {error && (
        <p style={{ marginTop: 16, color: "crimson" }}>
          Error: {error}
        </p>
      )}

      {!loading && !error && (
        <>
          <div style={{ marginTop: 24 }}>
            <div>Total Books: {derived.total}</div>
            <div>Unread Books: {derived.unreadCount}</div>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2>Books by Domain</h2>
            <ul>
              {Object.entries(derived.domainCounts).map(([domain, count]) => (
                <li key={domain}>
                  {domain}: {count}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2>Top Rated Unread</h2>
            {derived.topRatedUnread.length === 0 && <div>No rated unread books yet.</div>}
            {derived.topRatedUnread.map((b) => (
              <div key={b.id} style={{ marginTop: 8 }}>
                <strong>{b.name}</strong> . {b.review}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}