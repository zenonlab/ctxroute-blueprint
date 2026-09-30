import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../../components/button';
import { FeedbackState } from '../../../components/feedback-state';
import { Status } from '../../../components/status';
import { Icon } from '../../../icons';
import { WorkCard } from '../../library/work-card';
import type { ReviewDecision, ReviewItem, ReviewResolverState } from './review-resolver.contract';
import styles from './ReviewResolver.module.css';

const matchLabels = new Map([
  ['source-id', 'Identifiant exact'], ['source-url', 'Adresse exacte'], ['ordered-exact', 'Titre exact'],
  ['explicit-season', 'Saison corroborée'], ['reordered-significant-words', 'Mêmes mots significatifs'],
  ['bounded-edit-distance', 'Faible différence de titre'],
]);
const provenanceLabels = new Map([
  ['local-alias', 'Alias local'], ['hydrated-title', 'Fiche locale'], ['provider-search', 'Recherche fournisseur'],
  ['public-discovery', 'Identités proposées par les fournisseurs'],
]);

export interface ReviewResolverProps {
  busy?: boolean;
  pending?: boolean;
  canNext: boolean;
  canPrevious: boolean;
  item?: ReviewItem;
  extensionRequired?: boolean;
  onDownloadExtension?: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onRefresh: () => void;
  onRetry: () => void;
  onSubmitDecision: (decision: ReviewDecision) => void;
  state: ReviewResolverState;
}

function manualSource(value: string): 'id' | 'url' {
  return /^https?:\/\//i.test(value) ? 'url' : 'id';
}

function validHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ReviewResolver({
  busy = false,
  pending = false,
  canNext,
  canPrevious,
  item,
  extensionRequired = false,
  onDownloadExtension,
  onNext,
  onPrevious,
  onRefresh,
  onRetry,
  onSubmitDecision,
  state,
}: ReviewResolverProps) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [confirmNoMatch, setConfirmNoMatch] = useState(false);
  const manualInputId = useId();
  const manualPanelId = useId();
  const manualErrorId = useId();
  const candidatesDeferred = state === 'partial' && item?.candidates.length === 0 && item.reason === undefined;

  useEffect(() => {
    setManualOpen(false);
    setManualValue('');
    setManualError(null);
    setConfirmNoMatch(false);
  }, [item?.id, item?.revision]);

  const submitManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item || busy) return;
    const value = manualValue.trim();
    if (!value) {
      setManualError('Saisissez un identifiant ou une adresse web.');
      return;
    }
    const source = manualSource(value);
    if (source === 'url' && !validHttpUrl(value)) {
      setManualError('Saisissez une adresse web valide.');
      return;
    }
    setManualError(null);
    onSubmitDecision({ kind: 'manual', revision: item.revision, source, value });
  };

  if (state === 'loading') {
    return <FeedbackState className={styles.centeredState} description="Lecture de la file conservée sur cet appareil." kind="loading" layout="centered" title="Préparation des Reviews…" />;
  }

  if (state === 'empty') {
    return (
      <FeedbackState
        action={extensionRequired && onDownloadExtension ? <Button icon="download" onClick={onDownloadExtension} variant="primary">Télécharger l’extension</Button> : undefined}
        className={styles.empty}
        description={extensionRequired ? 'Installez l’extension TobiRink pour retrouver les œuvres de vos favoris à vérifier.' : undefined}
        icon="inbox"
        kind="empty"
        layout="centered"
        title={extensionRequired ? 'Extension TobiRink requise' : 'Aucune correspondance à vérifier'}
      />
    );
  }

  if (state === 'error') {
    return (
      <FeedbackState
        action={<Button disabled={busy} icon="refresh-cw" onClick={onRetry}>Recharger les suggestions</Button>}
        className={styles.centeredState}
        description="Vos correspondances restent enregistrées. Seules les suggestions seront rechargées."
        kind="error"
        layout="centered"
        recoverable
        title="Candidats indisponibles"
      />
    );
  }

  if (state === 'conflict') {
    return (
      <section className={styles.conflict} role="alert">
        <div>
          <strong>La Review a changé</strong>
          <p>Rechargez sa version actuelle avant de prendre une décision.</p>
        </div>
        <Button disabled={busy} icon="refresh-cw" onClick={onRefresh}>Recharger</Button>
      </section>
    );
  }

  if (state === 'success') {
    return (
      <section className={styles.success}>
        <Status live="polite" tone="success">Décision enregistrée</Status>
        <p>La prochaine Review va être affichée.</p>
      </section>
    );
  }

  if (!item) return null;
  const providerReferences = item.providerReferences ?? [];
  const comparableCount = item.candidates.length + providerReferences.length;

  return (
    <section aria-busy={busy || undefined} className={styles.resolver}>
      {pending ? <Status live="polite" tone="accent">Vérification en cours · réessayez dans quelques instants</Status> : null}
      {state === 'partial' && item.reason === undefined ? <Status tone="accent">Une source est indisponible · décision conservée</Status> : null}
      {item.reason === 'NOT_FOUND' ? <Status tone="accent">Aucune identité trouvée après recherche complète</Status> : null}
      {item.reason === 'UNCONFIRMED_SEASON' ? <Status tone="accent">Titre trouvé · saison à confirmer avant association</Status> : null}
      {state === 'offline' ? <Status tone="warning">Hors ligne · les détails seront complétés à la reconnexion</Status> : null}

      <section aria-label="Contexte du favori" className={styles.sourceContext}>
        <div>
          <strong>{item.title}</strong>
          <span>{[item.sourceLabel, item.progress].filter(Boolean).join(' · ')}</span>
          {item.provenance || item.matchLevel ? <span>{[item.provenance ? provenanceLabels.get(item.provenance) ?? 'Résolution locale' : undefined, item.matchLevel ? matchLabels.get(item.matchLevel) : undefined].filter(Boolean).join(' · ')}</span> : null}
        </div>
        {item.sourceUrl ? (
          <div className={styles.sourceActions}>
            <a href={item.sourceUrl} rel="noreferrer" target="_blank">Source ↗</a>
          </div>
        ) : null}
      </section>

      {candidatesDeferred ? (
        <p className={styles.noCandidates}>Les candidats ne sont pas encore disponibles.</p>
      ) : (
        <>
          <h3 className={styles.question}>Quelle œuvre correspond à ce favori&nbsp;?</h3>
          {providerReferences.length > 0 ? (
            <section aria-label="Identités fournisseur à vérifier" className={styles.manualPanel}>
              <p className={styles.noCandidates}>Plusieurs identifiants sont proposés. Vérifiez une référence avant de l’associer à ce favori.</p>
              {providerReferences.map((reference) => (
                <Button
                  disabled={busy}
                  key={`${reference.provider}:${reference.externalId}`}
                  onClick={() => onSubmitDecision({ kind: 'manual', revision: item.revision, source: 'id', value: `${reference.provider}:${reference.externalId}` })}
                >
                  {`Vérifier ${reference.provider}:${reference.externalId}`}
                </Button>
              ))}
            </section>
          ) : null}
          <div className={styles.candidates}>
            {item.candidates.map((candidate) => (
              <WorkCard
                coverAlt={candidate.coverAlt}
                coverFallbackSrc={candidate.coverFallbackSrc}
                coverSrc={candidate.coverSrc}
                context={candidate.mediaType}
                detail={candidate.provider}
                href={candidate.href}
                indicator={candidate.providerId}
                key={candidate.candidateId}
                reviewActions={{
                  disabled: busy,
                  onSelect: () => onSubmitDecision({ candidateId: candidate.candidateId, kind: 'candidate', revision: item.revision }),
                  selectLabel: 'Choisir cette œuvre',
                  sourceLabel: 'Voir la source',
                }}
                title={candidate.title}
                variant="review"
              />
            ))}
            <button
              aria-controls={manualPanelId}
              aria-expanded={manualOpen}
              aria-label="Saisir un identifiant ou une URL"
              className={`${styles.manualChoice}${manualOpen ? ` ${styles.selected}` : ''}`}
              disabled={busy}
              onClick={() => setManualOpen((open) => !open)}
              type="button"
            >
              <Icon aria-hidden="true" name="plus" size="lg" />
              <span>{comparableCount > 0 ? 'Autre œuvre' : 'Saisie manuelle'}</span>
            </button>
          </div>
          {comparableCount === 0 ? <p className={styles.noCandidates}>Aucun candidat proposé par les sources disponibles.</p> : null}
          {item.totalCandidates !== undefined && item.totalCandidates > comparableCount ? <p className={styles.noCandidates}>{comparableCount} identités affichées sur {item.totalCandidates} identités comparées.</p> : null}
        </>
      )}

      {!candidatesDeferred && manualOpen ? (
        <div className={styles.manualPanel} id={manualPanelId}>
          <form onSubmit={submitManual}>
            <label htmlFor={manualInputId}>Identifiant ou adresse de la source</label>
            <div className={styles.manualControls}>
              <input
                aria-describedby={manualError ? manualErrorId : undefined}
                aria-invalid={manualError ? true : undefined}
                disabled={busy}
                id={manualInputId}
                onChange={(event) => {
                  setManualValue(event.target.value);
                  setManualError(null);
                }}
                placeholder="anilist:123 ou URL de la fiche fournisseur"
                value={manualValue}
              />
              <Button busy={busy} icon="search" type="submit" variant="primary">Vérifier</Button>
            </div>
            {manualError ? <span id={manualErrorId} role="alert">{manualError}</span> : null}
          </form>
          <Button
            disabled={busy}
            icon="x"
            onClick={() => setConfirmNoMatch(true)}
            variant="secondary"
          >
            Aucune correspondance
          </Button>
          {confirmNoMatch ? (
            <section aria-label="Confirmer aucune correspondance">
              <p>Confirmez que ce favori ne correspond à aucune œuvre. Cette décision restera enregistrée.</p>
              <Button disabled={busy} onClick={() => onSubmitDecision({ kind: 'none', revision: item.revision })} variant="primary">Confirmer aucune correspondance</Button>
              <Button disabled={busy} onClick={() => setConfirmNoMatch(false)} variant="quiet">Annuler</Button>
            </section>
          ) : null}
        </div>
      ) : null}

      <nav aria-label="Navigation dans les Reviews" className={styles.reviewNavigation}>
        <Button
          aria-label="Review précédente"
          disabled={busy || !canPrevious}
          icon="chevron-left"
          iconOnly
          onClick={onPrevious}
          variant="quiet"
        />
        <span aria-live="polite" className={styles.position}>
          {item.position && item.total ? `${item.position} / ${item.total}` : 'Review en cours'}
        </span>
        <Button
          aria-label="Review suivante"
          disabled={busy || !canNext}
          icon="chevron-right"
          iconOnly
          onClick={onNext}
          variant="quiet"
        />
      </nav>
    </section>
  );
}
