import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentAllowedSql, libraryFilterKeys, libraryFilterSql, libraryProjectionSql, libraryQuerySchema, retainSelected } from '../src/library-query.js';

describe('library multi-value query',()=>{
  it('normalizes repeated parameters while retaining every selected value',()=>{
    const parsed=libraryQuerySchema.parse({type:['ANIME','MANGA'],theme:['Theme A'],genre:['Genre A'],category:['Category A'],year:['2024','2025'],author:['Synthetic Author'],studio:['Synthetic Studio']});
    expect(parsed.type).toEqual(['ANIME','MANGA']);expect(parsed.genre).toEqual(['Genre A']);expect(parsed.category).toEqual(['Category A']);expect(parsed.year).toEqual([2024,2025]);
    expect(parsed.author).toEqual(['Synthetic Author']);expect(parsed.studio).toEqual(['Synthetic Studio']);
  });

  it('projects credited people with provenance and filters them only through private parameters',()=>{
    expect(libraryProjectionSql).toContain("a.field='authors'");
    expect(libraryProjectionSql).toContain("a.field='studios'");
    expect(libraryProjectionSql).toContain("'sourceUrl',person.source_url");
    expect(libraryProjectionSql).toContain('AS authors');
    expect(libraryProjectionSql).toContain('AS studios');
    const sql=libraryFilterSql();
    expect(sql).toContain("lower(value->>'name')=ANY($16::text[])");
    expect(sql).toContain("lower(value->>'name')=ANY($17::text[])");
    expect(libraryFilterKeys).not.toEqual(expect.arrayContaining(['author','studio']));
  });

  it('separates AniList episode total from aired availability and MangaUpdates chapter provenance',()=>{
    expect(libraryProjectionSql).toContain("a.provider='anilist' AND a.field IN ('episodes','episodeCount')");
    expect(libraryProjectionSql).toContain('AS "episodeTotal"');
    expect(libraryProjectionSql).toContain("pp.provider=CASE WHEN m.type='ANIME' THEN 'anilist' ELSE 'mangaupdates' END");
    expect(libraryProjectionSql).toContain("CASE WHEN mm.provider='mangaupdates' THEN mm.latest_chapter ELSE NULL END");
    expect(libraryProjectionSql).toContain('pp.available_position_provenance AS provenance');
    expect(libraryProjectionSql).toContain("'provenance',available.provenance");
  });

  it('normalizes excluded facet values without turning them into inclusions',()=>{
    const parsed=libraryQuerySchema.parse({excludeType:'ANIME',excludeTheme:['Drama']});
    expect(parsed.excludeType).toEqual(['ANIME']);expect(parsed.excludeTheme).toEqual(['Drama']);
    const sql=libraryFilterSql();expect(sql).toContain('NOT ("type"=ANY($10::text[]))');expect(sql).toContain('NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(themes)');
  });

  it('uses array membership within categories and AND between categories',()=>{
    const sql=libraryFilterSql();
    expect(sql).toContain('"type"=ANY($3::text[])');expect(sql).toContain('jsonb_array_elements_text(genres)');expect(sql).toContain('jsonb_array_elements_text(categories)');expect(sql).toContain(' AND ');
  });

  it('uses the shared title policy and searches every alias',()=>{
    expect(libraryProjectionSql).toContain('favlib_display_title');expect(libraryProjectionSql).not.toContain('max(t.text)');expect(libraryFilterSql()).toContain('search_title.media_id=projected."id"');
  });
  it('includes review-linked media in the read-only library without treating review as accepted identity',()=>{
    expect(libraryProjectionSql).toContain("l.status IN ('matched','accepted','review')");
    expect(libraryProjectionSql).toContain("review_link.status='review'");
    expect(libraryProjectionSql).toContain("resolved_review.status='RESOLVED'");
    expect(libraryProjectionSql).toContain('resolved_review.decision IS NOT NULL');
    expect(libraryProjectionSql).toContain("AS \"classificationStatus\"");
    expect(libraryProjectionSql).not.toContain("UPDATE bookmark_media_link");
  });

  it('requires a live raw bookmark before a link contributes a library card',()=>{
    expect(libraryProjectionSql).toContain('JOIN bookmark_import_item active_import');
    expect(libraryProjectionSql).toContain("active_import.event<>'removed'");
  });

  it('projects one recent, available, language-qualified work URL per domain within the user scope',()=>{
    expect(libraryProjectionSql).toContain("o.provenance->>'workUrl'");
    expect(libraryProjectionSql).toContain("o.status='AVAILABLE'");
    expect(libraryProjectionSql).toContain("languageDetection' NOT IN ('undetected','ambiguous')");
    expect(libraryProjectionSql).toContain('SELECT DISTINCT ON');
    expect(libraryProjectionSql).toContain('(o.user_id IS NULL OR o.user_id=$1)');
    expect(libraryProjectionSql).toContain('o.checked_at DESC');
    expect(libraryProjectionSql).not.toContain('o.user_id<>$1');
  });

  it('hides removed favorites from the review queue while preserving direct audit access',()=>{
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    const list=server.slice(server.indexOf('app.get("/api/v1/reviews"'),server.indexOf('app.get("/api/v1/reviews/:id"'));
    const detail=server.slice(server.indexOf('app.get("/api/v1/reviews/:id"'),server.indexOf('app.get(\n  "/api/v1/reviews/:id/candidates'));
    expect(list).toContain("active_link.status IN ('matched','accepted','review')");
    expect(list).toContain('active_link.user_id=r.user_id');
    expect(detail).toContain('r.id=$1::uuid AND r.user_id=$2::uuid');
    expect(detail).not.toContain('active_link.status');
  });

  it('keeps covers attached to a merged target visible without changing the favorite media id',()=>{
    expect(libraryProjectionSql).toContain('media_identity_merge im JOIN media_cover c ON c.media_id=im.target_media_id');
    expect(libraryProjectionSql).toContain("'media-identity-merge'");
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    expect(server).toContain('c.media_id IN (SELECT $1::text UNION SELECT im.target_media_id');
    expect(server).toContain('l.media_id=$1 AND l.user_id=$2');
    expect(server).toContain('AS "coverProvenance"');
    expect(server).toContain('coverUrl: base.rows[0].coverProvenance');
  });

  it('defines personal aliases as a direct display projection',()=>{
    for(const migration of ['0008_display_title_and_image_safety.sql','0011_personal_display_title.sql']){
      const sql=readFileSync(resolve(process.cwd(),'../../packages/database/migrations',migration),'utf8');
      expect(sql).toContain("t.kind='personal'");expect(sql).toContain("t.provenance->>'userId'=target_user_id::text");
      expect(sql).toContain("'PERSONAL_ALIAS'");expect(sql).toContain("t.kind='source' AND t.connector='source-url'");
      expect(sql).toContain("'ROMAJI_FALLBACK'");
      expect(sql).not.toContain('similarity(');
    }
  });

  it('temporarily removes only the facet being counted',()=>{
    const sql=libraryFilterSql('theme');
    expect(sql).not.toContain('jsonb_array_elements_text(themes)');expect(sql).toContain('$4::text[] IS NOT NULL');expect(sql).toContain('"type"=ANY($3::text[])');
    expect(sql).toContain('$11::text[] IS NOT NULL');
  });

  it('keeps a selected zero-count option but does not invent an unselected unknown value',()=>{
    expect(retainSelected([{value:'Action',count:2}],['Action','Drama'])).toEqual([{value:'Action',count:2},{value:'Drama',count:0}]);
  });

  it('rejects more than thirty rows and invalid years',()=>{
    expect(libraryQuerySchema.safeParse({limit:31}).success).toBe(false);expect(libraryQuerySchema.safeParse({year:'unknown'}).success).toBe(false);
  });
  it('does not expose language or format in the library query contract',()=>{
    expect(libraryQuerySchema.safeParse({language:'ja'}).success).toBe(false);
    expect(libraryQuerySchema.safeParse({format:'OVA'}).success).toBe(false);
  });
  it('keeps personal progress numeric and shared availability separate',()=>{
    expect(libraryProjectionSql).toContain("'number',COALESCE(fp.global_position_number,fp.position_number::numeric)");
    expect(libraryProjectionSql).toContain("'localNumber',fp.local_position_number");
    expect(libraryProjectionSql).toContain('available_position_kind');
    expect(libraryProjectionSql).toContain("pp.status='ACTIVE'");
    expect(libraryProjectionSql).toContain('ELSE NULL');
  });

  it('uses a preserved raw favorite page as user-scoped translation availability',()=>{
    expect(libraryProjectionSql).toContain("'favorite-source'");
    expect(libraryProjectionSql).toContain("'favorite-raw-observation'");
    expect(libraryProjectionSql).toContain('observation.provenance');
    expect(libraryProjectionSql).toContain('fp.user_id=$1');
    expect(libraryProjectionSql).toContain('ORDER BY available.number DESC');
  });

  it('delegates exact blocked taxonomy visibility to the user-scoped SQL function',()=>{
    expect(libraryProjectionSql).toContain("a.field='genres'");
    expect(libraryProjectionSql).toContain("a.field='categories'");
    expect(libraryProjectionSql).toContain('favlib_content_allowed(l.media_id,$1::uuid)');
    expect(contentAllowedSql('synthetic.media_id','$2')).toBe('favlib_content_allowed(synthetic.media_id,$2::uuid)');
    expect(libraryProjectionSql).not.toContain('contentRating');
    expect(libraryProjectionSql).not.toContain('publicationDemographic');
    expect(libraryFilterKeys).toEqual(['type','theme','genre','category','status','year']);
  });

  it('projects the shared parser display title before the legacy identity fallback',()=>{
    expect(libraryProjectionSql).toContain("NULLIF(i.parse_artifact->>'displayTitle','')");
    expect(libraryProjectionSql).toContain("i.parse_artifact#>>'{identity,title}'");
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    expect(server.match(/parse_artifact->>'displayTitle'/gu)?.length).toBeGreaterThanOrEqual(3);
    expect(server).not.toContain('Titre parsé indisponible');
  });

  it('only advertises calendar covers backed by stored image data',()=>{
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    expect(server).toContain('(c.data IS NOT NULL OR c.asset_sha256 IS NOT NULL)');
    expect(server).toContain("FROM media_airing a");
    expect(server).toContain("'DATE'::text");
    expect(server).toContain('e.observed_at AS "observedAt"');
  });

  it('returns a bounded user-scoped AniList chronology from proved members',()=>{
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    expect(server).toMatch(/animeSeasons:\s*animeSeasons\.rows/u);
    expect(server).toMatch(/animeRelated:\s*animeRelated\.rows/u);
    expect(server).toContain('WITH sequence_media AS (SELECT $1::text AS id UNION');
    expect(server).toContain("WHERE w.root_media_id=$1 AND ${contentAllowedSql('w.media_id','$2')} ORDER BY w.member_order LIMIT 50");
    expect(server).toContain("payload.validity_status='VALID'");
  });
  it('projects the bounded transitive relation closure without treating titles or popularity as relation evidence',()=>{
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    expect(server).toContain('async function libraryRelatedWorks');
    expect(server).toContain('WITH RECURSIVE requested(card_id,root_id)');
    expect(server).toContain('FROM relation_walk walk JOIN graph_edges edge ON edge.source_id=walk.media_id');
    expect(server).toContain('relation_walk(card_id,root_id,media_id,relation_type,relation_depth)');
    expect(server).toContain('WHERE walk.relation_depth<8');
    expect(server).not.toContain('walk.path||edge.target_id');
    expect(server).toContain("SELECT member.root_media_id,member.media_id,'SEQUENCE_MEMBER'");
    expect(server).toContain('COALESCE((SELECT root_media_id FROM anime_work_member WHERE media_id=input_media_id),input_media_id)');
    expect(server).toContain('favlib_display_title(ranked.media_id,$2::uuid)');
    expect(server).toContain('ranked.related_rank<=50');
    expect(server).toContain('ranked.relation_depth AS "relationDepth"');
    expect(server).toContain("progress.user_id=$2 AND progress.media_id=ranked.media_id");
    expect(server).toContain("availability.media_id=ranked.media_id AND availability.status='ACTIVE'");
    expect(server).toContain("END AS status");
    expect(server).toContain('relatedWorks: relatedByMedia.get(row.id) ?? []');
    expect(server.match(/WHERE relation\.kind<>'canonical_variant'/gu)).toHaveLength(2);
    expect(server).toContain("AND relation.kind<>'canonical_variant'");
    expect(server.slice(server.indexOf('async function libraryRelatedWorks'),server.indexOf('app.get("/api/v1/library"'))).not.toContain('popularity');
  });
  it('isolates personal relation progress to the requesting user',()=>{
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    const projection=server.slice(server.indexOf('async function libraryRelatedWorks'),server.indexOf('async function relatedLibraryMediaAllowed'));
    expect(projection).toContain('favlib_display_title(ranked.media_id,$2::uuid)');
    expect(projection).toContain('progress.user_id=$2');
    expect(projection).not.toMatch(/favorite_progress progress WHERE progress\.media_id=ranked\.media_id(?![^)]*progress\.user_id)/u);
    expect(projection).not.toContain('favorite_progress progress WHERE progress.user_id<>');
  });
  it('authorizes each related cover through the owned source card and the same graph closure',()=>{
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    expect(server).toContain('/api/v1/library/:mediaId/related/:relatedMediaId/cover');
    expect(server).toContain('link.user_id=$3 AND link.media_id=$4');
    expect(server).toContain("link.status IN ('matched','accepted','review')");
    expect(server).toContain('ranked.card_id=$4 AND ranked.media_id=$2 AND ranked.related_rank<=50');
    expect(server).toContain('relatedLibraryMediaAllowed(req.params.mediaId,req.params.relatedMediaId,req.user.id)');
    expect(server).toContain('/api/v1/library/${encodeURIComponent(coverScope)}/related/${encodeURIComponent(row.id)}/cover');
    expect(server).toContain('SELECT merge.target_media_id FROM media_identity_merge merge');
  });
  it('serves a bounded root-scoped related detail without using identity heuristics',()=>{
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    const route=server.slice(server.indexOf('app.get("/api/v1/library/:rootMediaId/related/:mediaId"'),server.indexOf('app.post("/api/v1/library/:mediaId/source-reports"'));
    expect(route).toContain('richCatalogRow(req.user.id,mediaId,req.headers["x-timezone"],rootMediaId)');
    expect(route).toContain('new Map([[mediaId,rootMediaId]])');
    expect(route).toContain('rootMediaId,relatedWorks:');
    expect(server.slice(server.indexOf('async function relatedLibraryMediaAllowed'),server.indexOf('app.get("/api/v1/library"'))).not.toContain('popularity');
  });
});
