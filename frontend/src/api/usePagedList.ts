import { useEffect, useState } from 'react';
import { api, ApiError } from './client';

// Lädt eine Liste seitenweise (take/skip) und bietet "weitere laden" an.
// Ändert sich der Pfad (z. B. Suchbegriff), wird neu geladen; eine ältere,
// später eintreffende Antwort überschreibt die neue nicht.
export function usePagedList<T>(path: string, errorText: string, pageSize = 100) {
  const [items, setItems] = useState<T[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedPath, setLoadedPath] = useState<string | null>(null);

  const showError = (err: unknown) => setError(err instanceof ApiError ? err.message : errorText);

  useEffect(() => {
    let current = true;
    api
      .getPage<T>(path, pageSize, 0)
      .then((page) => {
        if (!current) return;
        setItems(page.items);
        setTotal(page.total);
        setError(null);
        setLoadedPath(path);
      })
      .catch((err) => current && setError(err instanceof ApiError ? err.message : errorText));
    return () => {
      current = false;
    };
  }, [path, pageSize, errorText]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const page = await api.getPage<T>(path, pageSize, items?.length ?? 0);
      setItems((previous) => [...(previous ?? []), ...page.items]);
      setTotal(page.total);
    } catch (err) {
      showError(err);
    } finally {
      setLoadingMore(false);
    }
  };

  return {
    items,
    total,
    error,
    hasMore: items !== null && items.length < total,
    loadMore,
    loadingMore,
    // true, solange die Liste zum aktuellen Pfad noch lädt
    stale: loadedPath !== path,
  };
}

// Wert erst nach einer kurzen Pause übernehmen (Suche beim Tippen)
export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
