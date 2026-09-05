import { definePreview } from '@tobirink/ui/preview-contract';
import '../../../../packages/ui/src/tokens/color.css';
import '../../../../packages/ui/src/tokens/layout.css';
import '../../../../packages/ui/src/tokens/effects.css';
import { Agenda, agendaStates, agendaVariants } from './index';
import type { AgendaDay, AgendaRelease, AgendaState } from './index';
import styles from './Agenda.module.css';

const releases: readonly AgendaRelease[] = [
  { availability: 'official', displayDate: '5 sept.', href: '#frieren-141', id: 'frieren-141', occursAt: '2026-09-05', precision: 'Jour officiel', release: 'Chapitre 141', source: 'Éditeur', title: 'Frieren' },
  { availability: 'confirmed', displayDate: '7 sept.', href: '#apothecary-19', id: 'apothecary-19', occursAt: '2026-09-07T20:00:00+02:00', precision: '20:00 · Europe/Paris', release: 'Épisode 19', source: 'Diffuseur', title: 'Les Carnets de l’apothicaire' },
  { availability: 'estimated', displayDate: 'vers le 12 sept.', href: '#witch-hat-15', id: 'witch-hat-15', precision: 'Fenêtre estimée', release: 'Chapitre 15', source: 'Historique local', title: 'L’Atelier des sorciers' },
  { availability: 'unavailable', displayDate: 'Date inconnue', href: '#dandadan-187', id: 'dandadan-187', precision: 'Aucune précision', release: 'Chapitre 187', source: 'Indisponible', title: 'Dandadan' },
];

const week: readonly AgendaDay[] = [
  { displayDate: '31 août', id: '2026-08-31', label: 'lundi', releases: [] },
  { displayDate: '1 sept.', id: '2026-09-01', label: 'mardi', releases: [] },
  { displayDate: '2 sept.', id: '2026-09-02', label: 'mercredi', releases: [releases[2]!] },
  { displayDate: '3 sept.', id: '2026-09-03', label: 'jeudi', releases: [] },
  { displayDate: '4 sept.', id: '2026-09-04', label: 'vendredi', releases: [releases[3]!] },
  { displayDate: '5 sept.', id: '2026-09-05', isToday: true, label: 'samedi', releases: [releases[0]!] },
  { displayDate: '6 sept.', id: '2026-09-06', label: 'dimanche', releases: [releases[1]!] },
];

function isState(value: string): value is AgendaState {
  return agendaStates.some((state) => state === value);
}

function AgendaDemo({ state }: { state: AgendaState }) {
  const visible = state === 'empty' || state === 'loading' || state === 'error'
    ? []
    : state === 'partial'
      ? week.map((day) => ({ ...day, releases: day.releases.filter((release) => release.availability === 'estimated') }))
      : week;

  return (
    <Agenda
      canNext
      canPrevious={false}
      days={visible}
      navigation={{
        activeId: 'agenda',
        onSearch: () => undefined,
        review: {
          count: 2,
          resolver: {
            canNext: false,
            canPrevious: false,
            item: {
              candidates: [{ candidateId: 'frieren-anilist', href: '#frieren-anilist', mediaType: 'Manga', provider: 'AniList', providerId: '118586', title: 'Frieren' }],
              id: 'review-frieren',
              position: 1,
              progress: 'chapitre 140',
              revision: 'review-3',
              sourceLabel: 'Favori Firefox',
              sourceUrl: '#source-frieren',
              title: 'Frieren chapitre',
              total: 2,
            },
            onNext: () => undefined,
            onPrevious: () => undefined,
            onRefresh: () => undefined,
            onRetry: () => undefined,
            onSubmitDecision: () => undefined,
            state: 'ready',
          },
        },
      }}
      onRetry={() => undefined}
      onNext={() => undefined}
      onPrevious={() => undefined}
      periodLabel="31 août – 6 septembre 2026"
      state={state}
      updatedAt="4 septembre · 22:10"
    />
  );
}

const agendaPreview = definePreview({
  id: 'agenda',
  title: 'Agenda',
  category: 'Surfaces',
  level: 'surface',
  purpose: 'Lire les prochaines sorties avec leur niveau de certitude.',
  presentation: 'page',
  variants: [...agendaVariants],
  states: [...agendaStates],
  fixtures: ['Semaine de 7 jours · 4 sorties · officielle, confirmée, estimée, indisponible'],
  sources: [
    { label: 'API publique', path: 'entrypoints/agenda/index.ts' },
    { label: 'Contrat', path: 'entrypoints/agenda/agenda.contract.ts' },
    { label: 'Surface', path: 'entrypoints/agenda/Agenda.tsx' },
    { label: 'Styles', path: 'entrypoints/agenda/Agenda.module.css' },
    { label: 'Preview', path: 'entrypoints/agenda/Agenda.preview.tsx' },
    { label: 'Tests', path: 'entrypoints/agenda/Agenda.test.tsx' },
  ],
  dependencies: ['MemberNavigation', 'WorkCard', 'FeedbackState', 'Button', 'Status'],
  accessibility: [
    'Chaque date certaine utilise time et les estimations restent du texte',
    'La semaine reste horizontale et son rail peut recevoir le focus au clavier',
    'La qualification et la source sont incluses dans le nom de chaque carte',
    'Une permission refusée renvoie vers Réglages sans ajouter de contrôle global à l’Agenda',
  ],
  usage: `import { Agenda } from '@tobirink/extension/entrypoints/agenda';`,
  render: ({ state }) => (
    <section className={styles.preview}>
      <AgendaDemo key={state} state={isState(state) ? state : 'ready'} />
    </section>
  ),
});

export default agendaPreview;
