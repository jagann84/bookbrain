"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type Book = {
  id: string;
  name: string;
  author: string;
  domain: string;
  status: string;
  review: string; // numeric string
};

type Recommendation = {
  title: string;
  author: string;
  domain: string;
  reason: string;
  rating: number | null;
};

function clean(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function num(n: string) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function titleCase(s: string) {
  const x = clean(s).toLowerCase();
  if (!x) return "";
  return x
    .split(" ")
    .map((w) => {
      if (!w) return w;
      const m = w.match(/^([^a-z0-9]*)([a-z0-9])(.*)$/i);
      if (!m) return w;
      const [, prefix, first, rest] = m;
      return `${prefix}${first.toUpperCase()}${rest}`;
    })
    .join(" ");
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function safeJson(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Important: when Next returns HTML (error page), avoid crashing json()
    return { error: text.slice(0, 240) };
  }
}

type SortKey = "rating" | "name" | "status" | "domain";
type SortDir = "asc" | "desc";

function statusRank(s: string) {
  const x = clean(s) || "Unread";
  if (x === "Unread") return 0;
  if (x === "Reading") return 1;
  return 2;
}

function normalizeStatus(s: string): "Unread" | "Reading" | "Read" {
  const x = clean(s);
  if (x === "Read") return "Read";
  if (x === "Reading") return "Reading";
  return "Unread";
}

function useOnClickOutside(
  refs: React.RefObject<HTMLElement | null>[],
  handler: () => void
) {
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node | null;
      const clickedInside = refs.some((r) => {
        const el = r.current;
        return el && target ? el.contains(target) : false;
      });
      if (!clickedInside) handler();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [refs, handler]);
}

function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div className={["animate-pulse rounded-lg bg-zinc-100", className].join(" ")} />
  );
}

function Kpi(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {props.label}
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900">
        {props.value}
      </div>
    </div>
  );
}

function KpiSkeleton(props: { label: string }) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {props.label}
      </div>
      <div className="mt-2">
        <Skeleton className="h-9 w-24 rounded-xl" />
      </div>
    </div>
  );
}

