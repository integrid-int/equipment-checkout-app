/**
 * ReturnPage — technician returns items against the active job ticket.
 *
 * Mirrors PullKit behavior:
 *  1. Active ticket is required
 *  2. Serialized items require one serial capture per unit
 *  3. Confirm return is blocked until serialized lines are valid
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import BarcodeScanner from "../components/BarcodeScanner";
import type { HaloItem, PullEntry, TicketAttachedItem } from "../types/halo";
import { useAuth } from "../hooks/useAuth";
import { useActiveJob } from "../context/ActiveJobContext";

type Modal =
  | { type: "serial"; item: HaloItem }
  | { type: "quantity"; item: HaloItem }
  | null;

interface SerialScanSession {
  item: HaloItem;
  requiredCount: number;
  scannedSerials: string[];
}

function toReturnEntries(attachedItems: TicketAttachedItem[] | undefined): PullEntry[] {
  if (!attachedItems?.length) return [];
  return attachedItems
    .filter((item) => item.itemId > 0 && item.quantity > 0)
    .map((item) => ({
      item: {
        id: item.itemId,
        name: item.itemName,
        count:
          typeof item.currentStock === "number"
            ? Math.max(item.currentStock, item.quantity)
            : item.quantity,
        serialized: Boolean(item.serialized),
        stockTracked: item.stockTracked,
        serialnumber: item.serialNumber,
      },
      quantity: item.quantity,
      serialNumber: item.serialNumber,
    }));
}

export default function ReturnPage() {
  const navigate = useNavigate();
  const { email } = useAuth();
  const { ticket, clearJob } = useActiveJob();

  const [scanning, setScanning] = useState(false);
  const [returnList, setReturnList] = useState<PullEntry[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [modal, setModal] = useState<Modal>(null);
  const [qtyInput, setQtyInput] = useState("1");
  const [serialInput, setSerialInput] = useState("");
  const [serialSession, setSerialSession] = useState<SerialScanSession | null>(null);
  const [serialScannerOpen, setSerialScannerOpen] = useState(false);
  const serialCommitInFlight = useRef(false);
  const seededTicketIdRef = useRef<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  useEffect(() => {
    if (!ticket) {
      seededTicketIdRef.current = null;
      setReturnList([]);
      return;
    }
    if (seededTicketIdRef.current === ticket.id) return;
    seededTicketIdRef.current = ticket.id;
    setReturnList(toReturnEntries(ticket.attachedItems));
  }, [ticket]);

  function addReturnEntry(entry: PullEntry) {
    setReturnList((prev) => {
      const serial = entry.serialNumber?.trim();
      if (serial) {
        const exists = prev.some(
          (e) =>
            e.item.id === entry.item.id &&
            e.serialNumber?.trim().toLowerCase() === serial.toLowerCase()
        );
        if (exists) return prev;
        return [...prev, entry];
      }

      const existing = prev.find((e) => e.item.id === entry.item.id && !e.serialNumber);
      if (existing) {
        return prev.map((e) =>
          e.item.id === entry.item.id && !e.serialNumber
            ? { ...e, quantity: e.quantity + entry.quantity }
            : e
        );
      }
      return [...prev, entry];
    });
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
        setQtyInput("1");
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

  function confirmSerialQty() {
    if (!modal || modal.type !== "serial") return;
    const qty = parseInt(qtyInput, 10);
    if (!qty || qty < 1) {
      showToast("Enter a valid quantity", "error");
      return;
    }
    setSerialSession({
      item: modal.item,
      requiredCount: qty,
      scannedSerials: [],
    });
    setSerialScannerOpen(true);
    setModal(null);
  }

  function handleSerializedBarcode(code: string) {
    if (serialCommitInFlight.current) return;
    serialCommitInFlight.current = true;
    setSerialSession((session) => {
      if (!session) return session;

      const serial = code.trim();
      if (!serial) return session;
      if (session.scannedSerials.includes(serial)) {
        showToast(`Serial already scanned: ${serial}`, "error");
        return session;
      }
      if (returnList.some((e) => e.item.id === session.item.id && e.serialNumber === serial)) {
        showToast(`Serial already in return list: ${serial}`, "error");
        return session;
      }

      addReturnEntry({ item: session.item, quantity: 1, serialNumber: serial });
      setSerialInput("");

      const nextSerials = [...session.scannedSerials, serial];
      if (nextSerials.length >= session.requiredCount) {
        setSerialScannerOpen(false);
        showToast(
          `Added return serials: ${session.item.name} (${nextSerials.length})`
        );
        return null;
      }

      return { ...session, scannedSerials: nextSerials };
    });
    setTimeout(() => {
      serialCommitInFlight.current = false;
    }, 0);
  }

  function confirmQty() {
    if (!modal || modal.type !== "quantity") return;
    const qty = parseInt(qtyInput, 10);
    if (!qty || qty < 1) return;
    addReturnEntry({ item: modal.item, quantity: qty });
    showToast(`Added: ${modal.item.name} × ${qty}`);
    setModal(null);
  }

  function hasInvalidSerializedEntries(): boolean {
    return returnList.some(
      (e) => e.item.serialized && (!e.serialNumber?.trim() || e.quantity !== 1)
    );
  }

  function convertSerializedLineToScanSession(entry: PullEntry, index: number) {
    if (entry.quantity < 1 || entry.serialNumber) return;
    setSerialSession({
      item: entry.item,
      requiredCount: entry.quantity,
      scannedSerials: [],
    });
    setReturnList((prev) => prev.filter((_, i) => i !== index));
    setSerialScannerOpen(true);
  }

  async function handleSubmitReturn() {
    if (!ticket || returnList.length === 0) return;
    if (serialSession) {
      showToast("Finish scanning serialized return items before confirming", "error");
      return;
    }
    if (hasInvalidSerializedEntries()) {
      showToast("Serialized returns require serial scans for each quantity", "error");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId: ticket.id,
          returnedByEmail: email,
          entries: returnList.map((e) => ({
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
        showToast(`Returned with ${data.errors.length} error(s)`, "error");
      } else {
        showToast(`Returned for #${ticket.id}`);
      }

      clearJob();
      navigate("/job");
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  const totalItems = returnList.reduce((s, e) => s + e.quantity, 0);

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
        <span className="text-5xl">⟲</span>
        <p className="font-semibold text-gray-700">No active job</p>
        <p className="text-gray-400 text-sm">Go to the Job tab to select a ticket before returning items.</p>
        <button onClick={() => navigate("/job")} className="btn-primary mt-2">Find a Job</button>
      </div>
    );
  }

  return (
    <div className="px-4 pt-4 pb-28 flex flex-col gap-4">
      <div className="bg-amber-50 border border-amber-100 rounded-2xl px-4 py-3">
        <p className="text-xs text-amber-600 font-medium">Returning against</p>
        <p className="font-bold text-amber-900">#{ticket.id} — {ticket.summary}</p>
        <p className="text-amber-600 text-sm">{ticket.client_name}</p>
      </div>

      <button
        onClick={() => setScanning(true)}
        disabled={lookingUp || Boolean(serialSession)}
        className="w-full bg-amber-500 hover:bg-amber-600 active:scale-95 text-white rounded-2xl py-5 flex flex-col items-center gap-1.5 shadow-md transition-all disabled:opacity-60"
      >
        <span className="text-3xl">⟲</span>
        <span className="font-semibold">{lookingUp ? "Looking up item…" : "Scan Item to Return"}</span>
        <span className="text-amber-100 text-xs">Scan barcode or serial number</span>
      </button>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.namedItem("q");
          if (input instanceof HTMLInputElement) {
            const q = input.value.trim();
            if (q) lookupItem(q);
          }
        }}
        className="flex gap-2"
      >
        <input
          name="q"
          type="search"
          className="input flex-1"
          placeholder="Search item by name…"
          disabled={Boolean(serialSession)}
        />
        <button type="submit" className="btn-secondary px-4" disabled={Boolean(serialSession)}>Add</button>
      </form>

      {lookupError && (
        <p className="text-red-600 text-sm bg-red-50 rounded-lg px-3 py-2">{lookupError}</p>
      )}

      {returnList.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-gray-700">Returning — {totalItems} item{totalItems !== 1 ? "s" : ""}</p>
          {returnList.map((entry, i) => (
            <div key={`${entry.item.id}-${entry.serialNumber ?? "bulk"}-${i}`} className="bg-white border border-gray-100 rounded-2xl p-3.5 flex items-center gap-3 shadow-sm">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{entry.item.name}</p>
                {entry.serialNumber ? (
                  <p className="text-xs text-gray-400 font-mono">SN: {entry.serialNumber}</p>
                ) : entry.item.serialized ? (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1">
                      Serial scans required ({entry.quantity})
                    </span>
                    <button
                      onClick={() => convertSerializedLineToScanSession(entry, i)}
                      className="text-xs text-amber-700"
                    >
                      Scan now
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={() =>
                        setReturnList((prev) =>
                          prev.map((e, j) =>
                            j === i ? { ...e, quantity: Math.max(1, e.quantity - 1) } : e
                          )
                        )
                      }
                      className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 font-bold flex items-center justify-center"
                    >−</button>
                    <span className="text-sm font-semibold w-6 text-center">{entry.quantity}</span>
                    <button
                      onClick={() =>
                        setReturnList((prev) =>
                          prev.map((e, j) =>
                            j === i ? { ...e, quantity: e.quantity + 1 } : e
                          )
                        )
                      }
                      className="w-7 h-7 rounded-lg bg-gray-100 text-gray-600 font-bold flex items-center justify-center"
                    >+</button>
                  </div>
                )}
              </div>
              <button
                onClick={() => setReturnList((prev) => prev.filter((_, j) => j !== i))}
                className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 flex items-center justify-center shrink-0"
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {ticket.attachedItems && ticket.attachedItems.length > 0 && (
        <p className="text-xs text-gray-400">
          Ticket includes {ticket.attachedItems.length} attached item{ticket.attachedItems.length !== 1 ? "s" : ""}. Confirm return quantities or add more scanned items.
        </p>
      )}

      {hasInvalidSerializedEntries() && !serialSession && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          One or more serialized return items still need scanned serials before return can be confirmed.
        </p>
      )}

      {returnList.length === 0 && (
        <div className="text-center py-10 text-gray-300">
          <p className="text-4xl mb-2">⟲</p>
          <p className="text-sm">Scan items to return them to stock</p>
        </div>
      )}

      {returnList.length > 0 && (
        <div className="fixed bottom-16 inset-x-0 px-4 pb-2 bg-gray-50/95 backdrop-blur border-t border-gray-100">
          <button
            onClick={handleSubmitReturn}
            disabled={submitting}
            className="w-full mt-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-lg py-3 min-h-[44px] transition-all disabled:opacity-50"
          >
            {submitting ? "Returning…" : `Return to Stock (${totalItems} item${totalItems !== 1 ? "s" : ""})`}
          </button>
        </div>
      )}

      {scanning && (
        <BarcodeScanner
          onResult={(code) => {
            setScanning(false);
            lookupItem(code);
          }}
          onClose={() => setScanning(false)}
        />
      )}

      {serialScannerOpen && serialSession && (
        <BarcodeScanner
          onResult={handleSerializedBarcode}
          onClose={() => {
            setSerialScannerOpen(false);
            showToast("Serial scan canceled", "error");
          }}
          title={`Scan Return Serials (${serialSession.scannedSerials.length}/${serialSession.requiredCount})`}
          helperText={`Scan ${serialSession.requiredCount - serialSession.scannedSerials.length} more serial barcode${serialSession.requiredCount - serialSession.scannedSerials.length !== 1 ? "s" : ""}`}
        />
      )}

      {!serialScannerOpen && serialSession && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 pb-safe-bottom shadow-xl">
            <h2 className="text-xl font-bold mb-1">Enter Scanned Return Serial</h2>
            <p className="text-gray-500 text-sm mb-1">{serialSession.item.name}</p>
            <p className="text-xs text-gray-400 mb-4">
              {serialSession.scannedSerials.length}/{serialSession.requiredCount} captured
            </p>
            <label className="label">Serial number</label>
            <input
              type="text"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              className="input mb-4"
              placeholder="Scan or type serial barcode..."
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => setSerialScannerOpen(true)}
                className="btn-secondary flex-1"
              >
                Use Camera
              </button>
              <button
                onClick={() => {
                  const serial = serialInput.trim();
                  if (!serial) return;
                  handleSerializedBarcode(serial);
                  setSerialInput("");
                }}
                className="btn-primary flex-1"
              >
                Add Scanned Serial
              </button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "serial" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 pb-safe-bottom shadow-xl">
            <h2 className="text-xl font-bold mb-1">Serialized Return Item</h2>
            <p className="text-gray-500 text-sm mb-4">{modal.item.name}</p>
            <label className="label">How many serialized units are you returning?</label>
            <input
              type="number"
              min={1}
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              className="input mb-4 text-2xl text-center font-bold"
              autoFocus
            />
            <div className="flex gap-2">
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirmSerialQty} className="btn-primary flex-1">Start Serial Scanning</button>
            </div>
          </div>
        </div>
      )}

      {modal?.type === "quantity" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
          <div className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 pb-safe-bottom shadow-xl">
            <h2 className="text-xl font-bold mb-1">Return Quantity</h2>
            <p className="text-gray-500 text-sm mb-4">{modal.item.name}</p>
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
              <button onClick={() => setModal(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={confirmQty} className="w-full mt-2 bg-amber-500 text-white font-semibold rounded-lg py-3 flex-1">
                Add to Return List
              </button>
            </div>
          </div>
        </div>
      )}

      {serialSession && (
        <div className="fixed inset-x-4 bottom-24 z-40 bg-white border border-gray-200 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-gray-800 truncate">{serialSession.item.name}</p>
            <span className="text-xs font-medium text-amber-600">
              {serialSession.scannedSerials.length}/{serialSession.requiredCount}
            </span>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Serialized return requires one scanned barcode per unit.
          </p>
          {serialSession.scannedSerials.length > 0 && (
            <div className="max-h-24 overflow-y-auto mb-3 space-y-1">
              {serialSession.scannedSerials.map((sn) => (
                <p key={sn} className="text-xs font-mono text-gray-500 bg-gray-50 rounded px-2 py-1 truncate">
                  {sn}
                </p>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setSerialScannerOpen(true);
                setSerialInput("");
              }}
              className="btn-secondary flex-1"
            >
              Continue Scanning
            </button>
            <button
              onClick={() => {
                setSerialSession(null);
                setSerialScannerOpen(false);
                setSerialInput("");
                showToast("Serialized return session cleared", "error");
              }}
              className="btn-secondary flex-1"
            >
              Cancel Session
            </button>
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
