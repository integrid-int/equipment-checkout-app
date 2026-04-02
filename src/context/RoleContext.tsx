/**
 * Fetches the current user's app role claim from /api/me and makes it available
 * throughout the app. Role is one of: "admin" | "technician" | "receiver" | null.
 *
 * null means the user is authenticated but has no recognized app role claim.
 */

import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type AppRole = "admin" | "technician" | "receiver" | null;

interface RoleContextValue {
  role: AppRole;
  email: string;
  displayName: string;
  loading: boolean;
  refresh: () => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<AppRole>(null);
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setLoading(true);
    const ts = Date.now();
    fetch(`/api/me?ts=${ts}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((data: { email?: string; displayName?: string; role?: AppRole }) => {
        setEmail(data.email ?? "");
        setDisplayName(data.displayName ?? data.email ?? "");
        setRole(data.role ?? null);
      })
      .catch(() => {
        setRole(null);
      })
      .finally(() => setLoading(false));
  }, [tick]);

  return (
    <RoleContext.Provider
      value={{ role, email, displayName, loading, refresh: () => setTick((t) => t + 1) }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleContext);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
