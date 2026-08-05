import { exactTitleMatchKind } from '@favlib/metadata';

type Query = (sql: string, values?: unknown[]) => Promise<any>;

export type ReviewCandidate = Record<string, any> & { id: string | number; title?: string; hitTitle?: string; url?: string };

/** These source titles are intentionally human-reviewed until an exact
 * provider identity is supplied. Their provider snapshots remain audit data,
 * but generic search hits must never become an automatic decision. */
export function isManualOnlyReviewTitle(title: string) {
  const key = exactTitleKey(title);
  return key === 'the dreaming man' || /^the dreaming man is a realist(?: \d+)?$/u.test(key) || key === 'happy mariage 8' || key === 'moi le maitre des interdits2';
}

function exactTitleKey(title: string) {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function candidateImage(candidate: ReviewCandidate) {
  if (typeof candidate.image === 'string' && candidate.image.trim()) return candidate.image;
  if (typeof candidate.coverImage === 'string' && candidate.coverImage.trim()) return candidate.coverImage;
  if (candidate.coverImage && typeof candidate.coverImage === 'object')
    return candidate.coverImage.extraLarge ?? candidate.coverImage.large ?? candidate.coverImage.medium;
  return undefined;
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
}) {
  const link = await query(`SELECT l.installation_id AS "installationId",l.bookmark_id AS "bookmarkId",i.payload->>'title' AS "favoriteTitle",i.payload->>'url' AS "favoriteUrl"
    FROM bookmark_media_link l LEFT JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id
    WHERE l.user_id=$1 AND ($2::text IS NULL OR l.media_id=$2) AND ($3::text IS NULL OR l.installation_id=$3) AND ($4::text IS NULL OR l.bookmark_id=$4) ORDER BY l.created_at DESC LIMIT 1`, [input.userId, input.mediaId ?? null, input.installationId ?? null, input.bookmarkId ?? null]);
  const installationId = input.installationId ?? link.rows[0]?.installationId ?? 'worker';
  const bookmarkId = input.bookmarkId ?? link.rows[0]?.bookmarkId ?? input.mediaId ?? input.url;
  const favoriteTitle = link.rows[0]?.favoriteTitle ?? input.title;
  const favoriteUrl = link.rows[0]?.favoriteUrl ?? input.url;
  const review = await query(`INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason)
    VALUES($1,$2,$3,$4,$5,$6,'PENDING',$7) ON CONFLICT(user_id,installation_id,bookmark_id,provider)
    DO UPDATE SET favorite_title=excluded.favorite_title,favorite_url=excluded.favorite_url,reason=COALESCE(excluded.reason,favorite_review.reason)
    RETURNING id`, [input.userId, installationId, bookmarkId, favoriteTitle, favoriteUrl, input.provider, input.reason ?? null]);
  const reviewId = review.rows[0].id;
  for (const candidate of input.candidates) {
    const title = String(candidate.title ?? candidate.name ?? `${input.provider} ${candidate.id}`);
    const known = await query("SELECT media_id AS \"mediaId\" FROM media_external_id WHERE provider=$1 AND external_id=$2 LIMIT 1", [input.provider, String(candidate.id)]);
    const texts = (value: unknown) => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : JSON.stringify(item)) : [];
    await query(`INSERT INTO favorite_review_candidate(review_id,provider_id,canonical_title,hit_title,associated_titles,type,year,start_date,status,authors,categories,genres,image,url,payload,media_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16)
      ON CONFLICT(review_id,provider_id) DO UPDATE SET payload=excluded.payload,canonical_title=excluded.canonical_title,hit_title=excluded.hit_title`, [
        reviewId, String(candidate.id), title, candidate.hitTitle ?? null,
        texts(candidate.titles ?? candidate.synonyms ?? candidate.associated), candidate.type ?? null,
        candidate.year ?? candidate.startYear ?? candidate.seasonYear ?? null, candidate.startDate == null ? null : JSON.stringify(candidate.startDate),
        candidate.status ?? null, candidate.authors == null ? null : JSON.stringify(candidate.authors), texts(candidate.categories), texts(candidate.genres),
        candidateImage(candidate) ?? null,
        candidate.url ?? candidate.siteUrl ?? `https://${input.provider === 'anilist' ? 'anilist.co' : 'mangaupdates.com'}`,
        JSON.stringify(candidate), known.rows[0]?.mediaId ?? null]);
  }
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
