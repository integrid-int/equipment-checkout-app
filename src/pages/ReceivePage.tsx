/**
 * ReceivePage — receive items against a Halo PSA Purchase Order.
 *
 * Flow:
 *  1. Scan PO barcode or search by PO number / supplier
 *  2. See PO line items with expected quantities
 *  3. Enter received quantity per line (pre-filled with remaining)
 *  4. For serialized lines: enter one serial per unit received
 *  5. Confirm → increments stock + marks PO lines received + audit note
 */

import { useState, useCallback } from "react";
import BarcodeScanner from "../components/BarcodeScanner";
import { useRole } from "../context/RoleContext";

interface POLine {
  id: number;
  item_id: number;
  item_name: string;
  quantity: number;
  quantityreceived: number;
  unitprice: number;
  serialized: boolean;
}

interface PurchaseOrder {
  id: number;
  ponumber: string;
  supplier_name: string;
  status: string;
  dateraised: string;
  lines?: POLine[];
}

interface ReceiveEntry {
  line: POLine;
  quantityReceived: number;
  serialNumbers: string[];
}

export default function ReceivePage() {
  const { email } = useRole();

  const [scanning, setScanning] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [poResults, setPoResults] = useState<PurchaseOrder[]>([]);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [loadingLines, setLoadingLines] = useState(false);
  const [entries, setEntries] = useState<ReceiveEntry[]>([]);
  const [serialModal, setSerialModal] = useState<{ entryIndex: number; line: POLine } | null>(null);
  const [serialInput, setSerialInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const searchPOs = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    setPoResults([]);
    try {
      const res = await fetch(`/api/purchase-orders?search=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { purchaseOrders: PurchaseOrder[] };
      setPoResults(data.purchaseOrders);
      if (data.purchaseOrders.length === 0) setSearchError(`No open POs found for "${q}"`);
    } catch (err) {
      setSearchError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }, []);

  async function selectPO(po: PurchaseOrder) {
    setSelectedPO(po);
    setPoResults([]);
    setQuery("");
    setLoadingLines(true);
    try {
      const res = await fetch(`/api/purchase-orders?id=${po.id}`);
      const data = (await res.json()) as { po: PurchaseOrder };
      const lines = data.po.lines ?? [];
      setSelectedPO(data.po);
      // Pre-build entries with remaining qty
      setEntries(
        lines
          .filter((l) => l.quantity - (l.quantityreceived ?? 0) > 0)
          .map((l) => ({
            line: l,
            quantityReceived: l.quantity - (l.quantityreceived ?? 0),
            serialNumbers: [],
          }))
      );
    } catch (err) {
      showToast(`Failed to load PO lines: ${(err as Error).message}`, "error");
    } finally {
      setLoadingLines(false);
    }
  }

  function updateQty(index: number, qty: number) {
    setEntries((prev) =>
      prev.map((e, i) => {
        if (i !== index) return e;
        const max = e.line.quantity - (e.line.quantityreceived ?? 0);
        return { ...e, quantityReceived: Math.max(0, Math.min(max, qty)) };
      })
    );
  }

  function openSerialModal(index: number) {
    setSerialInput("");
    setSerialModal({ entryIndex: index, line: entries[index].line });
  }

  function addSerial() {
    if (!serialModal || !serialInput.trim()) return;
    const sn = serialInput.trim();
    setEntries((prev) =>
      prev.map((e, i) =>
        i === serialModal.entryIndex
          ? { ...e, serialNumbers: [...e.serialNumbers, sn] }
          : e
      )
    );
    setSerialInput("");
    // Close modal if we've collected enough serials
    const entry = entries[serialModal.entryIndex];
    if (entry.serialNumbers.length + 1 >= entry.quantityReceived) {
      setSerialModal(null);
    }
  }

  function removeSerial(entryIndex: number, snIndex: number) {
    setEntries((prev) =>
      prev.map((e, i) =>
        i === entryIndex
          ? { ...e, serialNumbers: e.serialNumbers.filter((_, j) => j !== snIndex) }
          : e
      )
    );
  }

  async function handleConfirmReceive() {
    if (!selectedPO) return;
    const linesToReceive = entries.filter((e) => e.quantityReceived > 0);
    if (linesToReceive.length === 0) return;

    // Validate serials for serialized items
    for (const e of linesToReceive) {
      if (e.line.serialized && e.serialNumbers.length < e.quantityReceived) {
        showToast(`Enter all serial numbers for "${e.line.item_name}" (${e.serialNumbers.length}/${e.quantityReceived})`, "error");
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          poId: selectedPO.id,
          receivedByEmail: email,
          lines: linesToReceive.map((e) => ({
            poLineId: e.line.id,
            itemId: e.line.item_id,
            itemName: e.line.item_name,
            quantityReceived: e.quantityReceived,
            serialNumbers: e.line.serialized ? e.serialNumbers : undefined,
          })),
        }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string; receivedCount?: number };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      showToast(`Received ${data.receivedCount} line(s) against PO #${selectedPO.ponumber}`);
      setSelectedPO(null);
      setEntries([]);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  const totalUnits = entries.reduce((s, e) => s + e.quantityReceived, 0);

  return (
    <div className="px-4 pt-4 pb-28 flex flex-col gap-4">

      {/* Header */}
      {!selectedPO && (
        <>
          <button
            onClick={() => setScanning(true)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-2xl py-5 flex flex-col items-center gap-1.5 shadow-md transition-all"
          >
            <span className="text-3xl">📬</span>
            <span className="font-semibold">Scan PO Barcode</span>
            <span className="text-emerald-100 text-xs">Scan the purchase order barcode</span>
          </button>

          <form
            onSubmit={(e) => { e.preventDefault(); searchPOs(query); }}
            className="flex gap-2"
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input flex-1"
              placeholder="PO number or supplier name…"
            />
            <button type="submit" className="btn-primary px-4" disabled={searching}>
              {searching ? "…" : "Find"}
            </button>
          </form>

          {searchError && (
            <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2">{searchError}</p>
          )}

          {searching && (
            <div className="flex flex-col gap-2">
              {[1, 2].map((i) => <div key={i} className="bg-white rounded-2xl h-20 animate-pulse border border-gray-100" />)}
            </div>
          )}

          {poResults.map((po) => (
            <button
              key={po.id}
              onClick={() => selectPO(po)}
              className="bg-white border border-gray-100 rounded-2xl p-4 text-left shadow-sm flex items-start gap-3 active:scale-[0.99] transition-all"
            >
              <div className="bg-emerald-100 text-emerald-700 font-bold rounded-xl px-2.5 py-1 text-sm shrink-0">
                {po.ponumber}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{po.supplier_name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{po.status} · {new Date(po.dateraised).toLocaleDateString()}</p>
              </div>
              <span className="text-gray-300 text-lg shrink-0">›</span>
            </button>
          ))}
        </>
      )}

      {/* PO selected — line items */}
      {selectedPO && (
        <>
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs text-emerald-600 font-medium">Receiving against</p>
              <p className="font-bold text-emerald-900">PO #{selectedPO.ponumber}</p>
              <p className="text-emerald-700 text-sm">{selectedPO.supplier_name}</p>
            </div>
            <button
              onClick={() => { setSelectedPO(null); setEntries([]); }}
              className="text-emerald-500 text-sm bg-emerald-100 rounded-xl px-3 py-1.5"
            >
              Change
            </button>
          </div>

          {loadingLines && (
            <div className="flex flex-col gap-2">
              {[1, 2, 3].map((i) => <div key={i} className="bg-white rounded-2xl h-20 animate-pulse border border-gray-100" />)}
            </div>
          )}

          {!loadingLines && entries.length === 0 && (
            <div className="text-center py-10 text-gray-400">
              <p className="text-3xl mb-2">✅</p>
              <p className="text-sm">All lines on this PO are fully received</p>
            </div>
          )}

          {!loadingLines && entries.map((entry, index) => {
            const remaining = entry.line.quantity - (entry.line.quantityreceived ?? 0);
            return (
              <div key={entry.line.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 truncate">{entry.line.item_name}</p>
                    <p className="text-xs text-gray-400">
                      Ordered: {entry.line.quantity} · Already received: {entry.line.quantityreceived ?? 0} · Remaining: {remaining}
                    </p>
                  </div>
                  {entry.line.serialized && (
                    <span className="text-xs bg-brand-50 text-brand-500 px-2 py-0.5 rounded-md ml-2 shrink-0">Serialized</span>
                  )}
                </div>

                {/* Qty control */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-24 shrink-0">Receiving:</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateQty(index, entry.quantityReceived - 1)} className="w-8 h-8 rounded-lg bg-gray-100 font-bold text-gray-600 flex items-center justify-center">−</button>
                    <input
                      type="number"
                      min={0}
                      max={remaining}
                      value={entry.quantityReceived}
                      onChange={(e) => updateQty(index, parseInt(e.target.value) || 0)}
                      className="w-14 text-center border border-gray-200 rounded-lg py-1 text-sm font-semibold"
                    />
                    <button onClick={() => updateQty(index, entry.quantityReceived + 1)} className="w-8 h-8 rounded-lg bg-gray-100 font-bold text-gray-600 flex items-center justify-center">+</button>
                  </div>
                </div>

                {/* Serial numbers for serialized items */}
                {entry.line.serialized && entry.quantityReceived > 0 && (
                  <div className="bg-brand-50 rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium text-brand-700">
                        Serial numbers ({entry.serialNumbers.length}/{entry.quantityReceived})
                      </p>
                      <button onClick={() => openSerialModal(index)} className="text-xs text-brand-500 font-medium">+ Add</button>
                    </div>
                    {entry.serialNumbers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {entry.serialNumbers.map((sn, j) => (
                          <span key={j} className="flex items-center gap-1 bg-white border border-brand-100 text-brand-700 text-xs font-mono rounded-lg px-2 py-0.5">
                            {sn}
                            <button onClick={() => removeSerial(index, j)} className="text-brand-300 ml-0.5">✕</button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* Confirm footer */}
      {selectedPO && entries.some((e) => e.quantityReceived > 0) && (
        <div className="fixed bottom-16 inset-x-0 px-4 pb-2 bg-gray-50/95 backdrop-blur border-t border-gray-100">
          <button
            onClick={handleConfirmReceive}
            disabled={submitting}
            className="w-full mt-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl py-3 min-h-[44px] transition-all disabled:opacity-50"
          >
            {submitting ? "Receiving…" : `Confirm Receipt (${totalUnits} unit${totalUnits !== 1 ? "s" : ""})`}
          </button>
        </div>
      )}

      {/* Serial input modal */}
      {serialModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 pb-safe-bottom shadow-xl">
            <h2 className="text-xl font-bold mb-1">Enter Serial Number</h2>
            <p className="text-gray-500 text-sm mb-1">{serialModal.line.item_name}</p>
            <p className="text-xs text-gray-400 mb-4">
              {entries[serialModal.entryIndex].serialNumbers.length} of {entries[serialModal.entryIndex].quantityReceived} entered
            </p>
            <form onSubmit={(e) => { e.preventDefault(); addSerial(); }}>
              <input
                type="text"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                className="input mb-4"
                placeholder="Scan or type serial number…"
                autoFocus
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setSerialModal(null)} className="btn-secondary flex-1">Done</button>
                <button type="submit" className="btn-primary flex-1">Add Serial</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {scanning && (
        <BarcodeScanner
          onResult={(code) => { setScanning(false); setQuery(code); searchPOs(code); }}
          onClose={() => setScanning(false)}
        />
      )}

      {toast && (
        <div className={`fixed bottom-24 inset-x-4 rounded-2xl py-3 px-4 text-center text-white font-medium shadow-lg z-50 ${toast.type === "success" ? "bg-green-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
