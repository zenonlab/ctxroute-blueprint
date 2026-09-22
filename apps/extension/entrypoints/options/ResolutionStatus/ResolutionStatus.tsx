import { Button, Surface } from '@tobirink/ui';
import styles from './ResolutionStatus.module.css';
import type { ExtensionDiagnosticEvent } from '../../../runtime/extension-diagnostics';

export interface ResolutionStatusProps {
  controller?: { paused: boolean; state: 'idle' | 'inventory' | 'presence' | 'resolving' | 'waiting-provider' | 'blocked' | 'paused' | 'complete' } | undefined;
  counts?: { observed: number; processing: number; resolved: number; review: number; retryable: number; blocked: number; unsupported: number; internalErrors?: number; publicDiscoveryPending?: number; admissionWaiting?: number; rateLimited?: number; networkErrors?: number; actionRequired?: number; providerPaused?: number } | undefined;
  diagnostics?: { enabled: boolean; events: readonly ExtensionDiagnosticEvent[] } | undefined;
  inventory?: { continuationAt?: string; startedAt?: string; status: 'not-started' | 'inventory' | 'presence' | 'complete' } | undefined;
  state: 'loading' | 'running' | 'ready' | 'error';
  onReconcile: () => void;
  onControl: (action: 'pause' | 'resume' | 'retry-blocked' | 'retry-provider-unavailable') => void;
  onDiagnosticsToggle: () => void;
  onRefresh: () => void;
}

