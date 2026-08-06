import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { libraryFilterSql, libraryProjectionSql, libraryQuerySchema, retainSelected } from '../src/library-query.js';

describe('library multi-value query',()=>{
  it('normalizes repeated parameters while retaining every selected value',()=>{
    const parsed=libraryQuerySchema.parse({type:['ANIME','MANGA'],theme:['Action','Drama'],year:['2024','2025']});
    expect(parsed.type).toEqual(['ANIME','MANGA']);expect(parsed.theme).toEqual(['Action','Drama']);expect(parsed.year).toEqual([2024,2025]);
  });

  it('uses array membership within categories and AND between categories',()=>{
    const sql=libraryFilterSql();
    expect(sql).toContain('"type"=ANY($3::text[])');expect(sql).toContain('lower(value)=ANY($4::text[])');expect(sql).toContain(' AND ');
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
});
