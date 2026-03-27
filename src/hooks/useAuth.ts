/**
 * Reads the current SWA user from /.auth/me.
 * Azure SWA injects this endpoint automatically after Entra login.
 */

import { useState, useEffect } from "react";
import type { SwaUser } from "../types/halo";

export function useAuth() {
  const [user, setUser] = useState<SwaUser["clientPrincipal"] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/.auth/me")
      .then((r) => r.json())
      .then((data: SwaUser) => {
        setUser(data.clientPrincipal);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const email = user?.userDetails ?? user?.claims?.find((c) => c.typ === "preferred_username")?.val ?? "";

  const displayName =
    user?.claims?.find((c) => c.typ === "name")?.val ??
    user?.userDetails ??
    "Unknown";

  return { user, email, displayName, loading, isAuthenticated: !!user };
}
