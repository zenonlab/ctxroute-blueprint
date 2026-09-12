import { definePreview } from '@tobirink/ui/preview-contract';
import { ResolutionStatus } from './index';

export default definePreview({
  id: 'resolution-status', title: 'État de résolution', category: 'Surfaces', level: 'surface', presentation: 'page',
  purpose: 'Accompagner la première installation et distinguer chaque phase locale avant les choix actionnables.',
  variants: ['default'], states: ['ready', 'loading', 'error'], fixtures: ['Compteurs synthétiques sans données de favoris'],
  dependencies: ['Button', 'Surface'], accessibility: ['Liste descriptive native', 'État du diagnostic annoncé', 'Contrôle clavier natif', 'Chargement annoncé', 'Erreur annoncée et reprise explicite'],
  sources: [{ label: 'API publique', path: 'entrypoints/options/ResolutionStatus/index.ts' }, { label: 'Surface', path: 'entrypoints/options/ResolutionStatus/ResolutionStatus.tsx' }, { label: 'Styles', path: 'entrypoints/options/ResolutionStatus/ResolutionStatus.module.css' }],
  usage: "import { ResolutionStatus } from './ResolutionStatus';",
  render: ({ state }) => <ResolutionStatus controller={state === 'ready' ? { paused: false, state: 'resolving' } : undefined} counts={state === 'ready' ? { blocked: 0, observed: 22, processing: 12, resolved: 0, retryable: 2, review: 0, unsupported: 8 } : undefined} diagnostics={state === 'ready' ? { enabled: true, events: [] } : undefined} inventory={state === 'ready' ? { continuationAt: '2026-09-12T12:05:00.000Z', status: 'presence' } : undefined} onControl={() => undefined} onDiagnosticsToggle={() => undefined} onReconcile={() => undefined} onRefresh={() => undefined} state={state === 'loading' || state === 'error' ? state : 'ready'} />,
});
