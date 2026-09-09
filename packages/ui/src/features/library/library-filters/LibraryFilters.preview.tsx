import { useState } from 'react';
import { definePreview } from '../../../preview-contract';
import '../../../tokens/color.css';
import '../../../tokens/layout.css';
import '../../../tokens/effects.css';
import {
  LibraryFilters,
  emptyLibraryFilters,
  libraryFiltersStates,
  libraryFiltersVariants,
} from './index';
import type { LibraryFilterOptions, LibraryFiltersState, LibraryFiltersValue } from './index';
import styles from './LibraryFilters.module.css';

const options: LibraryFilterOptions = {
  format: [{ count: 31, label: 'TV', value: 'tv' }],
  genre: [{ count: 24, label: 'Fantasy', value: 'fantasy' }],
  type: [
    { count: 48, label: 'Manga', value: 'manga' },
    { count: 17, label: 'Anime', value: 'anime' },
    { count: 9, label: 'Roman', value: 'novel' },
  ],
  status: [
    { count: 51, label: 'Suivi', value: 'followed' },
    { count: 12, label: 'Terminé', value: 'completed' },
    { count: 4, label: 'À vérifier', value: 'review' },
  ],
  progress: [
    { count: 7, label: 'Non commencé', value: 'not-started' },
    { count: 39, label: 'En cours', value: 'ongoing' },
    { count: 28, label: 'Terminé', value: 'finished' },
  ],
  source: [{ count: 48, label: 'AniList', value: 'anilist' }],
  year: [{ count: 8, label: '2024', value: '2024' }],
};

const filteredValue: LibraryFiltersValue = {
  format: {},
  genre: { fantasy: 'include' },
  progress: { ongoing: 'include' },
  query: 'frieren',
  sort: 'POPULARITY_DESC',
  source: {},
  status: {},
  type: { manga: 'include' },
  year: {},
};

function isState(value: string): value is LibraryFiltersState {
  return libraryFiltersStates.some((state) => state === value);
}

function LibraryFiltersDemo({ state }: { state: LibraryFiltersState }) {
  const [value, setValue] = useState<LibraryFiltersValue>(state === 'filtered' ? filteredValue : emptyLibraryFilters);

  return (
    <LibraryFilters
      disabled={state === 'disabled'}
      onChange={setValue}
      options={options}
      value={value}
    />
  );
}

const libraryFiltersPreview = definePreview({
  id: 'library-filters',
  title: 'Recherche & filtres',
  category: 'Métier',
  level: 'domain',
  purpose: 'Rechercher et combiner des facettes sérialisables dans la bibliothèque.',
  variants: [...libraryFiltersVariants],
  states: [...libraryFiltersStates],
  fixtures: ['74 œuvres · tri et sept facettes persistantes'],
  sources: [
    { label: 'API publique', path: 'features/library/library-filters/index.ts' },
    { label: 'Contrat', path: 'features/library/library-filters/library-filters.contract.ts' },
    { label: 'Filtres', path: 'features/library/library-filters/LibraryFilters.tsx' },
    { label: 'Styles', path: 'features/library/library-filters/LibraryFilters.module.css' },
    { label: 'Preview', path: 'features/library/library-filters/LibraryFilters.preview.tsx' },
    { label: 'Tests', path: 'features/library/library-filters/LibraryFilters.test.tsx' },
  ],
  dependencies: ['SearchField', 'FacetSelect', 'design tokens'],
  accessibility: [
    'La recherche native possède un nom explicite',
    'Les sept facettes conservent clavier, Escape, recherche interne et sélection multiple',
    'Chaque sélection incluse ou exclue reste annoncée par son nom accessible',
  ],
  usage: `import { LibraryFilters } from '@tobirink/ui/features/library/library-filters';`,
  render: ({ state }) => {
    const selectedState = isState(state) ? state : 'default';

    return (
      <section className={styles.preview}>
        <header className={styles.previewHeader}>
          <div>
            <p className={styles.eyebrow}>Métier · Bibliothèque</p>
            <h3>Trouver sans changer de langage</h3>
          </div>
          <span className={styles.index}>Combinable</span>
        </header>
        <div className={styles.sample}>
          <LibraryFiltersDemo key={selectedState} state={selectedState} />
        </div>
        <p className={styles.rule}>La recherche générale et la recherche interne des facettes réutilisent le même champ.</p>
      </section>
    );
  },
});

export default libraryFiltersPreview;