const diagnosticLabels = {
  inventory: 'Inventaire',
  resolution: 'Résolution',
  run: 'Exécution',
  transport: 'Transport',
  projection: 'Projection',
  continuation: 'Reprise',
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

const controllerLabels = {
  blocked: 'Des tâches ont atteint la limite automatique', complete: 'Bibliothèque à jour', idle: 'Prêt à commencer', inventory: 'Lecture des favoris', paused: 'Analyse en pause', presence: 'Vérification des favoris encore présents', resolving: 'Identification des œuvres', 'waiting-provider': 'Attente avant une nouvelle tentative fournisseur',
} as const;

export function ResolutionStatus({ controller, counts, diagnostics, inventory, onControl, onDiagnosticsToggle, onReconcile, onRefresh, state }: ResolutionStatusProps) {
  const latestDiagnostic = diagnostics?.events.at(-1);
  const waitingLabel = counts?.admissionWaiting
    ? 'Mise en file des demandes publiques'
    : counts?.publicDiscoveryPending
      ? counts.internalErrors ? 'Attente du cache public et reprise après erreur locale' : 'Attente des résultats du cache public'
      : counts?.providerPaused || counts?.rateLimited
        ? 'Attente de la réouverture des fournisseurs'
        : counts?.networkErrors
          ? 'Reprise après indisponibilité réseau'
          : counts?.internalErrors ? 'Reprise après erreur locale' : 'Attente avant une nouvelle tentative';
  const inventoryLabel = inventory?.status === 'complete'
    ? 'Inventaire vérifié'
    : inventory?.status === 'presence'
      ? 'Vérification des favoris encore présents'
      : inventory?.status === 'inventory'
        ? 'Lecture des favoris'
        : 'Prêt à commencer';
  const actionLabel = inventory?.status === 'complete' ? 'Vérifier à nouveau' : inventory?.status === 'not-started' ? 'Commencer l’analyse' : 'Reprendre maintenant';
  return <section className={styles.section} aria-label="Analyse des favoris"><Surface>
    <div className={styles.content}>
      <h2>Analyse des favoris</h2>
      <p>TobiRink lit vos favoris par petits lots, vérifie lesquels sont encore présents, puis identifie les œuvres et récupère leurs informations.</p>
      <ol className={styles.steps} aria-label="Étapes de préparation">
        <li>Lire les favoris du navigateur</li>
        <li>Vérifier les favoris encore présents</li>
        <li>Identifier et enrichir les œuvres</li>
        <li>Afficher seulement les choix qui demandent votre aide</li>
      </ol>
      {state === 'loading' ? <p role="status">Lecture de l’état local…</p> : null}
      {state === 'running' ? <p role="status">Analyse en cours. Cette page peut rester ouverte ou être fermée.</p> : null}
      {state === 'error' ? <p role="alert">L’état local est indisponible. Réessayez.</p> : null}
      {inventory ? <div className={styles.current} role="status">
        <strong>{controller?.state === 'waiting-provider' ? waitingLabel : controller ? controllerLabels[controller.state] : inventoryLabel}</strong>
        {inventory.status === 'complete' && counts && counts.processing === 0 && counts.retryable === 0 && counts.blocked === 0 ? <span>Votre bibliothèque locale est à jour.</span> : null}
        {inventory.continuationAt ? <span>Prochaine reprise automatique : <time dateTime={inventory.continuationAt}>{new Date(inventory.continuationAt).toLocaleString('fr-FR')}</time>.</span> : null}
      </div> : null}
      {counts ? <dl className={styles.counts}>
        <dt>Favoris observés</dt><dd>{counts.observed}</dd>
        <dt>Préparation</dt><dd>{inventoryLabel}</dd>
        <dt>Traitement en cours</dt><dd>{counts.processing}</dd>
        <dt>Œuvres identifiées</dt><dd>{counts.resolved}</dd>
        <dt>Choix à examiner</dt><dd>{counts.review}</dd>
        <dt>Résolutions en attente de reprise</dt><dd>{counts.retryable}</dd>
        {counts.blocked ? <><dt>Bloquées après huit tentatives</dt><dd>{counts.blocked}</dd></> : null}
        {counts.internalErrors ? <><dt>Dont erreurs internes</dt><dd>{counts.internalErrors}</dd></> : null}
        {counts.publicDiscoveryPending ? <><dt>Dont attente du cache public</dt><dd>{counts.publicDiscoveryPending}</dd></> : null}
        {counts.admissionWaiting ? <><dt>En attente d’admission</dt><dd>{counts.admissionWaiting}</dd></> : null}
        {counts.rateLimited ? <><dt>Limitation temporaire du service</dt><dd>{counts.rateLimited}</dd></> : null}
        {counts.networkErrors ? <><dt>Réseau indisponible, reprise programmée</dt><dd>{counts.networkErrors}</dd></> : null}
        {counts.providerPaused ? <><dt>Traitement fournisseur indisponible</dt><dd>{counts.providerPaused}</dd></> : null}
        {counts.actionRequired ? <><dt>Erreur de réponse nécessitant une action</dt><dd>{counts.actionRequired}</dd></> : null}
        <dt>Liens non pris en charge</dt><dd>{counts.unsupported}</dd>
      </dl> : null}
      {counts?.unsupported ? <p>« Liens non pris en charge » ne signifie pas que les liens sont invalides : leur identité peut manquer, leur source être absente ou leur contenu être hors périmètre.</p> : null}
      {diagnostics ? <div className={styles.diagnostics}>
        <h3>Diagnostic local</h3>
        <p role="status">{diagnostics.enabled ? 'Activé' : 'Désactivé'} · {diagnostics.events.length} événements conservés sur 100 maximum.</p>
        {latestDiagnostic ? <p>Dernier état : {diagnosticLabels[latestDiagnostic.stage]} · {diagnosticOutcomeLabels[latestDiagnostic.outcome]} · passage {latestDiagnostic.runId} · {latestDiagnostic.occurredAt}{latestDiagnostic.operation ? ` · ${latestDiagnostic.operation}` : ''}{latestDiagnostic.code ? ` · ${latestDiagnostic.code}` : ''}{latestDiagnostic.durationMs !== undefined ? ` · ${latestDiagnostic.durationMs} ms` : ''}{diagnosticCounts(latestDiagnostic) ? ` · ${diagnosticCounts(latestDiagnostic)}` : ''}</p> : <p>Aucun événement enregistré.</p>}
        {latestDiagnostic?.errorCode ? <p>Code du diagnostic : {latestDiagnostic.errorCode}</p> : null}
        <Button disabled={state === 'loading' || state === 'running'} onClick={onDiagnosticsToggle}>{diagnostics.enabled ? 'Désactiver le diagnostic' : 'Activer le diagnostic'}</Button>
      </div> : null}
      <div className={styles.actions}>
        <Button disabled={state === 'loading' || state === 'running' || controller?.paused} onClick={onReconcile} variant="primary">{actionLabel}</Button>
        {controller ? <Button disabled={state === 'loading' || state === 'running'} onClick={() => onControl(controller.paused ? 'resume' : 'pause')}>{controller.paused ? 'Reprendre l’analyse' : 'Mettre en pause'}</Button> : null}
        {counts?.blocked ? <Button disabled={state === 'loading' || state === 'running' || controller?.paused} onClick={() => onControl('retry-blocked')}>Réessayer les tâches bloquées</Button> : null}
        {counts?.providerPaused ? <Button disabled={state === 'loading' || state === 'running' || controller?.paused} onClick={() => onControl('retry-provider-unavailable')}>Relancer les demandes épuisées</Button> : null}
        <Button disabled={state === 'loading' || state === 'running'} onClick={onRefresh}>Actualiser l’état</Button>
      </div>
    </div>
  </Surface></section>;
}
