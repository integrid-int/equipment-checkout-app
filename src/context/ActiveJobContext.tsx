/**
 * Holds the active job (ticket) and the pull list for the current session.
 * Persists in sessionStorage so a page refresh doesn't wipe a partial pull.
 */

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { HaloTicket, PullEntry } from "../types/halo";

interface ActiveJobState {
  ticket: HaloTicket | null;
  pullList: PullEntry[];
}

interface ActiveJobContextValue extends ActiveJobState {
  setTicket: (ticket: HaloTicket | null) => void;
  addEntry: (entry: PullEntry) => void;
  updateEntryQty: (itemId: number, quantity: number) => void;
  removeEntry: (itemId: number) => void;
  clearPullList: () => void;
  clearJob: () => void;
}

const KEY = "activeJob";

const ActiveJobContext = createContext<ActiveJobContextValue | null>(null);

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

  function setTicket(ticket: HaloTicket | null) {
    setState((s) => ({ ...s, ticket }));
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

  function removeEntry(itemId: number) {
    setState((s) => ({
      ...s,
      pullList: s.pullList.filter((e) => e.item.id !== itemId),
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
