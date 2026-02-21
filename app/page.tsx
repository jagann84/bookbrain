"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Book = {
  id: string;

  // Supabase shape
  title?: string | null;

  // Older Notion shape fallback
  name?: string | null;

  author?: string | null;
  domain?: string | null;
  status?: "Unread" | "Reading" | "Read" | string;
  review?: number | null;
};

type Recommendation = {
  title: string;
  author: string;
  domain: string;
  rating?: number;
  reason: string;
};

function clean(s: any) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function num(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function statusLabel(s: any) {
  const x = clean(s);
  if (x === "Read") return "Read";
  if (x === "Reading") return "Reading";
  return "Unread";
}

type SortKey =
  | "rating_desc"
  | "rating_asc"
  | "title_asc"
  | "title_desc"
  | "status_asc"
  | "status_desc"
  | "domain_asc"
  | "domain_desc";

function sortLabel(v: SortKey) {
  switch (v) {
    case "rating_desc":
      return "Rating. High to low";
    case "rating_asc":
      return "Rating. Low to high";
    case "title_asc":
      return "Title. A to Z";
    case "title_desc":
      return "Title. Z to A";
    case "domain_asc":
      return "Domain. A to Z";
    case "domain_desc":
      return "Domain. Z to A";
    case "status_asc":
      return "Status. A to Z";
    case "status_desc":
      return "Status. Z to A";
    default:
      return "Sort";
  }
}

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text || "Invalid JSON response" };
  }
}

