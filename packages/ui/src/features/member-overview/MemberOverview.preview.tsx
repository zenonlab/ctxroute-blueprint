import { definePreview } from '../../preview-contract';
import '../../tokens/color.css';
import '../../tokens/layout.css';
import '../../tokens/effects.css';
import { MemberOverview } from './MemberOverview';

const states = ['ready', 'loading', 'empty', 'error'] as const;

function isState(value: string): value is (typeof states)[number] {
  return states.some((state) => state === value);
}

const preview = definePreview({
  id: 'member-overview',
  title: 'Accueil membre',
  category: 'Surfaces',
  level: 'surface',
  purpose: 'Composer les aperçus Bibliothèque et Agenda avec les mêmes cartes et états que leurs surfaces dédiées.',
  presentation: 'page',
  variants: ['overview'],
  states: [...states],
  fixtures: ['Aperçu borné à quatre œuvres · semaine locale complète'],
  sources: [
    { label: 'API publique', path: 'features/member-overview/index.ts' },
    { label: 'Composition', path: 'features/member-overview/MemberOverview.tsx' },
    { label: 'Styles', path: 'features/member-overview/MemberOverview.module.css' },
    { label: 'Preview', path: 'features/member-overview/MemberOverview.preview.tsx' },
    { label: 'Tests', path: 'features/member-overview/MemberOverview.test.tsx' },
  ],
  dependencies: ['WorkCard', 'FeedbackState', 'Button', 'Status'],
  accessibility: ['Un seul main nomme l’accueil', 'Les états asynchrones utilisent FeedbackState', 'Le rail Agenda reste focalisable'],
  usage: `import { MemberOverview } from '@tobirink/ui';`,
  render: ({ state }) => {
    const selected = isState(state) ? state : 'ready';
    return <MemberOverview agendaDays={[]} agendaHref="#agenda" agendaState={selected} libraryCount={0} libraryHref="#library" libraryItems={[]} libraryState={selected} periodLabel="31 août – 6 septembre 2026" onRetry={() => undefined} />;
  },
});

export default preview;
