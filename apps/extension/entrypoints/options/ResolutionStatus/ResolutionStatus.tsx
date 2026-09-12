import { Button, Surface } from '@tobirink/ui';
import styles from './ResolutionStatus.module.css';

export interface ResolutionStatusProps {
  counts?: { observed: number; processing: number; retryable: number; unsupported: number; internalErrors?: number; collectivePending?: number } | undefined;
  inventory?: { startedAt?: string; status: 'not-started' | 'active' | 'complete' } | undefined;
  state: 'loading' | 'running' | 'ready' | 'error';
  onReconcile: () => void;
  onRefresh: () => void;
}

export function ResolutionStatus({ counts, inventory, onReconcile, onRefresh, state }: ResolutionStatusProps) {
  return <section className={styles.section} aria-label="Analyse des favoris"><Surface>
    <div className={styles.content}>
      <h2>Analyse des favoris</h2>
      <p>La cloche contient uniquement les ambiguïtés et les recherches terminées sans correspondance.</p>
      {state === 'loading' ? <p role="status">Lecture de l’état local…</p> : null}
      {state === 'running' ? <p role="status">Nouvelle analyse en cours…</p> : null}
      {state === 'error' ? <p role="alert">L’état local est indisponible. Réessayez.</p> : null}
      {counts ? <dl className={styles.counts}>
        <dt>Favoris observés</dt><dd>{counts.observed}</dd>
        <dt>Inventaire</dt><dd>{inventory?.status === 'complete' ? 'Complet' : inventory?.status === 'active' ? 'À poursuivre' : 'Pas démarré'}</dd>
        <dt>Traitement en cours</dt><dd>{counts.processing}</dd>
        <dt>Résolutions en attente de reprise</dt><dd>{counts.retryable}</dd>
        {counts.internalErrors ? <><dt>Dont erreurs internes</dt><dd>{counts.internalErrors}</dd></> : null}
        {counts.collectivePending ? <><dt>Dont attente du service collectif</dt><dd>{counts.collectivePending}</dd></> : null}
        <dt>Liens non pris en charge</dt><dd>{counts.unsupported}</dd>
      </dl> : null}
      <div className={styles.actions}>
        <Button disabled={state === 'loading' || state === 'running'} onClick={onReconcile} variant="primary">Relancer l’analyse</Button>
        <Button disabled={state === 'loading' || state === 'running'} onClick={onRefresh}>Actualiser l’état</Button>
      </div>
    </div>
  </Surface></section>;
}
