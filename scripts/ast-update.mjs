import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const packageNames = ['tree-sitter', 'tree-sitter-ruby', 'tree-sitter-javascript', 'tree-sitter-typescript', 'tree-sitter-python'];
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const candidates = packageNames.map(name => ({ name, current: manifest.devDependencies[name], candidate: execFileSync('npm', ['view', name, 'version'], { encoding: 'utf8' }).trim() }));
const report = { strategy: 'review-then-isolated-matrix', mutatesByDefault: false, candidates, applied: false };
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const sandbox = mkdtempSync(join(tmpdir(), 'ctxroute-ast-update-'));
const candidateVersions = Object.fromEntries(candidates.map(item => [item.name, item.candidate]));
try {
  cpSync(root, sandbox, { recursive: true, filter: source => !['.git', 'node_modules', 'dist', '.ctxroute'].includes(source.split(/[\\/]/u).at(-1)) });
  const sandboxManifestPath = join(sandbox, 'package.json');
  const sandboxManifest = JSON.parse(readFileSync(sandboxManifestPath, 'utf8'));
  delete sandboxManifest.scripts.postinstall;
  Object.assign(sandboxManifest.devDependencies, candidateVersions);
  writeFileSync(sandboxManifestPath, `${JSON.stringify(sandboxManifest, null, 2)}\n`);
  execFileSync('npm', ['install', '--save-exact'], { cwd: sandbox, stdio: 'inherit' });
  runMatrix(sandbox);

  const proof = {
    schemaVersion: 1,
    verifiedOn: new Date().toISOString().slice(0, 10),
    runtime: `tree-sitter@${candidateVersions['tree-sitter']}`,
    packages: candidateVersions,
    matrix: ['javascript', 'typescript', 'tsx', 'python', 'ruby', 'erb'],
    commands: ['npm run ast:check', 'node --test tests/context-ast.test.mjs tests/sensor.test.mjs tests/mcp-stdio.test.mjs'],
  };
  execFileSync('npm', ['install', '--save-dev', '--save-exact', ...candidates.map(item => `${item.name}@${item.candidate}`)], { cwd: root, stdio: 'inherit' });
  runMatrix(root);
  const proofPath = resolve(root, '.project/ast-compatibility.json');
  const temporaryProof = `${proofPath}.tmp-${process.pid}`;
  writeFileSync(temporaryProof, `${JSON.stringify(proof, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryProof, proofPath);
  console.log(JSON.stringify({ ...report, applied: true, proof: '.project/ast-compatibility.json' }, null, 2));
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}

function runMatrix(cwd) {
  execFileSync('npm', ['run', 'ast:check'], { cwd, stdio: 'inherit' });
  execFileSync(process.execPath, ['--test', 'tests/context-ast.test.mjs', 'tests/sensor.test.mjs', 'tests/mcp-stdio.test.mjs'], { cwd, stdio: 'inherit' });
}
