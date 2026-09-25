import { Icon } from '../layout/icons';
import { useTheme } from '../theme/ThemeContext';

// Schriftzug gAla (brand/gala-wordmark.svg) mit Farben aus den Tokens, damit
// er auch im Dunkelmodus lesbar bleibt
export function GalaWordmark({ height = 28 }: { height?: number }) {
  return (
    <svg viewBox="30 10 720 340" height={height} role="img" aria-label="gAla" style={{ display: 'block' }}>
      <g fill="var(--brand-ink)">
        <circle cx="100" cy="185" r="48" fill="none" stroke="var(--brand-ink)" strokeWidth="46" />
        <path d="M148 114 H194 V262 C194 322 150 346 88 342 C70 341 56 338 44 333 L58 298 C70 303 84 306 98 306 C134 306 148 290 148 262 Z" />
        <path d="M536 14 C500 26 476 52 476 96 L476 214 C476 234 470 246 462 256 C498 248 524 226 524 176 L524 58 C524 38 529 24 536 14 Z" />
        <circle cx="640" cy="185" r="48" fill="none" stroke="var(--brand-ink)" strokeWidth="46" />
        <rect x="688" y="114" width="46" height="136" />
      </g>
      <path
        d="M232 250 L316 28 L364 28 L448 250 L400 250 L340 90 L280 250 Z"
        fill="var(--brand-lawn)"
        stroke="var(--brand-lawn)"
        strokeWidth="6"
        strokeLinejoin="round"
      />
      <g fill="var(--brand-stone)" stroke="var(--brand-stone)" strokeWidth="8" strokeLinejoin="round">
        <path d="M326 156 H354 L362 180 H318 Z" />
        <path d="M308 198 H334 L330 240 H296 Z" />
        <path d="M346 198 H372 L384 240 H350 Z" />
      </g>
    </svg>
  );
}

// Marke in Navigation und Login je nach gewähltem Erscheinungsbild
export function Brand({ size = 'nav' }: { size?: 'nav' | 'login' }) {
  const { look } = useTheme();
  if (look === 'gala')
    return (
      <span className="brand brand-gala" data-testid="brand" data-look="gala">
        <GalaWordmark height={size === 'login' ? 52 : 30} />
        {size === 'login' && <span className="brand-tagline">Garten Landschaft Bau App</span>}
      </span>
    );
  return (
    <span className="brand" data-testid="brand" data-look="gartenai">
      {size === 'nav' && (
        <span className="app-nav-logo">
          <Icon name="leaf" size={18} />
        </span>
      )}
      GartenAI
    </span>
  );
}
