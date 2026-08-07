import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('calendar favorite contract', () => {
  it('keeps a provider-linked favorite visible while its title match is under review', () => {
    const server = readFileSync(resolve(process.cwd(), 'src/server.ts'), 'utf8');
    const favoriteMedia = server.match(/WITH favorite_media AS \(([\s\S]*?)\), latest_mu AS/u)?.[1] ?? '';
    expect(favoriteMedia).toContain("status IN ('matched','accepted','review')");
    expect(favoriteMedia).toContain('user_id=$1::uuid');
  });

  it('projects dated releases and scheduled anime airings with user-scoped facets', () => {
    const server = readFileSync(resolve(process.cwd(), 'src/server.ts'), 'utf8');
    expect(server).toContain('WHERE o.release_date IS NOT NULL');
    expect(server).toContain("'release'::text AS category");
    expect(server).toContain('m.type AS event_type');
    expect(server).toContain('o.provider_release_key AS release_key');
    expect(server).toContain('o.release_date AS starts_at');
    expect(server).toContain('jsonb_agg(DISTINCT genre_value ORDER BY genre_value)');
    expect(server).toContain('jsonb_agg(DISTINCT category_value ORDER BY category_value)');
    expect(server).toContain('FROM media_airing a');
    expect(server).toContain("a.schedule_status='SCHEDULED'");
    expect(server).toContain("ga.field='genres'");
    expect(server).toContain("ca.field='categories'");
    expect(server).toContain('calendarRows(req.user.id');
    expect(server).toMatch(/facets:\s*\{\s*genres:\s*facet\(["']genres["']\),\s*categories:\s*facet\(["']categories["']\)/u);
  });
});
