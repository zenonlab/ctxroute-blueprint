---
name: game-theme-author
description: Research a local game's engine and corpus, propose a source-grounded wallpaper concept for user acceptance, then prepare a portable theme without game-specific runtime hardcode or untracked commercial assets.
metadata:
  blueprint-version: "1.0.0"
  execution-authority: primary-or-orchestrator
---

# Game theme author

Use this skill whenever a new game, map, level or game-derived wallpaper theme is
requested. Do not use it merely to correct an already reproduced defect.

## Phase 1 — Read-only engine and corpus research

Do not generate, convert or modify product assets during this phase.

1. Hash and identify the user's local input without publishing its contents.
2. Inventory archives, scenes, rooms, geometry, materials, textures, animations,
   collisions, placements, effects, audio, UI and behavior data.
3. Research the engine and formats using primary documentation and pinned public
   implementations. Label evidence as official documentation, public implementation,
   local observation or hypothesis. A public viewer is reference or oracle only; it
   is never an asset source or a replacement runtime.
4. Inspect local source tables and metadata first. If a relation is absent, inspect
   locally exported code read-only and derive explicit relation rows with symbols,
   revisions and hashes. Geometry or screenshots remain diagnostic.
5. Evaluate candidate tools by exact version, license, format coverage, fidelity,
   reproducibility and failure behavior. Record rejected tools as well as selected ones.
6. Cover every subsystem required by `orbite.wallpaper-concept/1`. Use `missing`,
   `unsupported` or `not_applicable` truthfully; never infer total conversion from a
   successful mesh preview.

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

Return `DONE` only when research, accepted concept, conversion receipts, automatic
menus, session identity, pin behavior and visual matrices pass. Otherwise return the
specific unresolved subsystem and keep generation or activation closed.
