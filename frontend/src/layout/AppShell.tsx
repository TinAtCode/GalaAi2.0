import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { prefetchPages } from '../lazy-pages';
import { Icon, IconName } from './icons';
import { CommandPalette } from './CommandPalette';
import { offlineDb } from '../offline/db';
import { api } from '../api/client';
import { startOfflineSync, useOnline, useOutbox } from '../offline/sync';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  testId: string;
  group: 'Arbeit' | 'Angebote & Stammdaten' | 'Finanzen' | 'Verwaltung';
  permission?: string;
  // mobil in der unteren Leiste (die übrigen unter „Mehr“)
  primary?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Mein Tag', icon: 'sun', testId: 'nav-my-day', group: 'Arbeit', primary: true },
  // Handy auf der Baustelle: eigene Termine, Zeit, Fotos, Nachrichten
  {
    to: '/baustelle',
    label: 'Baustelle',
    icon: 'hardhat',
    permission: 'site.use',
    testId: 'nav-site',
    group: 'Arbeit',
    primary: true,
  },
  {
    to: '/projekte',
    label: 'Projekte',
    icon: 'folder',
    testId: 'nav-projects',
    group: 'Arbeit',
    primary: true,
  },
  { to: '/kunden', label: 'Kunden', icon: 'users', testId: 'nav-customers', group: 'Arbeit', primary: true },
  // Firma, Baustellen, Team und Persönliches in einer Monatsansicht
  { to: '/kalender', label: 'Kalender', icon: 'calendar', testId: 'nav-calendar', group: 'Arbeit' },
  // Wer ist wann wo – Termine aller Mitarbeiter einer Woche
  {
    to: '/plantafel',
    label: 'Plantafel',
    icon: 'board',
    permission: 'customer.read',
    testId: 'nav-board',
    group: 'Arbeit',
  },
  // Pflege- und Wartungsverträge (ansehen wie Projekte)
  {
    to: '/vertraege',
    label: 'Pflegeverträge',
    icon: 'repeat',
    permission: 'customer.read',
    testId: 'nav-contracts',
    group: 'Arbeit',
  },
  // Lagepläne auf diesem Gerät (auch ohne Netz)
  {
    to: '/offline',
    label: 'Offline-Pläne',
    icon: 'offline',
    permission: 'plan.read',
    testId: 'nav-offline',
    group: 'Arbeit',
  },
  {
    to: '/kalkulation',
    label: 'Kalkulation',
    icon: 'calculator',
    testId: 'nav-calculation',
    group: 'Angebote & Stammdaten',
  },
  {
    to: '/stammdaten',
    label: 'Stammdaten',
    icon: 'box',
    testId: 'nav-masterdata',
    group: 'Angebote & Stammdaten',
  },
  // Rechnungen und Zahlungen: nur mit invoice.create
  {
    to: '/offene-posten',
    label: 'Offene Posten',
    icon: 'receipt',
    permission: 'invoice.create',
    testId: 'nav-open-items',
    group: 'Finanzen',
    primary: true,
  },
  {
    to: '/bankabgleich',
    label: 'Bankabgleich',
    icon: 'bank',
    permission: 'invoice.create',
    testId: 'nav-bank',
    group: 'Finanzen',
  },
  // Geschäftsführung und Buchhaltung
  {
    to: '/finanzen',
    label: 'Finanzen',
    icon: 'chart',
    permission: 'finance.read',
    testId: 'nav-finance',
    group: 'Finanzen',
  },
  // Nur sichtbar mit employee.data.read (Vorgesetzte/Büro) – dieselbe
  // Berechtigung, die das Backend für diese Daten verlangt.
  {
    to: '/team',
    label: 'Team',
    icon: 'team',
    permission: 'employee.data.read',
    testId: 'nav-team',
    group: 'Verwaltung',
  },
  {
    to: '/einstellungen',
    label: 'Einstellungen',
    icon: 'settings',
    testId: 'nav-settings',
    group: 'Verwaltung',
  },
];

const GROUPS: NavItem['group'][] = ['Arbeit', 'Angebote & Stammdaten', 'Finanzen', 'Verwaltung'];

