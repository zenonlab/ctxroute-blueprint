import { franc, francAll } from 'franc-min';
// eld has no published TypeScript declaration; its tiny API is typed locally below.
// @ts-expect-error external package has no declaration file
import { eld } from 'eld';

export type LanguageDetectionMethod = 'url-path' | 'manifest' | 'document' | 'undetected' | 'ambiguous';
export type DetectedLanguage = { language: string | null; method: LanguageDetectionMethod; rawUrl: string; detectedAt: string };
const ISO = /^[a-z]{2,3}(?:-[a-z]{2,4})?$/i;
// ISO 639-1 language segments. Keeping this list explicit avoids treating
// arbitrary three-letter URL slugs as languages while covering every
// two-letter language badge.
const LANGUAGE_SEGMENT = new Set('aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'.split(' '));
export function normalizeLanguage(value: unknown): string | null { if (typeof value !== 'string') return null; const raw=value.trim().replace(/_/g,'-'); if (!ISO.test(raw)) return null; const [primary,...rest]=raw.split('-'); return [primary.toLowerCase(),...rest.map(part=>part.length===2?part.toUpperCase():part)].join('-'); }
export function languageMatches(preferred: string, detected: string | null): boolean { const a=normalizeLanguage(preferred)?.split('-')[0]; const b=normalizeLanguage(detected)?.split('-')[0]; return Boolean(a&&b&&a===b); }
export function detectLanguageFromUrl(rawUrl:string,now=new Date().toISOString()):DetectedLanguage { let url:URL; try{url=new URL(rawUrl)}catch{return {language:null,method:'undetected',rawUrl,detectedAt:now}} const candidates=url.pathname.split('/').filter(Boolean).map(normalizeLanguage).filter((value):value is string=>Boolean(value)); const unique=[...new Set(candidates.filter(value=>LANGUAGE_SEGMENT.has(value.split('-')[0])))]; return {language:unique.length===1?unique[0]:null,method:unique.length===1?'url-path':unique.length>1?'ambiguous':'undetected',rawUrl,detectedAt:now}; }
export function detectLanguage(rawUrl:string,manifestLanguage:unknown,now=new Date().toISOString()):DetectedLanguage { const fromUrl=detectLanguageFromUrl(rawUrl,now); if(fromUrl.language||fromUrl.method==='ambiguous')return fromUrl; const language=normalizeLanguage(manifestLanguage); return {language,method:language?'manifest':'undetected',rawUrl,detectedAt:now}; }
export function detectLanguageFromDocument(rawUrl:string,documentLanguage:unknown,now=new Date().toISOString()):DetectedLanguage { const fromUrl=detectLanguageFromUrl(rawUrl,now); if(fromUrl.language||fromUrl.method==='ambiguous')return fromUrl; const language=normalizeLanguage(documentLanguage); return {language,method:language?'document':'undetected',rawUrl,detectedAt:now}; }

const ISO3_TO_ISO1: Record<string, string> = { eng:'en', fra:'fr', fre:'fr', jpn:'ja', kor:'ko', zho:'zh', cmn:'zh', spa:'es', por:'pt', deu:'de', ger:'de', ita:'it', rus:'ru', tur:'tr' };
export type StatisticalLanguage = DetectedLanguage & { confidence: number; detector: 'franc-min' | 'eld' };

/** Last-resort detector. Declarative evidence must be checked first by callers.
 * A low-confidence or short result is deliberately returned as undetected. */
export function detectLanguageStatistically(text: string, rawUrl = '', now = new Date().toISOString(), minLength = 80): StatisticalLanguage {
  const cleaned = text.replace(/\s+/gu, ' ').trim();
  if (cleaned.length < minLength) return { language: null, method: 'undetected', rawUrl, detectedAt: now, confidence: 0, detector: 'franc-min' };
  const scores = francAll(cleaned, { minLength });
  const top = scores[0], second = scores[1];
  const confidence = top?.[1] ?? 0;
  const margin = confidence - (second?.[1] ?? 0);
  const language = top && confidence >= 0.8 && margin >= 0.1 ? ISO3_TO_ISO1[top[0]] ?? null : null;
  return { language, method: language ? 'document' : 'undetected', rawUrl, detectedAt: now, confidence, detector: 'franc-min' };
}

export function compareStatisticalLanguageDetectors(text: string, minLength = 80) {
  const cleaned = text.replace(/\s+/gu, ' ').trim();
  if (cleaned.length < minLength) return { franc: null, eld: null, length: cleaned.length };
  const francResult = franc(cleaned, { minLength });
  const eldResult = eld.detect(cleaned);
  return { franc: ISO3_TO_ISO1[francResult] ?? null, eld: eldResult.isReliable() ? normalizeLanguage(eldResult.language) : null, length: cleaned.length };
}
