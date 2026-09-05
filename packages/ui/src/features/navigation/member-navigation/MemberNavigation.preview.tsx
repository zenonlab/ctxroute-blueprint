import { useState } from 'react';
import { definePreview } from '../../../preview-contract';
import '../../../tokens/color.css';
import '../../../tokens/layout.css';
import '../../../tokens/effects.css';
import { MemberNavigation, memberNavigationStates, memberNavigationVariants } from './index';
import type { MemberNavigationState } from './index';
import styles from './MemberNavigation.module.css';

function isState(value: string): value is MemberNavigationState {
  return memberNavigationStates.some((state) => state === value);
}

function MemberNavigationDemo({ state }: { state: MemberNavigationState }) {
  const [message, setMessage] = useState('');
  const [reviewCount, setReviewCount] = useState(state === 'default' ? 0 : 3);
  const [reviewPosition, setReviewPosition] = useState(1);

  return (
    <MemberNavigation
      activeId="library"
      onSearch={(query) => setMessage(query ? `Recherche : ${query}` : 'Bibliothèque demandée')}
      review={{
        count: reviewCount,
        resolver: {
          canNext: reviewPosition < reviewCount,
          canPrevious: reviewPosition > 1,
          item: state === 'reviews' ? {
            candidates: [
              { candidateId: 'apothecary-anilist', href: '#apothecary-anilist', mediaType: 'Anime', provider: 'AniList', providerId: '161645', title: 'Les Carnets de l’apothicaire' },
              { candidateId: 'apothecary-mu', href: '#apothecary-mu', mediaType: 'Manga', provider: 'MangaUpdates', providerId: '139995', title: 'The Apothecary Diaries' },
            ],
            id: 'review-apothecary',
            position: reviewPosition,
            progress: 'chapitre 37',
            revision: 'review-7',
            sourceLabel: 'Chapitre 37',
            sourceUrl: '#source-apothecary',
            title: 'Carnets apothicaire',
            total: reviewCount,
          } : undefined,
          onNext: () => {
            setMessage('Review passée pour le moment');
            setReviewPosition((position) => Math.min(reviewCount, position + 1));
          },
          onPrevious: () => setReviewPosition((position) => Math.max(1, position - 1)),
          onRefresh: () => setMessage('Rechargement demandé'),
          onRetry: () => setMessage('Nouvel essai demandé'),
          onSubmitDecision: (decision) => {
            setMessage(`Décision enregistrée : ${decision.kind}`);
            setReviewCount((count) => Math.max(0, count - 1));
          },
          state: state === 'reviews' ? 'ready' : 'empty',
        },
      }}
    >
      <main className={styles.previewContent}>
        <p className={styles.previewEyebrow}>Bibliothèque locale</p>
        <h1>Vos œuvres</h1>
        <p>Le shell complet reprend la navigation, la recherche et le resolver Review FavLib.</p>
        <p aria-live="polite">{message}</p>
      </main>
    </MemberNavigation>
  );
}

const memberNavigationPreview = definePreview({
  id: 'member-navigation',
  title: 'Shell membre',
  category: 'Surfaces',
  level: 'surface',
  purpose: 'Encadrer les pages principales avec la recherche et le resolver Review FavLib.',
  presentation: 'page',
  variants: [...memberNavigationVariants],
  states: [...memberNavigationStates],
  fixtures: ['Shell FavLib · Bibliothèque active · resolver de 3 correspondances'],
  sources: [
    { label: 'API publique', path: 'features/navigation/member-navigation/index.ts' },
    { label: 'Contrat', path: 'features/navigation/member-navigation/member-navigation.contract.ts' },
    { label: 'Navigation', path: 'features/navigation/member-navigation/MemberNavigation.tsx' },
    { label: 'Styles', path: 'features/navigation/member-navigation/MemberNavigation.module.css' },
    { label: 'Preview', path: 'features/navigation/member-navigation/MemberNavigation.preview.tsx' },
    { label: 'Tests', path: 'features/navigation/member-navigation/MemberNavigation.test.tsx' },
  ],
  dependencies: ['Navigation', 'SearchField', 'Button', 'ReviewResolver'],
  accessibility: [
    'Les liens actifs conservent aria-current et les deux navigations possèdent un nom distinct',
    'Le déclencheur Review est nommé, masque le badge à zéro et garde une cible tactile de 44 px',
    'La cloche reste visible au repos et distingue ses états hover, focus et ouvert',
    'La cloche ouvre une bulle non modale ancrée, Escape et le clic extérieur la ferment puis rendent le focus au déclencheur',
    'La recherche possède un label, se soumet avec Entrée et annonce son résultat dans la fixture',
  ],
  usage: `import { MemberNavigation } from '@tobirink/ui';`,
  render: ({ state }) => (
    <section className={styles.preview}>
      <MemberNavigationDemo key={state} state={isState(state) ? state : 'default'} />
    </section>
  ),
});

export default memberNavigationPreview;
