import { definePreview } from '../../../preview-contract';
import '../../../tokens/color.css';
import '../../../tokens/layout.css';
import '../../../tokens/effects.css';
import { WorkCard, workCardStates, workCardVariants } from './index';
import type { WorkCardState, WorkCardVariant } from './index';
import styles from './WorkCard.module.css';

const fixtures = {
  'active-work': { context: 'Œuvre', detail: 'Page active', indicator: '- / -', title: 'Frieren' },
  agenda: { context: 'Officielle', detail: 'Chapitre 141 · Éditeur', indicator: '5 sept.', title: 'Frieren' },
  library: { context: 'Manga', detail: 'MangaUpdates', indicator: '37 / 120', title: 'Synthetic visual favorite' },
  review: { context: 'Candidat', detail: 'AniList', indicator: 'ANL 12345', title: 'Frieren' },
} satisfies Record<WorkCardVariant, { context: string; detail: string; indicator: string; title: string }>;

function isVariant(value: string): value is WorkCardVariant {
  return workCardVariants.some((variant) => variant === value);
}

function isState(value: string): value is WorkCardState {
  return workCardStates.some((state) => state === value);
}

const workCardPreview = definePreview({
  id: 'work-card',
  title: 'WorkCard',
  category: 'Métier',
  level: 'domain',
  purpose: 'Présenter une œuvre dans la carte couverture historique de FavLib.',
  variants: [...workCardVariants],
  states: [...workCardStates],
  fixtures: ['Bibliothèque', 'Review', 'Agenda', 'Œuvre active 3:2'],
  sources: [
    { label: 'API publique', path: 'features/library/work-card/index.ts' },
    { label: 'Contrat', path: 'features/library/work-card/work-card.contract.ts' },
    { label: 'WorkCard', path: 'features/library/work-card/WorkCard.tsx' },
    { label: 'Mouvement', path: 'features/library/work-card/card-motion.ts' },
    { label: 'Styles', path: 'features/library/work-card/WorkCard.module.css' },
    { label: 'Preview', path: 'features/library/work-card/WorkCard.preview.tsx' },
    { label: 'Tests', path: 'features/library/work-card/WorkCard.test.tsx' },
  ],
  dependencies: ['color tokens', 'layout tokens', 'effects tokens', 'preview-contract'],
  accessibility: [
    'La carte à face unique est un lien nommé vers la source de l’œuvre',
    'Le candidat Review retourne sa coque au survol, au focus ou au toucher et expose deux actions distinctes',
    'La couverture possède une alternative ou un remplacement explicitement nommé',
    'Le tilt est limité aux pointeurs fins et supprimé avec prefers-reduced-motion',
  ],
  usage: `import { WorkCard } from '@tobirink/ui';`,
  render: ({ state, variant }) => {
    const selectedState: WorkCardState = isState(state) ? state : 'default';
    const selectedVariant: WorkCardVariant = isVariant(variant) ? variant : 'library';
    const fixture = fixtures[selectedVariant];

    return (
      <section className={styles.preview}>
        <header className={styles.previewHeader}>
          <div>
            <p className={styles.eyebrow}>Métier · {selectedVariant}</p>
            <h3>La couverture est la carte</h3>
          </div>
          <span className={styles.index}>FavLib / original</span>
        </header>

        <div className={styles.example}>
          <WorkCard
            context={fixture.context}
            detail={fixture.detail}
            href="#work-card"
            indicator={fixture.indicator}
            reviewActions={selectedVariant === 'review' ? { onSelect: () => undefined } : undefined}
            state={selectedState}
            title={fixture.title}
            variant={selectedVariant}
          />
        </div>

        <p className={styles.rule}>La face avant reste identique. Seul le candidat Review révèle les actions au dos.</p>
      </section>
    );
  },
});

export default workCardPreview;
