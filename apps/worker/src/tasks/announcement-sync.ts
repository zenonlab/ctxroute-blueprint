export type AnnouncementInput = {
  mediaId: string;
  releaseKey: string;
  announcedAt: string;
  status: 'SCHEDULED' | 'ANNOUNCED';
  provenance: Record<string, unknown>;
};

type Helpers = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };

export default async function announcementSync(payload: unknown, helpers: Helpers) {
  const input = payload as { provider?: string; announcements?: AnnouncementInput[] };
  if (!input.provider || !Array.isArray(input.announcements)) return { status: 'SKIPPED', reason: 'announcement-payload-invalid' };
  const policy = await helpers.query('SELECT status FROM catalog_provider_policy WHERE provider=$1', [input.provider]);
  if (policy.rows[0]?.status !== 'AUTHORIZED') return { status: 'SKIPPED', reason: 'provider-policy-not-authorized' };
  let saved = 0;
  for (const announcement of input.announcements) {
    if (!announcement.mediaId || !announcement.releaseKey || !announcement.announcedAt || !['SCHEDULED', 'ANNOUNCED'].includes(announcement.status)) continue;
    await helpers.query(
      `INSERT INTO release_announcement(media_id,release_key,provider,status,announced_at,provenance)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(provider,release_key) DO UPDATE SET media_id=excluded.media_id,status=excluded.status,announced_at=excluded.announced_at,provenance=excluded.provenance`,
      [announcement.mediaId, announcement.releaseKey, input.provider, announcement.status, announcement.announcedAt, JSON.stringify(announcement.provenance)],
    );
    saved += 1;
  }
  return { status: 'OK', saved };
}
