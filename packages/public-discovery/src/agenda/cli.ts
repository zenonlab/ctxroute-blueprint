import { AniListAgendaCollector, collectPublicAgendaLanes, MangaUpdatesAgendaCollector } from './collectors.js';
import { publicAgendaIngestionSchema, publicAgendaReceiptSchema } from './contracts.js';

interface CalendarWindow { readonly from: string; readonly to: string }

function requiredToken(): string {
  const value = process.env.AGENDA_OIDC_TOKEN;
  if (!value || value.length < 32 || value.length > 8192) throw new Error('missing-agenda-oidc-token');
  return value;
}
function calendarWindow(now: Date): CalendarWindow {
  return { from: new Date(now.valueOf() - 86_400_000).toISOString().slice(0, 10), to: new Date(now.valueOf() + 15 * 86_400_000).toISOString().slice(0, 10) };
}

const now = new Date(); const window = calendarWindow(now);
const collection = await collectPublicAgendaLanes([new AniListAgendaCollector(), new MangaUpdatesAgendaCollector()], window);
if (collection.failures.length > 0) throw new Error(`agenda-collection-incomplete:${collection.failures.join(',')}`);
const ingestion = publicAgendaIngestionSchema.parse({ events: collection.events, generatedAt: now.toISOString(), nonce: crypto.randomUUID(), schemaVersion: 1, window });
const response = await fetch('https://tobirink-public-api.choukky.workers.dev/v2/releases/generations', { body: JSON.stringify(ingestion), headers: { Authorization: `Bearer ${requiredToken()}`, 'Content-Type': 'application/json' }, method: 'POST', signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`agenda-ingestion-${response.status}:${(await response.text()).slice(0, 256)}`);
const receipt = publicAgendaReceiptSchema.parse(await response.json());
if (!receipt.accepted || receipt.count !== collection.events.length) throw new Error('agenda-ingestion-not-promoted');
const providers = { anilist: collection.events.filter((event) => event.provider === 'anilist').length, mangaupdates: collection.events.filter((event) => event.provider === 'mangaupdates').length };
process.stdout.write(`${JSON.stringify({ event: 'agenda_generation_published', providers, ...receipt, window })}\n`);
