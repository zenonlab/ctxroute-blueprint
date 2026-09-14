import { publicReleaseEventSchema } from '@tobirink/application';
import { z } from 'zod';

export const publicReleaseIngestionSchema = z.strictObject({
  events: z.array(publicReleaseEventSchema).max(5_000),
  generatedAt: z.iso.datetime({ offset: false }),
  nonce: z.uuid(),
  schemaVersion: z.literal(1),
  window: z.strictObject({ from: z.iso.date(), to: z.iso.date() }),
}).superRefine((value, context) => {
  if (value.window.from > value.window.to || Date.parse(`${value.window.to}T00:00:00.000Z`) - Date.parse(`${value.window.from}T00:00:00.000Z`) > 40 * 86_400_000) {
    context.addIssue({ code: 'custom', message: 'invalid-ingestion-window', path: ['window'] });
  }
  const ids = new Set<string>();
  for (const [index, event] of value.events.entries()) {
    if (ids.has(event.id)) context.addIssue({ code: 'custom', message: 'duplicate-event', path: ['events', index, 'id'] });
    ids.add(event.id);
    const date = event.occurrence.value.slice(0, 10);
    if (date < value.window.from || date > value.window.to) context.addIssue({ code: 'custom', message: 'event-outside-window', path: ['events', index, 'occurrence'] });
  }
});

export type PublicReleaseIngestion = z.output<typeof publicReleaseIngestionSchema>;
