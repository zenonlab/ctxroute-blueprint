import { Button } from '../../components/button';
import { FeedbackState } from '../../components/feedback-state';
import { Status } from '../../components/status';
import type { AgendaDay } from '../agenda';
import type { LibraryWork } from '../library/library-surface';
import { WorkCard } from '../library/work-card';
import styles from './MemberOverview.module.css';

export interface MemberOverviewProps { agendaDays: readonly AgendaDay[]; agendaHref: string; agendaState: 'empty' | 'error' | 'loading' | 'ready'; libraryCount: number; libraryHref: string; libraryItems: readonly LibraryWork[]; libraryState: 'empty' | 'error' | 'loading' | 'ready'; onRetry?: () => void; periodLabel: string; }

export function MemberOverview({ agendaDays, agendaHref, agendaState, libraryCount, libraryHref, libraryItems, libraryState, onRetry, periodLabel }: MemberOverviewProps) {
  const estimated = agendaDays.some((day) => day.releases.some((release) => release.availability === 'estimated'));
  const libraryError = onRetry
    ? <FeedbackState action={<Button icon="refresh-cw" onClick={onRetry}>Réessayer</Button>} className={styles.centeredState} description="Les œuvres déjà conservées ne sont pas supprimées." kind="error" layout="centered" recoverable title="Lecture interrompue" />
    : <FeedbackState className={styles.centeredState} description="Les œuvres déjà conservées ne sont pas supprimées." kind="error" layout="centered" recoverable={false} title="Lecture interrompue" />;
  const agendaError = onRetry
    ? <FeedbackState action={<Button icon="refresh-cw" onClick={onRetry}>Actualiser la période</Button>} className={styles.centeredState} description="Le cache précédent reste intact." kind="error" layout="centered" recoverable title="Actualisation interrompue" />
    : <FeedbackState className={styles.centeredState} description="Le cache précédent reste intact." kind="error" layout="centered" recoverable={false} title="Actualisation interrompue" />;
  return <main aria-label="Accueil" className={styles.overview}>
    <section className={styles.section} aria-labelledby="library-overview-title">
      <header className={styles.heading}><div><p className={styles.eyebrow}>Bibliothèque</p><h1 id="library-overview-title">{libraryCount} œuvres</h1></div><a className={styles.link} href={libraryHref}>Tout voir</a></header>
      {libraryState === 'loading' ? <FeedbackState className={styles.centeredState} description="Lecture des œuvres enregistrées sur cet appareil." kind="loading" layout="centered" title="Préparation de la bibliothèque…" /> : null}
      {libraryState === 'empty' ? <FeedbackState className={styles.centeredState} description="Aucun favori HTTP(S) compatible n’a été trouvé lors de l’analyse." icon="library-big" kind="empty" layout="centered" title="Aucune œuvre trouvée" /> : null}
      {libraryState === 'error' ? libraryError : null}
      {libraryState === 'ready' ? <div className={styles.grid}>{libraryItems.map((item) => <WorkCard coverAlt={item.coverAlt} coverSrc={item.coverSrc} context={item.mediaType} detail={item.source} href={item.href} indicator={item.progress} key={item.id} title={item.title} variant="library" />)}</div> : null}
    </section>
    <section className={styles.section} aria-labelledby="agenda-overview-title">
      <header className={styles.heading}><div><p className={styles.eyebrow}>Semaine</p><h2 id="agenda-overview-title">{periodLabel}</h2></div><a className={styles.link} href={agendaHref}>Ouvrir l’agenda</a></header>
      {agendaState === 'loading' ? <FeedbackState className={styles.centeredState} description="Lecture des sorties enregistrées pour la période." kind="loading" layout="centered" title="Préparation de l’agenda…" /> : null}
      {agendaState === 'empty' ? <FeedbackState className={styles.centeredState} description="Aucune sortie datée n’est enregistrée pour cette semaine." icon="calendar-days" kind="empty" layout="centered" title="Semaine vide" /> : null}
      {agendaState === 'error' ? agendaError : null}
      {agendaState === 'ready' ? <>{estimated ? <Status tone="accent">La semaine contient des horaires estimés</Status> : null}<div aria-label={`Aperçu Agenda · ${periodLabel}`} className={styles.week} tabIndex={0}>{agendaDays.map((day) => <section className={styles.day} key={day.id}><header><strong>{day.label}</strong><span>{day.displayDate}</span></header>{day.releases.map((release) => <WorkCard context={release.availability === 'estimated' ? 'Estimation' : release.availability === 'official' ? 'Officielle' : 'Confirmée'} detail={`${release.release} · ${release.source}`} href={release.href} indicator={release.displayDate} key={release.id} title={release.title} variant="agenda" />)}</section>)}</div></> : null}
    </section>
  </main>;
}
