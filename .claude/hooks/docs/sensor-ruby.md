---
match: [".rb", ".erb", "Gemfile"]
mode: once
---

# Ruby Sensor adapter

Ruby and Rails files use the exact `tree-sitter-ruby` dependency. ERB extracts
Ruby into a masked source of identical length. If the grammar genuinely fails
to load, use only its declared lexical fallback and report the reason on every
diagnostic.
