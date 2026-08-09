export const REQUIRED_RUNTIME_TABLES = [
  'app_user', 'bookmark_import_batch', 'bookmark_import_item', 'bookmark_media_link', 'favorite_progress_candidate',
  'media', 'media_title', 'media_external_id', 'media_metadata', 'media_enrichment_state', 'domain_favicon_cache', 'favorite_review', 'favorite_review_candidate', 'provider_profile',
  'review_title_cluster', 'review_cluster_discovery', 'review_cluster_candidate', 'review_cluster_endorsement', 'review_cluster_vote', 'review_cluster_report', 'review_revalidation',
  'review_cluster_admin_decision',
  'review_cluster_candidate_position_event',
  'catalog_provider_policy', 'catalog_image_asset', 'media_cover', 'provider_payload', 'mangadex_promotion_state',
  'anime_work_member', 'user_anime_work_choice',
  'provider_sync_state', 'provider_request_gate', 'provider_request_waitlist', 'media_airing', 'calendar_feed', 'service_heartbeat', 'site_metadata_cache',
  'graphile_worker.jobs',
] as const;
export const BOOTSTRAP_SCHEMA_VERSION = '2026-08-08-runtime-v15';
export async function inspectRuntimeSchema(db: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> }) {
  const names = REQUIRED_RUNTIME_TABLES.map((name) => name === 'graphile_worker.jobs' ? name : `public.${name}`);
  const result = await db.query(`SELECT name, to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) AS names(name)`, [names]);
  const missing = result.rows.filter((row) => !row.present).map((row) => row.name);
  return { required: REQUIRED_RUNTIME_TABLES.length, missing, ok: missing.length === 0 };
}
