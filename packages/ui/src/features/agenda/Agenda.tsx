import { Button } from '../../components/button';
import { FeedbackState } from '../../components/feedback-state';
import { Status } from '../../components/status';
import { WorkCard } from '../library/work-card';
import { MemberNavigation } from '../navigation/member-navigation';
import type { MemberNavigationConfig } from '../navigation/member-navigation';
import type { AgendaDay, AgendaState, AgendaVariant } from './agenda.contract';
import styles from './Agenda.module.css';

export interface AgendaProps { canNext: boolean; canPrevious: boolean; days: readonly AgendaDay[]; navigation: MemberNavigationConfig; onNext: () => void; onPrevious: () => void; onRetry: () => void; periodLabel: string; state: AgendaState; updatedAt: string; variant?: AgendaVariant; }
const availabilityLabels = { confirmed: 'Confirmée', estimated: 'Estimation', official: 'Officielle', unavailable: 'Indisponible' } as const;

export function Agenda({ canNext, canPrevious, days, navigation, onNext, onPrevious, onRetry, periodLabel, state, updatedAt, variant = 'timeline' }: AgendaProps) {
  const usable = state === 'ready' || state === 'partial' || state === 'offline' || state === 'blocked';
  const releaseCount = days.reduce((total, day) => total + day.releases.length, 0);
  return <MemberNavigation {...navigation}>
    <main aria-labelledby="agenda-title" className={styles.agenda} data-state={state} data-variant={variant}>
      <header className={styles.header}><div><p>Calendrier</p><h1 id="agenda-title">Agenda</h1></div><span className={styles.count}>{releaseCount}</span></header>
      {state === 'loading' ? <FeedbackState className={styles.centeredState} description="Lecture des sorties enregistrées pour la période." kind="loading" layout="centered" title="Préparation de l’agenda…" /> : null}
      {state === 'empty' ? <FeedbackState className={styles.centeredState} description="Aucune sortie datée n’est enregistrée pour cette semaine." icon="calendar-days" kind="empty" layout="centered" title="Semaine vide" /> : null}
      {state === 'error' ? <FeedbackState action={<Button icon="refresh-cw" onClick={onRetry}>Actualiser la période</Button>} className={styles.centeredState} description="Les sorties déjà affichées restent disponibles." kind="error" layout="centered" recoverable title="Actualisation interrompue" /> : null}
      {usable ? <>
        {state === 'partial' ? <Status tone="accent">Dates estimées séparées · certaines sources manquent</Status> : null}
        {state === 'offline' ? <Status tone="warning">{`Cache du ${updatedAt} · hors ligne`}</Status> : null}
        {state === 'blocked' ? <Status tone="danger">Notifications refusées · configurez-les dans Réglages</Status> : null}
        <section aria-labelledby="agenda-period" className={styles.period}>
          <div className={styles.periodTitle}><Button aria-label="Semaine précédente" disabled={!canPrevious} icon="arrow-left" onClick={onPrevious}>Précédente</Button><h2 id="agenda-period">{periodLabel}</h2><Button aria-label="Semaine suivante" disabled={!canNext} icon="arrow-right" iconPosition="end" onClick={onNext}>Suivante</Button></div>
          <div aria-label={`Agenda · ${periodLabel}`} className={styles.week} tabIndex={0}>{days.map((day) => <section aria-labelledby={`agenda-day-${day.id}`} className={styles.day} data-today={day.isToday || undefined} key={day.id}>
            <header className={styles.dayHeader}><h3 id={`agenda-day-${day.id}`}>{day.label}</h3><span>{day.displayDate}</span></header>
            {day.releases.length > 0 ? <div className={styles.releases}>{day.releases.map((release) => <article className={styles.release} key={release.id}>
              {release.occursAt ? <time className={styles.srOnly} dateTime={release.occursAt}>{release.displayDate}</time> : null}
              <WorkCard aria-label={`${release.title} · ${availabilityLabels[release.availability]} · ${release.displayDate} · ${release.precision} · ${release.source}`} coverAlt={release.coverAlt} coverSrc={release.coverSrc} context={availabilityLabels[release.availability]} detail={`${release.release} · ${release.source}`} href={release.href} indicator={release.displayDate} state={release.availability === 'unavailable' ? 'unavailable' : 'default'} title={release.title} variant="agenda" />
            </article>)}</div> : null}
          </section>)}</div>
        </section>
      </> : null}
    </main>
  </MemberNavigation>;
}
