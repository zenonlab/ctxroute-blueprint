import { createHash } from 'node:crypto';
import { canonicalUrl, inspect } from '@favlib/connectors';
import { resolutionStatus, type Snapshot } from '@favlib/availability';
import { isTestEnvironment } from '@favlib/config';
import { progressionFromFavorite } from '@favlib/metadata';
import { safeRequest } from '@favlib/safe-http';
import { resolvePageLanguage } from '@favlib/metadata';

export type FetchPolicy = { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; approvedDomains: string[]; allowPrivateTest?: boolean };
export type CollectionInput = { target: string; rawTarget?: string; workUrl?: string; mediaId: string; connector: string; connectorVersion: string; policy: FetchPolicy; now?: string };

const FAVICON_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'];
const MEDIA_KEYWORDS = /(?:anime|manga|manhwa|manhua|comic|comics|webtoon|light\s*novel|novel|chapter|chapitre|episode|épisode|scan|reading|read)/iu;
const SUSPICIOUS_KEYWORDS = /(?:casino|roulette|spinzywheel|gambling|betting|phish(?:ing)?|malware|porn|adult|payday\s*loan|index\s+of)/iu;

async function fetchHtml(target: string, policy: FetchPolicy) {
  const response = await safeRequest(target, { headers: { accept: 'text/html,application/xhtml+xml' }, timeoutMs: policy.timeoutMs ?? 5000, maxBytes: policy.maxBytes ?? 512 * 1024, mimeTypes: ['text/html', 'application/xhtml+xml'], maxRedirects: policy.maxRedirects ?? 2, allowedHosts: policy.approvedDomains, allowPrivateTest: Boolean(policy.allowPrivateTest && isTestEnvironment()) });
  if (response.status === 429) throw new Error('RATE_LIMITED');
  if (response.status < 200 || response.status >= 300) throw new Error(`HTTP_${response.status}`);
  return { html: response.body.toString('utf8'), url: response.url, headers: response.headers };
}

function manifestText(value: unknown) {
  if (!value || typeof value !== 'object') return '';
  const manifest = value as Record<string, unknown>;
  const values = [manifest.name, manifest.short_name, manifest.description, manifest.keywords];
  return values.flatMap(item => Array.isArray(item) ? item : [item]).filter((item): item is string => typeof item === 'string').join(' ').trim();
}

async function validateSiteSignals(domain: string, policy: FetchPolicy) {
  if (policy.allowPrivateTest && isTestEnvironment()) return null;
  // A favicon is presentation metadata, never availability evidence.
  try { await safeRequest(`https://${domain}/favicon.ico`, { requireHttps: true, maxRedirects: 2, timeoutMs: 3000, maxBytes: 512 * 1024, mimeTypes: FAVICON_MIMES, allowedHosts: policy.approvedDomains }); } catch { /* DomainIcon owns its fallback. */ }
  let sawSuspectManifest = false;
  for (const path of ['/manifest.json', '/site.webmanifest']) {
    try {
      const response = await safeRequest(`https://${domain}${path}`, { requireHttps: true, maxRedirects: 2, timeoutMs: 3000, maxBytes: 128 * 1024, mimeTypes: [], allowedHosts: policy.approvedDomains });
      if (response.status < 200 || response.status >= 300) continue;
      const value = JSON.parse(response.body.toString('utf8')) as unknown;
      const text = manifestText(value);
      if (!MEDIA_KEYWORDS.test(text) || SUSPICIOUS_KEYWORDS.test(text)) {
        sawSuspectManifest = true;
        continue;
      }
      return value;
    } catch (error) {
      if (error instanceof Error && error.message === 'MANIFEST_SUSPECT') throw error;
    }
  }
  if (sawSuspectManifest) throw new Error('MANIFEST_SUSPECT');
  return null;
}

export async function collectSnapshot(input: CollectionInput): Promise<Snapshot> {
  const fetchedAt = input.now ?? new Date().toISOString();
  try {
    const response = await fetchHtml(input.target, input.policy);
    const domain = new URL(response.url).hostname.toLowerCase();
    const manifest = await validateSiteSignals(domain, input.policy);
    const parsed = inspect(response.url, response.html);
    const parsedTitle = parsed.title ?? undefined;
    const releases = parsed.releases.length ? parsed.releases : (() => {
      const progression = parsedTitle ? progressionFromFavorite({ title: parsedTitle, url: response.url }) : null;
      if (!progression) return [];
      return [{ logicalKey: `${input.mediaId}:${progression.kind}:${progression.raw}`, sequence: { kind: progression.kind === 'episode' ? 'integer' as const : progression.raw.includes('.') ? 'decimal' as const : 'integer' as const, raw: progression.raw, number: progression.number, part: undefined }, url: response.url, title: parsedTitle ?? '', evidence: ['accessible-target', 'shared-progression-parser'] }];
    })();
    const languageUrl=input.workUrl??response.url;
    const detected = resolvePageLanguage({ url:languageUrl, manifestLanguage:(manifest as Record<string, unknown> | null)?.lang, html:response.html, headers:response.headers, now:fetchedAt });
    const origins:Snapshot['origins'] = releases.map(release => {
      const url = canonicalUrl(release.url, response.url) ?? release.url;
      return { mediaId: input.mediaId, connector: input.connector, checkedAt: fetchedAt, status: 'AVAILABLE' as const, observationKind:'RELEASE' as const, sequence: { kind: release.sequence.kind, raw: release.sequence.raw, number: release.sequence.number, part: release.sequence.part }, title: release.title, url, workUrl: input.workUrl ?? input.target, language: detected.language, languageDetection: detected.method, languageEvidence:detected.evidence };
    });
    if(parsed.status==='VALID')origins.unshift({mediaId:input.mediaId,connector:input.connector,checkedAt:fetchedAt,status:'AVAILABLE' as const,observationKind:'WORK' as const,sequence:{kind:'special' as const,raw:'work-source'},title:parsedTitle,url:input.workUrl??input.target,workUrl:input.workUrl??input.target,language:detected.language,languageDetection:detected.method,languageEvidence:detected.evidence});
    return { fetchedAt, status: 'VALID', resolutionStatus: resolutionStatus({ accessible: true, identityResolved: parsed.status === 'VALID', chapterResolved: releases.length > 0 }), origins };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : 'COLLECTION_FAILED';
    const down = /HTTP_(?:404|410)|NOT_FOUND|PRIVATE_IP|FAVICON_NOT_FOUND/u.test(errorCode);
    const retryable = /TIMEOUT|ABORT|RATE_LIMITED|HTTP_5\d\d|DNS|TLS|NETWORK/u.test(errorCode);
    return { fetchedAt, status: 'QUARANTINED', resolutionStatus: resolutionStatus({ accessible: false, identityResolved: false, chapterResolved: false, retryable }), origins: [], error: errorCode };
  }
}

export function snapshotHash(snapshot: Snapshot) { return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'); }
