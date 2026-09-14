import { z } from 'zod';
import { AniListReleaseCollector, collectPublicReleaseLanes, MangaUpdatesReleaseCollector } from '../../apps/worker/src/releases/public-release-collectors';
import { publicReleaseIngestionSchema } from '../../apps/worker/src/releases/public-release-ingestion';

const oidcResponseSchema = z.strictObject({ value: z.string().min(32).max(8192) });
const ingestionResponseSchema = z.strictObject({ accepted: z.boolean(), count: z.number().int().nonnegative(), replayed: z.boolean(), revision: z.string().regex(/^calendar-[a-f0-9]{48}$/u) });
interface CalendarWindow { readonly from: string; readonly to: string }

function requiredEnvironment(name: 'AGENDA_OIDC_TOKEN'): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing-${name.toLowerCase()}`);
  return value;
}

function calendarWindow(now: Date): CalendarWindow {
  return {
    from: new Date(now.valueOf() - 86_400_000).toISOString().slice(0, 10),
    to: new Date(now.valueOf() + 15 * 86_400_000).toISOString().slice(0, 10),
  };
}

async function run(): Promise<void> {
  const now = new Date();
  const window = calendarWindow(now);
  const collection = await collectPublicReleaseLanes([new AniListReleaseCollector(), new MangaUpdatesReleaseCollector()], window);
  if (collection.failures.length > 0) throw new Error(`agenda-collection-incomplete:${collection.failures.join(',')}`);
  const token = oidcResponseSchema.parse({ value: requiredEnvironment('AGENDA_OIDC_TOKEN') }).value;
  const ingestion = publicReleaseIngestionSchema.parse({ events: collection.events, generatedAt: now.toISOString(), nonce: crypto.randomUUID(), schemaVersion: 1, window });
  const response = await fetch('https://tobirink.com/v2/releases/generations', { body: JSON.stringify(ingestion), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, method: 'POST', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`agenda-ingestion-${response.status}:${(await response.text()).slice(0, 256)}`);
  const receipt = ingestionResponseSchema.parse(await response.json());
  if (!receipt.accepted || receipt.count !== collection.events.length) throw new Error('agenda-ingestion-not-promoted');
  process.stdout.write(`${JSON.stringify({ event: 'agenda_generation_published', ...receipt, window })}\n`);
}

await run();
