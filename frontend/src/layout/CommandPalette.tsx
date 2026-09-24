import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { NavItem } from './AppShell';

interface Result {
  to: string;
  label: string;
  meta: string;
}

interface CustomerHit {
  id: string;
  name: string;
  city: string | null;
}
interface ProjectHit {
  id: string;
  title: string;
  property: { label: string; customer: { name: string } };
}

// Schnellsuche (Strg+K): Bereiche, Kunden und Projekte
export function CommandPalette({ items, onClose }: { items: NavItem[]; onClose: () => void }) {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Kunden und Projekte nach kurzer Pause suchen; alte Antworten verwerfen
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || !hasPermission('customer.read')) return;
    let current = true;
    const timer = setTimeout(() => {
      const q = encodeURIComponent(term);
      Promise.all([
        api.get<CustomerHit[]>(`/customers?q=${q}&take=5`),
        api.get<ProjectHit[]>(`/projects?q=${q}&take=5`),
      ])
        .then(([customers, projects]) => {
          if (!current) return;
          setFound([
            ...projects.map((p) => ({
              to: `/projekte/${p.id}`,
              label: p.title,
              meta: `Projekt · ${p.property.customer.name}`,
            })),
            ...customers.map((c) => ({
              to: `/kunden/${c.id}`,
              label: c.name,
              meta: `Kunde${c.city ? ` · ${c.city}` : ''}`,
            })),
          ]);
          setActive(0);
        })
        .catch(() => current && setFound([]));
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, hasPermission]);

  const term = query.trim().toLowerCase();
  const pages: Result[] = items
    .filter((item) => !term || item.label.toLowerCase().includes(term))
    .map((item) => ({ to: item.to, label: item.label, meta: 'Bereich' }));
  // Treffer aus Kunden/Projekten nur ab zwei Zeichen
  const results = [...(term.length >= 2 ? found : []), ...pages].slice(0, 12);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') onClose();
    else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && results[active]) {
      navigate(results[active].to);
      onClose();
    }
  };

  return (
    <div className="command-backdrop" onClick={onClose}>
      <div
        className="command-panel"
        role="dialog"
        aria-label="Schnellsuche"
        onClick={(e) => e.stopPropagation()}
        data-testid="command-palette"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Kunde, Projekt oder Bereich suchen …"
          aria-label="Suche"
          data-testid="command-input"
        />
        <ul className="command-results" role="listbox">
          {results.map((r, i) => (
            <li key={`${r.to}-${r.meta}`}>
              <Link to={r.to} onClick={onClose} aria-selected={i === active} role="option">
                <span>{r.label}</span>
                <span className="list-item-meta">{r.meta}</span>
              </Link>
            </li>
          ))}
        </ul>
        {!results.length && <div className="command-hint">Nichts gefunden.</div>}
        <div className="command-hint">↑ ↓ auswählen · Enter öffnen · Esc schließen</div>
      </div>
    </div>
  );
}
