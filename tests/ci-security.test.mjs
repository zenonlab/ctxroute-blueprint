import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');

test('GitHub Actions runtime remains limited to protected production delivery', () => {
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  const workflows = tracked.filter((path) => /(^|\/)\.github\/workflows\//u.test(path));
  assert.deepEqual(workflows, ['.github/workflows/deploy-production.yml']);
  const workflow = read('.github/workflows/deploy-production.yml');
  assert.match(workflow, /branches: \[main\]/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /worker:tobirink-public-api/u);
  assert.doesNotMatch(workflow, /pull_request:/u);
  assert.equal(tracked.includes('src/run.ts'), false);
  assert.equal(tracked.includes('src/agenda/cli.ts'), false);
});

test('local verification retains the complete quality boundary', () => {
  const manifest = JSON.parse(read('package.json'));
  for (const command of [
    'validate',
    'typecheck',
    'test:parser-equivalence',
    'test:performance',
    'crg:smoke',
    'integration',
    'npm audit --audit-level=high',
    'build:docs',
  ]) {
    assert.equal(manifest.scripts.verify.includes(command), true, command);
  }
  assert.equal(read('.github/code-review-graph-constraints.txt').trim().endsWith('code-review-graph==2.3.8'), true);
});

test('fresh production canaries require bounded provider observation', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  const canaryStep = workflow.split('- name: Run fresh bounded anime and manga canaries')[1]?.split('- name:')[0];
  assert.ok(canaryStep);
  assert.match(canaryStep, /inputs\.run_manga_canary == true/u);
  assert.match(canaryStep, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/u);
  assert.match(canaryStep, /node scripts\/infra\/manga-canary\.mjs --observe/u);
  assert.doesNotMatch(canaryStep, /DEN[O0].*TOKEN|continue-on-error/u);
});
