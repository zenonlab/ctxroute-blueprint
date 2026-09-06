import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LOCAL_SKILLS = Object.freeze(['blueprint-audit', 'session-auditor', 'skill-creator']);
export const SKILL_MODES = Object.freeze(['SWARM_ON', 'SWARM_OFF']);
export const RESEARCH_LABELS = Object.freeze(['official-documentation', 'implementation', 'recommendation', 'hypothesis']);
const COMPANION_FIELDS = new Set(['schemaVersion', 'skillId', 'version', 'modes', 'mutationAuthority', 'researchLabels', 'validations']);
const VALIDATION_FIELDS = new Set(['id', 'executable', 'args', 'cwd', 'timeout_ms']);
const FORBIDDEN_NPM_SCRIPTS = new Set(['validate', 'verify', 'blueprint:review', 'skills:verify']);
const SAFE_EXECUTABLE = /^(?:[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+(?:[\\/][a-zA-Z0-9._-]+)+)$/u;
const SECRET_HINT = /(?:bearer\s+\S+|(?:api[_-]?key|authorization|cookie|password|private[_-]?key|secret|token)\s*[:=]\s*\S+)/iu;

export function validateBlueprintSkills(root = process.cwd()) {
  const errors = [];
  const skillsRoot = join(root, '.agents', 'skills');
  const discovered = existsSync(skillsRoot)
    ? readdirSync(skillsRoot, { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(join(skillsRoot, entry.name, 'blueprint.json'))).map(entry => entry.name)
    : [];
  const names = [...new Set([...LOCAL_SKILLS, ...discovered])].sort();
  for (const name of names) validateSkill(root, name, errors);
  return [...new Set(errors)];
}

export function readBlueprintCompanions(root = process.cwd()) {
  const errors = validateBlueprintSkills(root);
  if (errors.length) throw new Error(errors.join('\n'));
  return LOCAL_SKILLS.map(name => JSON.parse(readFileSync(join(root, '.agents', 'skills', name, 'blueprint.json'), 'utf8')));
}

function validateSkill(root, name, errors) {
  const directory = join(root, '.agents', 'skills', name);
  const skillPath = join(directory, 'SKILL.md');
  const companionPath = join(directory, 'blueprint.json');
  if (!isRegularFile(skillPath) || !isRegularFile(companionPath)) { errors.push(`${name}: missing regular SKILL.md or blueprint.json`); return; }
  const source = readFileSync(skillPath, 'utf8');
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/u)?.[1] ?? '';
  const declaredName = frontmatter.match(/^name:\s*([^\r\n]+)$/mu)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*([^\r\n]+)$/mu)?.[1]?.trim();
  if (declaredName !== basename(directory) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(declaredName ?? '')) errors.push(`${name}: invalid or mismatched name`);
  if (!description || description.length > 1024) errors.push(`${name}: missing or oversized description`);
  if (/\[(?:TODO|PLACEHOLDER)|TODO:/iu.test(source)) errors.push(`${name}: unfinished placeholder`);
  let companion;
  try { companion = JSON.parse(readFileSync(companionPath, 'utf8')); } catch { errors.push(`${name}: invalid blueprint.json`); return; }
  validateCompanion(name, companion, errors);
  validateReferences(name, skillPath, source, errors);
}

function validateCompanion(name, companion, errors) {
  if (!isPlainObject(companion)) { errors.push(`${name}: blueprint companion must be an object`); return; }
  const unknown = Object.keys(companion).filter(key => !COMPANION_FIELDS.has(key));
  if (unknown.length) errors.push(`${name}: unknown companion fields ${unknown.sort().join(', ')}`);
  if (companion.schemaVersion !== 2 || companion.skillId !== name || !/^\d+\.\d+\.\d+$/u.test(companion.version ?? '')) errors.push(`${name}: invalid blueprint companion identity`);
  if (!sameSet(companion.modes, SKILL_MODES)) errors.push(`${name}: modes must contain SWARM_ON and SWARM_OFF exactly once`);
  if (companion.mutationAuthority !== 'orchestrator') errors.push(`${name}: mutationAuthority must be orchestrator`);
  if (name === 'skill-creator') {
    if (!sameSet(companion.researchLabels, RESEARCH_LABELS)) errors.push(`${name}: invalid researchLabels`);
  } else if ('researchLabels' in companion) errors.push(`${name}: researchLabels are only valid for skill-creator`);
  if (!Array.isArray(companion.validations) || companion.validations.length < 1 || companion.validations.length > 16) errors.push(`${name}: validations must contain 1 to 16 entries`);
  else {
    const identifiers = new Set();
    companion.validations.forEach((validation, index) => validateValidation(name, validation, index, identifiers, errors));
  }
  if ('validation' in companion) errors.push(`${name}: legacy shell validation field is forbidden`);
}

function validateValidation(name, validation, index, identifiers, errors) {
  const prefix = `${name}: validation ${index + 1}`;
  if (!isPlainObject(validation)) { errors.push(`${prefix} must be an object`); return; }
  const unknown = Object.keys(validation).filter(key => !VALIDATION_FIELDS.has(key));
  if (unknown.length) errors.push(`${prefix} has unknown fields ${unknown.sort().join(', ')}`);
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(validation.id ?? '') || identifiers.has(validation.id)) errors.push(`${prefix} has an invalid or duplicate id`);
  else identifiers.add(validation.id);
  if (!isSafeExecutable(validation.executable)) errors.push(`${prefix} has an invalid executable`);
  if (!Array.isArray(validation.args) || validation.args.length > 64 || validation.args.some(argument => argument !== String(argument) || argument.length > 512 || hasControlCharacter(argument) || SECRET_HINT.test(argument))) errors.push(`${prefix} has invalid args`);
  if (!isSafeRelativePath(validation.cwd)) errors.push(`${prefix} has an unsafe cwd`);
  if (!Number.isSafeInteger(validation.timeout_ms) || validation.timeout_ms < 1 || validation.timeout_ms > 30_000) errors.push(`${prefix} has an invalid timeout_ms`);
  if (validation.executable === 'npm' && validation.args?.[0] === 'run' && FORBIDDEN_NPM_SCRIPTS.has(validation.args[1])) errors.push(`${prefix} recursively invokes ${validation.args[1]}`);
}

