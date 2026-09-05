import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('application import boundaries', () => {
  it('imports domain contracts but no provider or UI SDK', () => {
    const sources = [
      './index.ts',
      './ports/capability-ports.ts',
      './ports/storage-port.ts',
      './use-cases/add-work-to-library.ts',
      './use-cases/record-progress.ts',
      './use-cases/resolve-review.ts',
    ]
      .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
      .join('\n');
    expect(sources).not.toMatch(/from ['"](?:dexie|react|wxt|webextension-polyfill|@cloudflare|hono)/);
    expect(sources).not.toMatch(/\b(?:browser|chrome)\./);
  });
});
