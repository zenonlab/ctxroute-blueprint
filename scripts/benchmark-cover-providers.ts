import { performance } from 'node:perf_hooks';
import { searchMangaUpdatesSeries, titleVariants } from '../packages/metadata/src/index.ts';

// Benchmark réseau volontairement opt-in :
//   corepack pnpm exec tsx scripts/benchmark-cover-providers.ts
// Les résultats ne sont pas écrits dans FavLib.
const titles = process.argv.slice(2).length ? process.argv.slice(2) : [
  'Kami ni Aisareta Ko',
  'Solo Leveling',
  'The Beginning After the End',
];

type Sample = { provider: string; title: string; calls: number; milliseconds: number; candidates: number; cover: boolean; error?: string };

async function measure(provider: string, title: string, run: (fetch: typeof globalThis.fetch) => Promise<{ candidates: number; cover: boolean }>): Promise<Sample> {
  let calls = 0;
  const fetcher: typeof globalThis.fetch = async (...args) => { calls++; return globalThis.fetch(...args); };
  const start = performance.now();
  try {
    const result = await run(fetcher);
    return { provider, title, calls, milliseconds: Math.round(performance.now() - start), ...result };
  } catch (error) {
    return { provider, title, calls, milliseconds: Math.round(performance.now() - start), candidates: 0, cover: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const samples: Sample[] = [];
  for (const title of titles) {
    samples.push(await measure('MangaUpdates', title, async fetch => {
      const items = await searchMangaUpdatesSeries(title, { fetch });
      return { candidates: items.length, cover: false };
    }));
  }
  console.table(samples);
  for (const title of titles) console.log(`${title}: variantes testées = ${titleVariants([title]).join(' | ')}`);
  const grouped = new Map<string, Sample[]>();
  for (const row of samples) grouped.set(row.provider, [...(grouped.get(row.provider) ?? []), row]);
  for (const [provider, rows] of grouped) {
    const valid = rows.filter(row => !row.error);
    console.log(`${provider}: appels=${rows.reduce((sum, row) => sum + row.calls, 0)}, moyenne_ms=${valid.length ? Math.round(valid.reduce((sum, row) => sum + row.milliseconds, 0) / valid.length) : 'n/a'}, succès=${valid.length}/${rows.length}`);
  }
}
void main();
