import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const NAV_ITEMS = [
  { to: '/', label: 'Mein Tag', icon: '☀', testId: 'nav-my-day' },
  { to: '/projekte', label: 'Projekte', icon: '📋', testId: 'nav-projects' },
  { to: '/kunden', label: 'Kunden', icon: '👤', testId: 'nav-customers' },
  { to: '/kalkulation', label: 'Kalkulation', icon: '🧮', testId: 'nav-calculation' },
  { to: '/stammdaten', label: 'Stammdaten', icon: '📦', testId: 'nav-masterdata' },
  // Rechnungen und Zahlungen: nur mit invoice.create
  {
    to: '/offene-posten',
    label: 'Offene Posten',
    icon: '€',
    permission: 'invoice.create',
    testId: 'nav-open-items',
  },
  {
    to: '/bankabgleich',
    label: 'Bankabgleich',
    icon: '🏦',
    permission: 'invoice.create',
    testId: 'nav-bank',
  },
  // Geschäftsführung und Buchhaltung
  {
    to: '/finanzen',
    label: 'Finanzen',
    icon: '📊',
    permission: 'finance.read',
    testId: 'nav-finance',
  },
  // Nur sichtbar mit employee.data.read (Vorgesetzte/Büro) – dieselbe
  // Berechtigung, die das Backend für diese Daten verlangt.
  { to: '/team', label: 'Team', icon: '🧑‍🤝‍🧑', permission: 'employee.data.read', testId: 'nav-team' },
  { to: '/einstellungen', label: 'Einstellungen', icon: '⚙', testId: 'nav-settings' },
];

export function AppShell() {
  const { user, logout, hasPermission } = useAuth();
  const visibleNavItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(item.permission));

  return (
    <div className="app-shell">
      <nav className="app-nav" aria-label="Hauptnavigation">
        <div className="app-nav-brand">GartenAI</div>
        <ul className="app-nav-list">
          {visibleNavItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) => (isActive ? 'active' : '')}
                data-testid={item.testId}
              >
                <span className="app-nav-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="app-nav-label">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <button className="app-nav-logout" onClick={logout} data-testid="nav-logout">
          {user ? `${user.firstName} · Abmelden` : 'Abmelden'}
        </button>
      </nav>

      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
