import { Link } from 'react-router-dom';
import { usePagedList } from '../api/usePagedList';
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

export function ProjectsPage() {
  const {
    items: projects,
    total,
    error,
    hasMore,
    loadMore,
    loadingMore,
  } = usePagedList<Project>('/projects', 'Projekte konnten nicht geladen werden.');

  return (
    <div>
      <header className="my-day-header">
        <h2>Projekte</h2>
      </header>

      {error && <p className="field-error">{error}</p>}
      {!error && projects === null && <p>Lädt …</p>}

      {projects?.length === 0 && (
        <div className="empty-state">
          <strong>Noch keine Projekte angelegt.</strong>
          Projekte legst du beim jeweiligen Kunden an (Kunden → Objekt → Projekt).
        </div>
      )}

      {projects?.map((project) => (
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
            </div>
          </div>
          <span className={`status-badge status-${project.status}`}>{STATUS_LABELS[project.status]}</span>
        </Link>
      ))}

      {hasMore && projects && (
        <LoadMore shown={projects.length} total={total} onLoadMore={loadMore} loading={loadingMore} />
      )}
    </div>
  );
}
