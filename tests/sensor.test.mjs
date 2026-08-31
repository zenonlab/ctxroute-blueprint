import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { adapterForPath, analyzePaths, analyzeSource, isSupportedSourcePath, SENSOR_ADAPTERS, SENSOR_COVERAGE, toSarif } from '../.githooks/sensor-engine.mjs';

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
test('high-value application risks and SARIF contract are reported', () => {
  const result = analyzeSource('route.ts', "fetch(userUrl); readFile(req.query.path); res.redirect(next); crypto.createHash('md5');", { config: { sql: { sinks: ['query'] } } });
  assert.deepEqual(result.map(item => item.rule), ['sensor/ssrf', 'sensor/path-traversal', 'sensor/open-redirect', 'sensor/weak-crypto']);
  assert.equal(result.every(item => item.confidence && item.category), true);
  const sarif = toSarif({ diagnostics: result });
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.runs[0].results.length, 4);
});
test('SARIF CLI does not treat its flag as a source path', () => {
  const result = spawnSync(process.execPath, [sensor, '--sarif', 'safe.js'], { cwd: root, encoding: 'utf8' });
  const body = JSON.parse(result.stdout);
  assert.equal(body.version, '2.1.0');
  assert.equal(body.runs[0].results.some(item => item.locations[0].physicalLocation.artifactLocation.uri === '--sarif'), false);
});
test('staged Sensor blocks unsafe diagnostics before commit', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sensor-staged-'));
  const objects = join(directory, 'objects');
  mkdirSync(objects);
  const env = { ...process.env, GIT_INDEX_FILE: join(directory, 'index'), GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(root, '.git/objects') };
  const git = (args, input) => execFileSync('git', args, { cwd: root, env, input, stdio: 'pipe' });
  git(['read-tree', 'HEAD']);
  const blob = git(['hash-object', '-w', '--stdin'], 'spawn("tool", [], { shell: true });\n').toString().trim();
  git(['update-index', '--add', '--cacheinfo', `100644,${blob},.sensor-staged-fixture.js`]);
  const result = spawnSync(process.execPath, ['.githooks/validate-staged.mjs'], { cwd: root, env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sensor\/shell-true/u);
});
test('syntax errors exit 2', () => { const result = run('py', 'def broken(:\n'); assert.equal(result.status, 2); assert.equal(result.body.verdict, 'ERROR'); });
test('diagnostics are path ordered', () => { const directory = mkdtempSync(join(tmpdir(), 'sensor-order-')); const a = join(directory, 'a.js'); const b = join(directory, 'b.js'); writeFileSync(a, 'eval(a);'); writeFileSync(b, 'eval(b);'); const result = spawnSync(process.execPath, [sensor, b, a], { cwd: root, encoding: 'utf8' }); assert.deepEqual(JSON.parse(result.stdout).diagnostics.map(item => item.path), [a, b]); });
function run(extension, source) { const directory = mkdtempSync(join(tmpdir(), 'sensor-test-')); const path = join(directory, `fixture.${extension}`); writeFileSync(path, source); const result = spawnSync(process.execPath, [sensor, path], { cwd: root, encoding: 'utf8' }); return { ...result, body: JSON.parse(result.stdout) }; }

