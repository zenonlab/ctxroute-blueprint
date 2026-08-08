import type { Task } from 'graphile-worker';
import { CONNECTOR_VERSIONS } from '@favlib/config';
import { withProviderRequest } from '@favlib/database/provider-queue';
import { decideMangaUpdatesTitleMatch, fetchMangaUpdatesSeries, mangaUpdatesMediaType, mangaUpdatesTypeAllowed, normalizeTitle, searchMangaUpdatesSeries } from '@favlib/metadata';
import { normalizedError } from '../enrichment-state.js';

const nextMonday = (h: Parameters<Task>[1], mediaId: string, error: string) => h.query(
  "UPDATE mangadex_promotion_state SET last_attempt_at=now(),last_error=$2,next_attempt_at=favlib_next_paris_monday(now()+interval '1 minute'),updated_at=now() WHERE media_id=$1 AND status='PENDING'",
  [mediaId,error],
);

/** Weekly, idempotent identity promotion. MangaDex assertions and cover are
 * deliberately untouched: MangaUpdates contributes identity plus missing
 * aliases only, and provider audience signals never participate. */
const task: Task = async (_payload, h) => {
  const due = await h.query(`SELECT s.media_id,s.mangadex_id,
    COALESCE((SELECT json_agg(t.text ORDER BY CASE t.kind WHEN 'source' THEN 0 WHEN 'personal' THEN 1 ELSE 2 END,t.id) FROM media_title t WHERE t.media_id=s.media_id AND t.kind IN ('source','personal','supplier')),'[]') AS titles
    FROM mangadex_promotion_state s JOIN media_metadata mm ON mm.media_id=s.media_id AND mm.provider='mangadex' AND mm.status='ACTIVE'
    WHERE s.status='PENDING' AND s.next_attempt_at<=now() ORDER BY s.next_attempt_at,s.media_id LIMIT 100 FOR UPDATE OF s SKIP LOCKED`);
  for (const row of due.rows as Array<{media_id:string;mangadex_id:string;titles:string[]}>) {
    const aliases=[...new Set((row.titles??[]).map(String).map(value=>value.trim()).filter(Boolean))];
    try {
      const found:any[]=[];
      for (const query of aliases.slice(0,8)) found.push(...await withProviderRequest(h,{provider:'mangaupdates',kind:'weekly-mangadex-promotion',priority:40,scopeKey:row.media_id,spacingMs:350},()=>searchMangaUpdatesSeries(query)));
      const summaries=[...new Map(found.map(item=>[item.id,item])).values()];
      const detailed=[];
      for (const summary of summaries.slice(0,20)) detailed.push(await withProviderRequest(h,{provider:'mangaupdates',kind:'weekly-mangadex-promotion-detail',priority:40,scopeKey:row.media_id,spacingMs:350},()=>fetchMangaUpdatesSeries(summary.id)));
      const decision=decideMangaUpdatesTitleMatch(aliases,detailed);
      if(decision.status!=='MATCH'||!decision.candidate||!mangaUpdatesTypeAllowed(decision.candidate)){await nextMonday(h,row.media_id,decision.status);continue;}
      const selected=decision.candidate;
      const owner=await h.query("SELECT media_id FROM media_external_id WHERE provider='mangaupdates' AND external_id=$1",[selected.id]);
      const target=owner.rows[0]?.media_id??row.media_id;
      if(target!==row.media_id) await h.query("SELECT merge_media_identity($1,$2,'mangaupdates',$3,$4::jsonb)",[row.media_id,target,selected.id,JSON.stringify({source:'weekly-mangadex-promotion',mangadexId:row.mangadex_id,matcherVersion:decision.matcherVersion})]);
      else await h.query("INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'mangaupdates',$2,$3) ON CONFLICT(provider,external_id) DO NOTHING",[target,selected.id,{source:'weekly-mangadex-promotion',mangadexId:row.mangadex_id,matcherVersion:decision.matcherVersion}]);
      const providerType=mangaUpdatesMediaType(selected.type); if(providerType) await h.query("UPDATE media SET type=$2,updated_at=now() WHERE id=$1 AND type IN ('MANGA','MANHWA','MANHUA')",[target,providerType]);
      for(const title of [...new Set([selected.title,...(selected.titles??[]),...(selected.associated??[])].filter((value):value is string=>Boolean(value)))]) await h.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'supplier','associated','mangaupdates',1,$4) ON CONFLICT DO NOTHING",[target,title,normalizeTitle(title),{provider:'mangaupdates',externalId:selected.id,source:'weekly-promotion'}]);
      await h.query("UPDATE media_metadata SET provider='mangaupdates',external_id=$2,source_url=COALESCE($3,source_url),status='ACTIVE',updated_at=now() WHERE media_id=$1 AND provider='mangadex'",[target,selected.id,selected.url??null]);
      await h.query("UPDATE mangadex_promotion_state SET status='PROMOTED',mangaupdates_id=$2,last_attempt_at=now(),last_error=NULL,promoted_at=now(),updated_at=now() WHERE media_id=$1",[target,selected.id]);
    } catch(error) { await nextMonday(h,row.media_id,normalizedError(error)); }
  }
};
export default task;
