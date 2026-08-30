# Architecture

The typed Archify architecture JSON IR under `src/` is the versioned source of
truth. Validate it at `showcase` quality with `npm run validate:architecture`.
Generate the interactive HTML with `npm run build:docs`; output stays under
ignored `dist/` and must never be edited manually or committed.