function validateReferences(name, skillPath, source, errors) {
  for (const reference of [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].map(match => match[1]).filter(path => !/^[a-z]+:/iu.test(path))) {
    const target = resolve(dirname(skillPath), reference);
    if (relative(dirname(skillPath), target).startsWith('..') || !isRegularFile(target)) errors.push(`${name}: missing or unsafe referenced resource ${reference}`);
  }
}

function isSafeRelativePath(value) {
  if (value !== String(value) || value.length < 1 || value.length > 256 || isAbsolute(value) || hasControlCharacter(value) || SECRET_HINT.test(value)) return false;
  const normalized = normalize(value).replaceAll('\\', '/');
  return normalized === '.' || (!normalized.startsWith('../') && normalized !== '..');
}

function isSafeExecutable(value) {
  if (value !== String(value) || value.length < 1 || value.length > 128 || isAbsolute(value) || hasControlCharacter(value) || SECRET_HINT.test(value) || !SAFE_EXECUTABLE.test(value)) return false;
  return !normalize(value).replaceAll('\\', '/').split('/').includes('..');
}

function isRegularFile(path) {
  try { return lstatSync(path).isFile(); } catch { return false; }
}

function hasControlCharacter(value) { return [...value].some(character => { const code = character.codePointAt(0); return code <= 31 || code === 127; }); }
function isPlainObject(value) { return value && value === Object(value) && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function sameSet(actual, expected) { return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === expected.length && expected.every(value => actual.includes(value)); }

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = validateBlueprintSkills();
  if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exitCode = 1; }
  else process.stdout.write('Blueprint skills are valid.\n');
}
