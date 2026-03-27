/**
 * CheckedOutPage — shows all items currently checked out.
 * Useful for the equipment room manager to see what's out.
 */

import { useEffect, useState } from "react";
import { useCheckedOutAssets } from "../hooks/useAssets";
import AssetCard from "../components/AssetCard";
import CheckinModal from "../components/CheckinModal";
import type { HaloAsset } from "../types/halo";
import { useAuth } from "../hooks/useAuth";

export default function CheckedOutPage() {
  const { email } = useAuth();
  const { assets, loading, error, refresh } = useCheckedOutAssets();
  const [checkinAsset, setCheckinAsset] = useState<HaloAsset | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { refresh(); }, [refresh]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
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
    refresh();
  }

  return (
    <div className="px-4 pt-4 pb-24">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-gray-900">
          Currently Out
          {assets.length > 0 && (
            <span className="ml-2 text-sm font-normal text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">
              {assets.length}
            </span>
          )}
        </h1>
        <button onClick={refresh} className="btn-secondary text-sm px-3 py-1.5">
          Refresh
        </button>
      </div>

      {error && (
        <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2 mb-3">{error}</p>
      )}

      <div className="flex flex-col gap-3">
        {loading && Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl h-28 animate-pulse border border-gray-100" />
        ))}

        {!loading && assets.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-3">✅</p>
            <p className="font-medium">All equipment is in</p>
          </div>
        )}

        {!loading && assets.map((asset) => (
          <AssetCard
            key={asset.id}
            asset={asset}
            onCheckin={setCheckinAsset}
          />
        ))}
      </div>

      {checkinAsset && (
        <CheckinModal
          asset={checkinAsset}
          onConfirm={handleCheckin}
          onClose={() => setCheckinAsset(null)}
        />
      )}

      {toast && (
        <div className="fixed bottom-24 inset-x-4 rounded-2xl py-3 px-4 text-center bg-green-600 text-white font-medium shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