function TableSkeletonRow() {
  return (
    <tr className="border-t border-zinc-200">
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-56" />
        <div className="mt-2">
          <Skeleton className="h-3 w-40" />
        </div>
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-28" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-16" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-6 w-24 rounded-full" />
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end">
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
      </td>
    </tr>
  );
}

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [books, setBooks] = useState<Book[]>([]);
  const [error, setError] = useState<string | null>(null);

  // header add
  const [headerTitle, setHeaderTitle] = useState("");
  const [headerAuthor, setHeaderAuthor] = useState("");
  const [headerAdding, setHeaderAdding] = useState(false);

  // table controls
  const [query, setQuery] = useState("");
  const PAGE_SIZE = 5;
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<SortKey>("rating");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // status updates
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // row menu
  const [openMenuForId, setOpenMenuForId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  useOnClickOutside([menuRef, menuBtnRef], () => setOpenMenuForId(null));

  // delete confirm
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    title: string;
    author: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // recommendation
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);
  const [recAdding, setRecAdding] = useState(false);

  // Recommended card ellipsis menu + confirm already read
  const [openRecMenu, setOpenRecMenu] = useState(false);
  const recMenuRef = useRef<HTMLDivElement | null>(null);
  const recBtnRef = useRef<HTMLButtonElement | null>(null);
  useOnClickOutside([recMenuRef, recBtnRef], () => setOpenRecMenu(false));

  const [confirmRecRead, setConfirmRecRead] = useState<{
    title: string;
    author: string;
  } | null>(null);

  // toast
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(
    null
  );

  function showToast(type: "ok" | "err", msg: string) {
    setToast({ type, msg });
    window.setTimeout(() => setToast(null), 2500);
  }

  // escape closes
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpenMenuForId(null);
      setConfirmDelete(null);
      setOpenRecMenu(false);
      setConfirmRecRead(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  async function fetchBooks() {
    const res = await fetch("/api/books?limit=1000", { cache: "no-store" });
    const json = await safeJson(res);
    if (!res.ok) throw new Error(json?.error || `Failed to fetch (HTTP ${res.status})`);
    const list = Array.isArray(json?.books) ? json.books : [];
    setBooks(list);
  }

  async function fetchRecommendation() {
    try {
      setRecLoading(true);
      setRecError(null);
      const res = await fetch("/api/recommend-book", { cache: "no-store" });
      const json = await safeJson(res);
      if (!res.ok) throw new Error(json?.error || `Failed (HTTP ${res.status})`);
      setRec(json?.recommendation || null);
    } catch (e: any) {
      setRec(null);
      setRecError(e?.message || "Unknown error");
    } finally {
      setRecLoading(false);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setError(null);
        await Promise.all([fetchBooks(), fetchRecommendation()]);
      } catch (e: any) {
        setError(e?.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, sortKey, sortDir]);

  async function addBookHeader() {
    try {
      const t = titleCase(headerTitle);
      const a = titleCase(headerAuthor);

      if (!t) {
        showToast("err", "Title is required.");
        return;
      }

      setHeaderAdding(true);

      const res = await fetch("/api/add-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, author: a }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        showToast("err", json?.error || `Failed to add (HTTP ${res.status})`);
        return;
      }

      showToast("ok", json?.alreadyExists ? "Already in your list." : "Book added.");
      setHeaderTitle("");
      setHeaderAuthor("");
      await fetchBooks();
    } catch (e: any) {
      showToast("err", e?.message || "Unknown error");
    } finally {
      setHeaderAdding(false);
    }
  }

  // This powers BOTH:
  // - Add to list (Unread)
  // - I already read this (Read)
  async function addRecommendedBook(status: "Unread" | "Read") {
    if (!rec) return;

    try {
      setRecAdding(true);

      const res = await fetch("/api/add-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: rec.title,
          author: rec.author,
          status, // <-- crucial: this inserts with Read when you choose "already read"
        }),
      });

      const json = await safeJson(res);
      if (!res.ok) {
        showToast("err", json?.error || `Failed to add (HTTP ${res.status})`);
        return;
      }

      showToast(
        "ok",
        status === "Read"
          ? json?.alreadyExists
            ? "Already in your list. Marked Read if needed."
            : "Added as Read."
          : json?.alreadyExists
          ? "Already in your list."
          : "Added to your list."
      );

      await fetchBooks(); // refresh grid
      await fetchRecommendation(); // get next suggestion
    } catch (e: any) {
      showToast("err", e?.message || "Unknown error");
    } finally {
      setRecAdding(false);
    }
  }

  async function setStatus(id: string, status: "Unread" | "Reading" | "Read") {
    setBooks((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));

    try {
      setUpdatingId(id);

      const res = await fetch("/api/update-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });

      const json = await safeJson(res);
      if (!res.ok) {
        showToast("err", json?.error || `Failed to update (HTTP ${res.status})`);
        await fetchBooks();
        return;
      }
      showToast("ok", "Updated.");
    } catch (e: any) {
      showToast("err", e?.message || "Unknown error");
      await fetchBooks().catch(() => {});
    } finally {
      setUpdatingId(null);
    }
  }

  async function deleteBook(id: string) {
    try {
      setDeleting(true);

      const res = await fetch("/api/delete-book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });

      const json = await safeJson(res);

      if (!res.ok) {
        showToast("err", json?.error || `Failed to delete (HTTP ${res.status})`);
        return;
      }

      setBooks((prev) => prev.filter((b) => b.id !== id));
      showToast("ok", "Deleted.");
      setConfirmDelete(null);
    } catch (e: any) {
      showToast("err", e?.message || "Unknown error");
    } finally {
      setDeleting(false);
    }
  }

  const derived = useMemo(() => {
    const safe = Array.isArray(books) ? books : [];
    const total = safe.length;

    const statusCounts = { Unread: 0, Reading: 0, Read: 0 };
    const domainCounts: Record<string, number> = {};

    for (const b of safe) {
      const s = normalizeStatus(b.status);
      if (s === "Read") statusCounts.Read += 1;
      else if (s === "Reading") statusCounts.Reading += 1;
      else statusCounts.Unread += 1;

      const d = clean(b.domain) || "Uncategorized";
      domainCounts[d] = (domainCounts[d] || 0) + 1;
    }

    const avgRating =
      safe.length === 0
        ? 0
        : safe.reduce((acc, b) => acc + num(b.review || "0"), 0) / safe.length;

    const topDomains = Object.entries(domainCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([domain, count]) => ({ domain, count }));

    const q = clean(query).toLowerCase();
    const filtered =
      !q
        ? safe
        : safe.filter((b) => {
            const hay = `${b.name || ""} ${b.author || ""} ${b.domain || ""}`.toLowerCase();
            return hay.includes(q);
          });

    const dirMul = sortDir === "asc" ? 1 : -1;

    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "rating") return (num(a.review || "0") - num(b.review || "0")) * dirMul;
      if (sortKey === "name") {
        const an = clean(a.name).toLowerCase();
        const bn = clean(b.name).toLowerCase();
        if (an < bn) return -1 * dirMul;
        if (an > bn) return 1 * dirMul;
        return 0;
      }
      if (sortKey === "domain") {
        const ad = (clean(a.domain) || "uncategorized").toLowerCase();
        const bd = (clean(b.domain) || "uncategorized").toLowerCase();
        if (ad < bd) return -1 * dirMul;
        if (ad > bd) return 1 * dirMul;
        return 0;
      }
      return (statusRank(a.status) - statusRank(b.status)) * dirMul;
    });

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    const safePage = clamp(page, 1, totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    const pageItems = sorted.slice(start, start + PAGE_SIZE);

    const domainData = [...topDomains].reverse();

    return {
      total,
      statusCounts,
      avgRating,
      domainData,
      sortedCount: sorted.length,
      pageItems,
      page: safePage,
      totalPages,
    };
  }, [books, query, page, sortKey, sortDir]);

  const canHeaderAdd = !headerAdding && clean(headerTitle).length > 0;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <div className="flex-1">
            <div className="text-xl font-semibold tracking-tight">BookBrain</div>
            <div className="text-xs text-zinc-500">Less spreadsheet. More strategy.</div>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <input
              value={headerTitle}
              onChange={(e) => setHeaderTitle(e.target.value)}
              placeholder="Book title…"
              className="w-[280px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-300 focus:ring-2"
            />
            <input
              value={headerAuthor}
              onChange={(e) => setHeaderAuthor(e.target.value)}
              placeholder="Author…"
              className="w-[220px] rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-300 focus:ring-2"
            />
            <button
              disabled={!canHeaderAdd}
              onClick={addBookHeader}
              className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-60 transition"
            >
              {headerAdding ? "Adding…" : "Add"}
            </button>
          </div>
        </div>
      </header>

      {/* toast */}
      {toast && (
        <div className="fixed bottom-5 left-1/2 z-20 -translate-x-1/2">
          <div
            className={[
              "rounded-xl border px-4 py-2 text-sm shadow-sm",
              "transition transform animate-[toastIn_200ms_ease-out]",
              toast.type === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-rose-200 bg-rose-50 text-rose-900",
            ].join(" ")}
          >
            {toast.msg}
          </div>
        </div>
      )}

      {/* confirm delete */}
      {confirmDelete && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl transition transform animate-[modalIn_180ms_ease-out]">
            <div className="text-sm font-semibold text-zinc-900">Delete this book?</div>
            <div className="mt-2 text-sm text-zinc-600">
              This will remove{" "}
              <span className="font-medium text-zinc-900">{confirmDelete.title}</span>
              {confirmDelete.author ? (
                <>
                  {" "}
                  by{" "}
                  <span className="font-medium text-zinc-900">{confirmDelete.author}</span>
                </>
              ) : null}
              . This cannot be undone.
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60 transition"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={() => deleteBook(confirmDelete.id)}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 active:scale-[0.99] disabled:opacity-60 transition"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* confirm "already read" for recommendation */}
      {confirmRecRead && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl transition transform animate-[modalIn_180ms_ease-out]">
            <div className="text-sm font-semibold text-zinc-900">Mark as already read?</div>
            <div className="mt-2 text-sm text-zinc-600">
              This will add{" "}
              <span className="font-medium text-zinc-900">{confirmRecRead.title}</span>
              {confirmRecRead.author ? (
                <>
                  {" "}
                  by{" "}
                  <span className="font-medium text-zinc-900">{confirmRecRead.author}</span>
                </>
              ) : null}
              {" "}to your list with Status = Read.
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                disabled={recAdding}
                onClick={() => setConfirmRecRead(null)}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60 transition"
              >
                Cancel
              </button>
              <button
                disabled={recAdding}
                onClick={async () => {
                  setConfirmRecRead(null);
                  await addRecommendedBook("Read");
                }}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-60 transition"
              >
                {recAdding ? "Adding…" : "Yes, add as Read"}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-6 py-8">
        {error && !loading && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
            Error: {error}
          </div>
        )}

        {/* KPIs */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {loading ? (
            <>
              <KpiSkeleton label="Total" />
              <KpiSkeleton label="Unread" />
              <KpiSkeleton label="Reading" />
              <KpiSkeleton label="Read" />
              <KpiSkeleton label="Avg rating" />
            </>
          ) : (
            <>
              <Kpi label="Total" value={derived.total.toString()} />
              <Kpi label="Unread" value={derived.statusCounts.Unread.toString()} />
              <Kpi label="Reading" value={derived.statusCounts.Reading.toString()} />
              <Kpi label="Read" value={derived.statusCounts.Read.toString()} />
              <Kpi label="Avg rating" value={derived.avgRating.toFixed(2)} />
            </>
          )}
        </section>

        {/* Recommended Next */}
        <section className="mt-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Recommended next
                </div>

                {(loading || recLoading) && (
                  <div className="mt-3 space-y-2">
                    <Skeleton className="h-6 w-[360px]" />
                    <Skeleton className="h-4 w-[260px]" />
                    <Skeleton className="h-4 w-[520px]" />
                    <Skeleton className="h-4 w-[420px]" />
                  </div>
                )}

                {!loading && !recLoading && recError && (
                  <div className="mt-2 text-sm text-rose-700">Error: {recError}</div>
                )}

                {!loading && !recLoading && !recError && rec && (
                  <>
                    <div className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
                      {rec.title}
                    </div>
                    <div className="mt-1 text-sm text-zinc-600">
                      {rec.author} · {rec.domain}
                      {typeof rec.rating === "number" ? (
                        <> · Rating {rec.rating.toFixed(2)}</>
                      ) : null}
                    </div>
                    <div className="mt-3 text-sm leading-relaxed text-zinc-700">
                      {rec.reason}
                    </div>
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <button
                  disabled={loading || recLoading || recAdding}
                  onClick={fetchRecommendation}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60 transition"
                >
                  {recLoading ? "Refreshing…" : "Refresh"}
                </button>

                <button
                  disabled={loading || recLoading || recAdding || !rec}
                  onClick={() => addRecommendedBook("Unread")}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 active:scale-[0.99] disabled:opacity-60 transition"
                >
                  {recAdding ? "Adding…" : "Add to list"}
                </button>

                {/* Ellipsis menu with "Already read" */}
                <div className="relative">
                  <button
                    ref={recBtnRef}
                    disabled={loading || recLoading || recAdding || !rec}
                    onClick={() => setOpenRecMenu((v) => !v)}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60 transition"
                    aria-label="More actions"
                    title="More actions"
                  >
                    <span className="text-lg leading-none">⋯</span>
                  </button>

                  {openRecMenu && (
                    <div
                      ref={recMenuRef}
                      className="absolute right-0 top-12 z-20 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg origin-top-right transition transform animate-[menuIn_140ms_ease-out]"
                    >
                      <div className="px-3 py-2 text-xs font-medium text-zinc-500">
                        Actions
                      </div>
                      <div className="h-px bg-zinc-200" />

                      <button
                        className="flex w-full items-center justify-between px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
                        onClick={() => {
                          setOpenRecMenu(false);
                          if (!rec) return;
                          setConfirmRecRead({ title: rec.title, author: rec.author });
                        }}
                      >
                        <span>I already read this</span>
                        <span className="text-xs text-zinc-500">Read</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Chart + Table side-by-side */}
        <section className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Chart */}
          <div className="lg:col-span-5">
            <div className="h-full rounded-2xl border border-zinc-200 bg-white p-5">
              <div className="mb-1 text-sm font-medium text-zinc-900">Books by domain</div>
              <div className="text-xs text-zinc-500">Top 10 domains by count</div>

              <div className="mt-4 h-[420px]">
                {loading ? (
                  <div className="h-full w-full rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="space-y-3">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-4 w-64" />
                      <Skeleton className="h-4 w-52" />
                      <Skeleton className="h-4 w-72" />
                      <Skeleton className="h-4 w-60" />
                    </div>
                  </div>
                ) : derived.domainData.length === 0 ? (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                    No domain data yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={derived.domainData}
                      layout="vertical"
                      margin={{ top: 8, right: 18, bottom: 8, left: 90 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="domain"
                        width={150}
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip />
                      <Bar dataKey="count" fill="#111827" radius={[6, 6, 6, 6]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="lg:col-span-7">
            <div className="h-full rounded-2xl border border-zinc-200 bg-white p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-sm font-medium text-zinc-900">Books</div>
                  <div className="text-xs text-zinc-500">
                    {loading ? (
                      <Skeleton className="h-3 w-28" />
                    ) : (
                      <>Showing {derived.sortedCount} results</>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-xs font-medium text-zinc-600">Sort</div>

                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    disabled={loading}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 outline-none ring-zinc-300 focus:ring-2 disabled:opacity-60"
                  >
                    <option value="rating">Rating</option>
                    <option value="name">Book name</option>
                    <option value="status">Status</option>
                    <option value="domain">Domain</option>
                  </select>

                  <select
                    value={sortDir}
                    onChange={(e) => setSortDir(e.target.value as SortDir)}
                    disabled={loading}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 outline-none ring-zinc-300 focus:ring-2 disabled:opacity-60"
                  >
                    <option value="desc">Desc</option>
                    <option value="asc">Asc</option>
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium text-zinc-600">
                  Search
                </label>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search title, author, domain"
                  disabled={loading}
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none ring-zinc-300 focus:ring-2 disabled:opacity-60"
                />
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200">
                <div className="max-h-[420px] overflow-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 bg-zinc-50 text-xs text-zinc-600">
                      <tr>
                        <th className="px-4 py-3 font-medium">Book</th>
                        <th className="px-4 py-3 font-medium">Domain</th>
                        <th className="px-4 py-3 font-medium">Rating</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Actions</th>
                      </tr>
                    </thead>

                    <tbody>
                      {loading ? (
                        <>
                          <TableSkeletonRow />
                          <TableSkeletonRow />
                          <TableSkeletonRow />
                          <TableSkeletonRow />
                          <TableSkeletonRow />
                        </>
                      ) : derived.pageItems.length === 0 ? (
                        <tr className="border-t border-zinc-200">
                          <td className="px-4 py-5 text-sm text-zinc-600" colSpan={5}>
                            No results. Clear search and try again.
                          </td>
                        </tr>
                      ) : (
                        derived.pageItems.map((b) => {
                          const busy = updatingId === b.id || deleting;
                          const status = normalizeStatus(b.status);
                          const isOpen = openMenuForId === b.id;

                          const statusOptions:
                            { label: string; value: "Unread" | "Reading" | "Read" }[] =
                            status === "Unread"
                              ? [
                                  { label: "Mark Reading", value: "Reading" },
                                  { label: "Mark Read", value: "Read" },
                                ]
                              : status === "Reading"
                              ? [
                                  { label: "Mark Unread", value: "Unread" },
                                  { label: "Mark Read", value: "Read" },
                                ]
                              : [
                                  { label: "Mark Unread", value: "Unread" },
                                  { label: "Mark Reading", value: "Reading" },
                                ];

                          return (
                            <tr
                              key={b.id}
                              className="border-t border-zinc-200 hover:bg-zinc-50/70 transition"
                            >
                              <td className="px-4 py-3">
                                <div className="font-medium text-zinc-900">
                                  {b.name || "(Untitled)"}
                                </div>
                                <div className="text-xs text-zinc-500">
                                  {b.author || "Unknown author"}
                                </div>
                              </td>

                              <td className="px-4 py-3 text-zinc-700">
                                {b.domain || "Uncategorized"}
                              </td>

                              <td className="px-4 py-3 text-zinc-700">
                                {num(b.review || "0") ? num(b.review).toFixed(2) : "0"}
                              </td>

                              <td className="px-4 py-3">
                                <span className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700">
                                  {status}
                                  {updatingId === b.id ? " · Saving…" : ""}
                                </span>
                              </td>

                              <td className="px-4 py-3">
                                <div className="relative flex justify-end">
                                  <button
                                    ref={isOpen ? menuBtnRef : undefined}
                                    disabled={busy}
                                    onClick={() =>
                                      setOpenMenuForId((cur) => (cur === b.id ? null : b.id))
                                    }
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60 transition"
                                    aria-label="Actions"
                                    title="Actions"
                                  >
                                    <span className="text-lg leading-none">⋯</span>
                                  </button>

                                  {isOpen && (
                                    <div
                                      ref={menuRef}
                                      className="absolute right-0 top-10 z-20 w-52 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg origin-top-right transition transform animate-[menuIn_140ms_ease-out]"
                                    >
                                      <div className="px-3 py-2 text-xs font-medium text-zinc-500">
                                        Actions
                                      </div>
                                      <div className="h-px bg-zinc-200" />

                                      {statusOptions.map((opt) => (
                                        <button
                                          key={opt.value}
                                          className="flex w-full items-center justify-between px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
                                          onClick={async () => {
                                            setOpenMenuForId(null);
                                            await setStatus(b.id, opt.value);
                                          }}
                                        >
                                          <span>{opt.label}</span>
                                          <span className="text-xs text-zinc-500">{opt.value}</span>
                                        </button>
                                      ))}

                                      <div className="h-px bg-zinc-200" />

                                      <button
                                        className="flex w-full items-center justify-between px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                                        onClick={() => {
                                          setOpenMenuForId(null);
                                          setConfirmDelete({
                                            id: b.id,
                                            title: b.name || "(Untitled)",
                                            author: b.author || "",
                                          });
                                        }}
                                      >
                                        <span>Delete…</span>
                                        <span className="text-xs text-rose-700">Remove</span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-xs text-zinc-500">
                  {loading ? (
                    <Skeleton className="h-3 w-24" />
                  ) : (
                    <>
                      Page {derived.page} of {derived.totalPages}
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    disabled={loading || derived.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60 transition"
                  >
                    Prev
                  </button>
                  <button
                    disabled={loading || derived.page >= derived.totalPages}
                    onClick={() => setPage((p) => Math.min(derived.totalPages, p + 1))}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 active:scale-[0.99] disabled:opacity-60 transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <style jsx global>{`
          @keyframes menuIn {
            from { opacity: 0; transform: translateY(-6px) scale(0.98); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes modalIn {
            from { opacity: 0; transform: translateY(8px) scale(0.985); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes toastIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </main>
    </div>
  );
}