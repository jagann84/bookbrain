export const dynamic = "force-dynamic";

type Book = {
  id: string;
  name: string;
  author: string;
  domain: string;
  status: string;
  review: string;
};

async function getBooks(): Promise<Book[]> {
  const res = await fetch("http://localhost:3000/api/books", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Failed to fetch books");
  const data = await res.json();
  return data.books as Book[];
}

export default async function Home() {
  const books = await getBooks();

  const total = books.length;

  const unread = books.filter(
    (b) => b.status?.toLowerCase() !== "read"
  );

  const domainCounts: Record<string, number> = {};
  books.forEach((b) => {
    const d = b.domain || "Uncategorized";
    domainCounts[d] = (domainCounts[d] || 0) + 1;
  });

  const topRatedUnread = unread
    .filter((b) => b.review && Number(b.review) > 0)
    .sort((a, b) => Number(b.review) - Number(a.review))
    .slice(0, 5);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>BookBrain Dashboard</h1>

      <div style={{ marginTop: 24 }}>
        <div>Total Books: {total}</div>
        <div>Unread Books: {unread.length}</div>
      </div>

      <div style={{ marginTop: 24 }}>
        <h2>Books by Domain</h2>
        <ul>
          {Object.entries(domainCounts).map(([domain, count]) => (
            <li key={domain}>
              {domain}: {count}
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 24 }}>
        <h2>Top Rated Unread</h2>
        {topRatedUnread.length === 0 && <div>No rated unread books yet.</div>}
        {topRatedUnread.map((b) => (
          <div key={b.id} style={{ marginTop: 8 }}>
            <strong>{b.name}</strong> — {b.review}
          </div>
        ))}
      </div>
    </main>
  );
}