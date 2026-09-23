import { useEffect, useState } from 'react';
import { api, ApiError } from './client';

// Lädt eine Liste seitenweise (take/skip) und bietet "weitere laden" an.
export function usePagedList<T>(path: string, errorText: string, pageSize = 100) {
  const [items, setItems] = useState<T[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const showError = (err: unknown) => setError(err instanceof ApiError ? err.message : errorText);

  useEffect(() => {
    api
      .getPage<T>(path, pageSize, 0)
      .then((page) => {
        setItems(page.items);
        setTotal(page.total);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : errorText));
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

  return { items, total, error, hasMore: items !== null && items.length < total, loadMore, loadingMore };
}
