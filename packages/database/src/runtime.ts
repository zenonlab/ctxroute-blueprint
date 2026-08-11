/** Tables required by the running API/worker contract. */
export const REQUIRED_RUNTIME_TABLES = [
  'app_user', 'bookmark_import_batch', 'bookmark_import_item', 'bookmark_media_link',
  'media', 'media_title', 'media_external_id', 'media_metadata', 'media_enrichment_state',
  'catalog_provider_policy', 'catalog_image_asset', 'media_cover', 'provider_payload',
  'provider_sync_state', 'provider_request_gate', 'provider_request_waitlist', 'media_airing', 'calendar_feed', 'service_heartbeat',
  'graphile_worker.jobs',
] as const;

export const BOOTSTRAP_SCHEMA_VERSION = '2026-08-10-runtime-v16';

export async function inspectRuntimeSchema(db: { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> }) {
  const names = REQUIRED_RUNTIME_TABLES.map((name) => name === 'graphile_worker.jobs' ? name : `public.${name}`);
  const result = await db.query(`SELECT name, to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) AS names(name)`, [names]);
  const missing = result.rows.filter((row) => !row.present).map((row) => row.name);
  return { required: REQUIRED_RUNTIME_TABLES.length, missing, ok: missing.length === 0 };
}
