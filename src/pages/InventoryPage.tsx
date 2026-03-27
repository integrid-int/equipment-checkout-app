/**
 * InventoryPage — searchable list of all assets.
 * Technicians can browse and check out/in without scanning.
 */

import { useEffect, useState } from "react";
import { useAssets } from "../hooks/useAssets";
import AssetCard from "../components/AssetCard";
import CheckoutModal from "../components/CheckoutModal";
import CheckinModal from "../components/CheckinModal";
import type { HaloAsset } from "../types/halo";
import { useAuth } from "../hooks/useAuth";

export default function InventoryPage() {
  const { email } = useAuth();
  const { assets, total, loading, error, search } = useAssets();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [checkoutAsset, setCheckoutAsset] = useState<HaloAsset | null>(null);
  const [checkinAsset, setCheckinAsset] = useState<HaloAsset | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  useEffect(() => {
    search(query, page);
  }, [query, page, search]);

  // Reset page when query changes
  useEffect(() => { setPage(1); }, [query]);

  async function handleCheckout(checkedOutTo: string, notes: string) {
    if (!checkoutAsset) return;
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: checkoutAsset.id, checkedOutTo, checkedOutByEmail: email, notes }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    showToast(`${checkoutAsset.assettype_name} checked out to ${checkedOutTo}`);
    setCheckoutAsset(null);
    search(query, page);
  }

  async function handleCheckin(notes: string) {
    if (!checkinAsset) return;
    const res = await fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: checkinAsset.id, returnedByEmail: email, notes }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    showToast(`${checkinAsset.assettype_name} checked in`);
    setCheckinAsset(null);
    search(query, page);
  }

  const pageSize = 25;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="px-4 pt-4 pb-24">
      {/* Search bar */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="input w-full mb-4"
        placeholder="Search assets…"
      />

      {/* Status */}
      {!loading && !error && (
        <p className="text-gray-400 text-xs mb-3">
          {total > 0 ? `${total} asset${total !== 1 ? "s" : ""}` : "No assets found"}
        </p>
      )}
      {error && (
        <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2 mb-3">{error}</p>
      )}

      {/* List */}
      <div className="flex flex-col gap-3">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl h-28 animate-pulse border border-gray-100" />
        ))}
        {!loading && assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            onCheckout={setCheckoutAsset}
            onCheckin={setCheckinAsset}
          />
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-3 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="btn-secondary px-4 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="flex items-center text-sm text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="btn-secondary px-4 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {/* Modals */}
      {checkoutAsset && (
        <CheckoutModal
          asset={checkoutAsset}
          onConfirm={handleCheckout}
          onClose={() => setCheckoutAsset(null)}
        />
      )}
      {checkinAsset && (
        <CheckinModal
          asset={checkinAsset}
          onConfirm={handleCheckin}
          onClose={() => setCheckinAsset(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 inset-x-4 rounded-2xl py-3 px-4 text-center bg-green-600 text-white font-medium shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
