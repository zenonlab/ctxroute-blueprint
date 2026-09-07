import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '../../../components/button';
import { FeedbackState } from '../../../components/feedback-state';
import { Status } from '../../../components/status';
import { Icon } from '../../../icons';
import { WorkCard } from '../../library/work-card';
import type { ReviewDecision, ReviewItem, ReviewResolverState } from './review-resolver.contract';
import styles from './ReviewResolver.module.css';

export interface ReviewResolverProps {
  busy?: boolean;
  canNext: boolean;
  canPrevious: boolean;
  item?: ReviewItem;
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
  canNext,
  canPrevious,
  item,
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
  const manualInputId = useId();
  const manualPanelId = useId();
  const manualErrorId = useId();
  const candidatesDeferred = state === 'partial' && item?.candidates.length === 0;

  useEffect(() => {
    setManualOpen(false);
    setManualValue('');
    setManualError(null);
  }, [item?.id]);

  const submitManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!item || busy) return;
    const value = manualValue.trim();
    if (!value) {
      setManualError('Saisissez un identifiant ou une URL fournisseur.');
      return;
    }
    const source = manualSource(value);
    if (source === 'url' && !validHttpUrl(value)) {
      setManualError('Saisissez une URL HTTP(S) valide.');
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
        className={styles.empty}
        icon="inbox"
        kind="empty"
        layout="centered"
        title="Aucune correspondance à vérifier"
      />
    );
  }

  if (state === 'error') {
    return (
      <FeedbackState
        action={<Button disabled={busy} icon="refresh-cw" onClick={onRetry}>Recharger les candidats</Button>}
        className={styles.centeredState}
        description="La file est conservée. Seuls les candidats seront relus."
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

  return (
    <section aria-busy={busy || undefined} className={styles.resolver}>
      {state === 'partial' ? <Status tone="accent">Un fournisseur est indisponible · décision conservée</Status> : null}
      {state === 'offline' ? <Status tone="warning">Hors ligne · hydratation différée après décision</Status> : null}

      <section aria-label="Contexte du favori" className={styles.sourceContext}>
        <div>
          <strong>{item.title}</strong>
          <span>{[item.sourceLabel, item.progress].filter(Boolean).join(' · ')}</span>
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
          <div className={styles.candidates}>
            {item.candidates.map((candidate) => (
              <WorkCard
                coverAlt={candidate.coverAlt}
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
              <span>{item.candidates.length > 0 ? 'Autre œuvre' : 'Saisie manuelle'}</span>
            </button>
          </div>
          {item.candidates.length === 0 ? <p className={styles.noCandidates}>Aucun candidat proposé par les sources disponibles.</p> : null}
        </>
      )}

      {!candidatesDeferred && manualOpen ? (
        <div className={styles.manualPanel} id={manualPanelId}>
          <form onSubmit={submitManual}>
            <label htmlFor={manualInputId}>Identifiant ou URL fournisseur</label>
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
                placeholder="ID ou URL AniList / MangaUpdates"
                value={manualValue}
              />
              <Button busy={busy} icon="search" type="submit" variant="primary">Vérifier</Button>
            </div>
            {manualError ? <span id={manualErrorId} role="alert">{manualError}</span> : null}
          </form>
          <Button
            disabled={busy}
            icon="x"
            onClick={() => onSubmitDecision({ kind: 'none', revision: item.revision })}
            variant="secondary"
          >
            Aucune correspondance
          </Button>
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
          aria-label="Passer cette Review pour le moment"
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
