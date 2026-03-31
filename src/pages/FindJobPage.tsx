/**
 * FindJobPage — Step 1 of the pull kit workflow.
 * Technician scans or searches for their Halo ticket/job,
 * then taps "Start Pull" to begin scanning items.
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import BarcodeScanner from "../components/BarcodeScanner";
import { useActiveJob } from "../context/ActiveJobContext";
import type { HaloTicket, TicketAttachedItem } from "../types/halo";

export default function FindJobPage() {
  const navigate = useNavigate();
  const { ticket: activeTicket, setTicket, clearJob, pullList } = useActiveJob();

  const [scanning, setScanning] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectingTicketId, setSelectingTicketId] = useState<number | null>(null);
  const [results, setResults] = useState<HaloTicket[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const hydrateTicketAttachedItems = useCallback(async (ticket: HaloTicket): Promise<HaloTicket> => {
    // Always re-fetch by numeric ID so attached items are present even when the
    // user selected this ticket from a non-numeric search result payload.
    let sourceTicket = ticket;
    try {
      const detailRes = await fetch(`/api/tickets?search=${encodeURIComponent(String(ticket.id))}`);
      if (detailRes.ok) {
        const detailData = (await detailRes.json()) as { tickets?: HaloTicket[] };
        const exact = (detailData.tickets ?? []).find((t) => t.id === ticket.id);
        if (exact) sourceTicket = exact;
      }
    } catch {
      // Keep fallback behavior with the selected ticket object.
    }

    const attached = sourceTicket.attachedItems ?? [];
    if (attached.length === 0) {
      return { ...sourceTicket, attachedItems: [] };
    }

    const enriched = await Promise.all(
      attached.map(async (item): Promise<TicketAttachedItem> => {
        try {
          const res = await fetch(`/api/items?id=${item.itemId}`);
          if (!res.ok) return item;
          const data = (await res.json()) as {
            items: Array<{
              count?: number;
              serialized?: boolean;
              serialnumber?: string;
              stockTracked?: boolean;
            }>;
          };
          const found = data.items?.[0];
          if (!found) return item;
          return {
            ...item,
            currentStock: typeof found.count === "number" ? found.count : item.currentStock,
            serialized:
              typeof found.serialized === "boolean"
                ? found.serialized
                : item.serialized,
            stockTracked:
              typeof found.stockTracked === "boolean"
                ? found.stockTracked
                : item.stockTracked,
            serialNumber: found.serialnumber ?? item.serialNumber,
          };
        } catch {
          return item;
        }
      })
    );

    return { ...sourceTicket, attachedItems: enriched };
  }, []);

  const searchTickets = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    setError(null);
    setResults([]);
    try {
      const res = await fetch(`/api/tickets?search=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tickets: HaloTicket[] };
      setResults(data.tickets);
      if (data.tickets.length === 0) setError(`No open tickets found for "${q}"`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }, []);

  function handleBarcode(code: string) {
    setScanning(false);
    setQuery(code);
    searchTickets(code);
  }

  async function selectTicket(t: HaloTicket) {
    setSelectingTicketId(t.id);
    try {
      const latestRes = await fetch(`/api/tickets?search=${encodeURIComponent(String(t.id))}`);
      const latestData = latestRes.ok
        ? ((await latestRes.json()) as { tickets: HaloTicket[] })
        : null;
      const latestTicket = latestData?.tickets?.find((ticket) => ticket.id === t.id) ?? t;
      const hydratedTicket = await hydrateTicketAttachedItems(latestTicket);
      setTicket(hydratedTicket, { seedFromAttachedItems: true });
      setResults([]);
      setQuery("");
      setError(null);
    } finally {
      setSelectingTicketId(null);
    }
  }

  function handleStartPull() {
    navigate("/pull");
  }

  return (
    <div className="px-4 pt-5 pb-24 flex flex-col gap-5">

      {/* Active job banner */}
      {activeTicket && (
        <div className="bg-brand-500 rounded-2xl p-4 text-white">
          <p className="text-xs text-brand-100 mb-0.5">Active Job</p>
          <p className="font-bold text-lg leading-tight">#{activeTicket.id} — {activeTicket.summary}</p>
          <p className="text-brand-100 text-sm mt-1">
            {[activeTicket.client_name, activeTicket.site_name].filter(Boolean).join(" · ")}
          </p>
          {pullList.length > 0 && (
            <p className="text-brand-50 text-xs mt-2">
              {pullList.length} item{pullList.length !== 1 ? "s" : ""} in pull list
            </p>
          )}
          <div className="flex gap-2 mt-3">
            <button onClick={handleStartPull} className="flex-1 bg-white text-brand-600 font-semibold rounded-lg py-2.5 text-sm">
              Continue Pull →
            </button>
            <button
              onClick={() => { if (confirm("Clear active job and pull list?")) clearJob(); }}
              className="bg-white/20 text-white rounded-lg px-3 py-2.5 text-sm"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Scan / search controls */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => setScanning(true)}
          className="w-full bg-brand-500 hover:bg-brand-600 active:scale-95 text-white rounded-2xl py-5 flex flex-col items-center gap-1.5 shadow-md transition-all"
        >
          <span className="text-3xl">✦</span>
          <span className="font-semibold">Scan Job Barcode</span>
          <span className="text-brand-100 text-xs">Scan ticket QR or barcode</span>
        </button>

        <div className="relative">
          <div className="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none text-gray-400 text-sm">or</div>
          <form
            onSubmit={(e) => { e.preventDefault(); searchTickets(query); }}
            className="flex gap-2"
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="input flex-1 pl-10"
              placeholder="Ticket #, job name, or client…"
            />
            <button type="submit" className="btn-primary px-4" disabled={searching}>
              {searching ? "…" : "Search"}
            </button>
          </form>
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="text-red-600 text-sm bg-red-50 rounded-xl px-3 py-2">{error}</p>
      )}

      {/* Searching skeleton */}
      {searching && (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <div key={i} className="bg-white rounded-2xl h-20 animate-pulse border border-gray-100" />
          ))}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-gray-400">{results.length} ticket{results.length !== 1 ? "s" : ""} found</p>
          {results.map((t) => (
            <button
              key={t.id}
              onClick={() => selectTicket(t)}
              disabled={selectingTicketId === t.id}
              className="bg-white border border-gray-100 rounded-2xl p-4 text-left shadow-sm flex items-start gap-3 active:scale-[0.99] transition-all"
            >
              <div className="bg-brand-100 text-brand-600 font-bold rounded-xl px-2.5 py-1 text-sm shrink-0">
                #{t.id}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 leading-tight">{t.summary}</p>
                <p className="text-sm text-gray-500 truncate mt-0.5">
                  {[t.client_name, t.site_name].filter(Boolean).join(" · ")}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{t.status_name} · {t.agent_name}</p>
              </div>
              <span className="text-gray-300 text-lg shrink-0">
                {selectingTicketId === t.id ? "…" : "›"}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Ticket selected confirmation */}
      {activeTicket && results.length === 0 && !error && !searching && (
        <div className="text-center py-4 text-gray-400 text-sm">
          Tap <strong>Continue Pull</strong> above to start scanning items.
        </div>
      )}

      {scanning && (
        <BarcodeScanner onResult={handleBarcode} onClose={() => setScanning(false)} />
      )}
    </div>
  );
}