export function AppShell() {
  const { user, logout, hasPermission } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const visible = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));
  const online = useOnline();
  const outbox = useOutbox();

  // offline gespeicherte Änderungen übertragen, sobald Netz da ist
  useEffect(() => startOfflineSync(), []);
  // übrige Seiten im Hintergrund laden, damit sie auch ohne Netz aufgehen
  useEffect(() => {
    if (online) prefetchPages();
  }, [online]);

  // Abmelden löscht die Offline-Daten – vorher warnen, wenn noch etwas wartet
  const signOut = async () => {
    const waiting = await offlineDb.allOutbox().catch(() => []);
    if (
      waiting.length &&
      !window.confirm(
        `${waiting.length} offline gespeicherte ${waiting.length === 1 ? 'Änderung ist' : 'Änderungen sind'} noch nicht übertragen und gehen beim Abmelden verloren. Trotzdem abmelden?`,
      )
    )
      return;
    await logout();
  };

  // Strg+K / Cmd+K öffnet die Schnellsuche
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ungelesene Nachrichten von Baustelle bzw. Büro (alle 60 s)
  const canUseSite = hasPermission('site.use');
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!canUseSite) return;
    const load = () =>
      api
        .get<{ count: number }[]>('/site/unread')
        .then((list) => setUnread(list.reduce((sum, u) => sum + u.count, 0)))
        .catch(() => undefined);
    load();
    const timer = window.setInterval(load, 60_000);
    return () => window.clearInterval(timer);
  }, [canUseSite]);

  const link = (item: NavItem) => (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) => (isActive ? 'active' : '')}
      data-testid={item.testId}
    >
      <span className="app-nav-icon">
        <Icon name={item.icon} size={22} />
        {item.to === '/baustelle' && unread > 0 && (
          <span className="nav-badge" data-testid="nav-site-unread">
            {unread}
          </span>
        )}
      </span>
      <span className="app-nav-label">{item.label}</span>
    </NavLink>
  );

  const initials = user ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() : '';

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="Hauptnavigation">
        <div className="app-nav-brand">
          <span className="app-nav-logo">
            <Icon name="leaf" size={18} />
          </span>
          GartenAI
        </div>
        <button
          className="search-trigger nav-desktop-only"
          onClick={() => setSearchOpen(true)}
          aria-label="Schnellsuche öffnen (Strg+K)"
          data-testid="search-open"
        >
          <Icon name="search" size={16} /> Suchen …<kbd>Strg K</kbd>
        </button>
        {GROUPS.map((group) => {
          const items = visible.filter((item) => item.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="app-nav-group">
              <div className="app-nav-group-label">{group}</div>
              <ul className="app-nav-list">
                {items.map((item) => (
                  <li key={item.to} className={item.primary ? undefined : 'nav-secondary'}>
                    {link(item)}
                  </li>
                ))}
                {group === 'Verwaltung' && (
                  <li className="nav-more">
                    <button
                      className="app-nav-more"
                      onClick={() => setMoreOpen(!moreOpen)}
                      aria-expanded={moreOpen}
                      data-testid="nav-more"
                    >
                      <span className="app-nav-icon">
                        <Icon name="more" size={22} />
                      </span>
                      <span className="app-nav-label">Mehr</span>
                    </button>
                  </li>
                )}
              </ul>
            </div>
          );
        })}
        <div className="app-nav-footer">
          {user && (
            <div className="app-nav-user">
              <span className="app-nav-avatar">{initials}</span>
              <span>
                {user.firstName} {user.lastName}
              </span>
            </div>
          )}
          <button onClick={signOut} data-testid="nav-logout">
            Abmelden
          </button>
        </div>
      </nav>

      {moreOpen && (
        <>
          <div className="nav-sheet-backdrop" onClick={() => setMoreOpen(false)} />
          <div className="nav-sheet" role="dialog" aria-label="Weitere Bereiche">
            <button
              onClick={() => {
                setMoreOpen(false);
                setSearchOpen(true);
              }}
            >
              <Icon name="search" size={22} />
              Suchen
            </button>
            {visible
              .filter((item) => !item.primary)
              .map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                  onClick={() => setMoreOpen(false)}
                >
                  <Icon name={item.icon} size={22} />
                  {item.label}
                </NavLink>
              ))}
            <button onClick={signOut}>
              <Icon name="logout" size={22} />
              Abmelden
            </button>
          </div>
        </>
      )}

      {searchOpen && <CommandPalette items={visible} onClose={() => setSearchOpen(false)} />}

      <main className="app-content">
        {(!online || outbox.length > 0) && (
          <div
            className={`offline-banner no-print${online ? '' : ' is-offline'}`}
            role="status"
            data-testid="offline-banner"
          >
            {!online ? 'Keine Verbindung – ' : ''}
            {outbox.length > 0
              ? `${outbox.length} Planänderung${outbox.length === 1 ? '' : 'en'} ${online ? 'werden übertragen' : 'warten auf die Übertragung'}${outbox.some((e) => e.conflict) ? ' (Konflikt – bitte im Plan entscheiden)' : ''}.`
              : 'Lagepläne auf diesem Gerät lassen sich weiter bearbeiten.'}{' '}
            <NavLink to="/offline">Offline-Pläne</NavLink>
          </div>
        )}
        <Suspense fallback={<p className="page-loading">Lädt …</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
