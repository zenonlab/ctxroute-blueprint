import type { Task } from 'graphile-worker';
import { saveProviderProfileCover } from '../cover-store.js';

const task: Task = async (raw, helpers) => {
  const profileId = String((raw as any)?.profileId ?? '');
  if (!profileId) return;
  const row = await helpers.query("SELECT provider,provider_id,image FROM provider_profile WHERE id=$1 AND image IS NOT NULL AND image<>''", [profileId]);
  if (!row.rows[0]) return;
  await saveProviderProfileCover(helpers as any, profileId, String(row.rows[0].image), String(row.rows[0].provider), { timeoutMs: 15000 });
  await helpers.query(`INSERT INTO media_cover(media_id,source_url,provider,provider_external_id,provenance,mime_type,data,asset_sha256,content_sha256,width,height,byte_size,status,fetched_at,error)
    SELECT external.media_id,profile.cover_source_url,profile.provider,profile.provider_id,
      jsonb_build_object('source','provider-profile-cover','profileId',profile.id::text),'image/webp',NULL,
      profile.cover_asset_sha256,profile.cover_asset_sha256,profile.cover_width,profile.cover_height,profile.cover_byte_size,'ACTIVE',now(),NULL
    FROM provider_profile profile JOIN LATERAL (
      SELECT external.media_id FROM media_external_id external
        WHERE external.provider=profile.provider AND external.external_id=profile.provider_id
      UNION
      SELECT candidate.media_id FROM favorite_review_candidate candidate
        WHERE candidate.profile_id=profile.id AND candidate.media_id IS NOT NULL
    ) external ON true
    WHERE profile.id=$1 AND profile.cover_status='ACTIVE' AND profile.cover_asset_sha256 IS NOT NULL
    ON CONFLICT(media_id) DO UPDATE SET source_url=excluded.source_url,provider=excluded.provider,
      provider_external_id=excluded.provider_external_id,provenance=excluded.provenance,mime_type=excluded.mime_type,
      data=NULL,asset_sha256=excluded.asset_sha256,content_sha256=excluded.content_sha256,width=excluded.width,
      height=excluded.height,byte_size=excluded.byte_size,status='ACTIVE',fetched_at=now(),error=NULL
    WHERE media_cover.status IN ('FAILED','STALE','FALLBACK')`, [profileId]);
};

export default task;
