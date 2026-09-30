import { definePreview } from '@tobirink/ui/preview-contract';
import { ResolutionStatus } from './index';

export default definePreview({
  id: 'resolution-status', title: 'État de résolution', category: 'Surfaces', level: 'surface', presentation: 'page',
  purpose: 'Accompagner la première installation et distinguer chaque phase locale avant les choix actionnables.',
  variants: ['default'], states: ['ready', 'unavailable', 'rate-limited', 'loading', 'error'], fixtures: ['Compteurs synthétiques sans données de favoris', 'Attente mixte : une admission et deux demandes indisponibles'],
  dependencies: ['Button', 'Surface'], accessibility: ['Liste descriptive native', 'État du diagnostic annoncé', 'Contrôle clavier natif', 'Chargement annoncé', 'Erreur annoncée et reprise explicite'],
  sources: [{ label: 'API publique', path: 'entrypoints/options/ResolutionStatus/index.ts' }, { label: 'Surface', path: 'entrypoints/options/ResolutionStatus/ResolutionStatus.tsx' }, { label: 'Styles', path: 'entrypoints/options/ResolutionStatus/ResolutionStatus.module.css' }],
  usage: "import { ResolutionStatus } from './ResolutionStatus';",
  render: ({ state }) => {
    const waiting = state === 'unavailable' || state === 'rate-limited';
    const ready = state === 'ready' || waiting;
    const counts = waiting
      ? { blocked: 0, observed: 8, processing: 0, resolved: 5, retryable: 3, review: 0, unsupported: 0, ...(state === 'unavailable' ? { admissionWaiting: 1, providerPaused: 2 } : { rateLimited: 3 }) }
      : { blocked: 0, observed: 22, processing: 12, resolved: 0, retryable: 2, review: 0, unsupported: 8 };
    return <ResolutionStatus controller={ready ? { paused: false, state: waiting ? 'waiting-provider' : 'resolving' } : undefined} counts={ready ? counts : undefined} diagnostics={ready ? { enabled: true, events: [] } : undefined} inventory={ready ? { continuationAt: '2026-09-12T12:05:00.000Z', status: waiting ? 'complete' : 'presence' } : undefined} onControl={() => undefined} onDiagnosticsToggle={() => undefined} onReconcile={() => undefined} onRefresh={() => undefined} state={state === 'loading' || state === 'error' ? state : 'ready'} />;
  },
});
