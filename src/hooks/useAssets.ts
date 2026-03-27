import { useState, useCallback, useRef } from "react";
import type { HaloAsset } from "../types/halo";

export function useAssets() {
  const [assets, setAssets] = useState<HaloAsset[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(async (query: string, page = 1) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ page: String(page), pagesize: "25" });
      if (query) params.set("search", query);

      const res = await fetch(`/api/assets?${params}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as { assets: HaloAsset[]; total: number };
      setAssets(data.assets);
      setTotal(data.total);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  return { assets, total, loading, error, search };
}

export function useCheckedOutAssets() {
  const [assets, setAssets] = useState<HaloAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/checkins");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { assets: HaloAsset[] };
      setAssets(data.assets);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { assets, loading, error, refresh };
}
