---
match: [".githooks/sensor", ".githooks/sensor-engine.mjs", ".githooks/sensor-checklist.mjs", ".project/sensor-rules.json", "package.json", "Gemfile", "composer.json"]
mode: smart
threshold: 3
---
# Sensor adapters and optional parsers

The blueprint Sensor works without installing a product framework or an
additional parser. Read the Sensor checklist and ADR-0010 before changing its
registry, rules, or dependencies.

Ruby/Rails and PHP/Laravel files have bounded lexical checks. `tree-sitter-ruby`
and `tree-sitter-php` are optional derived-product capabilities: detect the
actual project stack first, then propose them only when AST syntax or
complexity checks are useful. Never install them merely because a filename is
recognized, and never describe lexical coverage as AST or runtime proof.

If an optional parser is absent, keep the lexical fallback and report the
limitation. Preserve the single Sensor engine, stable diagnostic contract,
explicit unsupported-language errors, and CTXRoute/SQLite boundaries. Adding a
parser or changing a rule requires architecture evidence, an applicable ADR,
tests, and validation; it must not modify `AGENTS.md`, global permissions, or
CTXRoute configuration automatically.
