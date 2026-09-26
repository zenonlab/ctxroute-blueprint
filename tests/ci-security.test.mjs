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
  const actionRefs = [...workflow.matchAll(/uses:\s*([^\s#]+)/gu)].map(match => match[1]);
  assert.equal(actionRefs.length, 2);
  assert.ok(actionRefs.every(ref => /^actions\/(?:checkout|setup-node)@[a-f0-9]{40}$/u.test(ref)));
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

test('Playwright Chromium is reused by the repository verification', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  const install = workflow.split('- name: Install Playwright Chromium')[1]?.split('- name:')[0];
  assert.ok(install);
  assert.match(install, /chromium\.executablePath\(\)/u);
  assert.match(install, /test -x "\$CHROME_BIN"/u);
  assert.match(install, /CHROME_BIN=%s\\n.*GITHUB_ENV/u);
  assert.ok(workflow.indexOf('- name: Install Playwright Chromium') < workflow.indexOf('- name: Verify repository'));
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

test('diagnostics receive the explicit Cloudflare account before the production plan', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  const diagnostics = workflow.split('- name: Collect aggregate Discovery diagnostics')[1]?.split('- name:')[0];
  assert.ok(diagnostics);
  assert.match(diagnostics, /CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/u);
  assert.match(diagnostics, /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/u);
  assert.match(diagnostics, /timeout-minutes: 2/u);
  assert.doesNotMatch(diagnostics, /continue-on-error/u);
  assert.ok(workflow.indexOf('- name: Collect aggregate Discovery diagnostics') < workflow.indexOf('- name: Create expiring Cloudflare plan'));
});

test('branch dispatch verifies and plans without applying the Worker or admitting canaries', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  const step = name => workflow.split(`- name: ${name}`)[1]?.split('- name:')[0];
  const condition = name => step(name)?.match(/if: \$\{\{ (.+) \}\}/u)?.[1];
  const applyCondition = condition('Apply only the approved Worker target');
  const canaryCondition = condition('Run fresh bounded anime and manga canaries');
  assert.equal(applyCondition, "github.ref == 'refs/heads/main'");
  assert.equal(condition('Verify public production probes'), applyCondition);
  assert.equal(canaryCondition, "github.ref == 'refs/heads/main' && inputs.run_manga_canary == true");
  assert.doesNotMatch(step('Verify repository'), /if:/u);
  assert.doesNotMatch(step('Create expiring Cloudflare plan'), /if:/u);
  for (const [ref, enabled, expectedApply, expectedCanary] of [
    ['refs/heads/main', false, true, false],
    ['refs/heads/main', true, true, true],
    ['refs/heads/fix/example', false, false, false],
    ['refs/heads/fix/example', true, false, false],
    ['refs/tags/main', true, false, false],
  ]) {
    const allowed = expression => expression.split(' && ').every(term => term === "github.ref == 'refs/heads/main'" ? ref === 'refs/heads/main' : term === 'inputs.run_manga_canary == true' && enabled);
    assert.equal(allowed(applyCondition), expectedApply);
    assert.equal(allowed(canaryCondition), expectedCanary);
  }
});

test('extension publication is an optional two-object phase after successful canaries', () => {
  const workflow = read('.github/workflows/deploy-production.yml');
  assert.match(workflow, /publish_extension:[\s\S]*?default: false[\s\S]*?type: boolean/u);
  const preflight = workflow.indexOf('- name: Check extension publication preconditions');
  assert.ok(preflight > 0 && preflight < workflow.indexOf('- name: Apply only the approved Worker target'));
  const publication = workflow.split('- name: Publish and verify immutable extension archives')[1]?.split('- name:')[0];
  assert.ok(publication);
  assert.ok(workflow.indexOf('- name: Run fresh bounded anime and manga canaries') < workflow.indexOf('- name: Publish and verify immutable extension archives'));
  assert.match(publication, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(publication, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(publication, /inputs\.publish_extension == true/u);
  assert.match(publication, /inputs\.run_manga_canary == true/u);
  assert.equal((publication.match(/--operation r2-publish:/gu) ?? []).length, 2);
  assert.equal((publication.match(/--allow r2:tobirink-public-releases\/downloads\//gu) ?? []).length, 2);
  assert.match(publication, /assertExtensionPublicationPlan/u);
  assert.match(publication, /verifyExtensionPublication/u);
  assert.doesNotMatch(publication, /worker-deploy|d1-migrate|queue-|published-extension\.json|continue-on-error|always\(\)/u);
  const workerPlan = workflow.split('- name: Create expiring Cloudflare plan')[1]?.split('- name:')[0];
  assert.match(workerPlan, /plan\.actions\.length !== 1/u);
  assert.doesNotMatch(workerPlan, /r2-publish/u);
  assert.doesNotMatch(workflow, /contents: write/u);
});
