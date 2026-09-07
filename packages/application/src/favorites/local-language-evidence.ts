export interface LocalLanguageEvidenceInput {
  contentLanguage?: readonly string[];
  documentLanguage?: string;
  hreflang?: readonly string[];
  manifestLanguage?: string;
  ogLocale?: string;
  statistical?: Readonly<{ confidence: number; language: string; textLength: number }>;
  urlLanguages?: readonly string[];
}

export type LocalLanguageEvidence =
  | Readonly<{ kind: 'ambiguous'; proofs: readonly string[] }>
  | Readonly<{ kind: 'detected'; language: string; proof: string; proofs: readonly string[] }>
  | Readonly<{ kind: 'undetected'; proofs: readonly string[] }>;

function language(value: string): string | undefined {
  const normalized = value.trim().replaceAll('_', '-').toLowerCase().split('-', 1)[0];
  return normalized && /^[a-z]{2,3}$/u.test(normalized) ? normalized : undefined;
}

export function detectLocalLanguage(input: LocalLanguageEvidenceInput): LocalLanguageEvidence {
  const declarations: Array<readonly [proof: string, value: string]> = [];
  for (const value of input.urlLanguages ?? []) declarations.push(['url-path', value]);
  if (input.manifestLanguage) declarations.push(['manifest', input.manifestLanguage]);
  if (input.documentLanguage) declarations.push(['html-lang', input.documentLanguage]);
  for (const value of input.contentLanguage ?? []) declarations.push(['content-language', value]);
  if (input.ogLocale) declarations.push(['og:locale', input.ogLocale]);
  for (const value of input.hreflang ?? []) declarations.push(['hreflang', value]);
  const normalized = declarations.flatMap(([proof, value]) => {
    const detected = language(value);
    return detected === undefined ? [] : [{ language: detected, proof }];
  }).slice(0, 24);
  const strong = normalized.filter(({ proof }) => proof === 'url-path' || proof === 'manifest' || proof === 'html-lang' || proof === 'content-language' || proof === 'og:locale');
  const strongLanguages = new Set(strong.map((item) => item.language));
  if (strongLanguages.size > 1) return Object.freeze({ kind: 'ambiguous', proofs: Object.freeze(strong.map((item) => item.proof)) });
  const firstStrong = strong[0];
  if (firstStrong !== undefined) return Object.freeze({ kind: 'detected', language: firstStrong.language, proof: firstStrong.proof, proofs: Object.freeze(strong.map((item) => item.proof)) });
  const statistical = input.statistical;
  if (statistical !== undefined && statistical.textLength >= 80 && statistical.confidence >= 0.85) {
    const detected = language(statistical.language);
    if (detected !== undefined) return Object.freeze({ kind: 'detected', language: detected, proof: 'statistical', proofs: Object.freeze(['statistical']) });
  }
  const hreflang = normalized.filter(({ proof }) => proof === 'hreflang');
  const hreflangLanguages = new Set(hreflang.map((item) => item.language));
  if (hreflangLanguages.size === 1 && hreflang[0] !== undefined) return Object.freeze({ kind: 'detected', language: hreflang[0].language, proof: 'hreflang', proofs: Object.freeze(['hreflang']) });
  return Object.freeze({ kind: 'undetected', proofs: Object.freeze([]) });
}
