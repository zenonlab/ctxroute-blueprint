import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const config = JSON.parse(readFileSync('.project/project-config.json', 'utf8'));
const workflow = readFileSync('.github/workflows/validate.yml', 'utf8');
const required = ['setup:check', 'workspace:check', 'governance:check', 'progress:read', 'progress:validate', 'sensor', 'sensor:blueprint', 'initialize', 'lint', 'test:coverage', 'crg:smoke', 'integration', 'verify'];
const missing = required.filter(name => !pkg.scripts[name]);
const requiredCommands = [config.commands.test, config.commands.lint, config.commands.integration, config.commands.performance, config.commands.sensorBlueprint];
for (const command of requiredCommands) if (!command) missing.push('project-command:null');
for (const command of ['npm run setup:check', 'npm ci', 'npm run validate', 'npm run integration', 'npm audit --audit-level=high', 'npm run build:docs', 'node scripts/blueprint-sensor.mjs']) if (!workflow.includes(command)) missing.push(`workflow:${command}`);
for (const event of ['SessionStart', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'PreCompact', 'Stop']) {
  if (!readFileSync('.codex/hooks.json', 'utf8').includes(event) || !readFileSync('.claude/settings.json', 'utf8').includes(event)) missing.push(`event:${event}`);
}
if (missing.length) { console.error(`Coherence check failed: ${missing.join(', ')}`); process.exit(1); }
console.log('Coherence check passed: package scripts, project commands, workflow, and lifecycle events agree.');
