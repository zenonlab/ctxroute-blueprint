---
name: skill-creator
description: Create or repair a reusable Agent Skills skill when a new task category appears, no suitable skill exists, or observed execution evidence shows an existing skill has failed.
metadata:
  blueprint-version: "1.0.0"
  execution-authority: orchestrator
---

# Skill creator

Use this skill on a real discovery or failure signal, not after every session.
It has identical capability in both modes: the orchestrator delegates it in
`SWARM_ON`; the primary agent executes it directly in `SWARM_OFF`.

## Evidence and choice

Research current external conventions only when the task benefits from them.
Prefer primary sources. Label each input as official documentation,
implementation evidence, recommendation, or hypothesis. Compare plausible
alternatives by task fit, context cost, tool authority, deterministic
validation, portability, and failure risk. Record why the chosen structure is
better for the observed request.

Create a kebab-case skill directory with a required `SKILL.md`. Keep only
`name` and a discriminating `description` in standard frontmatter fields;
place blueprint-specific version, modes, authority, limits, and validation in
`metadata` or `blueprint.json`. Use progressive disclosure: reusable scripts
for deterministic mechanics and references only for conditional detail. Never
make swarm mode reduce a skill's tools or capabilities.

Validate the manifest with `node scripts/validate-blueprint-skills.mjs` and
execute its structured validations through `npm run skills:verify`. A skill
validation must never invoke the repository-wide `validate`, `verify`,
`blueprint:review`, or `skills:verify` scripts recursively. Then invoke the
`blueprint-audit` skill. Return the
decision and evidence to the orchestrator, which alone registers the skill and
associates it with future missions.
