import { readFileSync } from 'node:fs';
import { defineConfig } from 'oxlint';

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const project = JSON.parse(readFileSync(new URL('./.project/project-config.json', import.meta.url), 'utf8'));
const effectPolicy = project.quality?.sensor?.antiSlopEffect ?? 'auto';
const hasDirectEffect = Boolean(packageJson.dependencies?.effect || packageJson.devDependencies?.effect);
const effectEnabled = effectPolicy === 'enabled' || (effectPolicy === 'auto' && hasDirectEffect);

const genericRules = Object.fromEntries([
  'no-chained-type-assertions', 'no-conditional-empty-object-spread', 'no-known-value-widening', 'no-module-mocking',
  'no-object-parameters', 'no-reflect-apply', 'no-reflect-get', 'no-runtime-typeof', 'no-shape-in-symbol-names',
  'no-unknown-parameters', 'no-unknown-returns', 'no-unknown-type-aliases', 'no-unsafe-dictionary-type',
  'no-widen-then-assert', 'require-safety-comment-for-type-assertion',
].map(rule => [`anti-slop/${rule}`, 'error']));

const jsPlugins = [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }];
const rules = { ...genericRules };
if (effectEnabled) {
  jsPlugins.push({ name: 'anti-slop-effect', specifier: './tools/oxlint/anti-slop/effect/index.ts' });
  rules['anti-slop-effect/no-service-constructor-imports'] = 'error';
}

export default defineConfig({
  ignorePatterns: ['tools/oxlint/anti-slop/**'],
  jsPlugins,
  rules,
});
