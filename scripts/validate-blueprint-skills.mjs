import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LOCAL_SKILLS = Object.freeze(['blueprint-audit', 'session-auditor', 'skill-creator']);

export function validateBlueprintSkills(root = process.cwd()) {
  const errors = [];
  const skillsRoot = join(root, '.agents', 'skills');
  const discovered = existsSync(skillsRoot) ? readdirSync(skillsRoot).filter(name => existsSync(join(skillsRoot, name, 'blueprint.json'))) : [];
  const names = [...new Set([...LOCAL_SKILLS, ...discovered])].sort();
  for (const name of names) {
    const directory = join(root, '.agents', 'skills', name);
    const skillPath = join(directory, 'SKILL.md');
    const companionPath = join(directory, 'blueprint.json');
    if (!existsSync(skillPath) || !existsSync(companionPath)) { errors.push(`${name}: missing SKILL.md or blueprint.json`); continue; }
    const source = readFileSync(skillPath, 'utf8');
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/u)?.[1] ?? '';
    const declaredName = frontmatter.match(/^name:\s*([^\n]+)$/mu)?.[1]?.trim();
    const description = frontmatter.match(/^description:\s*([^\n]+)$/mu)?.[1]?.trim();
    if (declaredName !== basename(directory) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(declaredName ?? '')) errors.push(`${name}: invalid or mismatched name`);
    if (!description || description.length > 1024) errors.push(`${name}: missing or oversized description`);
    if (/\[(?:TODO|PLACEHOLDER)|TODO:/iu.test(source)) errors.push(`${name}: unfinished placeholder`);
    let companion;
    try { companion = JSON.parse(readFileSync(companionPath, 'utf8')); } catch { errors.push(`${name}: invalid blueprint.json`); continue; }
    if (companion.schemaVersion !== 1 || companion.skillId !== name || !/^\d+\.\d+\.\d+$/u.test(companion.version) || !Array.isArray(companion.modes) || !['SWARM_ON', 'SWARM_OFF'].every(mode => companion.modes.includes(mode))) errors.push(`${name}: invalid blueprint companion contract`);
    for (const reference of [...source.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].map(match => match[1]).filter(path => !/^[a-z]+:/iu.test(path))) {
      if (!existsSync(join(dirname(skillPath), reference))) errors.push(`${name}: missing referenced resource ${reference}`);
    }
  }
  return [...new Set(errors)];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const errors = validateBlueprintSkills();
  if (errors.length) { process.stderr.write(`${errors.join('\n')}\n`); process.exitCode = 1; }
  else process.stdout.write('Blueprint skills are valid.\n');
}
