import { load as loadHtml } from 'cheerio';
import { franc, francAll } from 'franc-min';
// eld has no published TypeScript declaration; its tiny API is typed locally below.
// @ts-expect-error external package has no declaration file
import { eld } from 'eld';

export type LanguageDetectionMethod =
  | 'url-path'
  | 'manifest'
  | 'document'
  | 'html-lang'
  | 'content-language'
  | 'og:locale'
  | 'hreflang'
  | 'statistical'
  | 'undetected'
  | 'ambiguous';
export type DetectedLanguage = { language: string | null; method: LanguageDetectionMethod; rawUrl: string; detectedAt: string };
export type LanguageSignalMethod = Exclude<LanguageDetectionMethod, 'document' | 'statistical' | 'undetected' | 'ambiguous'>;
export type LanguageSignal = { method: LanguageSignalMethod; language: string; raw: string; strength: 'strong' | 'weak' };
export type LanguageDetectorEvidence = { language: string | null; confidence: number; reliable: boolean };
export type LanguageEvidence = {
  analyzedLength: number;
  declarations: LanguageSignal[];
  detectors: { francMin: LanguageDetectorEvidence & { margin: number }; eld: LanguageDetectorEvidence };
  conflicts: Array<{ kind: 'strong-statistical' | 'strong-strong' | 'detector-detector' | 'weak-weak'; languages: string[] }>;
};
export type ResolvedLanguage = DetectedLanguage & { evidence: LanguageEvidence };
export type DeclaredLanguageEvidence = {
  language: string | null;
  method: Exclude<LanguageDetectionMethod, 'document' | 'statistical'>;
  raw: string | null;
};

const ISO = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i;
const LANGUAGE_SEGMENT = new Set('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'.split(' '));
const ISO3_TO_ISO1: Record<string, string> = { eng:'en', fra:'fr', fre:'fr', jpn:'ja', kor:'ko', zho:'zh', cmn:'zh', spa:'es', por:'pt', deu:'de', ger:'de', ita:'it', rus:'ru', tur:'tr' };
const MAX_RAW_EVIDENCE_LENGTH = 160;

export function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/_/g, '-');
  if (!ISO.test(raw)) return null;
  const [primary, ...rest] = raw.split('-');
  return [primary.toLowerCase(), ...rest.map(part => part.length === 2 ? part.toUpperCase() : part)].join('-');
}

const primaryLanguage = (language: string) => language.split('-')[0];
const boundedRaw = (value: unknown) => String(value ?? '').trim().slice(0, MAX_RAW_EVIDENCE_LENGTH);

export function languageMatches(preferred: string, detected: string | null): boolean {
  const a = normalizeLanguage(preferred)?.split('-')[0];
  const b = normalizeLanguage(detected)?.split('-')[0];
  return Boolean(a && b && a === b);
}

function urlLanguageCandidates(rawUrl: string) {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return []; }
  return [...new Set(url.pathname.split('/').filter(Boolean).map(normalizeLanguage).filter((value): value is string => Boolean(value)).filter(value => LANGUAGE_SEGMENT.has(primaryLanguage(value))))];
}

export function detectLanguageFromUrl(rawUrl: string, now = new Date().toISOString()): DetectedLanguage {
  const unique = urlLanguageCandidates(rawUrl);
  return { language: unique.length === 1 ? unique[0] : null, method: unique.length === 1 ? 'url-path' : unique.length > 1 ? 'ambiguous' : 'undetected', rawUrl, detectedAt: now };
}

export function detectLanguage(rawUrl: string, manifestLanguage: unknown, now = new Date().toISOString()): DetectedLanguage {
  const fromUrl = detectLanguageFromUrl(rawUrl, now);
  if (fromUrl.language || fromUrl.method === 'ambiguous') return fromUrl;
  const language = normalizeLanguage(manifestLanguage);
  return { language, method: language ? 'manifest' : 'undetected', rawUrl, detectedAt: now };
}

export function detectLanguageFromDocument(rawUrl: string, documentLanguage: unknown, now = new Date().toISOString()): DetectedLanguage {
  const fromUrl = detectLanguageFromUrl(rawUrl, now);
  if (fromUrl.language || fromUrl.method === 'ambiguous') return fromUrl;
  const language = normalizeLanguage(documentLanguage);
  return { language, method: language ? 'document' : 'undetected', rawUrl, detectedAt: now };
}

