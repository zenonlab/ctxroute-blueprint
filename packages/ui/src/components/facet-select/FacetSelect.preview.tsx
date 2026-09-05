import { useState } from 'react';
import { definePreview } from '../../preview-contract';
import { FacetSelect, facetSelectStates, facetSelectVariants } from './index';
import type { FacetSelectState, FacetSelection } from './index';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import styles from './FacetSelect.module.css';

const options = [
  { value: 'anilist', label: 'AniList', count: 32 },
  { value: 'mangaupdates', label: 'MangaUpdates', count: 18 },
  { value: 'myanimelist', label: 'MyAnimeList', count: 9 },
] as const;

function isFacetSelectState(value: string): value is FacetSelectState {
  return facetSelectStates.some((state) => state === value);
}

function initialValue(state: FacetSelectState): FacetSelection {
  if (state === 'included') return { anilist: 'include' };
  if (state === 'excluded') return { mangaupdates: 'exclude' };
  return {};
}

function FacetDemo({ state }: { state: FacetSelectState }) {
  const [value, setValue] = useState<FacetSelection>(() => initialValue(state));

  return (
    <FacetSelect
      defaultOpen={state === 'open' || state === 'included' || state === 'excluded'}
      disabled={state === 'disabled'}
      label="Sources"
      onChange={setValue}
      options={options}
      value={value}
    />
  );
}

const facetSelectPreview = definePreview({
  id: 'facet-select',
  title: 'FacetSelect',
  category: 'Primitives',
  level: 'primitive',
  purpose: 'Inclure, exclure ou neutraliser plusieurs facettes dans un menu custom compact.',
  variants: [...facetSelectVariants],
  states: [...facetSelectStates],
  fixtures: ['AniList · 32', 'MangaUpdates · 18', 'MyAnimeList · 9'],
  sources: [
    { label: 'API publique', path: 'components/facet-select/index.ts' },
    { label: 'Contrat', path: 'components/facet-select/facet-select.contract.ts' },
    { label: 'Implémentation', path: 'components/facet-select/FacetSelect.tsx' },
    { label: 'Styles', path: 'components/facet-select/FacetSelect.module.css' },
    { label: 'Preview', path: 'components/facet-select/FacetSelect.preview.tsx' },
    { label: 'Tests', path: 'components/facet-select/FacetSelect.test.tsx' },
  ],
  dependencies: ['Icon', 'SearchField', 'color tokens', 'layout tokens', 'effects tokens', 'preview-contract'],
  accessibility: [
    'Le trigger expose aria-expanded et la relation avec le menu',
    'La recherche possède un label accessible et filtre uniquement les options visibles',
    'Chaque option annonce son libellé et son état neutre, inclus ou exclu',
    'Flèches, Escape et retour du focus sont pris en charge',
    'Chaque option reste une cible clavier native',
  ],
  usage: `import { FacetSelect } from '@tobirink/ui';`,
  render: ({ state }) => {
    const selectedState: FacetSelectState = isFacetSelectState(state) ? state : 'closed';

    return (
      <section className={styles.preview} data-state={selectedState}>
        <header className={styles.previewHeader}>
          <div>
            <p className={styles.eyebrow}>Primitive · Facettes</p>
            <h3>Un filtre, trois intentions</h3>
          </div>
          <span className={styles.index}>Custom / tri-state</span>
        </header>

        <section className={styles.section}>
          <h4 className={styles.sectionTitle}>Composition</h4>
          <div className={styles.sample}>
            <FacetDemo key={selectedState} state={selectedState} />
          </div>
        </section>

        <p className={styles.rule}>Un clic inclut, le suivant exclut, le troisième remet la facette à zéro.</p>
      </section>
    );
  },
});

export default facetSelectPreview;
