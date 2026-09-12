import { describe, expect, it } from 'vitest';
import { createSourceEvidence } from './source-evidence-contract';

const base = {
  aliases: [{ provenance: 'stable-url-slug' as const, value: 'Fixture Work' }],
  diagnostics: [], key: 'fixture', mediaKind: 'MANGA' as const, proofs: ['TITLE_SLUG' as const],
  sourceAdapter: 'fixture', stableSlug: 'fixture-work', strategy: 'generic' as const,
};

describe('source identity transformation provenance', () => {
  it('retains and freezes structural routing transformations', () => {
    const evidence = createSourceEvidence({ ...base, identityTransformations: ['numeric-routing-prefix', 'numeric-routing-suffix'] });
    expect(evidence.identityTransformations).toEqual(['numeric-routing-prefix', 'numeric-routing-suffix']);
    expect(Object.isFrozen(evidence.identityTransformations)).toBe(true);
  });

  it('does not permit transformation provenance on rejected evidence', () => {
    expect(() => createSourceEvidence({ ...base, aliases: [], disposition: 'URL_IDENTITY_UNRESOLVED', identityTransformations: ['numeric-routing-prefix'], mediaKind: 'UNKNOWN', proofs: [], stableSlug: undefined }))
      .toThrow(/actionable identity/u);
  });
});