export type StatisticalLanguage = DetectedLanguage & { confidence: number; detector: 'franc-min' | 'eld' };

export function statisticalLanguageDecision(francLanguage: string | null, eldLanguage: string | null) {
  const francDetected = normalizeLanguage(francLanguage), eldDetected = normalizeLanguage(eldLanguage);
  if (francDetected && eldDetected && primaryLanguage(francDetected) !== primaryLanguage(eldDetected)) return { language:null, method:'ambiguous' as const, detector:'franc-min' as const };
  return francDetected ? { language:francDetected, method:'document' as const, detector:'franc-min' as const } : eldDetected ? { language:eldDetected, method:'document' as const, detector:'eld' as const } : { language:null, method:'undetected' as const, detector:'franc-min' as const };
}

function statisticalEvidence(text: string, minLength = 80) {
  const cleaned = text.replace(/\s+/gu, ' ').trim();
  if (cleaned.length < minLength) return {
    cleaned,
    decision: statisticalLanguageDecision(null, null),
    francMin: { language:null, confidence:0, margin:0, reliable:false },
    eld: { language:null, confidence:0, reliable:false },
  };
  const scores = francAll(cleaned, { minLength });
  const top = scores[0], second = scores[1];
  const confidence = top?.[1] ?? 0;
  const margin = confidence - (second?.[1] ?? 0);
  const francLanguage = top && confidence >= 0.8 && margin >= 0.1 ? ISO3_TO_ISO1[top[0]] ?? null : null;
  const eldResult = eld.detect(cleaned) as { language: string; isReliable(): boolean; getScores(): Record<string, number> };
  const eldReliable = eldResult.isReliable();
  const eldLanguage = eldReliable ? normalizeLanguage(eldResult.language) : null;
  const eldScores = eldResult.getScores();
  return {
    cleaned,
    decision: statisticalLanguageDecision(francLanguage, eldLanguage),
    francMin: { language:francLanguage, confidence, margin, reliable:Boolean(francLanguage) },
    eld: { language:eldLanguage, confidence:Number(eldScores[eldResult.language] ?? 0), reliable:eldReliable && Boolean(eldLanguage) },
  };
}

/** A short or low-confidence result is deliberately returned as undetected. */
export function detectLanguageStatistically(text: string, rawUrl = '', now = new Date().toISOString(), minLength = 80): StatisticalLanguage {
  const result = statisticalEvidence(text, minLength);
  return { ...result.decision, rawUrl, detectedAt:now, confidence:result.francMin.confidence };
}

export function compareStatisticalLanguageDetectors(text: string, minLength = 80) {
  const cleaned = text.replace(/\s+/gu, ' ').trim();
  if (cleaned.length < minLength) return { franc:null, eld:null, length:cleaned.length };
  const francResult = franc(cleaned, { minLength });
  const eldResult = eld.detect(cleaned);
  return { franc:ISO3_TO_ISO1[francResult] ?? null, eld:eldResult.isReliable() ? normalizeLanguage(eldResult.language) : null, length:cleaned.length };
}

function headerValues(headers: Headers | Record<string, string | string[] | undefined> | undefined, name: string) {
  const value = headers instanceof Headers ? headers.get(name) : Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return (Array.isArray(value) ? value : [value]).flatMap(item => String(item ?? '').split(',')).map(item => item.split(';')[0].trim()).filter(Boolean);
}

function addSignal(signals: LanguageSignal[], method: LanguageSignalMethod, raw: unknown, strength: LanguageSignal['strength']) {
  const language = normalizeLanguage(raw);
  if (language) signals.push({ method, language, raw:boundedRaw(raw), strength });
}

export function visibleDocumentText(html: string) {
  const $ = loadHtml(html);
  $('script,style,noscript,template,svg').remove();
  return $('body').text().replace(/\s+/gu, ' ').trim();
}

