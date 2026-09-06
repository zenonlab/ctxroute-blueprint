import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readBlueprintCompanions } from './validate-blueprint-skills.mjs';

const executeFile = promisify(execFile);
const MAX_DIAGNOSTIC_BYTES = 1024;
const SECRET = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:api[_-]?key|authorization|cookie|password|private[_-]?key|secret|token)\s*[:=]\s*\S+)/giu;

export async function verifyBlueprintSkills({ root = process.cwd(), execute = runValidation } = {}) {
  const companions = readBlueprintCompanions(root);
  const results = [];
  for (const companion of companions) {
    for (const validation of companion.validations) {
      const started = Date.now();
      try {
        const result = await execute(validation, root);
        results.push({ skill_id: companion.skillId, validation_id: validation.id, status: result.exit_code === 0 ? 'passed' : 'failed', exit_code: result.exit_code, duration_ms: Date.now() - started, diagnostic: sanitize(result.diagnostic) });
      } catch (error) {
        results.push({ skill_id: companion.skillId, validation_id: validation.id, status: error?.code === 'ETIMEDOUT' ? 'timed_out' : 'failed', exit_code: Number.isInteger(error?.code) ? error.code : null, duration_ms: Date.now() - started, diagnostic: sanitize(error?.stderr || error?.message || 'validation failed') });
      }
    }
  }
  return { ok: results.every(result => result.status === 'passed'), results };
}

async function runValidation(validation, root) {
  const repository = await realpath(root);
  const cwd = await realpath(resolve(repository, validation.cwd));
  if (isAbsolute(validation.cwd) || relative(repository, cwd).startsWith('..')) throw new Error('validation cwd escapes the repository');
  const result = await executeFile(validation.executable, validation.args, { cwd, timeout: validation.timeout_ms, maxBuffer: 64 * 1024, windowsHide: true, shell: false });
  return { exit_code: 0, diagnostic: result.stderr };
}

function sanitize(value = '') {
  const redacted = String(value).replace(SECRET, '<redacted>');
  return Buffer.from(redacted).subarray(0, MAX_DIAGNOSTIC_BYTES).toString('utf8').trim() || undefined;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  verifyBlueprintSkills().then(report => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  }).catch(error => { process.stderr.write(`${sanitize(error.message)}\n`); process.exitCode = 1; });
}
