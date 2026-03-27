/**
 * ScanPage — primary kiosk view.
 * 1. Tap "Scan Barcode" → camera opens
 * 2. Camera decodes barcode → searches Halo for matching asset
 * 3. Asset found → shows AssetCard with checkout/checkin action
 */

import { useState, useCallback } from "react";
import BarcodeScanner from "../components/BarcodeScanner";
import AssetCard from "../components/AssetCard";
import CheckoutModal from "../components/CheckoutModal";
import CheckinModal from "../components/CheckinModal";
import type { HaloAsset } from "../types/halo";
import { useAuth } from "../hooks/useAuth";

type View = "idle" | "scanning" | "result" | "checkout" | "checkin";

export default function ScanPage() {
  const { email } = useAuth();
  const [view, setView] = useState<View>("idle");
  const [asset, setAsset] = useState<HaloAsset | null>(null);
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [lastBarcode, setLastBarcode] = useState("");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const handleBarcode = useCallback(async (barcode: string) => {
    setView("idle");
    setLastBarcode(barcode);
    setSearching(true);
    setNotFound(false);
    setAsset(null);

    try {
      const res = await fetch(`/api/assets?search=${encodeURIComponent(barcode)}&pagesize=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { assets: HaloAsset[] };

      if (data.assets.length > 0) {
        setAsset(data.assets[0]);
        setView("result");
      } else {
        setNotFound(true);
      }
    } catch (err) {
      showToast(`Search failed: ${(err as Error).message}`, "error");
    } finally {
      setSearching(false);
    }
  }, []);

  async function handleCheckout(checkedOutTo: string, notes: string) {
    if (!asset) return;
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: asset.id, checkedOutTo, checkedOutByEmail: email, notes }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    showToast(`${asset.assettype_name} checked out to ${checkedOutTo}`);
    setView("idle");
    setAsset(null);
  }

  async function handleCheckin(notes: string) {
    if (!asset) return;
    const res = await fetch("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetId: asset.id, returnedByEmail: email, notes }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    showToast(`${asset.assettype_name} checked in`);
    setView("idle");
    setAsset(null);
  }

  return (
    <div className="flex flex-col items-center justify-start px-4 pt-6 pb-24 min-h-full gap-6">
      {/* Scan button */}
      <button
        onClick={() => setView("scanning")}
        className="w-full max-w-sm bg-brand-600 hover:bg-brand-700 active:scale-95 text-white rounded-2xl py-6 flex flex-col items-center gap-2 shadow-lg transition-all"
        disabled={searching}
      >
        <span className="text-4xl">⬛</span>
        <span className="text-lg font-semibold">Scan Barcode</span>
        <span className="text-blue-200 text-sm">Tap to open camera</span>
      </button>

      {/* Manual search */}
      <div className="w-full max-w-sm">
        <p className="text-gray-400 text-xs text-center mb-2">or search manually</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const q = (e.currentTarget.elements.namedItem("q") as HTMLInputElement).value.trim();
            if (q) handleBarcode(q);
          }}
          className="flex gap-2"
        >
          <input name="q" type="search" className="input flex-1" placeholder="Barcode, serial, or name…" />
          <button type="submit" className="btn-primary px-4">Go</button>
        </form>
      </div>

      {/* Searching spinner */}
      {searching && (
        <div className="flex flex-col items-center gap-2 text-gray-500">
          <div className="w-8 h-8 border-4 border-gray-200 border-t-brand-500 rounded-full animate-spin" />
          <p className="text-sm">Looking up "{lastBarcode}"…</p>
        </div>
      )}

      {/* Not found */}
      {notFound && !searching && (
        <div className="w-full max-w-sm bg-white border border-gray-100 rounded-2xl p-5 text-center shadow-sm">
          <p className="text-2xl mb-2">🔍</p>
          <p className="font-semibold text-gray-800">No asset found</p>
          <p className="text-sm text-gray-500 mt-1">
            "{lastBarcode}" didn't match any inventory in Halo PSA.
          </p>
        </div>
      )}

      {/* Asset result */}
      {view === "result" && asset && (
        <div className="w-full max-w-sm">
          <AssetCard
            asset={asset}
            onCheckout={() => setView("checkout")}
            onCheckin={() => setView("checkin")}
          />
        </div>
      )}

      {/* Scanner overlay */}
      {view === "scanning" && (
        <BarcodeScanner onResult={handleBarcode} onClose={() => setView("idle")} />
      )}

      {/* Checkout modal */}
      {view === "checkout" && asset && (
        <CheckoutModal
          asset={asset}
          onConfirm={handleCheckout}
          onClose={() => setView("result")}
        />
      )}

      {/* Checkin modal */}
      {view === "checkin" && asset && (
        <CheckinModal
          asset={asset}
          onConfirm={handleCheckin}
          onClose={() => setView("result")}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-24 inset-x-4 rounded-2xl py-3 px-4 text-center text-white font-medium shadow-lg transition-all z-50 ${
            toast.type === "success" ? "bg-green-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
