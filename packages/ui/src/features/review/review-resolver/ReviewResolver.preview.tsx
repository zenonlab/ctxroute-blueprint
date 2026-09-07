import { useState } from 'react';
import { definePreview } from '../../../preview-contract';
import '../../../tokens/color.css';
import '../../../tokens/layout.css';
import '../../../tokens/effects.css';
import { ReviewResolver, reviewResolverStates } from './index';
import type { ReviewDecision, ReviewResolverState } from './index';
import styles from './ReviewResolver.module.css';

const item = {
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
  total: 3,
} as const;

function isState(value: string): value is ReviewResolverState {
  return reviewResolverStates.some((state) => state === value);
}

function ReviewResolverDemo({ state }: { state: ReviewResolverState }) {
  const [result, setResult] = useState<ReviewDecision | null>(null);
  const [position, setPosition] = useState(1);
  const currentItem = state === 'partial' ? { ...item, candidates: [], position } : { ...item, position };
  return (
    <section className={styles.preview}>
      <ReviewResolver
        canNext={position < item.total}
        canPrevious={position > 1}
        item={state === 'loading' || state === 'empty' || state === 'error' || state === 'success' ? undefined : currentItem}
        onNext={() => setPosition((current) => Math.min(item.total, current + 1))}
        onPrevious={() => setPosition((current) => Math.max(1, current - 1))}
        onRefresh={() => setResult(null)}
        onRetry={() => setResult(null)}
        onSubmitDecision={setResult}
        state={state}
      />
      <p aria-live="polite">{result ? `Décision prête · ${result.kind}` : ''}</p>
    </section>
  );
}

const reviewResolverPreview = definePreview({
  id: 'review-resolver',
  title: 'Resolver Review',
  category: 'Métier',
  level: 'domain',
  purpose: 'Résoudre un favori ambigu sans transformer la source en carte candidate.',
  variants: ['candidate-only'],
  states: [...reviewResolverStates],
  fixtures: ['1 favori compact · 2 candidates WorkCard · décision directe', 'file sans candidats en état partiel'],
  sources: [
    { label: 'API publique', path: 'features/review/review-resolver/index.ts' },
    { label: 'Contrat', path: 'features/review/review-resolver/review-resolver.contract.ts' },
    { label: 'Implémentation', path: 'features/review/review-resolver/ReviewResolver.tsx' },
    { label: 'Styles', path: 'features/review/review-resolver/ReviewResolver.module.css' },
    { label: 'Preview', path: 'features/review/review-resolver/ReviewResolver.preview.tsx' },
    { label: 'Tests', path: 'features/review/review-resolver/ReviewResolver.test.tsx' },
  ],
  dependencies: ['WorkCard', 'Button', 'Status', 'FeedbackState'],
  accessibility: [
    'La position et les changements de résultat sont annoncés sans détourner le focus',
    'Les flèches parcourent la file sans produire de décision et se désactivent aux bornes',
    'Le formulaire manuel possède un label persistant et des erreurs associées',
    'Busy désactive toutes les décisions tandis que la source reste consultable',
    'Le format étroit conserve deux cartes sans débordement horizontal',
  ],
  usage: `import { ReviewResolver } from '@tobirink/ui';`,
  render: ({ state }) => <ReviewResolverDemo key={state} state={isState(state) ? state : 'ready'} />,
});

export default reviewResolverPreview;
