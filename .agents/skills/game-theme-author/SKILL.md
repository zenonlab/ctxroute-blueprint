---
name: game-theme-author
description: Research a local game's engine and corpus, propose a source-grounded wallpaper concept for user acceptance, then prepare a portable theme without game-specific runtime hardcode or untracked commercial assets.
metadata:
  blueprint-version: "1.1.0"
  execution-authority: primary-or-orchestrator
---

# Game theme author

Use this skill whenever a new game, map, level or game-derived wallpaper theme is
requested. Do not use it merely to correct an already reproduced defect.

Before acting, read `references/first-pass-playbook.md` completely. Maintain both a
verified `orbite.wallpaper-concept/1` and an
`orbite.game-theme-authoring-run/1`. The run is the authoritative stage ledger; prose
progress and a successful preview never open a later gate.

## Invariant — protect the active product

Research and conversion operate in a new private candidate root. Record the current
active package, binary and PID when they exist, but do not edit, overwrite, reinstall,
stop or reactivate them during research, proposal or candidate construction. Native
activation is the seventeenth and final gate. It opens only after the first sixteen
gates pass and the authoring-run verifier returns `activation_allowed: true`.

## Phase 1 — Read-only engine and corpus research

Do not generate, convert or modify product assets during this phase.

1. Hash and identify the user's local input without publishing its contents. Freeze
   the exact revision and create the isolated authoring-run ledger.
2. Inventory archives, scenes, rooms, geometry, materials, textures, animations,
   collisions, placements, effects, audio, UI and behavior data.
3. Research the engine and formats using primary documentation and pinned public
   implementations. Label evidence as official documentation, public implementation,
   local observation or hypothesis. A public viewer is reference or oracle only; it
   is never an asset source or a replacement runtime.
4. Establish the source coordinate system before exporting a visible scene: handedness,
   up/forward axes, unit scale, transform order and matrix convention. Prove the
   conversion with an asymmetric fixture; an identity-looking sample is insufficient.
5. Traverse dependencies from declared roots until the closure accounts for every
   discovered reference. Record cycles without duplicating assets. Unresolved
   dependencies close conversion.
6. Inspect local source tables and metadata first. If a relation is absent, inspect
   locally exported code read-only and derive explicit relation rows with symbols,
   revisions and hashes. Geometry or screenshots remain diagnostic.
7. Evaluate candidate tools by exact version, license, format coverage, fidelity,
   reproducibility and failure behavior. Record rejected tools as well as selected ones.
8. Cover every subsystem required by `orbite.wallpaper-concept/1`. Use `missing`,
   `unsupported` or `not_applicable` truthfully; never infer total conversion from a
   successful mesh preview.

Research must separately locate source semantics for animation timing, loop metadata,
root motion, attachments, effect emitters, the material pipeline and scene dependency
resolution. A visually plausible guess is not a source semantic.

Keep commercial inputs, extracted code, assets, captures and resolved manifests in
`private/`. Commit only generic contracts, adapters, logic and free fixtures.

## Phase 2 — Wallpaper proposal before generation

Create a proposed `orbite.wallpaper-concept/1` document and validate it with:

```bash
node scripts/verify-wallpaper-concept.mjs /path/to/concept.json
```

Present the user with a concise plan before generating anything. The plan must name:

- the scene and its ambient motion;
- the useful objects discovered in the local inventory and why each fits;
- which interactive object represents each typed session role;
- the `focus` and `open` intents available on each object;
- which 3D objects may be pinned above ordinary workspace windows;
- the automatic menus, system controls, pause/occlusion behavior and known gaps;
- at least one alternative when the corpus supports materially different concepts.

For example, an exploration game may suggest a travelling carrier as ambient motion
and compact companions as session indicators, but those roles are accepted only when
the inventory proves those resources exist. Never bake example names into a contract.

Pause for explicit user acceptance of one proposal. Before acceptance, the concept
status remains `proposed`, its decision remains `pending`, and
`generation_allowed` must be false. A vague “continue” applies only when the proposal
was already shown in the immediately preceding exchange.

## Phase 3 — Generation after the gate

Generation may start only when the verifier returns `generation_allowed: true`.
Convert from immutable local inputs and preserve a receipt for every transformation.
No runtime component may recognize the source game, engine, character, vehicle or
resource filename. New source behavior becomes an adapter capability or remains an
explicit limitation.

Build menu stages from the qualified catalog, relation axes and declared capabilities.
Never duplicate a single item, select the first compatible item silently or create a
category because its name resembles a known game concept.

Every interactive scene object has one stable `instance_id` and one typed
`session_binding`. Appearance, animation and pin state may change without changing
that identity, its route or its external action.

Work in this order; never tune a later layer to compensate for an earlier failure:

1. decode one asymmetric structural fixture and prove coordinates;
2. close all dependencies for the primary scene;
3. materialize complete placement, attachment, effect-origin and hit-region relations;
4. convert geometry/materials, then rigs/animations, then effects/audio/UI;
5. regenerate the same input twice and compare canonical hashes;
6. convert a different witness scene with the same adapter and zero runtime edits;
7. run the candidate in an isolated viewer, never in the installed wallpaper;
8. qualify visual, interaction, session and pause/occlusion matrices;
9. request native activation only after the authoring-run verifier permits it.

An animation entry records source duration, sample domain, authored playback mode,
endpoint policy, root-motion owner and required event markers. Do not infer looping
from clip duration or repeat the last-to-first discontinuity. Effects record source
emitter cardinality and explicit nullable sockets; one source emitter is never cloned
to fill a two-sided runtime representation.

Menus are projections of qualified catalog axes. Their order, labels, previews,
compatibility and reset values are data. A menu cannot contain a choice whose model,
rig, relation row, preview or action is unresolved.

## Pinned 3D object contract

A pin is another presentation of the same logical instance, not a copied session.
The OS connector implements the window level and exclusions for secure/system
surfaces; the renderer supplies pixels and hit regions through portable roles.

- The ordinary pin button toggles persistent visibility for the selected object.
- Right-clicking a pinned object enters `transform-frame` edit mode.
- The frame exposes drag position, bounded size, brightness and opacity.
- `accept` commits all fields atomically; `cancel` restores the complete snapshot.
- `disable` hides that object's pin without deleting its settings or session.
- Settings list every pinnable object, including disabled objects, so each can be
  re-enabled later.
- Pause and confirmed occlusion stop scene simulation. A visible pin invalidates only
  its own dirty region and does not keep the wallpaper scene awake.

Unsupported always-on-top behavior is reported as a connector capability failure; it
must not be simulated with an uncontrolled global input surface.

## Qualification

Run source-relation matrices for every variant-dependent attachment, placement,
effect origin and session representation. Qualify multiple scenes or maps through the
same adapter to expose hidden hardcode. Compare source-oracle and output matrices for
geometry, material appearance, animation timing, effects, audio, UI, interaction,
pause, occlusion and pin editing.

Validate the stage ledger with:

```bash
node scripts/verify-game-theme-authoring-run.mjs /path/to/run.json
```

The required order is input integrity, engine research, inventory closure, coordinate
probe, dependency closure, source relations, deterministic conversion, witness scene,
animation semantics, effect semantics, generated UI, session identity, isolated
runtime, visual matrix, interaction matrix, pause/occlusion, then native activation.

Return `DONE` only when research, accepted concept, conversion receipts, automatic
menus, session identity, pin behavior and visual matrices pass. Otherwise return the
specific unresolved subsystem, its evidence path and the closed gate. Never modify
the active experiment merely to make progress appear visible.
