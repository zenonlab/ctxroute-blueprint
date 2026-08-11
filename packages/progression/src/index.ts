export type SequenceKind = 'season' | 'volume' | 'chapter' | 'episode' | 'special';
export type Position = { kind: SequenceKind; season?: number; number?: number; raw: string };
export type Observation = { mediaId: string; source: string; position: Position; confidence: 'high'|'medium'|'low'; observedAt: string; consented: boolean };
export type NormalizedStatus = 'Ongoing' | 'Hiatus' | 'Completed' | 'Cancelled';
export type AvailablePosition = Position & { kind: 'episode' | 'chapter'; provenance: Record<string, unknown> };
export type AnimeChainNode = { id: string; format?: string | null; episodeTotal?: number | null; relations: Array<{ id: string; kind: string }> };
export type AnimeChainMember = { id: string; order: number; episodeTotal: number | null; offset: number | null };
export type AnimeChainResult = { status: 'proved'; rootId: string; members: AnimeChainMember[] } | { status: 'ambiguous'; reason: 'BRANCH'|'CYCLE'|'MISSING_MEMBER'; candidates: string[] };
export type AnimeGlobalEpisodeProjection = {
  seasonMediaId: string;
  season: number;
  localEpisode: number;
  globalEpisode: number;
};

const mainAnimeFormats = new Set(['TV','TV_SHORT','ONA']);

/** Builds only a unique provider-proved PREQUEL/SEQUEL line. Popularity and title similarity are intentionally absent. */
export function buildLinearAnimeChain(nodes: AnimeChainNode[], seedId: string): AnimeChainResult {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const eligible = (id: string) => { const node=byId.get(id); return Boolean(node && mainAnimeFormats.has(String(node.format??'TV').toUpperCase())); };
  if (!byId.has(seedId)) return {status:'ambiguous',reason:'MISSING_MEMBER',candidates:[seedId]};
  const links = (id:string,kind:'PREQUEL'|'SEQUEL') => [...new Set((byId.get(id)?.relations??[]).filter(relation=>relation.kind===kind&&eligible(relation.id)).map(relation=>relation.id))];
  const reciprocalLinks = (id:string,kind:'PREQUEL'|'SEQUEL') => links(id,kind).filter(other => {
    const reciprocal=kind==='PREQUEL'?'SEQUEL':'PREQUEL';
    return links(other,reciprocal).includes(id);
  });
  let root=seedId;
  const backwards=new Set([root]);
  for (;;) {
    const previous=reciprocalLinks(root,'PREQUEL');
    if(previous.length>1)return {status:'ambiguous',reason:'BRANCH',candidates:previous};
    if(!previous.length)break;
    root=previous[0];
    if(backwards.has(root))return {status:'ambiguous',reason:'CYCLE',candidates:[root]};
    backwards.add(root);
  }
  const ordered:string[]=[];
  const visited=new Set<string>();
  let current=root;
  for (;;) {
    if(visited.has(current))return {status:'ambiguous',reason:'CYCLE',candidates:[current]};
    visited.add(current);ordered.push(current);
    const next=reciprocalLinks(current,'SEQUEL');
    if(next.length>1)return {status:'ambiguous',reason:'BRANCH',candidates:next};
    if(!next.length)break;
    if(!byId.has(next[0]))return {status:'ambiguous',reason:'MISSING_MEMBER',candidates:next};
    current=next[0];
  }
  let offset:number|null=0;
  const members=ordered.map((id,order)=>{
    const total=byId.get(id)?.episodeTotal??null;
    const member={id,order,episodeTotal:total,offset};
    if(offset!==null)offset=total===null?null:offset+total;
    return member;
  });
  return {status:'proved',rootId:root,members};
}

/** Entering a later proved season implies all prior complete seasons were watched. */
export function globalAnimePosition(member: AnimeChainMember, localEpisode?: number | null): number | null {
  if(member.offset===null)return null;
  return member.offset+(localEpisode??0);
}

/**
 * Converts a global episode only when every boundary used by the conversion is
 * provider-proved.  This intentionally does not infer an identity from title
 * digits: callers supply an already resolved chain and retain their raw input.
 */
export function projectGlobalAnimeEpisode(chain: AnimeChainResult, globalEpisode: number): AnimeGlobalEpisodeProjection | null {
  if (chain.status !== 'proved' || !Number.isInteger(globalEpisode) || globalEpisode < 1) return null;
  for (const member of chain.members) {
    if (member.offset === null || member.episodeTotal === null || member.episodeTotal < 1) return null;
    const first = member.offset + 1;
    const last = member.offset + member.episodeTotal;
    if (globalEpisode >= first && globalEpisode <= last)
      return { seasonMediaId: member.id, season: member.order + 1, localEpisode: globalEpisode - member.offset, globalEpisode };
  }
  return null;
}

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
  if (/\b(?:cancelled|canceled)\b/u.test(value)) return 'Cancelled';
  if (/\b(?:discontinued|dropped)\b/u.test(value)) return 'Cancelled';
  if (/\b(?:ongoing|releasing|currently publishing)\b/u.test(value)) return 'Ongoing';
  if (/\b(?:not[_ -]?yet[_ -]?released|upcoming|planned)\b/u.test(value)) return 'Ongoing';
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
