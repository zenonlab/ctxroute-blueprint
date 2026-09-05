import { useState } from 'react';
import { definePreview } from '@tobirink/ui/preview-contract';
import '../../../../packages/ui/src/tokens/color.css';
import '../../../../packages/ui/src/tokens/layout.css';
import '../../../../packages/ui/src/tokens/effects.css';
import { Review, reviewStates, reviewVariants } from './index';
import type { ReviewDecision, ReviewState, ReviewWorkItem } from './index';
import styles from './Review.module.css';

const queue: readonly ReviewWorkItem[] = [
  {
    candidates: [
      { aliases: ['The Apothecary Diaries'], candidateId: 'apothecary-anilist', href: '#apothecary-anilist', mediaType: 'Anime', provider: 'anilist', providerId: '161645', title: 'Les Carnets de l’apothicaire' },
      { aliases: ['Kusuriya no Hitorigoto'], candidateId: 'apothecary-mu', href: '#apothecary-mu', mediaType: 'Manga', provider: 'mangaupdates', providerId: '139995', title: 'The Apothecary Diaries' },
    ],
    id: 'review-apothecary',
    position: 1,
    revision: 'review-7',
    sourceLabel: 'Chapitre 37',
    sourceUrl: 'https://example.test/apothecary',
    title: 'Carnets apothicaire',
    total: 2,
  },
  {
    candidates: [
      { candidateId: 'frieren-anilist', href: '#frieren-anilist', mediaType: 'Manga', provider: 'anilist', providerId: '118586', title: 'Frieren' },
    ],
    id: 'review-frieren',
    position: 2,
    revision: 'review-3',
    sourceLabel: 'Chapitre 140',
    sourceUrl: 'https://example.test/frieren',
    title: 'Frieren chapitre',
    total: 2,
  },
];

function isState(value: string): value is ReviewState {
  return reviewStates.some((state) => state === value);
}

function ReviewDemo({ state }: { state: ReviewState }) {
  const [readRevision, setReadRevision] = useState(state === 'conflict' ? 'review-6' : queue[0].revision);
  const [result, setResult] = useState<ReviewDecision | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedItem = queue[selectedIndex];
  const item = { ...selectedItem, revision: state === 'conflict' ? readRevision : selectedItem.revision };
  const selectIndex = (index: number) => {
    setResult(null);
    setSelectedIndex(index);
  };

  return (
    <>
      <Review
        navigation={{
          onSearch: () => undefined,
          review: {
            count: queue.length,
            resolver: {
              canNext: selectedIndex < queue.length - 1,
              canPrevious: selectedIndex > 0,
              item: state === 'empty' || state === 'loading' || state === 'error' ? undefined : item,
              onNext: () => selectIndex(Math.min(queue.length - 1, selectedIndex + 1)),
              onPrevious: () => selectIndex(Math.max(0, selectedIndex - 1)),
              onRefresh: () => setReadRevision(selectedItem.revision),
              onRetry: () => setResult(null),
              onSubmitDecision: setResult,
              state: state === 'loading' ? 'loading' : state === 'error' ? 'error' : state === 'empty' ? 'empty' : state,
            },
          },
        }}
        onRetry={() => setResult(null)}
        state={state}
      />
      <p aria-live="polite">{result ? `Décision prête · ${result.kind}` : ''}</p>
    </>
  );
}

const reviewPreview = definePreview({
  id: 'review',
  title: 'Panneau Review',
  category: 'Surfaces',
  level: 'surface',
  purpose: 'Vérifier que Review reste un panneau de choix ouvert uniquement par la cloche du header.',
  presentation: 'page',
  variants: [...reviewVariants],
  states: [...reviewStates],
  fixtures: ['2 Reviews locales · 2 fournisseurs · révision protégée'],
  sources: [
    { label: 'API publique', path: 'entrypoints/review/index.ts' },
    { label: 'Contrat', path: 'entrypoints/review/review.contract.ts' },
    { label: 'Surface', path: 'entrypoints/review/Review.tsx' },
    { label: 'Styles', path: 'entrypoints/review/Review.module.css' },
    { label: 'Preview', path: 'entrypoints/review/Review.preview.tsx' },
    { label: 'Tests', path: 'entrypoints/review/Review.test.tsx' },
  ],
  dependencies: ['MemberNavigation', 'ReviewResolver'],
  accessibility: [
    'La cloche adjacente à la recherche est l’unique entrée Review visible',
    'La bulle non modale rend le focus au déclencheur après fermeture',
    'La page Review affiche toujours un état centré avec une icône Lucide',
    'Le resolver partagé réserve la WorkCard aux candidats et soumet directement la décision',
    'Les flèches changent de Review sans enregistrer de décision',
    'Le conflit masque les actions de décision et propose une nouvelle lecture',
  ],
  usage: `import { Review } from '@tobirink/extension/entrypoints/review';`,
  render: ({ state }) => (
    <section className={styles.preview}>
      <ReviewDemo key={state} state={isState(state) ? state : 'ready'} />
    </section>
  ),
});

export default reviewPreview;
