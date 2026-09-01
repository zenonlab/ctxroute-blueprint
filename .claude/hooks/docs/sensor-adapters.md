---
match: [".githooks/sensor", ".githooks/sensor-engine.mjs", ".githooks/sensor-checklist.mjs", ".project/sensor-rules.json", "package.json", "Gemfile", "composer.json"]
mode: smart
threshold: 3
---
# Sensor adapters and grammar modes

The blueprint Sensor works without installing a product framework. Read the
Sensor checklist and ADR-0010 before changing its registry, rules, or
dependencies.

Ruby/Rails files use the exact `tree-sitter-ruby` dependency, and ERB extracts
Ruby into a masked source of identical length. PHP/Laravel files remain
explicitly lexical and must never be described as AST. Do not add a PHP grammar
merely because a filename is recognized.

If the Ruby grammar genuinely fails to load, use only its declared lexical
fallback and report the reason on every diagnostic. Preserve the single
registry and Sensor engine, stable diagnostic contract, explicit
unsupported-language errors, and CTXRoute/SQLite boundaries. Adding a parser
or changing a rule requires architecture evidence, an applicable ADR, tests,
and validation; it must not modify `AGENTS.md`, global permissions, or CTXRoute
configuration automatically.
