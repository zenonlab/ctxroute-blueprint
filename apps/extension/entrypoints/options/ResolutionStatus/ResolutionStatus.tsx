import { Button, Surface } from '@tobirink/ui';
import styles from './ResolutionStatus.module.css';
import type { ExtensionDiagnosticEvent } from '../../../runtime/extension-diagnostics';

export interface ResolutionStatusProps {
  counts?: { observed: number; processing: number; retryable: number; unsupported: number; internalErrors?: number; collectivePending?: number } | undefined;
  diagnostics?: { enabled: boolean; events: readonly ExtensionDiagnosticEvent[] } | undefined;
  inventory?: { startedAt?: string; status: 'not-started' | 'active' | 'complete' } | undefined;
  state: 'loading' | 'running' | 'ready' | 'error';
  onReconcile: () => void;
  onDiagnosticsToggle: () => void;
  onRefresh: () => void;
}

const diagnosticLabels = {
  inventory: 'Inventaire',
  resolution: 'Résolution',
  run: 'Exécution',
} as const;
const diagnosticOutcomeLabels = {
  complete: 'terminé',
  failed: 'interrompu',
  retryable: 'à reprendre',
  started: 'démarré',
} as const;

function diagnosticCounts(event: ExtensionDiagnosticEvent): string | undefined {
  if (event.stage === 'inventory' && event.counts) return `${event.counts.observed ?? 0} lus · ${event.counts.batches ?? 0} lots`;
  if (event.stage === 'resolution' && event.counts) return `${event.counts.completed ?? 0} terminées · ${event.counts.retried ?? 0} reprises · ${event.counts.blocked ?? 0} bloquées`;
  return undefined;
}

export function ResolutionStatus({ counts, diagnostics, inventory, onDiagnosticsToggle, onReconcile, onRefresh, state }: ResolutionStatusProps) {
  const latestDiagnostic = diagnostics?.events.at(-1);
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
      {diagnostics ? <div className={styles.diagnostics}>
        <h3>Diagnostic local</h3>
        <p role="status">{diagnostics.enabled ? 'Activé' : 'Désactivé'} · {diagnostics.events.length} événements conservés sur 100 maximum.</p>
        {latestDiagnostic ? <p>Dernier état : {diagnosticLabels[latestDiagnostic.stage]} · {diagnosticOutcomeLabels[latestDiagnostic.outcome]} · passage {latestDiagnostic.runId} · {latestDiagnostic.occurredAt}{diagnosticCounts(latestDiagnostic) ? ` · ${diagnosticCounts(latestDiagnostic)}` : ''}</p> : <p>Aucun événement enregistré.</p>}
        <Button disabled={state === 'loading' || state === 'running'} onClick={onDiagnosticsToggle}>{diagnostics.enabled ? 'Désactiver le diagnostic' : 'Activer le diagnostic'}</Button>
      </div> : null}
      <div className={styles.actions}>
        <Button disabled={state === 'loading' || state === 'running'} onClick={onReconcile} variant="primary">Relancer l’analyse</Button>
        <Button disabled={state === 'loading' || state === 'running'} onClick={onRefresh}>Actualiser l’état</Button>
      </div>
    </div>
  </Surface></section>;
}
