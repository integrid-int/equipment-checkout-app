/**
 * Holds the active job (ticket) and the pull list for the current session.
 * Persists in sessionStorage so a page refresh doesn't wipe a partial pull.
 */

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { HaloTicket, PullEntry, TicketAttachedItem } from "../types/halo";

interface ActiveJobState {
  ticket: HaloTicket | null;
  pullList: PullEntry[];
}

interface ActiveJobContextValue extends ActiveJobState {
  setTicket: (ticket: HaloTicket | null, options?: { seedFromAttachedItems?: boolean }) => void;
  addEntry: (entry: PullEntry) => void;
  updateEntryQty: (itemId: number, quantity: number) => void;
  removeEntry: (itemId: number, serialNumber?: string) => void;
  clearPullList: () => void;
  clearJob: () => void;
}

const KEY = "activeJob";

const ActiveJobContext = createContext<ActiveJobContextValue | null>(null);

function toPullEntries(attachedItems: TicketAttachedItem[] | undefined): PullEntry[] {
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

export function ActiveJobProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ActiveJobState>(() => {
    try {
      const stored = sessionStorage.getItem(KEY);
      return stored ? JSON.parse(stored) : { ticket: null, pullList: [] };
    } catch {
      return { ticket: null, pullList: [] };
    }
  });

  useEffect(() => {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  }, [state]);

  function setTicket(ticket: HaloTicket | null, options?: { seedFromAttachedItems?: boolean }) {
    setState((s) => {
      if (!ticket) return { ...s, ticket: null };
      if (!options?.seedFromAttachedItems) return { ...s, ticket };
      return {
        ticket,
        pullList: toPullEntries(ticket.attachedItems),
      };
    });
  }

  function addEntry(entry: PullEntry) {
    setState((s) => {
      // If same itemId already exists, increment quantity
      const existing = s.pullList.find((e) => e.item.id === entry.item.id && !entry.serialNumber);
      if (existing) {
        return {
          ...s,
          pullList: s.pullList.map((e) =>
            e.item.id === entry.item.id && !e.serialNumber
              ? { ...e, quantity: e.quantity + entry.quantity }
              : e
          ),
        };
      }
      return { ...s, pullList: [...s.pullList, entry] };
    });
  }

  function updateEntryQty(itemId: number, quantity: number) {
    setState((s) => ({
      ...s,
      pullList: s.pullList.map((e) =>
        e.item.id === itemId && !e.serialNumber ? { ...e, quantity } : e
      ),
    }));
  }

  function removeEntry(itemId: number, serialNumber?: string) {
    setState((s) => ({
      ...s,
      pullList: s.pullList.filter((e) => {
        if (e.item.id !== itemId) return true;
        if (serialNumber !== undefined) return e.serialNumber !== serialNumber;
        return e.serialNumber !== undefined;
      }),
    }));
  }

  function clearPullList() {
    setState((s) => ({ ...s, pullList: [] }));
  }

  function clearJob() {
    setState({ ticket: null, pullList: [] });
    sessionStorage.removeItem(KEY);
  }

  return (
    <ActiveJobContext.Provider
      value={{ ...state, setTicket, addEntry, updateEntryQty, removeEntry, clearPullList, clearJob }}
    >
      {children}
    </ActiveJobContext.Provider>
  );
}

export function useActiveJob() {
  const ctx = useContext(ActiveJobContext);
  if (!ctx) throw new Error("useActiveJob must be used within ActiveJobProvider");
  return ctx;
}
