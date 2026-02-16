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

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // If the server returned HTML or partial content
    return { error: text.slice(0, 200) };
  }
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Add Book state
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [domain, setDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [addErr, setAddErr] = useState<string | null>(null);

  // Status update state
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updateErr, setUpdateErr] = useState<string | null>(null);

  async function fetchBooks() {
    const res = await fetch("/api/books?limit=100", { cache: "no-store" });
    const json = await safeJson(res);

    if (!res.ok) {
      throw new Error(json?.error || `Failed to fetch books (HTTP ${res.status})`);
    }

    const list = Array.isArray(json?.books) ? json.books : [];
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

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(json?.error || `Failed to add book (HTTP ${res.status})`);
      }

      setAddMsg(`Added: ${json?.title || title}${json?.author ? " by " + json.author : ""}`);
      setTitle("");
      setAuthor("");
      setDomain("");

      // Best-effort refresh. If Notion is rate-limiting, UI still works.
      fetchBooks().catch(() => {});
    } catch (e: any) {
      setAddErr(e?.message || "Unknown error");
    } finally {
      setAdding(false);
    }
  }

  async function setStatus(id: string, status: "Unread" | "Read") {
    // Optimistic UI update (so it feels instant even if Notion rate-limits refresh)
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));

    try {
      setUpdatingId(id);
      setUpdateErr(null);

      const res = await fetch("/api/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        throw new Error(json?.error || `Failed to update status (HTTP ${res.status})`);
      }

      // Best-effort refresh
      fetchBooks().catch(() => {});
    } catch (e: any) {
      // If it failed, revert the optimistic change by refetching (best effort)
      setUpdateErr(e?.message || "Unknown error");
      fetchBooks().catch(() => {});
    } finally {
      setUpdatingId(null);
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
      const d = b?.domain || "Uncategorized";
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    });

    const topRatedUnread = unread
      .filter((b) => num(b?.review || "0") > 0)
      .sort((a, b) => num(b?.review || "0") - num(a?.review || "0"))
      .slice(0, 5);

    return { total, unreadCount: unread.length, domainCounts, topRatedUnread };
  }, [books]);

  const canSubmit = !adding && title.trim().length > 0;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", maxWidth: 900 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>BookBrain Dashboard</h1>

      <div style={{ marginTop: 16, border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
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
            placeholder="Domain (optional)"
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
            {adding ? "Adding..." : "Add Book"}
          </button>

          {addMsg && <span style={{ color: "#0a7a2f" }}>{addMsg}</span>}
          {addErr && <span style={{ color: "crimson" }}>{addErr}</span>}
        </div>
      </div>

      {loading && <p style={{ marginTop: 16 }}>Loading…</p>}
      {error && <p style={{ marginTop: 16, color: "crimson" }}>Error: {error}</p>}

      {!loading && !error && (
        <>
          <div style={{ marginTop: 24 }}>
            <div>Total Books (loaded): {derived.total}</div>
            <div>Unread Books (loaded): {derived.unreadCount}</div>
            
          </div>

          <div style={{ marginTop: 24 }}>
            <h2>Books by Domain</h2>
            <ul>
              {Object.entries(derived.domainCounts).map(([d, count]) => (
                <li key={d}>
                  {d}: {count}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 24 }}>
            <h2>Update Status</h2>
            {updateErr && (
              <div style={{ color: "crimson", marginBottom: 10 }}>
                Error: {updateErr}
              </div>
            )}

            <div style={{ display: "grid", gap: 10 }}>
              {books.slice(0, 50).map((b) => {
                const status = (b.status || "Unread").toLowerCase();
                const busy = updatingId === b.id;

                return (
                  <div
                    key={b.id}
                    style={{
                      border: "1px solid #eee",
                      borderRadius: 12,
                      padding: 12,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700 }}>{b.name}</div>
                      <div style={{ fontSize: 13, color: "#666" }}>
                        {b.domain || "Uncategorized"} . {b.author || "Unknown"} . Status:{" "}
                        {b.status || "Unread"}
                      </div>
                    </div>

                    {status === "read" ? (
                      <button
                        disabled={busy}
                        onClick={() => setStatus(b.id, "Unread")}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          background: "#fff",
                          cursor: "pointer",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        Mark Unread
                      </button>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() => setStatus(b.id, "Read")}
                        style={{
                          padding: "8px 10px",
                          borderRadius: 10,
                          border: "1px solid #ddd",
                          background: "#111",
                          color: "white",
                          cursor: "pointer",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        Mark Read
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </main>
  );
}