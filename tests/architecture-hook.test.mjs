import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const hook = join(root, '.codex/hooks/pre-tool-architecture.mjs');

function run(tool_input, options = {}) {
  return spawnSync('node', [hook], {
    cwd: options.cwd ?? templateWorkspace(),
    input: JSON.stringify({ tool_name: options.toolName ?? 'apply_patch', tool_input }),
    encoding: 'utf8',
  });
}

function templateWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'architecture-template-'));
  const config = JSON.parse(readFileSync(join(root, '.project/project-config.json'), 'utf8'));
  config.status = 'template';
  for (const key of Object.keys(config.decisions)) config.decisions[key] = null;
  config.directories.source = [];
  config.codeExtensions = [];
  config.quality.mutation.decision = null;
  for (const directory of [...config.starter.infrastructureRoots, '.project', 'docs/architecture/src']) mkdirSync(join(cwd, directory), { recursive: true });
  for (const file of config.starter.rootFiles) writeFileSync(join(cwd, file), file === 'package.json' ? JSON.stringify({ scripts: { 'build:docs': 'node build' } }) : '');
  writeFileSync(join(cwd, '.codex/architecture-policy.json'), JSON.stringify({ policyVersion: 1, projectConfig: '.project/project-config.json', supportedStatuses: ['template', 'initialized'] }));
  writeFileSync(join(cwd, '.project/project-config.json'), JSON.stringify(config));
  writeFileSync(join(cwd, 'docs/architecture/src/blueprint.architecture.json'), '{}\n');
  return cwd;
}

test('blocks a new product file without architecture evidence', () => {
  const result = run({ command: '*** Add File: src/new-module.ts' });
  assert.match(result.stdout, /Write blocked/u);
});

test('allows a new test file', () => {
  const result = run({ command: '*** Add File: tests/new-module.test.ts' });
  assert.equal(result.stdout, '');
});

test('allows safe documentation extensions in declared documentation roots during discovery', () => {
  for (const path of ['documentation/guide.md', 'specs/contract.rst', 'specs/flow.mmd']) {
    const result = run({ command: `*** Add File: ${path}` });
    assert.equal(result.stdout, '', path);
  }
});

test('does not treat executable or misplaced files as discovery documentation', () => {
  for (const path of ['documentation/component.mdx', 'specs/generator.js', 'src/guide.md']) {
    const result = run({ command: `*** Add File: ${path}` });
    assert.match(result.stdout, /template mode/u, path);
  }
});

test('blocks a new module during discovery even with a diagram', () => {
  const result = run({ command: '*** Add File: src/new-module.ts\n*** Update File: docs/architecture/containers.md' });
  assert.match(result.stdout, /template mode/u);
});

test('does not block an existing hook', () => {
  const result = run({ file_path: '.codex/hooks/pre-tool-architecture.mjs' });
  assert.equal(result.stdout, '');
});

test('does not block a new infrastructure hook', () => {
  const result = run({ command: '*** Add File: .githooks/new-check.mjs' });
  assert.equal(result.stdout, '');
});

test('blocks a new dependency without architecture documentation', () => {
  const result = run({ file_path: 'package.json' }, { cwd: initializedWorkspace() });
  assert.match(result.stdout, /Write blocked/u);
});

test('reads patches supplied through a patch property', () => {
  const result = run({ patch: '*** Add File: application.rb' });
  assert.match(result.stdout, /template mode/u);
});

test('blocks a shell write command during discovery', () => {
  const result = run({ cmd: 'touch application.rb' }, { toolName: 'exec_command' });
  assert.match(result.stdout, /read and validation commands/u);
});

test('allows a validation command during discovery', () => {
  const result = run({ cmd: 'npm test' }, { toolName: 'exec_command' });
  assert.equal(result.stdout, '');
});

test('allows quoted search alternatives without hook noise', () => {
  const result = run({ cmd: "rg -n 'TODO|FIXME' ." }, { toolName: 'exec_command' });
  assert.equal(result.stdout, '');
});

test('allows the documented template setup commands during discovery', () => {
  for (const cmd of ['npm run setup:check', 'npm run setup', 'npm install --package-lock-only --ignore-scripts']) {
    const result = run({ cmd }, { toolName: 'exec_command' });
    assert.doesNotMatch(result.stdout, /decision":"block/u, cmd);
  }
});

