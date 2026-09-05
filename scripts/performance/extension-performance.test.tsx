import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExtensionSurface } from '../../apps/extension/runtime/ExtensionSurface';

const bundleBudgetBytes = 1_500_000;
const localOperationBudgetMs = 200;
const root = process.cwd();

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
      expect(bundle.files).toBe(19);
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
    expect(readinessCalls).toHaveLength(3);
    expect(readinessCalls[0]).toBeGreaterThan(source.indexOf('browser.runtime.onInstalled.addListener'));
    expect(readinessCalls[1]).toBeGreaterThan(source.indexOf('browser.runtime.onMessage.addListener'));
    expect(readinessCalls[2]).toBeGreaterThan(source.indexOf('browser.runtime.onMessage.addListener'));
    for (const forbidden of forbiddenStartupOperations) expect(source).not.toMatch(forbidden);
    for (const forbidden of forbiddenStartupOperations) expect(localStorage).not.toMatch(forbidden);
    expect(localStorage).toMatch(/database\.open\(\)/);
  });
});
