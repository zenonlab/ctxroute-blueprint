import { canonicalDateTime, invariant, requiredText } from './invariant';

export type ReleaseOccurrence =
  | { readonly kind: 'DATE'; readonly value: string }
  | { readonly kind: 'INSTANT'; readonly value: string };
export type PublicReleaseProvider = 'anilist' | 'mangaUpdates';
export type PublicReleaseKind = 'episode' | 'chapter' | 'volume' | 'special';
export type PublicReleaseState = 'SCHEDULED' | 'CONFIRMED' | 'ESTIMATED' | 'CANCELLED';
export interface PublicReleaseEvent { readonly id: string; readonly provider: PublicReleaseProvider; readonly providerWorkId: string; readonly releaseKind: PublicReleaseKind; readonly sequence?: number; readonly occurrence: ReleaseOccurrence; readonly state: PublicReleaseState; readonly provenance: { readonly source: string; readonly fetchedAt: string; readonly parserVersion: string; readonly rulesVersion: string }; readonly expiresAt: string; }
export interface LocalReleaseEvidence { readonly id: string; readonly publicReleaseId: string; readonly workId: string; readonly observedAt: string; readonly source: 'public' | 'manual'; readonly occurrence: ReleaseOccurrence; readonly state: PublicReleaseState; }
export interface LocalAgendaEvent { readonly id: string; readonly workId: string; readonly evidenceId: string; readonly occurrence: ReleaseOccurrence; readonly availability: 'confirmed' | 'estimated' | 'official' | 'unavailable'; readonly releaseLabel: string; }
export interface LocalNotificationDelivery { readonly id: string; readonly agendaEventId: string; readonly deduplicationKey: string; readonly channel: 'native'; readonly status: 'pending' | 'claimed' | 'delivered' | 'dismissed'; readonly availableAt: string; readonly claimedAt?: string; readonly deliveredAt?: string; }

export function createReleaseOccurrence(input: ReleaseOccurrence): ReleaseOccurrence {
  if (input.kind === 'DATE') { invariant(/^\d{4}-\d{2}-\d{2}$/u.test(input.value), 'invalid-agenda-date', 'DATE occurrence must be YYYY-MM-DD.'); return Object.freeze({ kind: input.kind, value: input.value }); }
  return Object.freeze({ kind: input.kind, value: canonicalDateTime(input.value, 'INSTANT occurrence') });
}
export function createPublicReleaseEvent(input: PublicReleaseEvent): PublicReleaseEvent {
  invariant(input.id.trim().length > 0, 'invalid-id', 'Public release id must not be empty.');
  invariant(input.providerWorkId.trim().length > 0, 'invalid-id', 'Provider work id must not be empty.');
  const sequence = input.sequence === undefined ? undefined : Math.max(0, Math.floor(input.sequence));
  const normalized = { ...input, id: requiredText(input.id, 'id'), providerWorkId: requiredText(input.providerWorkId, 'providerWorkId'), occurrence: createReleaseOccurrence(input.occurrence), expiresAt: canonicalDateTime(input.expiresAt, 'expiresAt'), provenance: Object.freeze({ ...input.provenance, fetchedAt: canonicalDateTime(input.provenance.fetchedAt, 'provenance.fetchedAt') }) };
  return Object.freeze(sequence === undefined ? normalized : { ...normalized, sequence });
}
