import { describe, expect, it } from 'vitest';
import { detectLocalLanguage } from './local-language-evidence';

describe('detectLocalLanguage', () => {
  it('L-01 accepts one strong URL locale', () => expect(detectLocalLanguage({ urlLanguages: ['FR-fr'] })).toMatchObject({ kind: 'detected', language: 'fr', proof: 'url-path' }));
  it('L-02 rejects conflicting URL locales', () => expect(detectLocalLanguage({ urlLanguages: ['fr', 'en'] })).toMatchObject({ kind: 'ambiguous' }));
  it('L-03 rejects statistical evidence from short text', () => expect(detectLocalLanguage({ statistical: { confidence: 0.99, language: 'fr', textLength: 79 } })).toEqual({ kind: 'undetected', proofs: [] }));
  it('L-04 lets reliable statistics beat weak hreflang', () => expect(detectLocalLanguage({ hreflang: ['en'], statistical: { confidence: 0.9, language: 'fr', textLength: 120 } })).toMatchObject({ kind: 'detected', language: 'fr', proof: 'statistical' }));
  it('L-05 fails closed on conflicting strong declarations', () => expect(detectLocalLanguage({ documentLanguage: 'fr', manifestLanguage: 'en', statistical: { confidence: 0.99, language: 'fr', textLength: 200 } })).toMatchObject({ kind: 'ambiguous' }));
});
