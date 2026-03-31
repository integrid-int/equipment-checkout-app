/**
 * StockPage — browse current inventory levels.
 * Useful for checking what's available before a deployment.
 */

import { useEffect, useState } from "react";
import type { HaloItem } from "../types/halo";
import { useDebounce } from "../hooks/useDebounce";

export default function StockPage() {
  const [items, setItems] = useState<HaloItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ page: String(page), pagesize: String(pageSize) });
    if (debouncedQuery) params.set("search", debouncedQuery);

    fetch(`/api/items?${params}`)
      .then((r) => r.json())
      .then((data: { items: HaloItem[]; total: number }) => {
        if (!cancelled) {
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
        }
      })
      .catch((err: Error) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [debouncedQuery, page]);

  useEffect(() => { setPage(1); }, [query]);

  const totalPages = Math.ceil(total / pageSize);

  function stockColor(count: number) {
    if (count === 0) return "bg-red-100 text-red-700";
    if (count <= 2) return "bg-amber-100 text-amber-700";
    return "bg-green-100 text-green-700";
  }

  return (
    <div className="px-4 pt-4 pb-24">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="input w-full mb-3"
        placeholder="Search stock items…"
      />

      {!loading && !error && (
        <p className="text-gray-400 text-xs mb-3">{total} item{total !== 1 ? "s" : ""}</p>
      )}

      {error && (
        <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2 mb-3">{error}</p>
      )}

      <div className="flex flex-col gap-2">
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl h-16 animate-pulse border border-gray-100" />
        ))}

        {!loading && items.map((item) => (
          <div key={item.id} className="bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-sm">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-900 truncate">{item.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {item.serialized && (
                  <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md">Serialized</span>
                )}
                {item.barcode && (
                  <span className="text-xs text-gray-400 font-mono">{item.barcode}</span>
                )}
              </div>
            </div>
            <span className={`shrink-0 text-sm font-bold px-2.5 py-1 rounded-xl ${stockColor(item.count)}`}>
              {item.count}
            </span>
          </div>
        ))}

        {!loading && items.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <p className="text-3xl mb-2">🗄️</p>
            <p className="text-sm">No items found</p>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-3 mt-6">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-4 disabled:opacity-40">← Prev</button>
          <span className="flex items-center text-sm text-gray-500">{page} / {totalPages}</span>
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary px-4 disabled:opacity-40">Next →</button>
        </div>
      )}
    </div>
  );
}