test('allows blueprint validation commands during discovery', () => {
  for (const cmd of [
    'npm run workspace:check',
    'npm run governance:check',
    'npm run progress:read',
    'npm run progress:validate -- plan.json',
    'npm run sensor -- --checklist',
    'npm run sensor -- --checklist --json',
    'node .githooks/sensor --checklist --json',
  ]) {
    const result = run({ cmd }, { toolName: 'exec_command' });
    assert.doesNotMatch(result.stdout, /decision":"block/u, cmd);
  }
});

test('allows CRG graph commands that only write generated graph state', () => {
  for (const command of ['crg:build', 'crg:update', 'crg:status', 'crg:review', 'crg:mcp', 'crg:smoke']) {
    const result = run({ cmd: `npm run ${command}` }, { toolName: 'exec_command' });
    assert.doesNotMatch(result.stdout, /decision":"block/u, command);
  }
});

test('allows CRG refactor previews and blocks real refactors', () => {
  const preview = run({ refactor_id: 'fixture', dry_run: true }, { toolName: 'apply_refactor_tool' });
  assert.doesNotMatch(preview.stdout, /decision":"block/u);
  assert.match(preview.stdout, /normal editing tools/u);
  const mutation = run({ refactor_id: 'fixture', dry_run: false }, { toolName: 'apply_refactor_tool' });
  assert.match(mutation.stdout, /decision":"block/u);
  assert.match(mutation.stdout, /dry_run: true/u);
});

test('keeps blueprint state mutations blocked during discovery', () => {
  for (const cmd of ['npm run progress:approve', 'npm run progress:mcp']) {
    const result = run({ cmd }, { toolName: 'exec_command' });
    assert.match(result.stdout, /read and validation commands/u, cmd);
  }
});

test('blocks dependency refreshes that can execute lifecycle scripts', () => {
  for (const cmd of ['npm install', 'npm install --package-lock-only', 'npm install --package-lock-only --ignore-scripts --foreground-scripts']) {
    const result = run({ cmd }, { toolName: 'exec_command' });
    assert.match(result.stdout, /read and validation commands/u, cmd);
  }
});

test('allows the automatic Git workflow during discovery', () => {
  for (const cmd of ['git switch -c perf/quiet-hooks', 'git switch main', 'git remote -v', 'git fetch origin', 'git pull --ff-only', 'git clone . ../project-copy', 'git add AGENTS.md', 'git commit -m "docs(agent): allow automatic commits"', 'git push', 'gh auth status', 'gh auth switch --user vegetatitan', 'gh api /user']) {
    const result = run({ cmd }, { toolName: 'exec_command' });
    assert.doesNotMatch(result.stdout, /decision":"block/u, cmd);
  }
});

test('rejects destructive branch replacement during discovery', () => {
  const result = run({ cmd: 'git switch -C perf/quiet-hooks' }, { toolName: 'exec_command' });
  assert.match(result.stdout, /read and validation commands/u);
});

test('requires both an ADR and Archify evidence for a new module', () => {
  const cwd = initializedWorkspace();
  const result = run({ patch: '*** Add File: src/service.rb\n*** Update File: docs/architecture/src/blueprint.architecture.json\n*** Add File: docs/decisions/ADR-0001-service.md' }, { cwd });
  assert.doesNotMatch(result.stdout, /decision":"block/u);
});

test('blocks a new module with only Archify evidence', () => {
  const cwd = initializedWorkspace();
  const result = run({ patch: '*** Add File: src/service.rb\n*** Update File: docs/architecture/src/blueprint.architecture.json' }, { cwd });
  assert.match(result.stdout, /applicable ADR/u);
});

test('blocks code outside declared directories after initialization', () => {
  const cwd = initializedWorkspace();
  const result = run({ patch: '*** Add File: application.rb\n*** Update File: docs/architecture/src/blueprint.architecture.json' }, { cwd });
  assert.match(result.stdout, /outside declared directories/u);
});

test('blocks direct shell writes after initialization', () => {
  const cwd = initializedWorkspace();
  const result = run({ cmd: 'touch src/service.rb' }, { cwd, toolName: 'exec_command' });
  assert.match(result.stdout, /traceable editing tool/u);
});

