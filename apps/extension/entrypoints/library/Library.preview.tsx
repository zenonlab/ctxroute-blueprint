import { useMemo, useState } from 'react';
import { definePreview } from '@tobirink/ui/preview-contract';
import { emptyLibraryFilters } from '@tobirink/ui';
import type { LibraryFiltersValue } from '@tobirink/ui';
import '../../../../packages/ui/src/tokens/color.css';
import '../../../../packages/ui/src/tokens/layout.css';
import '../../../../packages/ui/src/tokens/effects.css';
import { Library, libraryStates, libraryVariants } from './index';
import type { LibraryState, LibraryWork } from './index';
import styles from './Library.module.css';

const works: readonly LibraryWork[] = [
  { id: 'frieren', mediaType: 'Manga', progress: '140 / 143', source: 'MangaUpdates', title: 'Frieren' },
  { id: 'dandadan', mediaType: 'Manga', progress: '186 / -', source: 'MangaUpdates', title: 'Dandadan' },
  { id: 'apothecary', mediaType: 'Anime', progress: '18 / 24', source: 'AniList', title: 'Les Carnets de l’apothicaire' },
  { id: 'witch-hat', mediaType: 'Manga', progress: '12 / 14', source: 'MangaUpdates', title: 'L’Atelier des sorciers' },
  { id: 'pluto', mediaType: 'Anime', progress: '5 / 8', source: 'AniList', title: 'Pluto' },
  { id: 'blue-period', mediaType: 'Manga', progress: '- / -', source: 'MangaUpdates', title: 'Blue Period' },
];

const options = {
  format: [{ label: 'TV', value: 'tv' }],
  genre: [{ label: 'Fantasy', value: 'fantasy' }],
  progress: [{ label: 'À commencer', value: 'new' }, { label: 'En cours', value: 'current' }, { label: 'Terminé', value: 'done' }],
  source: [{ label: 'AniList', value: 'anilist' }, { label: 'MangaUpdates', value: 'mangaupdates' }],
  status: [{ label: 'Actif', value: 'active' }, { label: 'En pause', value: 'paused' }],
  type: [{ count: 4, label: 'Manga', value: 'manga' }, { count: 2, label: 'Anime', value: 'anime' }],
  year: [{ label: '2024', value: '2024' }],
} as const;

function isState(value: string): value is LibraryState {
  return libraryStates.some((state) => state === value);
}

function LibraryDemo({ state }: { state: LibraryState }) {
  const [filters, setFilters] = useState<LibraryFiltersValue>(emptyLibraryFilters);
  const [limit, setLimit] = useState(4);
  const [message, setMessage] = useState('');
  const filtered = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase('fr');
    const includedTypes = Object.entries(filters.type).filter(([, mode]) => mode === 'include').map(([type]) => type);
    return works.filter((work) => {
      const matchesQuery = query === '' || work.title.toLocaleLowerCase('fr').includes(query);
      const matchesType = includedTypes.length === 0 || includedTypes.includes(work.mediaType.toLowerCase());
      return matchesQuery && matchesType;
    });
  }, [filters]);
  const visible = state === 'partial' ? filtered.map((work, index) => index === 1 ? { ...work, source: 'Métadonnées enregistrées' } : work).slice(0, limit) : filtered.slice(0, limit);
  const shown = state === 'empty' || state === 'loading' || state === 'error' || state === 'blocked' ? [] : visible;

  return (
    <>
      <Library
        filterOptions={options}
        filters={filters}
        hasMore={shown.length < filtered.length}
        items={shown}
        navigation={{
          activeId: 'library',
          onSearch: (query) => setMessage(query ? `Recherche globale : ${query}` : 'Bibliothèque demandée'),
          review: {
          count: 2,
          resolver: {
            canNext: false,
            canPrevious: false,
            item: {
                candidates: [
                  { candidateId: 'apothecary-anilist', href: '#apothecary-anilist', mediaType: 'Anime', provider: 'AniList', providerId: '161645', title: 'Les Carnets de l’apothicaire' },
                  { candidateId: 'apothecary-mu', href: '#apothecary-mu', mediaType: 'Manga', provider: 'MangaUpdates', providerId: '139995', title: 'The Apothecary Diaries' },
                ],
                id: 'review-apothecary',
                position: 1,
                progress: 'chapitre 37',
                revision: 'review-7',
                sourceLabel: 'Favori Chrome',
                sourceUrl: '#source-apothecary',
                title: 'Carnets apothicaire',
                total: 2,
            },
            onNext: () => undefined,
            onPrevious: () => undefined,
            onRefresh: () => setMessage('Rechargement Review demandé'),
              onRetry: () => setMessage('Nouvel essai Review demandé'),
              onSubmitDecision: (decision) => setMessage(`Décision Review : ${decision.kind}`),
              state: 'ready',
            },
          },
        }}
        onChangeFilters={(value) => { setFilters(value); setLimit(4); }}
        onDownloadExtension={() => setMessage('Téléchargement de l’extension demandé')}
        onLoadMore={() => setLimit((current) => current + 2)}
        onOpenRecovery={() => setMessage('Récupération demandée')}
        onRetry={() => setMessage('Nouvel essai demandé')}
        state={state}
      />
      <p aria-live="polite">{message}</p>
    </>
  );
}

const libraryPreview = definePreview({
  id: 'library',
  title: 'Bibliothèque',
  category: 'Surfaces',
  level: 'surface',
  purpose: 'Parcourir les œuvres enregistrées, filtrer et consulter la progression conservée.',
  presentation: 'page',
  variants: [...libraryVariants],
  states: [...libraryStates],
  fixtures: ['6 œuvres enregistrées · pagination par 4 · progression automatique sur les cartes'],
  sources: [
    { label: 'API publique', path: 'entrypoints/library/index.ts' },
    { label: 'Contrat partagé', path: 'packages/ui/src/features/library/library-surface/library-surface.contract.ts' },
    { label: 'Surface partagée', path: 'packages/ui/src/features/library/library-surface/Library.tsx' },
    { label: 'Styles partagés', path: 'packages/ui/src/features/library/library-surface/Library.module.css' },
    { label: 'Preview', path: 'entrypoints/library/Library.preview.tsx' },
    { label: 'Tests', path: 'entrypoints/library/Library.test.tsx' },
  ],
  dependencies: ['MemberNavigation', 'LibraryFilters', 'WorkCard', 'FeedbackState', 'Button', 'Status'],
  accessibility: [
    'Le titre principal nomme la surface et chaque carte conserve un lien clavier',
    'Les états asynchrones utilisent les composants FeedbackState partagés',
    'Chaque progression conservée reste lisible dans la zone dédiée de WorkCard',
  ],
  usage: `import { Library } from '@tobirink/ui';`,
  render: ({ state }) => (
    <section className={styles.preview}>
      <LibraryDemo key={state} state={isState(state) ? state : 'ready'} />
    </section>
  ),
});

export default libraryPreview;
