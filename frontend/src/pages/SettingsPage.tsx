import { useTheme } from '../theme/ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { ChangePasswordSection } from './ChangePasswordSection';
import { UsersSection } from './UsersSection';
import { CompanySection } from './CompanySection';
import { AuditLogSection } from './AuditLogSection';

const COLOR_FIELDS: { key: keyof ReturnType<typeof useTheme>['theme']; label: string; hint: string }[] = [
  { key: 'primary', label: 'Primärfarbe', hint: 'Navigation, Buttons, Hervorhebungen' },
  { key: 'accent', label: 'Akzentfarbe', hint: 'z.B. Markierung bei "Mein Tag"' },
  { key: 'background', label: 'Hintergrund', hint: 'Grundfläche der Anwendung' },
];

export function SettingsPage() {
  const { theme, setTheme, resetTheme } = useTheme();
  const { hasPermission } = useAuth();

  return (
    <div>
      <header className="my-day-header">
        <h2>Einstellungen</h2>
      </header>

      <section className="settings-section">
        <h3>Darstellung</h3>
        <p>Farben lassen sich hier direkt anpassen – die Änderung gilt sofort für die ganze Anwendung.</p>

        {COLOR_FIELDS.map((field) => (
          <div key={field.key} className="color-field">
            <div>
              <div className="list-item-name">{field.label}</div>
              <div className="list-item-meta">{field.hint}</div>
            </div>
            <input
              type="color"
              value={theme[field.key]}
              onChange={(e) => setTheme({ ...theme, [field.key]: e.target.value })}
              aria-label={field.label}
            />
          </div>
        ))}

        <button
          className="btn"
          style={{ marginTop: 16, background: 'transparent', border: '1px solid var(--color-border)' }}
          onClick={resetTheme}
        >
          Auf Standardfarben zurücksetzen
        </button>
      </section>

      <ChangePasswordSection />
      {hasPermission('system.settings.write') && <CompanySection />}
      {hasPermission('system.settings.write') && <UsersSection />}
      {hasPermission('audit.read') && <AuditLogSection />}
    </div>
  );
}
