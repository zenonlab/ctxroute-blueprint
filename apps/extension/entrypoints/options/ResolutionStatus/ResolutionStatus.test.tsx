import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ResolutionStatus } from './index';

describe('ResolutionStatus', () => {
  it('shows private processing states separately from actionable Review', () => {
    const html = renderToStaticMarkup(<ResolutionStatus counts={{ processing: 12, retryable: 2, unsupported: 8 }} onRefresh={() => undefined} state="ready" />);
    expect(html).toContain('Traitement en cours');
    expect(html).toContain('Liens non pris en charge');
    expect(html).toContain('panne fournisseur');
    expect(html).not.toContain('href=');
  });
});