/** Collects every bounded declaration. Call resolvePageLanguage for arbitration. */
export function declaredLanguageSignals(input: {
  url: string;
  manifestLanguage?: unknown;
  html?: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
}): LanguageSignal[] {
  const signals: LanguageSignal[] = [];
  for (const candidate of urlLanguageCandidates(input.url)) addSignal(signals, 'url-path', candidate, 'strong');
  for (const value of headerValues(input.headers, 'content-language')) addSignal(signals, 'content-language', value, 'strong');
  addSignal(signals, 'manifest', input.manifestLanguage, 'weak');
  if (!input.html) return signals.slice(0, 24);
  const $ = loadHtml(input.html);
  addSignal(signals, 'html-lang', $('html').first().attr('lang'), 'weak');
  const locales = $("meta[property='og:locale'], meta[name='og:locale']").map((_, element) => $(element).attr('content')).get();
  for (const locale of locales) addSignal(signals, 'og:locale', locale, 'weak');
  const hreflangs = $("link[rel~='alternate'][hreflang]").map((_, element) => $(element).attr('hreflang')).get();
  for (const hreflang of hreflangs) addSignal(signals, 'hreflang', hreflang, 'weak');
  return signals.slice(0, 24);
}

/** Compatibility summary for consumers that only need declarations. */
export function declaredLanguageEvidence(input: {
  url: string;
  manifestLanguage?: unknown;
  html?: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
}): DeclaredLanguageEvidence {
  const signals = declaredLanguageSignals(input);
  const strong = signals.filter(signal => signal.strength === 'strong');
  const selected = strong.length ? strong : signals.filter(signal => signal.strength === 'weak');
  const languages = uniquePrimaryLanguages(selected);
  if (languages.length > 1) return { language:null, method:'ambiguous', raw:null };
  const signal = selected[0];
  return signal ? { language:signal.language, method:signal.method, raw:signal.raw } : { language:null, method:'undetected', raw:null };
}

const uniquePrimaryLanguages = (signals: Array<{ language: string | null }>) => [...new Set(signals.map(signal => signal.language).filter((value): value is string => Boolean(value)).map(primaryLanguage))];

/** Shared arbitration for availability collection and any page-language consumer. */
export function resolvePageLanguage(input: {
  url: string;
  manifestLanguage?: unknown;
  html: string;
  headers?: Headers | Record<string, string | string[] | undefined>;
  now?: string;
  minLength?: number;
}): ResolvedLanguage {
  const detectedAt = input.now ?? new Date().toISOString();
  const declarations = declaredLanguageSignals(input);
  const stats = statisticalEvidence(visibleDocumentText(input.html), input.minLength);
  const conflicts: LanguageEvidence['conflicts'] = [];
  const strong = declarations.filter(signal => signal.strength === 'strong');
  const weak = declarations.filter(signal => signal.strength === 'weak');
  const strongLanguages = uniquePrimaryLanguages(strong);
  const weakLanguages = uniquePrimaryLanguages(weak);
  const statisticalLanguages = uniquePrimaryLanguages([stats.francMin, stats.eld]);
  if (statisticalLanguages.length > 1) conflicts.push({ kind:'detector-detector', languages:statisticalLanguages });
  if (strongLanguages.length > 1) conflicts.push({ kind:'strong-strong', languages:strongLanguages });
  if (weakLanguages.length > 1) conflicts.push({ kind:'weak-weak', languages:weakLanguages });
  if (strongLanguages.length === 1 && stats.decision.language && strongLanguages[0] !== primaryLanguage(stats.decision.language)) conflicts.push({ kind:'strong-statistical', languages:[strongLanguages[0], primaryLanguage(stats.decision.language)] });
  const evidence: LanguageEvidence = { analyzedLength:stats.cleaned.length, declarations, detectors:{ francMin:stats.francMin, eld:stats.eld }, conflicts };
  if (stats.decision.method === 'ambiguous' || strongLanguages.length > 1 || conflicts.some(conflict => conflict.kind === 'strong-statistical')) return { language:null, method:'ambiguous', rawUrl:input.url, detectedAt, evidence };
  if (strongLanguages.length === 1) {
    const signal = strong.find(item => primaryLanguage(item.language) === strongLanguages[0])!;
    return { language:signal.language, method:signal.method, rawUrl:input.url, detectedAt, evidence };
  }
  if (stats.decision.language) return { language:stats.decision.language, method:'statistical', rawUrl:input.url, detectedAt, evidence };
  if (weakLanguages.length === 1) {
    const signal = weak.find(item => primaryLanguage(item.language) === weakLanguages[0])!;
    return { language:signal.language, method:signal.method, rawUrl:input.url, detectedAt, evidence };
  }
  return { language:null, method:weakLanguages.length > 1 ? 'ambiguous' : 'undetected', rawUrl:input.url, detectedAt, evidence };
}
