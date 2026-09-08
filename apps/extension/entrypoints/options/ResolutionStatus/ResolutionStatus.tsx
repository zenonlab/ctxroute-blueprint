import { Button, Surface } from '@tobirink/ui';
import styles from './ResolutionStatus.module.css';

export interface ResolutionStatusProps {
  counts?: { processing: number; retryable: number; unsupported: number } | undefined;
  state: 'loading' | 'ready' | 'error';
  onRefresh: () => void;
}

export function ResolutionStatus({ counts, onRefresh, state }: ResolutionStatusProps) {
  return <section className={styles.section} aria-label="Analyse des favoris"><Surface>
    <div className={styles.content}>
      <h2>Analyse des favoris</h2>
      <p>La cloche contient uniquement les ambiguïtés et les recherches terminées sans correspondance.</p>
      {state === 'loading' ? <p role="status">Lecture de l’état local…</p> : null}
      {state === 'error' ? <p role="alert">L’état local est indisponible. Réessayez.</p> : null}
      {counts ? <dl className={styles.counts}>
        <dt>Traitement en cours</dt><dd>{counts.processing}</dd>
        <dt>Résolution à reprendre après une panne fournisseur</dt><dd>{counts.retryable}</dd>
        <dt>Liens non pris en charge</dt><dd>{counts.unsupported}</dd>
      </dl> : null}
      <Button disabled={state === 'loading'} onClick={onRefresh}>Actualiser l’état</Button>
    </div>
  </Surface></section>;
}
