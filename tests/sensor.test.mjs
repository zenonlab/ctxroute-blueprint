import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { analyzeSource } from '../.githooks/sensor-engine.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const sensor = join(root, '.githooks', 'sensor');
for (const [extension, source] of [['js', 'const value = 1;'], ['jsx', 'const view = <div />;'], ['ts', 'const value: number = 1;'], ['tsx', 'const view: JSX.Element = <div />;'], ['py', 'value = 1\n']]) test(`safe ${extension} parses`, () => { const result = run(extension, source); assert.equal(result.status, 0, result.stderr); assert.equal(result.body.verdict, 'SAFE'); });
for (const [name, extension, source, rule] of [
  ['eval', 'js', 'eval(input);', 'sensor/dynamic-eval'],
  ['Function', 'ts', 'new Function("return 1");', 'sensor/dynamic-function'],
  ['dangerous command', 'js', 'execSync("rm -rf /tmp/example");', 'sensor/dangerous-shell-command'],
  ['shell true', 'js', 'spawn("tool", [], { shell: true });', 'sensor/shell-true'],
  ['secret network flow', 'js', 'fetch("https://example.test", { body: process.env.TOKEN });', 'sensor/secret-network-flow'],
  ['Python shell true', 'py', 'subprocess.run("tool", shell=True)\n', 'sensor/shell-true'],
  ['Python secret network flow', 'py', 'requests.post("https://example.test", data=os.getenv("TOKEN"))\n', 'sensor/secret-network-flow']
]) test(`${name} is unsafe`, () => { const result = run(extension, source); assert.equal(result.status, 2); assert.equal(result.body.verdict, 'UNSAFE'); assert.ok(result.body.diagnostics.some(item => item.rule === rule)); });
test('comments and strings are ignored', () => { assert.equal(run('js', '// eval(input)\nconst text = "rm -rf /";').status, 0); });
test('syntax errors exit 2', () => { const result = run('py', 'def broken(:\n'); assert.equal(result.status, 2); assert.equal(result.body.verdict, 'ERROR'); });
test('diagnostics are path ordered', () => { const directory = mkdtempSync(join(tmpdir(), 'sensor-order-')); const a = join(directory, 'a.js'); const b = join(directory, 'b.js'); writeFileSync(a, 'eval(a);'); writeFileSync(b, 'eval(b);'); const result = spawnSync(process.execPath, [sensor, b, a], { cwd: root, encoding: 'utf8' }); assert.deepEqual(JSON.parse(result.stdout).diagnostics.map(item => item.path), [a, b]); });
function run(extension, source) { const directory = mkdtempSync(join(tmpdir(), 'sensor-test-')); const path = join(directory, `fixture.${extension}`); writeFileSync(path, source); const result = spawnSync(process.execPath, [sensor, path], { cwd: root, encoding: 'utf8' }); return { ...result, body: JSON.parse(result.stdout) }; }

test('SQL parameters are safe while concatenation is unsafe', () => {
  assert.equal(analyzeSource('query.sql', 'SELECT * FROM users WHERE id = $1;').length, 0);
  assert.equal(analyzeSource('query.sql', 'SELECT * FROM users WHERE id = ${id};')[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('query.sql', '-- SELECT x + ${notCode}\nSELECT x FROM users;').length, 0);
});
test('HTML and CSS layer violations are explicit', () => {
  assert.equal(analyzeSource('page.html', '<main>Hello</main>').length, 0);
  assert.equal(analyzeSource('page.html', '<style>main { color: red }</style>').at(0).rule, 'sensor/ui-mixed-markup');
  assert.equal(analyzeSource('page.css', 'main { color: red }').length, 0);
  assert.equal(analyzeSource('page.css', '<div>bad</div>').at(0).rule, 'sensor/ui-mixed-markup');
});
test('anti-slop rules ignore comments and string contents', () => {
  assert.equal(analyzeSource('safe.js', '// console.log("debug")\nconst text = "TODO";').length, 0);
  assert.equal(analyzeSource('debug.js', 'console.log(value);').at(0).rule, 'sensor/anti-slop/debug-output');
});
test('unsupported and missing paths are explicit errors', () => {
  assert.equal(run('rb', 'puts 1').body.verdict, 'ERROR');
  const missing = spawnSync(process.execPath, [sensor, 'missing.sql'], { cwd: root, encoding: 'utf8' });
  assert.equal(JSON.parse(missing.stdout).diagnostics[0].rule, 'sensor/read-error');
});
