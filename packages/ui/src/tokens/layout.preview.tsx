import { definePreview } from '../preview-contract';
import './color.css';
import './layout.css';

const typeRamp = [
  { className: 'display', label: 'Display · 32 / 1.08', sample: 'Titre principal' },
  { className: 'title', label: 'Titre · 24 / 1.08', sample: 'Titre de page' },
  { className: 'section', label: 'Section · 18 / 1.25', sample: 'Titre de section' },
  { className: 'body', label: 'Corps · 14 / 1.5', sample: 'Une information claire, lisible et suffisamment dense.' },
  { className: 'label', label: 'Libellé · 11 / 1.25', sample: 'Libellé court' },
] as const;

const spaces = [
  { pixels: '4', token: '1' },
  { pixels: '8', token: '2' },
  { pixels: '12', token: '3' },
  { pixels: '16', token: '4' },
  { pixels: '24', token: '6' },
  { pixels: '32', token: '8' },
] as const;

const layoutPreview = definePreview({
  id: 'typography-spacing',
  title: 'Typographie & espacements',
  category: 'Fondations',
  level: 'foundation',
  purpose: 'Une hiérarchie sans-serif compacte et un rythme limité, reconstruits depuis la direction FavLib.',
  variants: ['Standard'],
  states: ['default', 'compact', 'focus'],
  fixtures: [typeRamp, spaces],
  sources: [
    { label: 'Tokens', path: 'tokens/layout.css' },
    { label: 'Preview', path: 'tokens/layout.preview.tsx' },
    { label: 'Tests', path: 'tokens/layout.test.ts' },
  ],
  dependencies: ['color tokens', 'preview-contract'],
  accessibility: [
    'Corps de texte à 14px avec hauteur de ligne 1.5',
    'Longueur de lecture limitée à 68 caractères',
    'Cible tactile minimale de 44px',
  ],
  usage: `import '@tobirink/ui/tokens/layout.css';`,
  render: ({ state }) => (
    <section className="layout-foundation" data-state={state}>
      <header className="layout-foundation__header">
        <div>
          <p className="layout-foundation__eyebrow">Fondation · Rythme</p>
          <h3>Type &amp; espace</h3>
        </div>
        <span className="layout-foundation__index">02 / 03</span>
      </header>

      <section className="layout-foundation__section" aria-labelledby="type-ramp-title">
        <h4 id="type-ramp-title">Échelle typographique</h4>
        <div className="layout-foundation__type-ramp">
          {typeRamp.map((type) => (
            <div className="layout-foundation__type-row" key={type.className}>
              <span>{type.label}</span>
              <p className={`layout-foundation__sample layout-foundation__sample--${type.className}`}>{type.sample}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="layout-foundation__section" aria-labelledby="rhythm-title">
        <h4 id="rhythm-title">Rythme et dimensions</h4>
        <div className="layout-foundation__rhythm-grid">
          <div className="layout-foundation__spacing" aria-label="Échelle d’espacement">
            {spaces.map((space) => (
              <div className="layout-foundation__space-row" key={space.token}>
                <code>{space.token}</code>
                <span className={`layout-foundation__space-bar layout-foundation__space-bar--${space.token}`} />
                <output>{space.pixels}px</output>
              </div>
            ))}
          </div>
          <div className="layout-foundation__targets" aria-label="Hauteurs de contrôle">
            <div className="layout-foundation__target layout-foundation__target--compact"><strong>Compact</strong><span>32px</span></div>
            <div className="layout-foundation__target layout-foundation__target--default"><strong>Défaut</strong><span>36px</span></div>
            <div className="layout-foundation__target layout-foundation__target--touch"><strong>Tactile</strong><span>44px minimum</span></div>
          </div>
        </div>
      </section>

      <p className="layout-foundation__rule">Six espacements. Sept tailles de texte. Aucune valeur locale improvisée.</p>
    </section>
  ),
});

export default layoutPreview;
