interface LoadMoreProps {
  shown: number;
  total: number;
  onLoadMore: () => void;
  loading: boolean;
}

// Hinweis unter einer Liste, wenn noch nicht alle Einträge geladen sind.
export function LoadMore({ shown, total, onLoadMore, loading }: LoadMoreProps) {
  return (
    <div className="list-item" data-testid="load-more">
      <div className="list-item-meta">
        {shown} von {total} angezeigt
      </div>
      <button className="btn" onClick={onLoadMore} disabled={loading} data-testid="load-more-button">
        {loading ? 'Lädt …' : 'Weitere laden'}
      </button>
    </div>
  );
}
