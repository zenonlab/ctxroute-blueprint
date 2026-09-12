import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResolutionStatus } from './index';

describe('ResolutionStatus', () => {
  it('distinguishes internal and collective waits without calling them provider failures', () => {
    const html = renderToStaticMarkup(<ResolutionStatus controller={{ paused: false, state: 'presence' }} counts={{ blocked: 0, observed: 3, processing: 0, resolved: 0, retryable: 3, review: 0, unsupported: 0, internalErrors: 1, collectivePending: 2 }} diagnostics={{ enabled: false, events: [] }} inventory={{ continuationAt: '2026-09-12T12:05:00.000Z', status: 'presence' }} onControl={() => undefined} onDiagnosticsToggle={() => undefined} onReconcile={() => undefined} onRefresh={() => undefined} state="ready" />);
    expect(html).toContain('Dont erreurs internes');
    expect(html).toContain('Dont attente du service collectif');
    expect(html).toContain('Vérification des favoris encore présents');
    expect(html).toContain('Prochaine reprise automatique');
    expect(html).toContain('Reprendre maintenant');
    expect(html).not.toContain('panne fournisseur');
  });
  it('shows private processing states separately from actionable Review', () => {
    const html = renderToStaticMarkup(<ResolutionStatus controller={{ paused: false, state: 'resolving' }} counts={{ blocked: 0, observed: 22, processing: 12, resolved: 0, retryable: 2, review: 0, unsupported: 8 }} diagnostics={{ enabled: true, events: [{ occurredAt: '2026-09-12T12:00:00.000Z', outcome: 'complete', runId: 'run-1', sequence: 'event-1', stage: 'resolution', version: 1 }] }} inventory={{ status: 'complete' }} onControl={() => undefined} onDiagnosticsToggle={() => undefined} onReconcile={() => undefined} onRefresh={() => undefined} state="ready" />);
    expect(html).toContain('Traitement en cours');
    expect(html).toContain('Liens non pris en charge');
    expect(html).toContain('attente de reprise');
    expect(html).toContain('Favoris observés');
    expect(html).toContain('Vérifier à nouveau');
    expect(html).toContain('Désactiver le diagnostic');
    expect(html).toContain('Résolution · terminé · passage run-1');
    expect(html).not.toContain('href=');
  });

  it('guides a new installation before its first scan', () => {
    const html = renderToStaticMarkup(<ResolutionStatus controller={{ paused: false, state: 'idle' }} counts={{ blocked: 0, observed: 0, processing: 0, resolved: 0, retryable: 0, review: 0, unsupported: 0 }} diagnostics={{ enabled: false, events: [] }} inventory={{ status: 'not-started' }} onControl={() => undefined} onDiagnosticsToggle={() => undefined} onReconcile={() => undefined} onRefresh={() => undefined} state="ready" />);
    expect(html).toContain('Lire les favoris du navigateur');
    expect(html).toContain('Vérifier les favoris encore présents');
    expect(html).toContain('Identifier et enrichir les œuvres');
    expect(html).toContain('Commencer l’analyse');
  });

  it('offers pause, resume and explicit blocked retry controls', () => {
    const common = { blocked: 2, observed: 2, processing: 0, resolved: 0, retryable: 0, review: 0, unsupported: 0 };
    const active = renderToStaticMarkup(<ResolutionStatus controller={{ paused: false, state: 'blocked' }} counts={common} diagnostics={{ enabled: false, events: [] }} inventory={{ status: 'complete' }} onControl={() => undefined} onDiagnosticsToggle={() => undefined} onReconcile={() => undefined} onRefresh={() => undefined} state="ready" />);
    const paused = renderToStaticMarkup(<ResolutionStatus controller={{ paused: true, state: 'paused' }} counts={common} diagnostics={{ enabled: false, events: [] }} inventory={{ status: 'complete' }} onControl={() => undefined} onDiagnosticsToggle={() => undefined} onReconcile={() => undefined} onRefresh={() => undefined} state="ready" />);
    expect(active).toContain('Mettre en pause');
    expect(active).toContain('Réessayer les tâches bloquées');
    expect(paused).toContain('Reprendre l’analyse');
    expect(paused).not.toContain('Votre bibliothèque locale est à jour.');
  });
});
