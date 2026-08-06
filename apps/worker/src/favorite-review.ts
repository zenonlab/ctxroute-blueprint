import { exactTitleMatchKind } from '@favlib/metadata';
import { createHash } from 'node:crypto';

type Query = (sql: string, values?: unknown[]) => Promise<any>;

function parsedFavoriteTitle(value: string): string {
  const parts = value.replace(/\s+/gu, ' ').trim().split(/\s+-\s+/u).map(part => part.trim()).filter(Boolean);
  const useful = parts.filter(part => !/^\d+(?:\s+(?:vostfr|vf|vo|sub|dub|scan|scans))?$/iu.test(part) && !/^voiranime$/iu.test(part) && !/^(?:vostfr|vf|vo|sub|dub|scan|scans)$/iu.test(part));
  let title = useful[0] ?? value.trim();
  title = title.replace(/^(?:read|watch|regarder gratuitement|regarder)\s+/iu, '');
  title = title.replace(/\s+(?:chapter|chapitre|episode|ep)\s*\d+(?:\.\d+)?(?:[-–—].*|\s+.*)?$/iu, '');
  title = title.replace(/\s+(?:in english online free|online free|en hd)\s*$/iu, '');
  title = title.replace(/\s*(?:[-–—|·:]\s*)?(?:voiranime|mangakakalot|manganelo|mangakakalot\.com|manganelo\.com|manhwaz)\s*$/iu, '');
  return title.replace(/\s+(?:vostfr|vf|vo|sub|dub|scan|scans|en hd)\s*$/iu, '').trim().replace(/[|·:—–-]+$/u, '').trim() || value.trim();
}

export type ReviewCandidate = Record<string, any> & { id: string | number; title?: string; hitTitle?: string; url?: string };

