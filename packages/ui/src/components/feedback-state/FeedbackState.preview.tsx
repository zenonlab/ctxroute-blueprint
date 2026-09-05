import { definePreview } from '../../preview-contract';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import { Button } from '../button';
import {
  FeedbackState,
  feedbackStateStates,
  feedbackStateVariants,
} from './index';
import type { FeedbackStateState, FeedbackStateVariant } from './index';
import styles from './FeedbackState.module.css';

function isVariant(value: string): value is FeedbackStateVariant {
  return feedbackStateVariants.some((variant) => variant === value);
}

function isState(value: string): value is FeedbackStateState {
  return feedbackStateStates.some((state) => state === value);
}

const content = {
  empty: {
    description: 'Ajoutez une œuvre pour commencer votre bibliothèque.',
    title: 'Bibliothèque vide',
  },
  error: {
    description: 'Les données locales n’ont pas pu être relues.',
    title: 'Chargement impossible',
  },
  loading: {
    description: 'Lecture de votre bibliothèque locale.',
    title: 'Chargement…',
  },
} satisfies Record<FeedbackStateVariant, { description: string; title: string }>;

const feedbackStatePreview = definePreview({
  id: 'feedback-states',
  title: 'Loading, Empty & Error',
  category: 'Primitives',
  level: 'primitive',
  purpose: 'Expliquer un état non nominal dans une présentation inline ou centrée.',
  variants: [...feedbackStateVariants],
  states: [...feedbackStateStates],
  fixtures: ['Bibliothèque locale'],
  sources: [
    { label: 'API publique', path: 'components/feedback-state/index.ts' },
    { label: 'Contrat', path: 'components/feedback-state/feedback-state.contract.ts' },
    { label: 'État', path: 'components/feedback-state/FeedbackState.tsx' },
    { label: 'Styles', path: 'components/feedback-state/FeedbackState.module.css' },
    { label: 'Preview', path: 'components/feedback-state/FeedbackState.preview.tsx' },
    { label: 'Tests', path: 'components/feedback-state/FeedbackState.test.tsx' },
  ],
  dependencies: ['Button', 'Icon', 'color tokens', 'layout tokens', 'effects tokens'],
  accessibility: [
    'Loading et Empty utilisent un statut poli; Error utilise une alerte',
    'Le chargement expose aria-busy et neutralise son animation en mouvement réduit',
    'Un état vide peut proposer une prochaine action réelle; une erreur doit être déclarée récupérable',
  ],
  usage: `import { FeedbackState } from '@tobirink/ui/components/feedback-state';`,
  render: ({ state, variant }) => {
    const selectedVariant: FeedbackStateVariant = isVariant(variant) ? variant : 'loading';
    const selectedState: FeedbackStateState = isState(state) ? state : 'default';
    const selectedContent = content[selectedVariant];

    return (
      <section className={styles.preview}>
        <header className={styles.previewHeader}>
          <div>
            <p className={styles.eyebrow}>Primitive · Retour système</p>
            <h3>Dire seulement ce qui se passe</h3>
          </div>
          <span className={styles.index}>État isolé</span>
        </header>

        <div className={styles.example}>
          {selectedVariant === 'error' && selectedState === 'recoverable' ? (
            <FeedbackState
              action={<Button icon="refresh-cw">Réessayer</Button>}
              description={selectedContent.description}
              kind="error"
              recoverable
              title={selectedContent.title}
            />
          ) : (
            <FeedbackState
              description={selectedContent.description}
              kind={selectedVariant}
              title={selectedContent.title}
            />
          )}
        </div>

        <p className={styles.rule}>Aucune récupération n’est suggérée si le produit ne peut pas l’exécuter.</p>
      </section>
    );
  },
});

export default feedbackStatePreview;
