import { definePreview } from '../preview-contract';
import './color.css';

const surfaces = [
  { className: 'canvas', role: 'Fond de page', token: 'color.canvas' },
  { className: 'surface', role: 'Surface principale', token: 'color.surface' },
  { className: 'raised', role: 'Élément élevé', token: 'color.surface.raised' },
  { className: 'overlay', role: 'Menu et dialogue', token: 'color.surface.overlay' },
] as const;

const contrastPairs = [
  { className: 'primary', label: 'Texte principal' },
  { className: 'muted', label: 'Texte secondaire' },
  { className: 'accent', label: 'Texte sur accent' },
  { className: 'inverse', label: 'Contraste inversé' },
] as const;

const colorPreview = definePreview({
  id: 'colors-contrast',
  title: 'Couleurs & contraste',
  category: 'Fondations',
  level: 'foundation',
  purpose: 'La direction FavLib reconstruite en rôles sémantiques : encre, graphite, ivoire et ambre.',
  variants: ['Sombre', 'Clair'],
  states: ['default', 'focus', 'disabled'],
  fixtures: [surfaces, contrastPairs],
  sources: [
    { label: 'Tokens', path: 'tokens/color.css' },
    { label: 'Preview', path: 'tokens/color.preview.tsx' },
    { label: 'Tests', path: 'tokens/color.test.ts' },
  ],
  dependencies: ['preview-contract'],
  accessibility: [
    'Tous les couples de texte atteignent WCAG AA',
    'L’accent ambre reste réservé aux actions et au focus',
    'Chaque état associe couleur, symbole et libellé',
  ],
  usage: `import '@tobirink/ui/tokens/color.css';`,
  render: ({ state, variant }) => (
    <section className="color-foundation" data-state={state} data-theme={variant === 'Clair' ? 'Clair' : 'Sombre'}>
      <header className="color-foundation__header">
        <div>
          <p className="color-foundation__eyebrow">Fondation · Couleur</p>
          <h3>Encre &amp; ambre</h3>
        </div>
        <span className="color-foundation__index">01 / 03</span>
      </header>

      <section className="color-foundation__section" aria-labelledby="surface-title">
        <h4 id="surface-title">Niveaux de surface</h4>
        <div className="color-foundation__surfaces">
          {surfaces.map((surface) => (
            <div className={`color-foundation__swatch color-foundation__swatch--${surface.className}`} key={surface.token}>
              <span className="color-foundation__token">{surface.token}</span>
              <span className="color-foundation__role">{surface.role}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="color-foundation__section" aria-labelledby="contrast-title">
        <h4 id="contrast-title">Couples de contraste</h4>
        <div className="color-foundation__contrast-grid">
          {contrastPairs.map((pair) => (
            <div className={`color-foundation__contrast color-foundation__contrast--${pair.className}`} key={pair.className}>
              <span className="color-foundation__sample">Aa · {pair.label}</span>
              <span className="color-foundation__ratio">AA</span>
            </div>
          ))}
        </div>
      </section>

      <section className="color-foundation__section" aria-labelledby="state-title">
        <h4 id="state-title">États sémantiques</h4>
        <div className="color-foundation__states">
          <div className="color-foundation__state color-foundation__state--success">
            <span className="color-foundation__symbol" aria-hidden="true">✓</span>
            <span><strong>Disponible</strong><small>Action terminée</small></span>
          </div>
          <div className="color-foundation__state color-foundation__state--warning">
            <span className="color-foundation__symbol" aria-hidden="true">?</span>
            <span><strong>À vérifier</strong><small>Décision attendue</small></span>
          </div>
          <div className="color-foundation__state color-foundation__state--danger">
            <span className="color-foundation__symbol" aria-hidden="true">!</span>
            <span><strong>Interrompu</strong><small>Action nécessaire</small></span>
          </div>
        </div>
      </section>

      <p className="color-foundation__usage">Aucune couleur brute hors de cette fondation.</p>
    </section>
  ),
});

export default colorPreview;
