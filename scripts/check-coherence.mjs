import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const config = JSON.parse(readFileSync('.project/project-config.json', 'utf8'));
const workflow = readFileSync('.github/workflows/validate.yml', 'utf8');
const required = ['setup:check', 'workspace:check', 'governance:check', 'progress:read', 'progress:validate', 'sensor', 'initialize'];
const missing = required.filter(name => !pkg.scripts[name]);
const requiredCommands = [config.commands.test, config.commands.build, config.commands.workspaceCheck, config.commands.governanceCheck, config.commands.progressRead, config.commands.progressValidate];
for (const command of requiredCommands) if (command && !workflow.includes(command.split(' ')[0])) missing.push(`workflow:${command}`);
for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'PreCompact', 'Stop']) {
  if (!readFileSync('.codex/hooks.json', 'utf8').includes(event) || !readFileSync('.claude/settings.json', 'utf8').includes(event)) missing.push(`event:${event}`);
}
if (missing.length) { console.error(`Coherence check failed: ${missing.join(', ')}`); process.exit(1); }
console.log('Coherence check passed: package scripts, project commands, workflow, and lifecycle events agree.');
