"use client";

import { useEffect, useRef, useState } from "react";

import { apiFetch, readApiError } from "../lib/api";

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const _cache = new Map<string, CacheEntry<unknown>>();
const DEFAULT_TTL_MS = 5_000;

export interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Read-side fetch hook for /api/* endpoints.
 *
 * - Sends X-API-Key when KURAL_API_KEY is configured (via apiFetch).
 * - Aborts the in-flight request on unmount or url change.
 * - 5s in-memory cache keyed on the URL — cheap suppression of duplicate
 *   re-fetches across a single tab. Pass ttlMs to override or set to 0 to
 *   disable caching for this consumer.
 */
export function useApi<T>(url: string | null, ttlMs: number = DEFAULT_TTL_MS): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!url) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    if (ttlMs > 0) {
      const cached = _cache.get(url);
      if (cached && cached.expiresAt > Date.now()) {
        setData(cached.data as T);
        setError(null);
        setLoading(false);
        return;
      }
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await apiFetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(await readApiError(res));
        const payload = (await res.json()) as T;
        if (controller.signal.aborted || !mounted.current) return;
        if (ttlMs > 0) {
          _cache.set(url, { data: payload, expiresAt: Date.now() + ttlMs });
        }
        setData(payload);
        setLoading(false);
      } catch (exc) {
        if (controller.signal.aborted || !mounted.current) return;
        if (exc instanceof DOMException && exc.name === "AbortError") return;
        setError(exc instanceof Error ? exc.message : "Request failed");
        setLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [url, ttlMs, tick]);

  return {
    data,
    error,
    loading,
    reload: () => {
      _cache.delete(url ?? "");
      setTick((value) => value + 1);
    },
  };
}

/** Test helper — clears the module-level fetch cache. */
export function _resetUseApiCache(): void {
  _cache.clear();
}
