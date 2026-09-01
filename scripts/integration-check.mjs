import { spawnSync } from 'node:child_process';
import process from 'node:process';

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  process.stderr.write('npm execution path is unavailable. Run integration through npm.\n');
  process.exit(1);
}
run('setup prerequisites', ['run', 'setup:check']);
if (process.platform === 'win32') {
  run('MCP manifests on Windows', ['run', 'mcp:validate']);
  process.stdout.write('Windows stdio smoke transport is skipped; manifests and the cross-platform unit fixtures remain validated.\n');
} else {
  run('MCP stdio smoke transport', ['run', 'mcp:smoke']);
}

function run(label, args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd: process.cwd(), stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    process.stderr.write(`${label} failed.\n`);
    process.exit(result.status ?? 1);
  }
}
