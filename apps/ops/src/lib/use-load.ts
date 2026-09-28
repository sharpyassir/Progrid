'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from './api';

/** Loads data for a page, optionally polling while the tab is visible. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], opts: { pollMs?: number; skip?: boolean } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(!opts.skip);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    try {
      const d = await fnRef.current();
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      setError(e as ApiError);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (opts.skip) return;
    setLoading(true);
    void reload();
    if (!opts.pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, opts.pollMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, opts.skip, opts.pollMs]);
  return { data, error, loading, reload, setData };
}
