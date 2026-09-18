import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Script, createContext } from 'node:vm';
import { createSourceEvidence } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { qualifyFavoriteUrl } from '../../packages/application/src/favorites/eligibility';
import { extractFavoriteSourceEvidence } from '../../packages/application/src/favorites/source-evidence';
import { normalizeFavoriteTitle } from '../../packages/application/src/favorites/title-normalization';
import { segmentFavoriteTitle } from '../../packages/application/src/favorites/title-segmentation';

const nodeSchema = z.object({ name: z.string().optional(), type: z.string().optional(), url: z.string().optional(), get children() { return z.array(nodeSchema).optional(); } });
const bookmarksSchema = z.object({ roots: z.record(z.string(), nodeSchema) });

describe.runIf(process.env.TOBIRINK_LOCAL_BOOKMARK_AUDIT === '1')('private read-only aggregate audit', () => {
  it('compares extraction versions without exporting bookmark content', () => {
    const source = execFileSync('git', ['show', '835bf80:packages/application/src/favorites/source-evidence.ts'], { encoding: 'utf8' });
    const compiled = stripTypeScriptTypes(source, { mode: 'transform', sourceMap: false }).replace(/^import .+;$/gmu, '').replace(/\bexport\s+(?=(?:const|function|class)\b)/gu, '');
    const context = createContext({ createSourceEvidence, qualifyFavoriteUrl, normalizeFavoriteTitle, segmentFavoriteTitle, URL });
    new Script(compiled).runInContext(context, { timeout: 1000 });
    const compare = new Script('extractFavoriteSourceEvidence(input).disposition ?? "QUERY"');
    const before: Record<string, number> = {}; const after: Record<string, number> = {};
    let total = 0; let newlyQueryable = 0; let profiles = 0;
    const root = join(homedir(), 'Library/Application Support/Google/Chrome');
    const inspect = (node: z.output<typeof nodeSchema>) => {
      if (node.type === 'url' && node.url !== undefined) {
        const input = { sourceKey: 'local-audit', title: node.name ?? '', url: node.url };
        context.input = input;
        let previous: string; let current: string;
        try { previous = z.string().parse(compare.runInContext(context, { timeout: 1000 })); } catch { previous = 'PARSE_ERROR'; }
        try { current = extractFavoriteSourceEvidence(input).disposition ?? 'QUERY'; } catch { current = 'PARSE_ERROR'; }
        before[previous] = (before[previous] ?? 0) + 1;
        after[current] = (after[current] ?? 0) + 1;
        total += 1;
        if (previous !== 'QUERY' && current === 'QUERY') newlyQueryable += 1;
      }
      node.children?.forEach(inspect);
    };
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let content: string;
      try { content = readFileSync(join(root, entry.name, 'Bookmarks'), 'utf8'); } catch { continue; }
      const parsed = bookmarksSchema.safeParse(JSON.parse(content));
      if (!parsed.success) throw new Error('Private bookmark schema unavailable');
      profiles += 1; Object.values(parsed.data.roots).forEach(inspect);
    }
    expect(total).toBeGreaterThan(0);
    process.stdout.write(JSON.stringify({ profiles, total, newlyQueryable, before, after, installedIdentityCertification: 'not-performed' }) + '\n');
  });
});
