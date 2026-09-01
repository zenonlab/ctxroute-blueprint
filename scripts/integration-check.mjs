import { spawnSync } from 'node:child_process';
import process from 'node:process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
run('setup prerequisites', ['run', 'setup:check']);
if (process.platform === 'win32') {
  run('MCP manifests on Windows', ['run', 'mcp:validate']);
  process.stdout.write('Windows stdio smoke transport is skipped; manifests and the cross-platform unit fixtures remain validated.\n');
} else {
  run('MCP stdio smoke transport', ['run', 'mcp:smoke']);
}

function run(label, args) {
  const result = spawnSync(npm, args, { cwd: process.cwd(), stdio: 'inherit', shell: false });
  if (result.error || result.status !== 0) {
    process.stderr.write(`${label} failed.\n`);
    process.exit(result.status ?? 1);
  }
}
