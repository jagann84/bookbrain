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

  // Manual Add Book state
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [domain, setDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);

  async function fetchBooks() {
    const res = await fetch("/api/books", { cache: "no-store" });
    const json = await res.json();

    const list = Array.isArray(json?.books) ? json.books : [];
    if (!res.ok) throw new Error(json?.error || "Failed to fetch books");

    setBooks(list);
  }

  useEffect(() => {
    async function run() {
      try {
        setLoading(true);
        setError(null);
        await fetchBooks();
      } catch (e: any) {
        setError(e?.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    run();
  }, []);

  async function addBook() {
    try {
      setAdding(true);
      setAddMsg(null);
      setAddErr(null);

      if (!title.trim()) {
        setAddErr("Title is required.");
        return;
      }

      const res = await fetch("/api/add-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, author, domain }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to add book");

      setAddMsg(`Added: ${json.title}${json.author ? " by " + json.author : ""}`);
      setTitle("");
      setAuthor("");
      setDomain("");

      await fetchBooks();
    } catch (e: any) {
      setAddErr(e?.message || "Unknown error");
    } finally {
      setAdding(false);
    }
  }

  const derived = useMemo(() => {
    const safeBooks = Array.isArray(books) ? books : [];
    const total = safeBooks.length;

    const unread = safeBooks.filter(
      (b) => ((b?.status || "") + "").toLowerCase() !== "read"
    );

    const domainCounts: Record<string, number> = {};
    safeBooks.forEach((b) => {
      const d = (b?.domain || "Uncategorized") + "";
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    });

    const topRatedUnread = unread
      .filter((b) => num((b?.review || "0") + "") > 0)
      .sort((a, b) => num((b?.review || "0") + "") - num((a?.review || "0") + ""))
      .slice(0, 5);

    return { total, unreadCount: unread.length, domainCounts, topRatedUnread };
  }, [books]);

  const canSubmit = !adding && title.trim().length > 0;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>BookBrain Dashboard</h1>

      {/* Add Book (Manual only) */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid #eee",
          borderRadius: 12,
          padding: 14,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Add Book</h2>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Book title"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <input
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
            placeholder="Author (optional)"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <input
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="Domain (optional). Example: Psychology"
            style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={addBook}
            disabled={!canSubmit}
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: "#111",
              color: "white",
              cursor: "pointer",
              opacity: canSubmit ? 1 : 0.6,
            }}
          >
            {adding ? "Adding..." : "Add to Notion"}
          </button>

          {addMsg ? <span style={{ color: "#0a7a2f" }}>{addMsg}</span> : null}
          {addErr ? <span style={{ color: "crimson" }}>{addErr}</span> : null}
        </div>

        <div style={{ marginTop: 10, color: "#666", fontSize: 13 }}>
          Manual add only for now. We can reintroduce URL later once everything else is stable.
        </div>
      </div>

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
              {Object.entries(derived.domainCounts || {}).map(([d, count]) => (
                <li key={d}>
                  {d}: {count}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2>Top Rated Unread</h2>
            {derived.topRatedUnread.length === 0 && <div>No rated unread books yet.</div>}
            {derived.topRatedUnread.map((b) => (
              <div key={b.id} style={{ marginTop: 8 }}>
                <strong>{b.name || "(Untitled)"}</strong> . {b.review || "—"}
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}