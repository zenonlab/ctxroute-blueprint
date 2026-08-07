import type { Task } from 'graphile-worker';
import { saveProviderProfileCover } from '../cover-store.js';

const task: Task = async (raw, helpers) => {
  const profileId = String((raw as any)?.profileId ?? '');
  if (!profileId) return;
  const row = await helpers.query("SELECT provider,image FROM provider_profile WHERE id=$1 AND image IS NOT NULL AND image<>''", [profileId]);
  if (!row.rows[0]) return;
  await saveProviderProfileCover(helpers as any, profileId, String(row.rows[0].image), String(row.rows[0].provider), { timeoutMs: 15000 });
};

export default task;
