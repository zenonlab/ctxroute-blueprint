import { diffSnapshots, releaseKey, type Snapshot } from '@favlib/availability';
import { collectSnapshot, snapshotHash, type FetchPolicy } from '../collect.js';
import { acquireLease, releaseLease } from '../lease.js';

type QueryHelper = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number|null }> };
type Payload = { previous: Snapshot|null; current: Snapshot } | { scopeKey: string; target: string; mediaId: string; connector: string; connectorVersion: string; policy: FetchPolicy; userId?: string; ttlMs?: number };

export default async function availability(payload?: Payload, helpers?: QueryHelper){
  if (payload && 'current' in payload) return diffSnapshots(payload.previous, payload.current);
  if (!payload || !('target' in payload)) return { status: 'SKIPPED', reason: 'snapshot-target-not-configured' };
  const owner = `worker-${process.pid}`;
  const leased = Boolean(helpers && await acquireLease(helpers, payload.scopeKey, owner, 5 * 60 * 1000));
  if (helpers && !leased) return { status: 'LEASED', scopeKey: payload.scopeKey };
  try {
    const previousRow = helpers ? await helpers.query('SELECT payload FROM source_snapshot WHERE scope_key=$1 AND connector=$2 AND connector_version=$3 AND canonical_target=$4 AND locale=$5 AND region=$6',[payload.scopeKey,payload.connector,payload.connectorVersion,payload.target,'','']) : { rows: [], rowCount: 0 };
    const previous = previousRow.rows[0]?.payload as Snapshot|undefined;
    if (previous && previous.status === 'VALID' && Date.now() - Date.parse(previous.fetchedAt) <= (payload.ttlMs ?? 15 * 60 * 1000)) return { status: 'CACHED', snapshot: previous };
    const current = await collectSnapshot({ target: payload.target, mediaId: payload.mediaId, connector: payload.connector, connectorVersion: payload.connectorVersion, policy: payload.policy });
    if (!helpers) return { ...diffSnapshots(null, current), snapshot: current };
    const diff = diffSnapshots(previous ?? null, current);
    await helpers.query('INSERT INTO source_snapshot(user_id,scope_key,connector,connector_version,canonical_target,status,fetched_at,payload,payload_hash,error) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(scope_key,connector,connector_version,canonical_target,locale,region) DO UPDATE SET status=excluded.status,fetched_at=excluded.fetched_at,payload=excluded.payload,payload_hash=excluded.payload_hash,error=excluded.error',[payload.userId ?? null,payload.scopeKey,payload.connector,payload.connectorVersion,payload.target,current.status,current.fetchedAt,JSON.stringify(current),snapshotHash(current),current.status === 'QUARANTINED' ? 'CONNECTOR_QUARANTINED' : null]);
    for (const release of diff.newReleases) {
      const key = releaseKey(release);
      const users = await helpers.query('SELECT DISTINCT user_id FROM bookmark_media_link WHERE media_id=$1 AND status IN ($2,$3)',[release.mediaId,'matched','accepted']);
      for (const user of users.rows) await helpers.query('INSERT INTO release_origin(user_id,scope_key,media_id,release_key,connector,canonical_url,status,checked_at,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(user_id,scope_key,release_key,connector,canonical_url) DO UPDATE SET checked_at=excluded.checked_at,status=excluded.status,provenance=excluded.provenance',[user.user_id,payload.scopeKey,release.mediaId,key,payload.connector,release.url ?? payload.target,'AVAILABLE',release.checkedAt,{snapshotHash:snapshotHash(current)}]);
      for (const user of users.rows) await helpers.query('INSERT INTO personal_notification(user_id,release_key,kind,payload) VALUES($1,$2,$3,$4) ON CONFLICT(user_id,release_key,kind) DO NOTHING',[user.user_id,key,'RELEASE_AVAILABLE',JSON.stringify({release,scopeKey:payload.scopeKey})]);
      if(release.url){let domain:string|null=null;try{domain=new URL(release.url).hostname.toLowerCase().replace(/^www\./,'')}catch{}if(domain){const favorites=await helpers.query(`SELECT l.user_id,l.bookmark_id,i.payload->>'url' AS old_url,COALESCE(i.payload->>'title','') AS old_title,d.id AS device_id FROM bookmark_media_link l JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id JOIN extension_device d ON d.user_id=l.user_id AND d.installation_id=l.installation_id AND d.revoked_at IS NULL JOIN extension_preference p ON p.user_id=l.user_id AND p.auto_update_favorites WHERE l.media_id=$1 AND l.status IN ('matched','accepted') AND i.event<>'removed'`,[release.mediaId]);for(const favorite of favorites.rows)if(favorite.old_url&&favorite.old_url!==release.url)await helpers.query(`INSERT INTO favorite_update_proposal(user_id,device_id,bookmark_id,expected_url,expected_title,new_url,new_title,domain) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,bookmark_id,new_url,new_title) DO NOTHING`,[favorite.user_id,favorite.device_id,favorite.bookmark_id,favorite.old_url,favorite.old_title,release.url,release.title??favorite.old_title,domain])}}
    }
    return { ...diff, snapshot: current };
  } finally {
    if (helpers && leased) await releaseLease(helpers, payload.scopeKey, owner);
  }
}
