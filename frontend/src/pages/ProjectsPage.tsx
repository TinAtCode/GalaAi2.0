import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';

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
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Project[]>('/projects')
      .then(setProjects)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Projekte konnten nicht geladen werden.'),
      );
  }, []);

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
          Neue Projekte werden im Büro erfasst.
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
    </div>
  );
}
