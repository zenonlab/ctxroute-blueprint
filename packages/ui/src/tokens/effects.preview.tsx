import { definePreview } from '../preview-contract';
import './color.css';
import './layout.css';
import './effects.css';

const radii = [
  { className: 'radius-sm', label: 'Petit', token: 'radius.sm' },
  { className: 'radius-md', label: 'Moyen', token: 'radius.md' },
  { className: 'radius-lg', label: 'Grand', token: 'radius.lg' },
] as const;

const elevations = [
  { className: 'flat', label: 'Plan', token: 'shadow.flat' },
  { className: 'raised', label: 'Surélevé', token: 'shadow.raised' },
  { className: 'overlay', label: 'Superposé', token: 'shadow.overlay' },
] as const;

const durations = [
  { className: 'fast', label: 'Rapide · 120 ms' },
  { className: 'standard', label: 'Standard · 180 ms' },
  { className: 'slow', label: 'Lent · 240 ms' },
] as const;

const effectsPreview = definePreview({
  id: 'shape-elevation-motion',
  title: 'Forme, élévation & mouvement',
  category: 'Fondations',
  level: 'foundation',
  purpose: 'Des finitions courtes et sobres, sans effet décoratif improvisé.',
  variants: ['Standard'],
  states: ['default', 'active', 'reduced'],
  fixtures: [radii, elevations, durations],
  sources: [
    { label: 'Tokens', path: 'tokens/effects.css' },
    { label: 'Preview', path: 'tokens/effects.preview.tsx' },
    { label: 'Tests', path: 'tokens/effects.test.ts' },
  ],
  dependencies: ['color tokens', 'layout tokens', 'preview-contract'],
  accessibility: [
    'Le mouvement illustre un changement sans porter seul l’information',
    'Le mode réduit supprime les transitions',
    'Les ombres complètent une bordure visible',
  ],
  usage: `import '@tobirink/ui/tokens/effects.css';`,
  render: ({ state }) => (
    <section className="effects-foundation" data-state={state}>
      <header className="effects-foundation__header">
        <div>
          <p className="effects-foundation__eyebrow">Fondation · Finition</p>
          <h3>Forme &amp; mouvement</h3>
        </div>
        <span className="effects-foundation__index">03 / 03</span>
      </header>

      <section className="effects-foundation__section" aria-labelledby="radius-title">
        <h4 id="radius-title">Rayons</h4>
        <div className="effects-foundation__grid">
          {radii.map((radius) => (
            <div className={`effects-foundation__sample effects-foundation__sample--${radius.className}`} key={radius.token}>
              <strong>{radius.label}</strong>
              <span className="effects-foundation__token">{radius.token}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="effects-foundation__section" aria-labelledby="elevation-title">
        <h4 id="elevation-title">Élévation</h4>
        <div className="effects-foundation__grid">
          {elevations.map((elevation) => (
            <div className={`effects-foundation__sample effects-foundation__sample--${elevation.className}`} key={elevation.token}>
              <strong>{elevation.label}</strong>
              <span className="effects-foundation__token">{elevation.token}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="effects-foundation__section" aria-labelledby="motion-title">
        <h4 id="motion-title">Durées</h4>
        <div className="effects-foundation__motion">
          {durations.map((duration) => (
            <div className="effects-foundation__motion-row" key={duration.className}>
              <span className="effects-foundation__token">{duration.label}</span>
              <span className="effects-foundation__track" aria-hidden="true">
                <span className={`effects-foundation__marker effects-foundation__marker--${duration.className}`} />
              </span>
            </div>
          ))}
        </div>
      </section>

      <p className="effects-foundation__rule">Trois rayons. Trois niveaux d’élévation. Mouvement toujours désactivable.</p>
    </section>
  ),
});

export default effectsPreview;
