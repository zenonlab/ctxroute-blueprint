import { createHash } from 'node:crypto';
import { canonicalUrl, inspect } from '@favlib/connectors';
import type { Snapshot } from '@favlib/availability';
import { isTestEnvironment } from '@favlib/config';
import { safeRequest } from '@favlib/safe-http';

export type FetchPolicy = { timeoutMs?: number; maxBytes?: number; maxRedirects?: number; approvedDomains: string[]; allowPrivateTest?: boolean };
export type CollectionInput = { target: string; mediaId: string; connector: string; connectorVersion: string; policy: FetchPolicy; now?: string };

async function fetchHtml(target:string,policy:FetchPolicy){const response=await safeRequest(target,{headers:{accept:'text/html,application/xhtml+xml'},timeoutMs:policy.timeoutMs??5000,maxBytes:policy.maxBytes??512*1024,mimeTypes:['text/html','application/xhtml+xml'],maxRedirects:policy.maxRedirects??2,allowedHosts:policy.approvedDomains,allowPrivateTest:Boolean(policy.allowPrivateTest&&isTestEnvironment())});if(response.status===429)throw new Error('RATE_LIMITED');if(response.status<200||response.status>=300)throw new Error(`HTTP_${response.status}`);return {html:response.body.toString('utf8'),url:response.url}}

export async function collectSnapshot(input: CollectionInput): Promise<Snapshot> { const fetchedAt = input.now ?? new Date().toISOString(); try { const response = await fetchHtml(input.target, input.policy); const parsed = inspect(response.url, response.html); if (parsed.status !== 'VALID') return { fetchedAt, status: 'QUARANTINED', origins: [] }; return { fetchedAt, status: 'VALID', origins: parsed.releases.map(release => ({ mediaId: input.mediaId, connector: input.connector, checkedAt: fetchedAt, status: 'AVAILABLE' as const, sequence: { kind: release.sequence.kind, raw: release.sequence.raw, number: release.sequence.number, part: release.sequence.part }, title: release.title, url: canonicalUrl(release.url, response.url) ?? release.url })) }; } catch { return { fetchedAt, status: 'QUARANTINED', origins: [] }; } }
export function snapshotHash(snapshot: Snapshot) { return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'); }
