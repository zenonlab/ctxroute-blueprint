import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { favoriteEquivalenceCorpus } from '../../packages/application/src/favorites/equivalence-corpus';

const root = process.cwd();

function testFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.test\.tsx?$/u.test(name) && name !== 'equivalence-oracle.test.ts' ? [path] : [];
  });
}

describe('canonical semantic proof coverage', () => {
  it('binds every canonical ID to an independently executed semantic test', () => {
    const sources = ['apps', 'packages'].flatMap((directory) => testFiles(join(root, directory))).map((path) => readFileSync(path, 'utf8'));
    const oracleSource = readFileSync(join(root, 'packages/application/src/favorites/equivalence-oracle.test.ts'), 'utf8');
    const missing = favoriteEquivalenceCorpus
      .filter(({ id }) => !sources.some((source) => source.includes(id)) && !(id.startsWith('O-') && oracleSource.includes(id)))
      .map(({ id }) => id);
    expect(missing).toEqual([]);
    expect(new Set(favoriteEquivalenceCorpus.map(({ expectedBehavior }) => expectedBehavior)).size).toBe(82);
  });
});
