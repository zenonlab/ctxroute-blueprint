import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { libraryFilterSql, libraryProjectionSql, libraryQuerySchema, retainSelected } from '../src/library-query.js';

describe('library multi-value query',()=>{
  it('normalizes repeated parameters while retaining every selected value',()=>{
    const parsed=libraryQuerySchema.parse({type:['ANIME','MANGA'],theme:['Theme A'],genre:['Genre A'],category:['Category A'],year:['2024','2025']});
    expect(parsed.type).toEqual(['ANIME','MANGA']);expect(parsed.genre).toEqual(['Genre A']);expect(parsed.category).toEqual(['Category A']);expect(parsed.year).toEqual([2024,2025]);
  });

  it('normalizes excluded facet values without turning them into inclusions',()=>{
    const parsed=libraryQuerySchema.parse({excludeType:'ANIME',excludeTheme:['Drama']});
    expect(parsed.excludeType).toEqual(['ANIME']);expect(parsed.excludeTheme).toEqual(['Drama']);
    const sql=libraryFilterSql();expect(sql).toContain('NOT ("type"=ANY($12::text[]))');expect(sql).toContain('NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(themes)');
  });

  it('uses array membership within categories and AND between categories',()=>{
    const sql=libraryFilterSql();
    expect(sql).toContain('"type"=ANY($3::text[])');expect(sql).toContain('jsonb_array_elements_text(genres)');expect(sql).toContain('jsonb_array_elements_text(categories)');expect(sql).toContain(' AND ');
  });

  it('uses the shared title policy and searches every alias',()=>{
    expect(libraryProjectionSql).toContain('favlib_display_title');expect(libraryProjectionSql).not.toContain('max(t.text)');expect(libraryFilterSql()).toContain('search_title.media_id=projected."id"');
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
    expect(sql).toContain('$13::text[] IS NOT NULL');
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

  it('separates genres from provider categories without filtering favorite works',()=>{
    expect(libraryProjectionSql).toContain("a.field='genres'");
    expect(libraryProjectionSql).toContain("a.field='categories'");
    expect(libraryProjectionSql).toContain('SELECT allow_adult FROM user_catalog_preference');
    expect(libraryProjectionSql).toContain("aa.field='adultCategories'");
    expect(libraryProjectionSql).not.toContain("adult.field='isAdult'");
    expect(libraryProjectionSql).not.toContain("adult.field='contentRating'");
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
    expect(server).toContain('WHERE w.root_media_id=$1 ORDER BY w.member_order LIMIT 50');
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
    expect(server).toContain('relatedWorks:relatedByMedia.get(row.id)??[]');
    expect(server.slice(server.indexOf('async function libraryRelatedWorks'),server.indexOf('app.get("/api/v1/library"'))).not.toContain('popularity');
  });
  it('authorizes each related cover through the owned source card and the same graph closure',()=>{
    const server=readFileSync(resolve(process.cwd(),'src/server.ts'),'utf8');
    expect(server).toContain('/api/v1/library/:mediaId/related/:relatedMediaId/cover');
    expect(server).toContain('link.user_id=$3 AND link.media_id=$4');
    expect(server).toContain("link.status IN ('matched','accepted','review')");
    expect(server).toContain('walk.card_id=$4 AND walk.media_id=$2');
    expect(server).toContain('/api/v1/library/${encodeURIComponent(row.libraryMediaId)}/related/${encodeURIComponent(row.id)}/cover');
    expect(server).toContain('SELECT merge.target_media_id FROM media_identity_merge merge');
  });
});
