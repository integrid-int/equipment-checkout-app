/**
 * ReturnPage — technician returns unused items back to stock.
 *
 * Flow:
 *  1. Optionally link to a ticket (for audit trail)
 *  2. Scan items being returned
 *  3. Confirm quantities
 *  4. Submit → increments stock + notes on ticket
 */

import { useState, useCallback } from "react";
import BarcodeScanner from "../components/BarcodeScanner";
import type { HaloItem, HaloTicket, PullEntry } from "../types/halo";
import { useAuth } from "../hooks/useAuth";

export default function ReturnPage() {
  const { email } = useAuth();

  const [scanning, setScanning] = useState(false);
  const [returnList, setReturnList] = useState<PullEntry[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // Optional ticket link
  const [ticketQuery, setTicketQuery] = useState("");
  const [ticketSearching, setTicketSearching] = useState(false);
  const [ticketResults, setTicketResults] = useState<HaloTicket[]>([]);
  const [linkedTicket, setLinkedTicket] = useState<HaloTicket | null>(null);

  // Modal for quantity confirmation
  const [qtyModal, setQtyModal] = useState<{ item: HaloItem; serial?: string } | null>(null);
  const [qtyInput, setQtyInput] = useState("1");

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
      if (item.serialized) {
        // Serialized: auto-add with qty 1 and the scanned serial
        setReturnList((prev) => [...prev, { item, quantity: 1, serialNumber: item.serialnumber ?? code }]);
        showToast(`Added: ${item.name}`);
      } else {
        setQtyInput("1");
        setQtyModal({ item });
      }
    } catch (err) {
      setLookupError((err as Error).message);
    } finally {
      setLookingUp(false);
    }
  }, []);

  function confirmQty() {
    if (!qtyModal) return;
    const qty = parseInt(qtyInput, 10);
    if (!qty || qty < 1) return;
    setReturnList((prev) => {
      const existing = prev.find((e) => e.item.id === qtyModal.item.id && !e.serialNumber);
      if (existing) {
        return prev.map((e) =>
          e.item.id === qtyModal.item.id && !e.serialNumber ? { ...e, quantity: e.quantity + qty } : e
        );
      }
      return [...prev, { item: qtyModal.item, quantity: qty }];
    });
    showToast(`Added: ${qtyModal.item.name} × ${qty}`);
    setQtyModal(null);
  }

  async function searchTickets() {
    if (!ticketQuery.trim()) return;
    setTicketSearching(true);
    setTicketResults([]);
    try {
      const res = await fetch(`/api/tickets?search=${encodeURIComponent(ticketQuery)}`);
      const data = (await res.json()) as { tickets: HaloTicket[] };
      setTicketResults(data.tickets);
    } finally {
      setTicketSearching(false);
    }
  }

  async function handleSubmitReturn() {
    if (returnList.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: linkedTicket?.id,
          returnedByEmail: email,
          entries: returnList.map((e) => ({
            itemId: e.item.id,
            itemName: e.item.name,
            quantity: e.quantity,
            serialNumber: e.serialNumber,
          })),
        }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      showToast(`${returnList.length} item${returnList.length !== 1 ? "s" : ""} returned to stock`);
      setReturnList([]);
      setLinkedTicket(null);
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  const totalItems = returnList.reduce((s, e) => s + e.quantity, 0);

  return (
    <div className="px-4 pt-4 pb-28 flex flex-col gap-4">

      {/* Scan button */}
      <button
        onClick={() => setScanning(true)}
        disabled={lookingUp}
        className="w-full bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-2xl py-5 flex flex-col items-center gap-1.5 shadow-md transition-all"
      >
        <span className="text-3xl">↩️</span>
        <span className="font-semibold">{lookingUp ? "Looking up item…" : "Scan Item to Return"}</span>
        <span className="text-amber-100 text-xs">Scan barcode or serial number</span>
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

      {/* Return list */}
      {returnList.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-gray-700">Returning — {totalItems} item{totalItems !== 1 ? "s" : ""}</p>
          {returnList.map((entry, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-2xl p-3.5 flex items-center gap-3 shadow-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{entry.item.name}</p>
                {entry.serialNumber
                  ? <p className="text-xs text-gray-400 font-mono">SN: {entry.serialNumber}</p>
                  : <p className="text-xs text-gray-400">Qty: {entry.quantity}</p>
                }
              </div>
              <button
                onClick={() => setReturnList((prev) => prev.filter((_, j) => j !== i))}
                className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center shrink-0"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Optional ticket link */}
      {returnList.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <p className="text-sm font-semibold text-gray-700 mb-2">
            Link to ticket <span className="font-normal text-gray-400">(optional — for audit trail)</span>
          </p>
          {linkedTicket ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-brand-50 rounded-xl px-3 py-2">
                <p className="text-sm font-semibold text-brand-900">#{linkedTicket.id} — {linkedTicket.summary}</p>
                <p className="text-xs text-brand-500">{linkedTicket.client_name}</p>
              </div>
              <button onClick={() => setLinkedTicket(null)} className="text-gray-400 text-sm">Clear</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="search"
                  value={ticketQuery}
                  onChange={(e) => setTicketQuery(e.target.value)}
                  className="input flex-1"
                  placeholder="Ticket # or name…"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchTickets(); } }}
                />
                <button onClick={searchTickets} className="btn-secondary px-3" disabled={ticketSearching}>
                  {ticketSearching ? "…" : "Find"}
                </button>
              </div>
              {ticketResults.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { setLinkedTicket(t); setTicketResults([]); setTicketQuery(""); }}
                  className="text-left bg-gray-50 rounded-xl px-3 py-2 text-sm"
                >
                  <span className="font-semibold">#{t.id}</span> — {t.summary}
                  <span className="text-gray-400 ml-1">({t.client_name})</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {returnList.length === 0 && (
        <div className="text-center py-10 text-gray-300">
          <p className="text-4xl mb-2">↩️</p>
          <p className="text-sm">Scan items to return them to stock</p>
        </div>
      )}

      {/* Submit footer */}
      {returnList.length > 0 && (
        <div className="fixed bottom-16 inset-x-0 px-4 pb-2 bg-gray-50/95 backdrop-blur border-t border-gray-100">
          <button
            onClick={handleSubmitReturn}
            disabled={submitting}
            className="w-full mt-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl py-3 min-h-[44px] transition-all disabled:opacity-50"
          >
            {submitting ? "Returning…" : `Return to Stock (${totalItems} item${totalItems !== 1 ? "s" : ""})`}
          </button>
        </div>
      )}

      {scanning && <BarcodeScanner onResult={(code) => { setScanning(false); lookupItem(code); }} onClose={() => setScanning(false)} />}

      {/* Quantity modal */}
      {qtyModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 pb-safe-bottom shadow-xl">
            <h2 className="text-xl font-bold mb-1">Return Quantity</h2>
            <p className="text-gray-500 text-sm mb-4">{qtyModal.item.name}</p>
            <label className="label">How many are you returning?</label>
            <input
              type="number"
              min={1}
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              className="input mb-4 text-2xl text-center font-bold"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setQtyModal(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirmQty} className="w-full mt-2 bg-amber-500 text-white font-semibold rounded-xl py-3 flex-1">
                Add to Return List
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-24 inset-x-4 rounded-2xl py-3 px-4 text-center text-white font-medium shadow-lg z-50 ${toast.type === "success" ? "bg-green-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
