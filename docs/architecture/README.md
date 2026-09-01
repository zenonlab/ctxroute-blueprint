# Architecture

The typed Archify architecture JSON IR under `docs/architecture/src/` is the
versioned source of truth. In this repository it documents the blueprint
infrastructure; a project created from the template must replace or extend it
during initialization with the product architecture. Validate it at `showcase`
quality with `npm run validate:architecture`.
Generate the interactive HTML with `npm run build:docs`; output stays under
ignored `dist/` and must never be edited manually or committed.

Run `npm run archify:visual-check` only after a successful build. It measures
containment at 1440×900, 1600×1000, 1920×1080, and 2048×1320 and generates
light/dark captures, a contact sheet, and a JSON receipt. Automated evidence
keeps `visualReview: pending` until a human inspects the artifact.