test('allows a contract with a real ADR', () => {
  const cwd = initializedWorkspace();
  const result = run({ patch: '*** Update File: package.json\n*** Add File: docs/decisions/ADR-0001-dependency.md' }, { cwd });
  assert.equal(result.stdout, '');
});

test('blocks governed changes while an ADR is invalid or superseded', () => {
  for (const metadata of [
    '# invalid ADR\n',
    '---\nscope:\n  - src/**\nreview: on-change\nsuperseded-by: ADR-0002-current.md\n---\nold\n',
  ]) {
    const cwd = initializedWorkspace();
    mkdirSync(join(cwd, 'docs/decisions'), { recursive: true });
    writeFileSync(join(cwd, 'docs/decisions/ADR-0001-old.md'), metadata);
    const result = run({ patch: '*** Update File: src/existing.rb' }, { cwd });
    assert.match(result.stdout, /Write blocked/u);
    assert.match(result.stdout, /ADR/u);
  }
});

test('blocks governed changes when applicable ADRs declare an explicit conflict', () => {
  const cwd = initializedWorkspace();
  mkdirSync(join(cwd, 'docs/decisions'), { recursive: true });
  writeFileSync(join(cwd, 'docs/decisions/ADR-0001-one.md'), '---\nscope:\n  - src/**\nreview: on-change\nrevised: true\nconflicts-with:\n  - ADR-0002-two.md\n---\none\n');
  writeFileSync(join(cwd, 'docs/decisions/ADR-0002-two.md'), '---\nscope:\n  - src/**\nreview: on-change\nrevised: true\n---\ntwo\n');
  const result = run({ patch: '*** Update File: src/existing.rb' }, { cwd });
  assert.match(result.stdout, /explicitly conflict/u);
});

test('recognizes an Archify source changed in a previous step', () => {
  const cwd = initializedWorkspace();
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.email', 'fixture@example.invalid']);
  git(cwd, ['config', 'user.name', 'Fixture']);
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-qm', 'chore: fixture']);
  writeFileSync(join(cwd, 'docs/architecture/src/blueprint.architecture.json'), '{"changed":true}\n');
  const result = run({ patch: '*** Add File: src/service.rb\n*** Add File: docs/decisions/ADR-0001-service.md' }, { cwd });
  assert.doesNotMatch(result.stdout, /decision":"block/u);
});

test('fails closed when configuration is invalid', () => {
  const cwd = initializedWorkspace();
  writeFileSync(join(cwd, '.project/project-config.json'), '{');
  const result = run({ patch: '*** Add File: src/service.rb' }, { cwd });
  assert.match(result.stdout, /invalid project configuration/u);
});

test('allows only invalid configuration repair', () => {
  const cwd = initializedWorkspace();
  writeFileSync(join(cwd, '.project/project-config.json'), '{');
  const result = run({ patch: '*** Update File: .project/project-config.json' }, { cwd });
  assert.doesNotMatch(result.stdout, /decision":"block/u);
});

function initializedWorkspace() {
  const cwd = mkdtempSync(join(tmpdir(), 'architecture-hook-'));
  for (const directory of ['.codex', '.project', 'docs/architecture/src', 'src']) mkdirSync(join(cwd, directory), { recursive: true });
  writeFileSync(join(cwd, '.codex/architecture-policy.json'), JSON.stringify({ policyVersion: 1, projectConfig: '.project/project-config.json', supportedStatuses: ['template', 'initialized'] }));
  const config = JSON.parse(readFileSync(join(root, '.project/project-config.json'), 'utf8'));
  config.status = 'initialized';
  for (const key of Object.keys(config.decisions)) config.decisions[key] = key === 'language' ? 'Ruby' : 'none';
  config.directories.source = ['src/'];
  config.codeExtensions = ['.rb'];
  config.quality.sensor.languages = ['ruby'];
  config.quality.mutation.decision = 'not-applicable';
  config.architecture.documents = ['docs/architecture/src/blueprint.architecture.json'];
  config.architecture.internalDocuments = [];
  writeFileSync(join(cwd, '.project/project-config.json'), JSON.stringify(config));
  writeFileSync(join(cwd, 'docs/architecture/src/blueprint.architecture.json'), '{}\n');
  return cwd;
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}
