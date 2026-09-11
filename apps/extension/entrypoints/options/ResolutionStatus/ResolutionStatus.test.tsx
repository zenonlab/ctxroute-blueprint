import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResolutionStatus } from './index';

describe('ResolutionStatus', () => {
  it('distinguishes internal and collective waits without calling them provider failures', () => {
    const html = renderToStaticMarkup(<ResolutionStatus counts={{ processing: 0, retryable: 3, unsupported: 0, internalErrors: 1, collectivePending: 2 }} onRefresh={() => undefined} state="ready" />);
    expect(html).toContain('Dont erreurs internes');
    expect(html).toContain('Dont attente du service collectif');
    expect(html).not.toContain('panne fournisseur');
  });
  it('shows private processing states separately from actionable Review', () => {
    const html = renderToStaticMarkup(<ResolutionStatus counts={{ processing: 12, retryable: 2, unsupported: 8 }} onRefresh={() => undefined} state="ready" />);
    expect(html).toContain('Traitement en cours');
    expect(html).toContain('Liens non pris en charge');
    expect(html).toContain('attente de reprise');
    expect(html).not.toContain('href=');
  });
});
