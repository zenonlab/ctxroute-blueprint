import { z } from 'zod';
import { publicReleaseEventSchema } from '../releases/release-contracts';

export const publicReleaseProviderSchema = z.enum(['anilist', 'mangaupdates']);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
const laneSchema = z.strictObject({ complete: z.boolean(), nextPage: z.number().int().positive(), notBefore: z.number().int().nonnegative() });
export const publicReleaseFallbackStateSchema = z.strictObject({
  generation: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u),
  lanes: z.strictObject({ anilist: laneSchema, mangaupdates: laneSchema }),
  startedAt: z.iso.datetime({ offset: false }),
  window: z.strictObject({ from: dateSchema, to: dateSchema }),
});
export const publicReleasePageCheckpointSchema = z.strictObject({
  complete: z.boolean(),
  events: z.array(publicReleaseEventSchema).max(100),
  nextPage: z.number().int().positive().optional(),
  notBefore: z.number().int().nonnegative().optional(),
  page: z.number().int().positive(),
  provider: publicReleaseProviderSchema,
}).superRefine((checkpoint, context) => {
  if (!checkpoint.complete && (checkpoint.nextPage === undefined || checkpoint.notBefore === undefined)) context.addIssue({ code: 'custom', message: 'Incomplete pages require a durable continuation.', path: ['nextPage'] });
  if (checkpoint.complete && checkpoint.nextPage !== undefined) context.addIssue({ code: 'custom', message: 'Complete pages cannot carry a continuation.', path: ['nextPage'] });
});

export type PublicReleaseFallbackState = z.output<typeof publicReleaseFallbackStateSchema>;
export type PublicReleasePageCheckpoint = z.output<typeof publicReleasePageCheckpointSchema>;
export interface PublicReleasePageSource { collectPage(provider: 'anilist' | 'mangaupdates', page: number, window: { from: string; to: string }): Promise<PublicReleasePageCheckpoint> }
export interface PublicReleaseFallbackStore {
  begin(state: PublicReleaseFallbackState): Promise<void>;
  load(): Promise<PublicReleaseFallbackState | undefined>;
  promote(generation: string, completedAt: string): Promise<void>;
  stage(generation: string, checkpoint: PublicReleasePageCheckpoint): Promise<void>;
}

export async function resumePublicReleaseFallback(dependencies: { clock?: () => number; source: PublicReleasePageSource; store: PublicReleaseFallbackStore; token?: () => string }, window: { from: string; to: string }): Promise<{ nextWakeAt?: number; state: 'complete' | 'waiting' | 'progressed' }> {
  const clock = dependencies.clock ?? Date.now;
  let state = await dependencies.store.load();
  if (state === undefined || state.window.from !== window.from || state.window.to !== window.to) {
    const now = clock();
    state = publicReleaseFallbackStateSchema.parse({ generation: dependencies.token?.() ?? `fallback-${now}`, lanes: { anilist: { complete: false, nextPage: 1, notBefore: 0 }, mangaupdates: { complete: false, nextPage: 1, notBefore: 0 } }, startedAt: new Date(now).toISOString(), window });
    await dependencies.store.begin(state);
  }
  const lanes = (['anilist', 'mangaupdates'] as const).filter((provider) => !state!.lanes[provider].complete);
  if (lanes.length === 0) { await dependencies.store.promote(state.generation, new Date(clock()).toISOString()); return { state: 'complete' }; }
  const ready = lanes.find((provider) => state!.lanes[provider].notBefore <= clock());
  if (ready === undefined) return { nextWakeAt: Math.min(...lanes.map((provider) => state!.lanes[provider].notBefore)), state: 'waiting' };
  const lane = state.lanes[ready];
  const page = publicReleasePageCheckpointSchema.parse(await dependencies.source.collectPage(ready, lane.nextPage, state.window));
  if (page.provider !== ready || page.page !== lane.nextPage) throw new Error('public-release-page-mismatch');
  await dependencies.store.stage(state.generation, page);
  const updated = await dependencies.store.load();
  if (updated && updated.lanes.anilist.complete && updated.lanes.mangaupdates.complete) { await dependencies.store.promote(updated.generation, new Date(clock()).toISOString()); return { state: 'complete' }; }
  const pending = updated ? (['anilist', 'mangaupdates'] as const).filter((provider) => !updated.lanes[provider].complete) : [];
  return pending.length === 0 ? { state: 'progressed' } : { nextWakeAt: Math.min(...pending.map((provider) => updated!.lanes[provider].notBefore)), state: 'progressed' };
}
