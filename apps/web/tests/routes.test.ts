import { describe, expect, it } from 'vitest';
import { webLibraryQuerySchema, webRequestSchema } from '@tobirink/contracts/web-bridge';
import { createLocalAgendaPeriod } from '@tobirink/ui';
import { publicDownloads } from '../app/download/page';
import extensionPackage from '../../extension/package.json';
import publishedExtension from '../published-extension.json';

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

describe('Workbench web routes', () => {
  it('bounds the home preview to four local works', () => {
    expect(webLibraryQuerySchema.parse({ facet: 'all', limit: 4 })).toEqual({ facet: 'all', limit: 4, sort: 'ADDED_DESC' });
  });

  it('accepts the URL-addressable Library projection bound', () => {
    expect(webRequestSchema.parse({ type: 'library.read', requestId: 'route_library', query: { cursor: 'work_cursor', facet: 'manga', limit: 24, search: 'étoile' } })).toBeTruthy();
  });

  it('builds full local weeks from Monday through Sunday', () => {
    const period = createLocalAgendaPeriod(new Date(2026, 9, 25, 12), 0);
    expect(period.days).toHaveLength(7);
    expect(period.days[0]?.date.getDay()).toBe(1);
    expect(period.days[6]?.date.getDay()).toBe(0);
  });

  it('exposes only the two published versioned archives', () => {
    expect(publicDownloads('1.0.0')).toEqual([
      { browser: 'Chrome', href: '/downloads/tobirink-chrome-mv3-1.0.0.zip' },
      { browser: 'Firefox', href: '/downloads/tobirink-firefox-mv3-1.0.0.zip' },
    ]);
  });

  it('publishes only the archives selected by the public pointer', () => {
    expect(compareVersions(extensionPackage.version, publishedExtension.version)).toBeGreaterThanOrEqual(0);
    expect(publicDownloads(publishedExtension.version)).toEqual([
      { browser: 'Chrome', href: `/downloads/tobirink-chrome-mv3-${publishedExtension.version}.zip` },
      { browser: 'Firefox', href: `/downloads/tobirink-firefox-mv3-${publishedExtension.version}.zip` },
    ]);
  });
});
