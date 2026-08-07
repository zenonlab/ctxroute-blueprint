export type SequenceKind = 'season' | 'volume' | 'chapter' | 'episode' | 'special';
export type Position = { kind: SequenceKind; season?: number; number?: number; raw: string };
export type Observation = { mediaId: string; source: string; position: Position; confidence: 'high'|'medium'|'low'; observedAt: string; consented: boolean };
export type NormalizedStatus = 'Ongoing' | 'Hiatus' | 'Completed';
export type AvailablePosition = Position & { kind: 'episode' | 'chapter'; provenance: Record<string, unknown> };

const numberPattern = /(?:episode|chapter|volume|tome|ep|ch|vol)?\s*(\d+(?:\.\d+)?)/i;

export function position(raw: string | number, kind: SequenceKind = 'episode'): Position {
  const value = String(raw).trim();
  if (/^(?:sp|special|ova|ona|film|movie)/i.test(value)) return { kind: 'special', raw: value };
  const match = value.match(numberPattern);
  return { kind, number: match ? Number(match[1]) : undefined, raw: value };
}

/** Shared display formatter; the provider value remains available separately as `raw`. */
export function chapterDisplay(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const parsed=position(raw,'chapter');
  return parsed.number === undefined ? raw.trim() : `Chapitre ${parsed.number}`;
}

export function comparePosition(left: Position, right: Position): number | null {
  if (left.kind !== right.kind) return null;
  if (left.kind === 'special' || left.number === undefined || right.number === undefined) return null;
  return left.number === right.number ? 0 : left.number > right.number ? 1 : -1;
}

export function normalizeSerializationStatus(raw: unknown): NormalizedStatus | undefined {
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim().toLocaleLowerCase();
  if (/\b(?:hiatus|on hiatus)\b/u.test(value)) return 'Hiatus';
  if (/\b(?:complete|completed|finished)\b/u.test(value)) return 'Completed';
  if (/\b(?:ongoing|releasing|currently publishing)\b/u.test(value)) return 'Ongoing';
  return undefined;
}

/** Keeps the greatest comparable position. Specials and different sequences are not collapsed. */
export function greatestAvailable(current: AvailablePosition | null, next: AvailablePosition): AvailablePosition {
  if (!current) return next;
  const comparison = comparePosition(current, next);
  return comparison !== null && comparison < 0 ? next : current;
}

export function acceptObservation(current: Position | null, next: Observation): boolean {
  if (!next.consented || next.confidence !== 'high' || next.position.kind === 'special') return false;
  if (!current) return true;
  const comparison = comparePosition(current, next.position);
  return comparison !== null && comparison <= 0;
}

export function consolidate(observations: Observation[]): Observation[] {
  const map = new Map<string, Observation>();
  for (const item of observations) {
    if (!item.consented || item.confidence !== 'high') continue;
    const key = `${item.mediaId}:${item.position.kind}:${item.position.number ?? item.position.raw}`;
    const previous = map.get(key);
    if (!previous || previous.observedAt < item.observedAt) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}
