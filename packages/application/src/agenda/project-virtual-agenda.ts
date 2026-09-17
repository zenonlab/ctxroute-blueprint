import { publicReleaseEventSchema, type PublicReleaseEventContract, type PublicReleaseEventInput, type VirtualReleaseModelContract } from '../releases/release-contracts';

const suspended = new Set(['HIATUS', 'COMPLETED', 'CANCELLED']);

function inWindow(event: PublicReleaseEventContract, from: string, to: string): boolean {
  const date = event.occurrence.value.slice(0, 10);
  return date >= from && date <= to;
}

export function projectVirtualAgenda(
  models: readonly VirtualReleaseModelContract[],
  window: { from: string; to: string },
): readonly PublicReleaseEventContract[] {
  const events = new Map<string, PublicReleaseEventContract>();
  for (const model of models) {
    for (const event of model.exceptions) if (inWindow(event, window.from, window.to)) events.set(event.id, event);
    if (model.explicitNext !== undefined && inWindow(model.explicitNext, window.from, window.to)) events.set(model.explicitNext.id, model.explicitNext);
    if (model.explicitNext !== undefined || model.intervalDays === undefined || suspended.has(model.editorialStatus)) continue;
    const nextTime = Date.parse(`${model.anchor.date}T00:00:00.000Z`) + Math.round(model.intervalDays * 86_400_000);
    const nextDate = new Date(nextTime).toISOString().slice(0, 10);
    if (nextDate < window.from || nextDate > window.to || nextDate < model.validity.from || nextDate > model.validity.to) continue;
    const numericSequence = model.anchor.sequence === undefined ? undefined : Number(model.anchor.sequence);
    const sequence = numericSequence !== undefined && Number.isInteger(numericSequence) ? String(numericSequence + 1) : undefined;
    const candidate: PublicReleaseEventInput = {
      id: `estimated-${model.workId}-${model.releaseKind}-${nextDate}`,
      provider: model.provider,
      providerWorkId: model.providerWorkId,
      releaseKind: model.releaseKind,
      occurrence: { kind: 'DATE' as const, value: nextDate },
      state: 'ESTIMATED' as const,
      provenance: { source: model.provenance.source, fetchedAt: model.provenance.observedAt, parserVersion: model.provenance.parserVersion, rulesVersion: model.provenance.rulesVersion },
      expiresAt: `${model.validity.to}T23:59:59.999Z`,
    };
    if (sequence !== undefined) candidate.sequence = sequence;
    events.set(candidate.id, publicReleaseEventSchema.parse(candidate));
  }
  return Object.freeze([...events.values()].sort((left, right) => left.occurrence.value.localeCompare(right.occurrence.value) || left.id.localeCompare(right.id)));
}
