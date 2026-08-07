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
});
