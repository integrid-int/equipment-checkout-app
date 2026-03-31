/**
 * PullKitPage — Step 2: scan items into the pull list.
 *
 * Flow:
 *  1. Scan item barcode or serial number → look up in Halo stock
 *  2a. Serialized item → confirm serial, add to list (qty 1)
 *  2b. Non-serialized item → prompt for quantity, add to list
 *  3. Review list → "Confirm Pull" → posts to API → success
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BarcodeScanner from "../components/BarcodeScanner";
import { useActiveJob } from "../context/ActiveJobContext";
import type { HaloItem, PullEntry } from "../types/halo";
import { useAuth } from "../hooks/useAuth";

type Modal =
  | { type: "serial"; item: HaloItem }
  | { type: "quantity"; item: HaloItem }
  | null;

export default function PullKitPage() {
  const navigate = useNavigate();
  const { email } = useAuth();
  const { ticket, pullList, addEntry, updateEntryQty, removeEntry, clearPullList, clearJob } = useActiveJob();

  const [scanning, setScanning] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [qtyInput, setQtyInput] = useState("1");
  const [serialInput, setSerialInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const lookupItem = useCallback(async (code: string) => {
    setLookingUp(true);
    setLookupError(null);
    try {
      const res = await fetch(`/api/items?search=${encodeURIComponent(code)}&pagesize=1`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: HaloItem[] };

      if (data.items.length === 0) {
        setLookupError(`No item found for "${code}"`);
        return;
      }

      const item = data.items[0];

      if (item.count <= 0) {
        setLookupError(`"${item.name}" is out of stock`);
        return;
      }

      if (item.serialized) {
        setSerialInput(item.serialnumber ?? code);
        setModal({ type: "serial", item });
      } else {
        setQtyInput("1");
        setModal({ type: "quantity", item });
      }
    } catch (err) {
      setLookupError((err as Error).message);
    } finally {
      setLookingUp(false);
    }
  }, []);

  function handleBarcode(code: string) {
    setScanning(false);
    lookupItem(code);
  }

  function confirmSerial() {
    if (!modal || modal.type !== "serial") return;
    addEntry({ item: modal.item, quantity: 1, serialNumber: serialInput.trim() });
    showToast(`Added: ${modal.item.name}`);
    setModal(null);
  }

  function confirmQty() {
    if (!modal || modal.type !== "quantity") return;
    const qty = parseInt(qtyInput, 10);
    if (!qty || qty < 1) return;
    if (qty > modal.item.count) {
      showToast(`Only ${modal.item.count} in stock`, "error");
      return;
    }
    addEntry({ item: modal.item, quantity: qty });
    showToast(`Added: ${modal.item.name} × ${qty}`);
    setModal(null);
  }

  async function handleConfirmPull() {
    if (!ticket || pullList.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.id,
          pulledByEmail: email,
          entries: pullList.map((e) => ({
            itemId: e.item.id,
            itemName: e.item.name,
            quantity: e.quantity,
            serialNumber: e.serialNumber,
          })),
        }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string; errors?: string[] };

      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      if (data.errors?.length) {
        showToast(`Pulled with ${data.errors.length} error(s) — check stock`, "error");
      } else {
        showToast(`Kit pulled for #${ticket.id}!`);
      }

      clearJob();
      navigate("/job");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  const totalItems = pullList.reduce((s, e) => s + e.quantity, 0);

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <span className="text-5xl">🎫</span>
        <p className="font-semibold text-gray-700">No active job</p>
        <p className="text-gray-400 text-sm">Go to the Job tab to find and select a ticket first.</p>
        <button onClick={() => navigate("/job")} className="btn-primary mt-2">Find a Job</button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-28 flex flex-col gap-4">

      {/* Ticket header */}
      <div className="bg-brand-50 border border-brand-100 rounded-2xl px-4 py-3">
        <p className="text-xs text-brand-500 font-medium">Pulling kit for</p>
        <p className="font-bold text-brand-900">#{ticket.id} — {ticket.summary}</p>
        <p className="text-brand-600 text-sm">{ticket.client_name}</p>
      </div>

      {/* Scan button */}
      <button
        onClick={() => setScanning(true)}
        disabled={lookingUp}
        className="w-full bg-brand-600 hover:bg-brand-700 active:scale-95 text-white rounded-2xl py-5 flex flex-col items-center gap-1.5 shadow-md transition-all disabled:opacity-60"
      >
        <span className="text-3xl">📦</span>
        <span className="font-semibold">{lookingUp ? "Looking up item…" : "Scan Item"}</span>
        <span className="text-blue-200 text-xs">Scan barcode or serial number</span>
      </button>

      {/* Manual search */}
      <form
        onSubmit={(e) => { e.preventDefault(); const input = e.currentTarget.elements.namedItem("q"); if (input instanceof HTMLInputElement) { const q = input.value.trim(); if (q) lookupItem(q); } }}
        className="flex gap-2"
      >
        <input name="q" type="search" className="input flex-1" placeholder="Search item by name…" />
        <button type="submit" className="btn-secondary px-4">Add</button>
      </form>

      {lookupError && (
        <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2">{lookupError}</p>
      )}

      {/* Pull list */}
      {pullList.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-700">Pull List — {totalItems} item{totalItems !== 1 ? "s" : ""}</p>
            <button onClick={() => { if (confirm("Clear pull list?")) clearPullList(); }} className="text-xs text-red-400">
              Clear all
            </button>
          </div>

          {pullList.map((entry) => (
            <div key={entry.item.id + (entry.serialNumber ?? "")} className="bg-white border border-gray-100 rounded-2xl p-3.5 flex items-center gap-3 shadow-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{entry.item.name}</p>
                {entry.serialNumber ? (
                  <p className="text-xs text-gray-400 font-mono">SN: {entry.serialNumber}</p>
                ) : (
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() => updateEntryQty(entry.item.id, Math.max(1, entry.quantity - 1))}
                      className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 font-bold flex items-center justify-center"
                    >−</button>
                    <span className="text-sm font-semibold w-6 text-center">{entry.quantity}</span>
                    <button
                      onClick={() => updateEntryQty(entry.item.id, Math.min(entry.item.count, entry.quantity + 1))}
                      className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 font-bold flex items-center justify-center"
                    >+</button>
                    <span className="text-xs text-gray-400 ml-1">(stock: {entry.item.count})</span>
                  </div>
                )}
              </div>
              <button
                onClick={() => removeEntry(entry.item.id)}
                className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center shrink-0"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {pullList.length === 0 && (
        <div className="text-center py-10 text-gray-300">
          <p className="text-4xl mb-2">📭</p>
          <p className="text-sm">No items yet — scan something</p>
        </div>
      )}

      {/* Confirm pull — sticky footer */}
      {pullList.length > 0 && (
        <div className="fixed bottom-16 inset-x-0 px-4 pb-2 bg-gray-50/95 backdrop-blur border-t border-gray-100">
          <button
            onClick={handleConfirmPull}
            disabled={submitting}
            className="btn-primary w-full mt-2 disabled:opacity-50"
          >
            {submitting ? "Pulling…" : `Confirm Pull (${totalItems} item${totalItems !== 1 ? "s" : ""})`}
          </button>
        </div>
      )}

      {/* Scanner */}
      {scanning && <BarcodeScanner onResult={handleBarcode} onClose={() => setScanning(false)} />}

      {/* Serial number modal */}
      {modal?.type === "serial" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 pb-safe-bottom shadow-xl">
            <h2 className="text-xl font-bold mb-1">Serialized Item</h2>
            <p className="text-gray-500 text-sm mb-4">{modal.item.name}</p>
            <label className="label">Confirm serial number</label>
            <input
              type="text"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              className="input mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirmSerial} className="btn-primary flex-1">Add to Pull List</button>
            </div>
          </div>
        </div>
      )}

      {/* Quantity modal */}
      {modal?.type === "quantity" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 pb-safe-bottom shadow-xl">
            <h2 className="text-xl font-bold mb-1">Add Item</h2>
            <p className="text-gray-500 text-sm mb-1">{modal.item.name}</p>
            <p className="text-xs text-gray-400 mb-4">{modal.item.count} in stock</p>
            <label className="label">Quantity</label>
            <input
              type="number"
              min={1}
              max={modal.item.count}
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              className="input mb-4 text-2xl text-center font-bold"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirmQty} className="btn-primary flex-1">Add to Pull List</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 inset-x-4 rounded-2xl py-3 px-4 text-center text-white font-medium shadow-lg z-50 ${toast.type === "success" ? "bg-green-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