test('SQL parameters are safe while concatenation is unsafe', () => {
  assert.equal(analyzeSource('query.sql', 'SELECT * FROM users WHERE id = $1;').length, 0);
  assert.equal(analyzeSource('query.sql', 'SELECT * FROM users WHERE id = ${id};')[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('query.sql', '-- SELECT x + ${notCode}\nSELECT x FROM users;').length, 0);
  assert.equal(analyzeSource('app.js', "db.query('SELECT * FROM users WHERE id = ' + userId)", { config: { sql: { sinks: ['query'] } } })[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('app.js', "db.query('SELECT * FROM users WHERE id = $1', [userId])", { config: { sql: { sinks: ['query'] } } }).length, 0);
  assert.equal(analyzeSource('app.js', "const sql = 'SELECT * FROM users WHERE id = ' + userId; db.query(sql)", { config: { sql: { sinks: ['query'] } } })[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('app.js', "function buildQuery(id) { return 'SELECT * FROM users WHERE id = ' + id; } db.query(buildQuery(userId))", { config: { sql: { sinks: ['query'] } } })[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('app.py', "cursor.execute(f'SELECT * FROM users WHERE id = {user_id}')", { config: { sql: { sinks: ['execute'] } } })[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('app.py', "def build_query(user_id):\n    return f'SELECT * FROM users WHERE id = {user_id}'\ncursor.execute(build_query(user_id))", { config: { sql: { sinks: ['execute'] } } })[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('orm.ts', "knex.raw('SELECT * FROM users WHERE id = ' + userId)")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('orm.ts', "query.whereRaw('id = ' + userId)")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('driver.ts', "sqlite.run('SELECT * FROM users WHERE id = ' + userId)")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('driver.py', "await pool.fetch_one(f'SELECT * FROM users WHERE id = {user_id}')")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('orm.ts', "sequelize.literal('ORDER BY ' + field)")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('orm.py', "text(f'SELECT * FROM users WHERE id = {user_id}')")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('orm.py', "RawSQL('id = %s', [user_id])").length, 0);
  assert.equal(analyzeSource('orm.ts', "const statement = sql`SELECT * FROM users WHERE id = ${userId}`; db.execute(statement);").length, 0);
  assert.equal(analyzeSource('orm.ts', "db.execute(sql`SELECT * FROM users WHERE id = ${userId}`);").length, 0);
  assert.equal(analyzeSource('orm.ts', "db.execute(sql.raw(`SELECT * FROM users WHERE id = ${userId}`));")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('orm.ts', "prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = ${userId}`)")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('route.ts', "const id = req.query.id; db.query(id)")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('route.py', "user_id = request.query_params['id']\ncursor.execute(user_id)")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('safe.ts', "const id = 42; db.query('SELECT * FROM users WHERE id = $1', [id])").length, 0);
  assert.equal(analyzeSource('query.sql', 'SELECT * FROM users;', { config: { sql: { requireLimit: true, maxRows: 100 } } })[0].rule, 'sensor/sql-unbounded-query');
  assert.equal(analyzeSource('query.sql', 'SELECT * FROM users LIMIT 100;', { config: { sql: { requireLimit: true, maxRows: 100 } } }).length, 0);
  assert.equal(analyzeSource('query.sql', 'SELECT * FROM users LIMIT $1;', { config: { sql: { requireLimit: true, maxRows: 100 } } }).length, 0);
  assert.equal(analyzeSource('query.sql', 'DELETE FROM users;', { config: { sql: { requireMutationFilter: true } } })[0].rule, 'sensor/sql-unfiltered-mutation');
  assert.equal(analyzeSource('query.sql', 'UPDATE users SET active = false WHERE id = $1;', { config: { sql: { requireMutationFilter: true } } }).length, 0);
  assert.equal(analyzeSource('route.ts', "function handler(req) { const id = req.query.id; return db.query('SELECT * FROM users WHERE id = $1', [id]); }", { config: { sql: { sinks: ['query'], requireRateLimit: true } } })[0].rule, 'sensor/sql-missing-rate-limit');
  assert.equal(analyzeSource('route.ts', "function handler(req) { rateLimit(req); const id = req.query.id; return db.query('SELECT * FROM users WHERE id = $1', [id]); }", { config: { sql: { sinks: ['query'], requireRateLimit: true } } }).length, 0);
});

test('SQL and path checks inspect only the sink argument', () => {
  const result = run('mjs', `import { readFileSync } from 'node:fs';
const row = database.prepare('UPDATE problems SET last_seen = ?, occurrences = occurrences + 1').run(now, appendEvidence(evidence));
const config = readFileSync('ctxroute-config.json', 'utf8');
`);
  assert.equal(result.body.diagnostics.some(item => item.rule === 'sensor/sql-injection'), false);
  assert.equal(result.body.diagnostics.some(item => item.rule === 'sensor/path-traversal'), false);
});
test('SQL tracking follows explicit exported/imported builders in one scan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sensor-cross-file-'));
  writeFileSync(join(directory, 'queries.ts'), "export function buildQuery(id) { return 'SELECT * FROM users WHERE id = ' + id; }\n");
  writeFileSync(join(directory, 'app.ts'), "import { buildQuery } from './queries';\ndb.query(buildQuery(userId));\n");
  const result = analyzePaths(['app.ts', 'queries.ts'], { root: directory, config: { schemaVersion: 1, dangerousCommands: [], sql: { sinks: ['query'] } } });
  assert.equal(result.verdict, 'UNSAFE');
  assert.equal(result.diagnostics.some(item => item.rule === 'sensor/sql-injection' && item.path === 'app.ts'), true);
});
test('Sensor exposes bounded adapter coverage and never resolves an unscanned local module', () => {
  assert.equal(SENSOR_ADAPTERS.flatMap(adapter => adapter.extensions).length, 113);
  assert.equal(isSupportedSourcePath('Dockerfile'), true);
  assert.equal(isSupportedSourcePath('.env.local'), true);
  assert.equal(isSupportedSourcePath('unknown.xyz'), false);
  assert.deepEqual(SENSOR_COVERAGE, { moduleScope: 'explicit-paths', packageResolution: 'disabled', wholeProgramAnalysis: false, rateLimitRuntimeProof: false });
  const directory = mkdtempSync(join(tmpdir(), 'sensor-explicit-scope-'));
  writeFileSync(join(directory, 'queries.js'), "export function buildQuery(id) { return 'SELECT * FROM users WHERE id = ' + id; }\n");
  writeFileSync(join(directory, 'app.js'), "import { buildQuery } from './queries';\ndb.query(buildQuery(userId));\n");
  const result = analyzePaths(['app.js'], { root: directory, config: { schemaVersion: 1, dangerousCommands: [], sql: { sinks: ['query'] } } });
  assert.equal(result.verdict, 'SAFE');
  assert.equal(result.coverage.moduleScope, 'explicit-paths');
  assert.equal(result.coverage.wholeProgramAnalysis, false);
  assert.equal(result.coverage.rateLimitRuntimeProof, false);
});
test('SQL tracking follows Python builders and import aliases in one scan', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sensor-python-cross-file-'));
  writeFileSync(join(directory, 'queries.py'), "def build_query(user_id):\n    return f'SELECT * FROM users WHERE id = {user_id}'\n");
  writeFileSync(join(directory, 'app.py'), "from queries import build_query as make_query\ncursor.execute(make_query(user_id))\n");
  const result = analyzePaths(['app.py', 'queries.py'], { root: directory, config: { schemaVersion: 1, dangerousCommands: [], sql: { sinks: ['execute'] } } });
  assert.equal(result.verdict, 'UNSAFE');
  assert.equal(result.diagnostics.some(item => item.rule === 'sensor/sql-injection' && item.path === 'app.py'), true);
});
test('SQL tracking resolves CommonJS aliases and does not match an unrelated module', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sensor-commonjs-cross-file-'));
  writeFileSync(join(directory, 'queries.js'), "export function buildQuery(id) { return 'SELECT * FROM users WHERE id = ' + id; }\n");
  writeFileSync(join(directory, 'other.js'), "export function buildQuery(id) { return 'SELECT * FROM users WHERE id = $1'; }\n");
  writeFileSync(join(directory, 'unsafe.cjs'), "const { buildQuery: makeQuery } = require('./queries');\ndb.query(makeQuery(userId));\n");
  writeFileSync(join(directory, 'safe.cjs'), "const { buildQuery } = require('./other');\ndb.query(buildQuery(userId));\n");
  const config = { schemaVersion: 1, dangerousCommands: [], sql: { sinks: ['query'] } };
  const result = analyzePaths(['safe.cjs', 'unsafe.cjs', 'queries.js', 'other.js'], { root: directory, config });
  assert.equal(result.diagnostics.some(item => item.rule === 'sensor/sql-injection' && item.path === 'unsafe.cjs'), true);
  assert.equal(result.diagnostics.some(item => item.rule === 'sensor/sql-injection' && item.path === 'safe.cjs'), false);
});
test('SQL tracking resolves CommonJS member aliases', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sensor-commonjs-member-'));
  writeFileSync(join(directory, 'queries.js'), "export function buildQuery(id) { return 'SELECT * FROM users WHERE id = ' + id; }\n");
  writeFileSync(join(directory, 'app.cjs'), "const queries = require('./queries');\ndb.query(queries.buildQuery(userId));\n");
  const result = analyzePaths(['app.cjs', 'queries.js'], { root: directory, config: { schemaVersion: 1, dangerousCommands: [], sql: { sinks: ['query'] } } });
  assert.equal(result.diagnostics.some(item => item.rule === 'sensor/sql-injection' && item.path === 'app.cjs'), true);
});
test('SQL tracking resolves ES namespace/default imports and local aliases', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sensor-esm-imports-'));
  writeFileSync(join(directory, 'queries.js'), "export function buildQuery(id) { return 'SELECT * FROM users WHERE id = ' + id; }\nexport default buildQuery;\n");
  writeFileSync(join(directory, 'namespace.js'), "import * as queries from './queries';\ndb.query(queries.buildQuery(userId));\n");
  writeFileSync(join(directory, 'default.js'), "import makeQuery from './queries';\ndb.query(makeQuery(userId));\n");
  writeFileSync(join(directory, 'alias.js'), "import { buildQuery } from './queries';\nconst makeQuery = buildQuery;\ndb.query(makeQuery(userId));\n");
  const config = { schemaVersion: 1, dangerousCommands: [], sql: { sinks: ['query'] } };
  const result = analyzePaths(['namespace.js', 'default.js', 'alias.js', 'queries.js'], { root: directory, config });
  for (const path of ['namespace.js', 'default.js', 'alias.js']) assert.equal(result.diagnostics.some(item => item.rule === 'sensor/sql-injection' && item.path === path), true, path);
});
test('SQL tracking detects Python percent formatting and preserves parameterized formatting', () => {
  assert.equal(analyzeSource('format.py', "cursor.execute('SELECT * FROM users WHERE id = %s' % user_id)")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('format.py', "cursor.execute('SELECT * FROM users WHERE id = %s', [user_id])").length, 0);
});
test('one action analyzes multiple language adapters with stable diagnostic ordering', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sensor-multi-language-'));
  writeFileSync(join(directory, 'page.vue'), '<script>eval(input);</script>\n');
  writeFileSync(join(directory, 'query.sql'), 'SELECT * FROM users WHERE id = ${user_id};\n');
  writeFileSync(join(directory, 'styles.css'), '<div>wrong</div>\n');
  const result = analyzePaths(['styles.css', 'query.sql', 'page.vue'], { root: directory, config: { schemaVersion: 1, dangerousCommands: [], sql: { sinks: ['query'] } } });
  assert.equal(result.verdict, 'UNSAFE');
  assert.deepEqual(result.diagnostics.map(item => item.path), ['page.vue', 'query.sql', 'styles.css']);
  assert.deepEqual(result.diagnostics.map(item => item.rule), ['sensor/dynamic-eval', 'sensor/sql-injection', 'sensor/ui-mixed-markup']);
});
test('HTML and CSS layer violations are explicit', () => {
  assert.equal(analyzeSource('page.html', '<main>Hello</main>').length, 0);
  assert.equal(analyzeSource('page.html', '<style>main { color: red }</style>').at(0).rule, 'sensor/ui-mixed-markup');
  assert.equal(analyzeSource('page.css', 'main { color: red }').length, 0);
  assert.equal(analyzeSource('page.css', '<div>bad</div>').at(0).rule, 'sensor/ui-mixed-markup');
  assert.equal(analyzeSource('page.js', "element.innerHTML = '<style>main { color: red }</style>'").at(0).rule, 'sensor/ui-mixed-markup');
  assert.equal(analyzeSource('page.html', '<button onclick="go()">Go</button>').at(0).rule, 'sensor/ui-inline-handler');
  assert.equal(analyzeSource('page.html', '<img src="avatar.png">').at(0).rule, 'sensor/ui-missing-alt');
  assert.equal(analyzeSource('page.css', '.button { color: red !important; }').at(0).rule, 'sensor/css-important');
  assert.equal(analyzeSource('page.tsx', '<div dangerouslySetInnerHTML={value} />').at(0).rule, 'sensor/xss');
});
test('Vue and Svelte single-file components analyze embedded code without false UI mixing alerts', () => {
  assert.equal(analyzeSource('Card.vue', '<template><main>Hello</main></template><style>main { color: red }</style>').length, 0);
  assert.equal(analyzeSource('Card.svelte', '<h1>Hello</h1>').length, 0);
  assert.equal(analyzeSource('Card.svelte', '<script>db.query(`SELECT * FROM users WHERE id = ${userId}`);</script><style>main { color: red }</style>').at(0).rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('Card.vue', '<script lang="ts">eval(input);</script>').at(0).rule, 'sensor/dynamic-eval');
});
test('lexical adapters cover Rust, TOML, and common repository formats without comment/string false positives', () => {
  assert.equal(analyzeSource('main.rs', 'fn main() { println!("ok"); }').length, 0);
  assert.equal(analyzeSource('main.rs', '// eval(input)\nfn main() {}').length, 0);
  assert.equal(analyzeSource('main.rs', 'fn main() { eval(input); }').at(0).rule, 'sensor/dynamic-eval');
  assert.equal(analyzeSource('Cargo.toml', '# eval(input)\nname = "demo"').length, 0);
  assert.equal(analyzeSource('config.toml', 'command = "eval(input)"').length, 0);
  assert.equal(analyzeSource('config.yaml', 'command: eval(input)').at(0).rule, 'sensor/dynamic-eval');
  assert.equal(analyzeSource('schema.graphql', 'type User { id: ID! }').length, 0);
  assert.equal(analyzeSource('main.lua', '-- eval(input)\nprint("ok")').length, 0);
  assert.equal(analyzeSource('main.lua', 'eval(input)').at(0).rule, 'sensor/dynamic-eval');
  assert.equal(analyzeSource('Dockerfile', 'RUN echo "ok"').length, 0);
  assert.equal(analyzeSource('.env', 'COMMAND="eval(input)"').length, 0);
});
test('Rails Ruby and templates detect unsafe boundaries without flagging safe ORM usage', () => {
  assert.equal(analyzeSource('users.rb', "User.where(id: params[:id]); User.find_by(name: params[:name])").length, 0);
  assert.equal(analyzeSource('users.rb', "User.find_by_sql(\"SELECT * FROM users WHERE id = #{params[:id]}\")")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('users.rb', "connection.execute('SELECT * FROM users WHERE id = ' + params[:id])")[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('users_controller.rb', 'send_file params[:path]')[0].rule, 'sensor/path-traversal');
  assert.equal(analyzeSource('users_controller.rb', 'render inline: params[:template]')[0].rule, 'sensor/rails-unsafe-render');
  assert.equal(analyzeSource('views/users.html.erb', '<img src="avatar.png"><%== params[:name] %>')[0].rule, 'sensor/ui-missing-alt');
  assert.equal(analyzeSource('views/users.html.erb', '<%= User.name %>')[0]?.rule, undefined);
  assert.equal(analyzeSource('views/users.html.erb', '<%= User.find_by_sql("SELECT * FROM users WHERE id = #{params[:id]}") %>')[0].rule, 'sensor/sql-injection');
  assert.equal(analyzeSource('views/users.html.haml', '.card{style: "color: #{params[:color]}"}')[0].rule, 'sensor/ui-dynamic-style');
  assert.equal(adapterForPath('app/views/home.html.erb'), 'template');
  assert.equal(adapterForPath('app/views/home.html.slim'), 'template');
  assert.equal(adapterForPath('app/views/home.blade.php'), 'template');
});
test('anti-slop rules ignore comments and string contents', () => {
  assert.equal(analyzeSource('safe.js', '// console.log("debug")\nconst text = "TODO";').length, 0);
  assert.equal(analyzeSource('template.js', 'const html = `<style>main { color: red }</style>`;').length, 0);
  assert.equal(analyzeSource('debug.js', 'console.log(value);').at(0).rule, 'sensor/anti-slop/debug-output');
});
test('unsupported and missing paths are explicit errors', () => {
  assert.equal(run('txt', 'plain text').body.verdict, 'ERROR');
  const missing = spawnSync(process.execPath, [sensor, 'missing.sql'], { cwd: root, encoding: 'utf8' });
  assert.equal(JSON.parse(missing.stdout).diagnostics[0].rule, 'sensor/read-error');
});
test('invalid or missing Sensor configuration is never treated as safe', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sensor-config-'));
  writeFileSync(join(directory, 'safe.js'), 'const value = 1;');
  assert.equal(analyzePaths(['safe.js'], { root: directory, config: { schemaVersion: 2 } }).verdict, 'ERROR');
  assert.equal(analyzePaths(['safe.js'], { root: directory }).diagnostics[0].rule, 'sensor/configuration');
  assert.equal(analyzePaths(['safe.js'], { root: directory, config: { schemaVersion: 1, dangerousCommands: [], complexity: { maxNodes: 10, maxDepth: 10 }, sql: { sinks: ['query'], requireLimit: false, maxRows: 100 } } }).verdict, 'SAFE');
  assert.equal(analyzePaths(['safe.js'], { root: directory, config: { schemaVersion: 1, analysis: { moduleScope: 'whole-program' }, dangerousCommands: [], sql: { sinks: ['query'] } } }).diagnostics[0].rule, 'sensor/configuration');
  assert.equal(analyzePaths(['safe.js'], { root: directory, config: { schemaVersion: 1, analysis: [], dangerousCommands: [], sql: { sinks: ['query'] } } }).diagnostics[0].rule, 'sensor/configuration');
});
