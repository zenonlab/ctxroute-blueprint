import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExtensionSurface } from '../../apps/extension/runtime/ExtensionSurface';
import { parseFavoriteObservation } from '../../packages/application/src/favorites/favorite-parser';
import { createFavoriteObservation, createSourceEvidence } from '../../packages/domain/src';

const bundleBudgetBytes = 1_500_000;
const localOperationBudgetMs = 200;
const root = process.cwd();

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
}

function parserP95(title: string, iterations: number): number {
  const observation = createFavoriteObservation({ bookmarkId: 'performance', folderPath: [], observationRevision: 'performance-v1', observationSequence: 1, observedAt: '2026-09-07T12:00:00.000Z', presence: 'observed', siblingOrder: 0, title, url: 'https://fixtures.tobirink.invalid/anime/performance-work/chapter-123.5' });
  const evidence = createSourceEvidence({ aliases: [{ provenance: 'stable-url-slug', value: 'Performance Work' }], diagnostics: [], key: 'performance', mediaKind: 'ANIME', proofs: ['CATEGORY_PATH', 'TITLE_SLUG', 'RELEASE_PATH'], release: { kind: 'chapter', provenance: 'URL_PATH', raw: 'chapter-123.5', value: 123.5 }, sourceAdapter: 'performance-fixture', stableSlug: 'performance-work', strategy: 'generic', title: 'Performance Work' });
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    parseFavoriteObservation(observation, evidence);
    samples.push(performance.now() - startedAt);
  }
  return percentile95(samples);
}

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

function packageMetrics(target: 'chrome-mv3' | 'firefox-mv3') {
  const directory = join(root, 'apps/extension/.output', target);
  const files = filesUnder(directory);
  return {
    compressedBytes: files.reduce((total, file) => total + gzipSync(readFileSync(file)).byteLength, 0),
    files: files.length,
    rawBytes: files.reduce((total, file) => total + statSync(file).size, 0),
    target,
  };
}

describe('extension performance budgets', () => {
  it('keeps typical and maximum parser inputs below their p95 budgets', () => {
    const typicalP95 = parserP95('Watch Performance Work — Episode 12 VOSTFR', 200);
    const maximumP95 = parserP95(`Performance Work ${'界'.repeat(2_000)} Episode 12`, 50);
    expect(typicalP95).toBeLessThan(10);
    expect(maximumP95).toBeLessThan(50);
    console.info(JSON.stringify({ favoriteParserP95Ms: { maximum: maximumP95, typical: typicalP95 } }));
  });

  it('renders representative local surfaces inside the 200 ms response budget', () => {
    const surfaces = ['library', 'review', 'agenda'] as const;
    const measurements = surfaces.map((name) => {
      const startedAt = performance.now();
      const markup = renderToStaticMarkup(<ExtensionSurface name={name} />);
      return { elapsedMs: performance.now() - startedAt, markup, name };
    });

    for (const measurement of measurements) {
      expect(measurement.markup.length).toBeGreaterThan(0);
      expect(measurement.elapsedMs).toBeLessThan(localOperationBudgetMs);
    }

    console.info(JSON.stringify({ localRenderMs: measurements.map(({ elapsedMs, name }) => ({ elapsedMs, name })) }));
  });

  it('keeps Chromium and Firefox packages below the compressed bundle budget', () => {
    const packages = [packageMetrics('chrome-mv3'), packageMetrics('firefox-mv3')];

    for (const bundle of packages) {
      expect(bundle.files).toBe(20);
      expect(bundle.compressedBytes).toBeLessThan(bundleBudgetBytes);
    }

    console.info(JSON.stringify({ bundleBudgetBytes, packages }));
  });

  it('keeps background startup free of storage scans, timers and network dependencies', () => {
    const source = readFileSync(join(root, 'apps/extension/wxt-entrypoints/background.ts'), 'utf8');
    const localStorage = readFileSync(join(root, 'apps/extension/runtime/local-storage.ts'), 'utf8');
    const forbiddenStartupOperations = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\bindexedDB\b/,
      /\.toArray\s*\(/,
      /\.getAll\s*\(/,
      /\bsetInterval\s*\(/,
      /\bsetTimeout\s*\(/,
    ];

    expect(source).toMatch(/main\(\) \{/);
    expect(source).toMatch(/browser\.runtime\.onMessage\.addListener/);
    expect(source).toMatch(/browser\.runtime\.onInstalled\.addListener/);
    const readinessCalls = [...source.matchAll(/await privateStorage\.ensureReady\(\)/g)].map((match) => match.index);
    expect(readinessCalls.length).toBeGreaterThan(0);
    for (const call of readinessCalls) expect(call).toBeGreaterThan(source.indexOf('browser.runtime.onInstalled.addListener'));
    expect(source.slice(source.indexOf('main() {'), source.indexOf('browser.runtime.onInstalled.addListener'))).not.toMatch(/ensureReady\(\)/);
    for (const forbidden of forbiddenStartupOperations) expect(source).not.toMatch(forbidden);
    for (const forbidden of forbiddenStartupOperations) expect(localStorage).not.toMatch(forbidden);
    expect(localStorage).toMatch(/database\.open\(\)/);
  });
});
