import { useState } from 'react';
import type { CatalogueItem } from '../catalog/types';

type PreviewViewport = 'auto' | '390' | '768';

interface PreviewCanvasProps {
  item: CatalogueItem;
  onStateChange: (state: string) => void;
  onVariantChange: (variant: string) => void;
  state: string;
  variant: string;
}

export function PreviewCanvas({ item, onStateChange, onVariantChange, state, variant }: PreviewCanvasProps) {
  const [viewport, setViewport] = useState<PreviewViewport>('auto');

  return (
    <section aria-labelledby="preview-title" className="preview-pane">
      <header className="preview-header">
        <div>
          <div className="breadcrumb"><span>{item.category}</span><span>/</span><strong>{item.title}</strong></div>
          <h2 id="preview-title">{item.title}</h2>
          <p>{item.purpose}</p>
        </div>
        <span className={`status-pill status-pill--${item.status}`}>
          <i className={`status-dot status-dot--${item.status}`} />
          {item.status === 'implemented' ? 'Implémenté' : 'Planifié'}
        </span>
      </header>

      <section className="controls-bar" aria-label="Contrôles de la preview">
        <label>
          <span>Variante</span>
          <select value={variant} onChange={(event) => onVariantChange(event.target.value)}>
            {item.variants.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>État</span>
          <select value={state} onChange={(event) => onStateChange(event.target.value)}>
            {item.states.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <div className="viewport-control" aria-label="Largeur de preview">
          <span>Viewport</span>
          {(['auto', '390', '768'] as const).map((width) => (
            <button
              aria-pressed={viewport === width}
              className={viewport === width ? 'is-active' : ''}
              key={width}
              onClick={() => setViewport(width)}
              type="button"
            >
              {width === 'auto' ? 'Auto' : width}
            </button>
          ))}
        </div>
      </section>

      <section className={`canvas canvas--${item.presentation}`} aria-label={`Aperçu de ${item.title}`} data-presentation={item.presentation}>
        <div className="canvas__grid" />
        {item.render ? (
          <div className="canvas__render" data-viewport={viewport}>{item.render({ state, variant })}</div>
        ) : (
          <div className="planned-preview">
            <span className="planned-preview__index">{String(item.id.length).padStart(2, '0')}</span>
            <p className="eyebrow">Prochaine pièce à concevoir</p>
            <h3>{item.title}</h3>
            <p>{item.purpose}</p>
            <div className="planned-preview__rule" />
            <span className="planned-preview__note">Le canevas accueillera ici le composant réel, sans copie.</span>
          </div>
        )}
      </section>

      <section className="metadata-grid" aria-label="Contrat du composant">
        <article>
          <p className="metadata-title">Dépendances</p>
          <p>{item.dependencies.length > 0 ? item.dependencies.join(' · ') : 'Aucune dépendance produit'}</p>
        </article>
        <article>
          <p className="metadata-title">Accessibilité</p>
          <ul>{item.accessibility.map((check) => <li key={check}>{check}</li>)}</ul>
        </article>
        <article className="metadata-grid__usage">
          <p className="metadata-title">Usage public</p>
          <code>{item.usage}</code>
        </article>
      </section>
    </section>
  );
}
