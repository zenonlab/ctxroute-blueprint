import { Button, FeedbackState, MemberNavigation } from '@tobirink/ui';
import type { MemberNavigationConfig } from '@tobirink/ui';
import type { ReviewState, ReviewVariant } from './review.contract';
import styles from './Review.module.css';

export interface ReviewProps {
  navigation: MemberNavigationConfig;
  onRetry: () => void;
  state: ReviewState;
  variant?: ReviewVariant;
}

const reviewCopy = {
  ready: {
    description: 'Utilisez la cloche à droite de la recherche pour parcourir les choix.',
    title: 'Review est intégrée aux notifications',
  },
  empty: {
    description: 'Les nouvelles correspondances apparaîtront dans la cloche.',
    title: 'Aucune correspondance à vérifier',
  },
  partial: {
    description: 'Le contexte enregistré reste accessible dans la cloche en attendant les candidats.',
    title: 'Certaines métadonnées manquent',
  },
  offline: {
    description: 'Les décisions disponibles localement restent accessibles depuis la cloche.',
    title: 'Review reste disponible hors ligne',
  },
  conflict: {
    description: 'Rouvrez la cloche puis relisez la correspondance avant de choisir.',
    title: 'La correspondance a changé',
  },
} as const;

export function Review({
  navigation,
  onRetry,
  state,
  variant = 'resolution',
}: ReviewProps) {
  return (
    <MemberNavigation {...navigation}>
      <main aria-label="Review" className={styles.review} data-state={state} data-variant={variant}>
        {state === 'loading' ? (
          <FeedbackState
            className={styles.centeredState}
            description="Lecture des correspondances enregistrées."
            kind="loading"
            layout="centered"
            title="Préparation de Review…"
          />
        ) : state === 'error' ? (
          <FeedbackState
            action={<Button icon="refresh-cw" onClick={onRetry}>Réessayer</Button>}
            className={styles.centeredState}
            description="Les données sont conservées."
            kind="error"
            layout="centered"
            recoverable
            title="Review ne peut pas être relue"
          />
        ) : (
          <FeedbackState
            className={styles.centeredState}
            description={reviewCopy[state].description}
            icon="bell"
            kind="empty"
            layout="centered"
            title={reviewCopy[state].title}
          />
        )}
      </main>
    </MemberNavigation>
  );
}