function candidateImage(candidate: ReviewCandidate) {
  if (typeof candidate.image === 'string' && candidate.image.trim()) return candidate.image;
  if (typeof candidate.coverImage === 'string' && candidate.coverImage.trim()) return candidate.coverImage;
  if (candidate.coverImage && typeof candidate.coverImage === 'object')
    return candidate.coverImage.extraLarge ?? candidate.coverImage.large ?? candidate.coverImage.medium;
  return undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export async function refreshReviewQueueNotification(query: Query, userId: string) {
  const pending = await query("SELECT count(*)::int AS count FROM favorite_review WHERE user_id=$1 AND status='PENDING'", [userId]);
  const count = Number(pending.rows[0]?.count ?? 0);
  if (!count) {
    await query("DELETE FROM personal_notification WHERE user_id=$1 AND kind='FAVORITE_REVIEW_REQUIRED' AND release_key='favorite-review-queue'", [userId]);
    return;
  }
  await query(`INSERT INTO personal_notification(user_id,release_key,kind,payload)
    VALUES($1,'favorite-review-queue','FAVORITE_REVIEW_REQUIRED',jsonb_build_object('title','Correspondances à résoudre','message',$2::text,'count',$3::int,'url','/review'))
    ON CONFLICT(user_id,release_key,kind) DO UPDATE SET payload=excluded.payload,read_at=NULL`, [userId, `Il reste ${count} favori${count > 1 ? 's' : ''} à vérifier.`, count]);
}

/** Persist a complete, provider-specific ambiguity decision exactly once. */
export async function openFavoriteReview(query: Query, input: {
  userId: string; installationId?: string; bookmarkId?: string; title: string; url: string;
  provider: 'anilist'|'mangaupdates'; candidates: ReviewCandidate[]; mediaId?: string; reason?: string;
  persistCover?: (profileId: string, imageUrl: string, provider: 'anilist'|'mangaupdates') => Promise<unknown>;
}) {
  const candidates = input.candidates.slice(0, 5);
  const link = await query(`SELECT l.installation_id AS "installationId",l.bookmark_id AS "bookmarkId",i.payload->>'title' AS "rawFavoriteTitle",i.payload->>'parsedTitle' AS "parsedFavoriteTitle",i.payload->>'url' AS "favoriteUrl"
    FROM bookmark_media_link l LEFT JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id
    WHERE l.user_id=$1 AND ($2::text IS NULL OR l.media_id=$2) AND ($3::text IS NULL OR l.installation_id=$3) AND ($4::text IS NULL OR l.bookmark_id=$4) ORDER BY l.created_at DESC LIMIT 1`, [input.userId, input.mediaId ?? null, input.installationId ?? null, input.bookmarkId ?? null]);
  const installationId = input.installationId ?? link.rows[0]?.installationId ?? 'worker';
  const bookmarkId = input.bookmarkId ?? link.rows[0]?.bookmarkId ?? input.mediaId ?? input.url;
  // The review must show what the user actually imported from Chrome. The
  // parsed/source title is only a resolver hint and may be an opaque URL slug
  // such as `Lw931574`.
  const rawFavoriteTitle = link.rows[0]?.rawFavoriteTitle ?? link.rows[0]?.favoriteTitle ?? input.title;
  // Always normalize the raw Chrome title on the server. The extension hint is
  // useful for transport, but must never allow an older client/parser result
  // to leak into the review UI.
  const favoriteTitle = parsedFavoriteTitle(rawFavoriteTitle);
  const favoriteUrl = link.rows[0]?.favoriteUrl || input.url || '';
  const review = await query(`INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason)
    VALUES($1,$2,$3,$4,$5,$6,'PENDING',$7) ON CONFLICT(user_id,installation_id,bookmark_id,provider)
    DO UPDATE SET favorite_title=excluded.favorite_title,favorite_url=excluded.favorite_url,reason=COALESCE(excluded.reason,favorite_review.reason)
    RETURNING id`, [input.userId, installationId, bookmarkId, favoriteTitle, favoriteUrl, input.provider, input.reason ?? null]);
  const reviewId = review.rows[0].id;
  for (const candidate of candidates) {
    const title = String(candidate.title ?? candidate.name ?? `${input.provider} ${candidate.id}`);
    const known = await query("SELECT media_id AS \"mediaId\" FROM media_external_id WHERE provider=$1 AND external_id=$2 LIMIT 1", [input.provider, String(candidate.id)]);
    const texts = (value: unknown) => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : JSON.stringify(item)) : [];
    const payload = stableJson(candidate);
    const payloadHash = createHash('sha256').update(payload).digest('hex');
    const profile = await query(`INSERT INTO provider_profile(provider,provider_id,payload_hash,canonical_title,associated_titles,type,year,start_date,status,authors,categories,genres,image,url,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb)
      ON CONFLICT(provider,provider_id,payload_hash) DO UPDATE SET last_seen_at=now()
      RETURNING id`, [
        input.provider, String(candidate.id), payloadHash, title,
        texts(candidate.titles ?? candidate.synonyms ?? candidate.associated), candidate.type ?? null,
        candidate.year ?? candidate.startYear ?? candidate.seasonYear ?? null, candidate.startDate == null ? null : JSON.stringify(candidate.startDate),
        candidate.status ?? null, candidate.authors == null ? null : JSON.stringify(candidate.authors), texts(candidate.categories), texts(candidate.genres),
        candidateImage(candidate) ?? null,
        candidate.url ?? candidate.siteUrl ?? `https://${input.provider === 'anilist' ? 'anilist.co' : 'mangaupdates.com'}`,
        payload]);
    if (input.persistCover) await input.persistCover(String(profile.rows[0].id), candidateImage(candidate) ?? '', input.provider);
    await query(`INSERT INTO favorite_review_candidate(review_id,profile_id,provider_id,hit_title,media_id)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(review_id,provider_id) DO UPDATE SET profile_id=excluded.profile_id,hit_title=excluded.hit_title,media_id=COALESCE(excluded.media_id,favorite_review_candidate.media_id)`, [
        reviewId, profile.rows[0].id, String(candidate.id), candidate.hitTitle ?? null, known.rows[0]?.mediaId ?? null]);
  }
  const currentProviderIds = [...new Set(candidates.map(candidate => String(candidate.id)))];
  await query('DELETE FROM favorite_review_candidate WHERE review_id=$1 AND NOT (provider_id=ANY($2::text[]))', [reviewId, currentProviderIds]);
  await refreshReviewQueueNotification(query, input.userId);
  return reviewId;
}

export async function openReviewsForMedia(query: Query, input: Omit<Parameters<typeof openFavoriteReview>[1], 'userId'> & { mediaId: string }) {
  const links = await query('SELECT DISTINCT user_id AS "userId",installation_id AS "installationId",bookmark_id AS "bookmarkId" FROM bookmark_media_link WHERE media_id=$1 AND status IN (\'matched\',\'accepted\',\'review\')', [input.mediaId]);
  for (const link of links.rows ?? []) await openFavoriteReview(query, { ...input, userId: String(link.userId), installationId: link.installationId, bookmarkId: link.bookmarkId });
}

export function isParenthesizedAmbiguity(alias: string, candidates: ReviewCandidate[]) {
  const exact = candidates.some(c => {
    const kind = exactTitleMatchKind(alias, String(c.title ?? ''));
    return kind === 'NORMALIZED_EXACT' || kind === 'COMPACT_EXACT';
  });
  const variant = candidates.some(c =>
    exactTitleMatchKind(alias, String(c.title ?? '')) === 'PARENTHESIZED_EXACT');
  return exact && variant;
}
