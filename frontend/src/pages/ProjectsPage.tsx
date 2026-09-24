import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDebounced, usePagedList } from '../api/usePagedList';
import { LoadMore } from '../layout/LoadMore';

interface Project {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  property: {
    label: string;
    street: string | null;
    city: string | null;
    customer: { name: string };
  };
}

const STATUS_LABELS: Record<Project['status'], string> = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  done: 'Fertig',
  cancelled: 'Storniert',
};

const FILTERS: [Project['status'] | '', string][] = [
  ['', 'Alle'],
  ['open', 'Offen'],
  ['in_progress', 'In Bearbeitung'],
  ['done', 'Fertig'],
  ['cancelled', 'Storniert'],
];

export function ProjectsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Project['status'] | ''>('');
  const q = useDebounced(search.trim());
  const params = new URLSearchParams({ ...(q && { q }), ...(status && { status }) }).toString();
  const {
    items: projects,
    total,
    error,
    hasMore,
    loadMore,
    loadingMore,
  } = usePagedList<Project>(
    `/projects${params ? `?${params}` : ''}`,
    'Projekte konnten nicht geladen werden.',
  );
  const filtered = !!(q || status);

  return (
    <div>
      <header className="page-header">
        <div>
          <h2>Projekte</h2>
          {projects && (
            <p>
              {total} {total === 1 ? 'Projekt' : 'Projekte'}
              {filtered ? ' gefunden' : ''}
            </p>
          )}
        </div>
      </header>

      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Projekt, Kunde, Objekt oder Ort suchen"
          aria-label="Projekte durchsuchen"
          data-testid="project-search"
        />
        <div className="chip-group" role="group" aria-label="Status">
          {FILTERS.map(([value, label]) => (
            <button
              key={value || 'all'}
              className="chip"
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
              data-testid={`project-filter-${value || 'all'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="field-error">{error}</p>}
      {!error && projects === null && <p>Lädt …</p>}

      {projects?.length === 0 &&
        (filtered ? (
          <div className="empty-state">
            <strong>Keine passenden Projekte.</strong>
            Suchbegriff oder Filter ändern.
          </div>
        ) : (
          <div className="empty-state">
            <strong>Noch keine Projekte angelegt.</strong>
            Projekte legst du beim jeweiligen Kunden an (Kunden → Objekt → Projekt).
          </div>
        ))}

      {!!projects?.length && (
        <div className="list-card">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/projekte/${project.id}`}
              className="list-item list-item-link"
              data-testid="project-list-item"
            >
              <div>
                <div className="list-item-name" data-testid="project-title">
                  {project.title}
                </div>
                <div className="list-item-meta">
                  {project.property.customer.name} · {project.property.label}
                  {project.property.city ? ` · ${project.property.city}` : ''}
                </div>
              </div>
              <span className={`status-badge status-${project.status}`}>{STATUS_LABELS[project.status]}</span>
            </Link>
          ))}
          {hasMore && (
            <LoadMore shown={projects.length} total={total} onLoadMore={loadMore} loading={loadingMore} />
          )}
        </div>
      )}
    </div>
  );
}