// ✅ Centralized helpers so you never lose titles again
function getTitle(b: Book) {
  return clean(b.title || b.name || "");
}
function getAuthor(b: Book) {
  return clean(b.author || "");
}
function getDomain(b: Book) {
  return clean(b.domain || "") || "General";
}
function getRating(b: Book) {
  return num(b.review);
}

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [rec, setRec] = useState<Recommendation | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  const [titleInput, setTitleInput] = useState("");
  const [authorInput, setAuthorInput] = useState("");

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("rating_desc");

  const [page, setPage] = useState(1);
  const perPage = 5;

  const [recMenuOpen, setRecMenuOpen] = useState(false);
  const recMenuRef = useRef<HTMLDivElement | null>(null);

  const [rowMenuOpenFor, setRowMenuOpenFor] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      const t = e.target as Node;

      if (recMenuRef.current && !recMenuRef.current.contains(t)) {
        setRecMenuOpen(false);
      }
      if (rowMenuRef.current && !rowMenuRef.current.contains(t)) {
        setRowMenuOpenFor(null);
      }
    }
    window.addEventListener("click", onClickOutside);
    return () => window.removeEventListener("click", onClickOutside);
  }, []);

  async function loadAll() {
    await Promise.all([loadBooks(), loadRecommendation()]);
  }

  async function loadBooks() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/books");
      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error || "Failed to fetch books");

      const arr = Array.isArray(json?.books) ? json.books : [];

      // ✅ Normalize to ensure title always exists when possible
      const normalized: Book[] = arr.map((b: any) => ({
        ...b,
        title: b?.title ?? b?.name ?? "",
        author: b?.author ?? "",
        domain: b?.domain ?? "General",
        status: b?.status ?? "Unread",
        review: b?.review ?? 0,
      }));

      setBooks(normalized);
    } catch (e: any) {
      setError(e?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function loadRecommendation() {
    try {
      setRecLoading(true);
      setRecError(null);
      const res = await fetch("/api/recommend-book");
      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error || "Failed to fetch recommendation");
      setRec(json?.recommendation || null);
    } catch (e: any) {
      setRecError(e?.message || "Unknown error");
      setRec(null);
    } finally {
      setRecLoading(false);
    }
  }

  async function addBook(status: "Unread" | "Reading" | "Read" = "Unread") {
    const title = clean(titleInput);
    const author = clean(authorInput);

    if (!title) {
      alert("Please enter a book title.");
      return;
    }

    const res = await fetch("/api/add-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, author, status }),
    });

    const json = await safeJson(res);
    if (!res.ok) {
      alert(json?.error || "Failed to add book");
      return;
    }

    if (json?.book) {
      const bk: Book = {
        ...json.book,
        title: json.book?.title ?? json.book?.name ?? "",
      };

      setBooks((prev) => {
        const exists = prev.some((b) => b.id === bk.id);
        if (exists) return prev.map((b) => (b.id === bk.id ? bk : b));
        return [bk, ...prev];
      });
      setPage(1);
    }

    setTitleInput("");
    setAuthorInput("");
  }

  async function addRecommended(status: "Unread" | "Read") {
    if (!rec) return;

    const res = await fetch("/api/add-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: rec.title,
        author: rec.author,
        status,
      }),
    });

    const json = await safeJson(res);
    if (!res.ok) {
      alert(json?.error || "Failed to add recommended book");
      return;
    }

    if (json?.book) {
      const bk: Book = {
        ...json.book,
        title: json.book?.title ?? json.book?.name ?? "",
      };

      setBooks((prev) => {
        const exists = prev.some((b) => b.id === bk.id);
        if (exists) return prev.map((b) => (b.id === bk.id ? bk : b));
        return [bk, ...prev];
      });
      setPage(1);
    }
  }

  async function updateStatus(bookId: string, status: "Unread" | "Reading" | "Read") {
    const res = await fetch("/api/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: bookId, status }),
    });

    const json = await safeJson(res);
    if (!res.ok) {
      alert(json?.error || "Failed to update status");
      return;
    }

    setBooks((prev) => prev.map((b) => (b.id === bookId ? { ...b, status } : b)));
  }

  async function deleteBook(bookId: string, title: string) {
    const ok = confirm(`Delete "${title}" from your list? This cannot be undone.`);
    if (!ok) return;

    const res = await fetch("/api/delete-book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: bookId }),
    });

    const json = await safeJson(res);
    if (!res.ok) {
      alert(json?.error || "Failed to delete book");
      return;
    }

    setBooks((prev) => prev.filter((b) => b.id !== bookId));
    setRowMenuOpenFor(null);
  }

  const derived = useMemo(() => {
    const total = books.length;
    const unread = books.filter((b) => statusLabel(b.status) === "Unread").length;
    const reading = books.filter((b) => statusLabel(b.status) === "Reading").length;
    const read = books.filter((b) => statusLabel(b.status) === "Read").length;

    const avgRating = books.reduce((sum, b) => sum + getRating(b), 0) / (books.length || 1);

    const domainCounts: Record<string, number> = {};
    for (const b of books) {
      const d = getDomain(b);
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    }

    const domainData = Object.entries(domainCounts)
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { total, unread, reading, read, avgRating, domainData };
  }, [books]);

  const filteredSorted = useMemo(() => {
    const q = clean(query).toLowerCase();
    const filtered = !q
      ? books
      : books.filter((b) => {
          const t = getTitle(b).toLowerCase();
          const a = getAuthor(b).toLowerCase();
          const d = getDomain(b).toLowerCase();
          return t.includes(q) || a.includes(q) || d.includes(q);
        });

    const sorted = [...filtered];
    const cmpStr = (a: string, b: string) =>
      a.localeCompare(b, undefined, { sensitivity: "base" });

    sorted.sort((x, y) => {
      const tx = getTitle(x);
      const ty = getTitle(y);
      const dx = getDomain(x);
      const dy = getDomain(y);
      const sx = statusLabel(x.status);
      const sy = statusLabel(y.status);
      const rx = getRating(x);
      const ry = getRating(y);

      switch (sortKey) {
        case "rating_desc":
          return ry - rx;
        case "rating_asc":
          return rx - ry;
        case "title_asc":
          return cmpStr(tx, ty);
        case "title_desc":
          return cmpStr(ty, tx);
        case "domain_asc":
          return cmpStr(dx, dy);
        case "domain_desc":
          return cmpStr(dy, dx);
        case "status_asc":
          return cmpStr(sx, sy);
        case "status_desc":
          return cmpStr(sy, sx);
        default:
          return 0;
      }
    });

    return sorted;
  }, [books, query, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filteredSorted.length / perPage));

  const paginated = useMemo(() => {
    const safePage = Math.min(Math.max(page, 1), pageCount);
    const start = (safePage - 1) * perPage;
    return filteredSorted.slice(start, start + perPage);
  }, [filteredSorted, page, pageCount]);

  useEffect(() => {
    setPage(1);
  }, [query, sortKey]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8 space-y-6 bg-white text-zinc-900">
      {/* Header */}
      <div className="flex items-start justify-between gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">BookBrain</h1>
          <p className="text-sm text-zinc-500">Less spreadsheet. More strategy.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="Book title…"
            className="h-10 w-72 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
          />
          <input
            value={authorInput}
            onChange={(e) => setAuthorInput(e.target.value)}
            placeholder="Author…"
            className="h-10 w-56 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
          />
          <button
            onClick={() => addBook("Unread")}
            className="h-10 rounded-xl bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 active:scale-[0.99]"
          >
            Add
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-zinc-600">Loading…</div>}
      {error && <div className="text-sm text-red-600">Error: {error}</div>}

      {!loading && !error && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
          <Kpi label="Total" value={derived.total} />
          <Kpi label="Unread" value={derived.unread} />
          <Kpi label="Reading" value={derived.reading} />
          <Kpi label="Read" value={derived.read} />
          <Kpi label="Avg rating" value={derived.avgRating.toFixed(2)} />
        </div>
      )}

      {/* Recommended Next */}
      <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Recommended next
            </div>

            {recLoading && <div className="mt-2 text-sm text-zinc-600">Loading recommendation…</div>}
            {!recLoading && recError && <div className="mt-2 text-sm text-red-600">Error: {recError}</div>}

            {!recLoading && !recError && rec && (
              <>
                <h2 className="mt-2 text-xl font-semibold leading-tight">{rec.title}</h2>
                <div className="mt-1 text-sm text-zinc-600">
                  {rec.author} · {rec.domain}
                  {typeof rec.rating === "number" && rec.rating > 0 ? ` · Rating ${rec.rating.toFixed(2)}` : ""}
                </div>
                <p className="mt-3 text-sm leading-6 text-zinc-700">{rec.reason}</p>
              </>
            )}

            {!recLoading && !recError && !rec && (
              <div className="mt-2 text-sm text-zinc-600">No recommendation available right now.</div>
            )}
          </div>

          {/* Ellipsis actions */}
          <div className="relative" ref={recMenuRef}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRecMenuOpen((v) => !v);
              }}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50 active:scale-[0.99]"
              aria-label="Recommendation actions"
              title="Actions"
              disabled={!rec && !recLoading}
            >
              ⋯
            </button>

            {recMenuOpen && (
              <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg z-20">
                <MenuButton
                  onClick={async () => {
                    setRecMenuOpen(false);
                    await loadRecommendation();
                  }}
                >
                  Refresh recommendation
                </MenuButton>

                <MenuButton
                  onClick={async () => {
                    if (!rec) return;
                    setRecMenuOpen(false);
                    await addRecommended("Unread");
                  }}
                  disabled={!rec}
                >
                  Add to list
                </MenuButton>

                <MenuButton
                  onClick={async () => {
                    if (!rec) return;
                    const ok = confirm("Mark this recommended book as already read?");
                    if (!ok) return;
                    setRecMenuOpen(false);
                    await addRecommended("Read");
                  }}
                  disabled={!rec}
                >
                  Mark as already read
                </MenuButton>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Chart + Table */}
      {!loading && !error && (
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Chart */}
          <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm lg:col-span-5">
            <div className="text-sm font-semibold text-zinc-900">Books by domain</div>
            <div className="mt-1 text-xs text-zinc-500">Top 10 domains by count</div>

            <div className="mt-4 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={derived.domainData}
                  layout="vertical"
                  margin={{ top: 8, right: 12, bottom: 8, left: 12 }}
                  barCategoryGap={10}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="domain" width={120} tick={{ fontSize: 12 }} interval={0} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#111827" radius={[10, 10, 10, 10]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-3xl border border-zinc-200 bg-white shadow-sm lg:col-span-7 overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-zinc-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search title, author, domain…"
                  className="h-10 w-full sm:w-80 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
                />

                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-zinc-900/10"
                >
                  <option value="rating_desc">{sortLabel("rating_desc")}</option>
                  <option value="rating_asc">{sortLabel("rating_asc")}</option>
                  <option value="title_asc">{sortLabel("title_asc")}</option>
                  <option value="title_desc">{sortLabel("title_desc")}</option>
                  <option value="status_asc">{sortLabel("status_asc")}</option>
                  <option value="status_desc">{sortLabel("status_desc")}</option>
                  <option value="domain_asc">{sortLabel("domain_asc")}</option>
                  <option value="domain_desc">{sortLabel("domain_desc")}</option>
                </select>
              </div>

              <div className="text-xs text-zinc-500">
                Showing {paginated.length} of {filteredSorted.length}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white">
                  <tr className="text-left text-xs font-medium uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-3">Book</th>
                    <th className="px-4 py-3">Domain</th>
                    <th className="px-4 py-3">Rating</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {paginated.map((b) => {
                    const s = statusLabel(b.status);
                    const title = getTitle(b);
                    const author = getAuthor(b);
                    return (
                      <tr key={b.id} className="border-t border-zinc-200">
                        <td className="px-4 py-3">
                          <div className="font-medium text-zinc-900">
                            {title || "Untitled"}
                          </div>
                          <div className="mt-1 text-xs text-zinc-500">
                            {author || " "}
                          </div>
                        </td>

                        <td className="px-4 py-3">{getDomain(b)}</td>

                        <td className="px-4 py-3 tabular-nums">{getRating(b).toFixed(2)}</td>

                        <td className="px-4 py-3">
                          <StatusPill status={s} />
                        </td>

                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            <div className="relative" ref={rowMenuOpenFor === b.id ? rowMenuRef : null}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRowMenuOpenFor((cur) => (cur === b.id ? null : b.id));
                                }}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50"
                                aria-label="Row actions"
                                title="Actions"
                              >
                                ⋯
                              </button>

                              {rowMenuOpenFor === b.id && (
                                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-lg z-20">
                                  <div className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                                    Set status
                                  </div>

                                  <MenuButton
                                    onClick={async () => {
                                      setRowMenuOpenFor(null);
                                      await updateStatus(b.id, "Unread");
                                    }}
                                  >
                                    Unread
                                  </MenuButton>

                                  <MenuButton
                                    onClick={async () => {
                                      setRowMenuOpenFor(null);
                                      await updateStatus(b.id, "Reading");
                                    }}
                                  >
                                    Reading
                                  </MenuButton>

                                  <MenuButton
                                    onClick={async () => {
                                      setRowMenuOpenFor(null);
                                      await updateStatus(b.id, "Read");
                                    }}
                                  >
                                    Read
                                  </MenuButton>

                                  <div className="my-1 h-px bg-zinc-200" />

                                  <MenuButton
                                    onClick={async () => {
                                      await deleteBook(b.id, title || "Untitled");
                                    }}
                                    danger
                                  >
                                    Delete
                                  </MenuButton>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {paginated.length === 0 && (
                    <tr>
                      <td className="px-4 py-10 text-center text-sm text-zinc-500" colSpan={5}>
                        No books match your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-zinc-200 p-4 text-sm">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm disabled:opacity-40"
              >
                Previous
              </button>

              <div className="text-xs text-zinc-600">
                Page <span className="font-medium text-zinc-900">{page}</span> of{" "}
                <span className="font-medium text-zinc-900">{pageCount}</span>
              </div>

              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={page >= pageCount}
                className="h-10 rounded-xl border border-zinc-200 bg-white px-3 text-sm disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function Kpi(props: { label: string; value: any }) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {props.label}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums text-zinc-900">
        {props.value}
      </div>
    </div>
  );
}

function StatusPill(props: { status: string }) {
  const s = props.status;
  const base = "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border";

  if (s === "Read") {
    return <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-700`}>Read</span>;
  }
  if (s === "Reading") {
    return <span className={`${base} border-amber-200 bg-amber-50 text-amber-800`}>Reading</span>;
  }
  return <span className={`${base} border-zinc-200 bg-zinc-50 text-zinc-700`}>Unread</span>;
}

function MenuButton(props: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const cls =
    "w-full text-left px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-40 disabled:hover:bg-white";
  const dangerCls = props.danger ? " text-red-600 hover:bg-red-50" : " text-zinc-900";

  return (
    <button onClick={props.onClick} disabled={props.disabled} className={cls + dangerCls}>
      {props.children}
    </button>
  );
}