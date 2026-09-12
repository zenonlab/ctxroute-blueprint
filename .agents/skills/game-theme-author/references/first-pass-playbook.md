# First-pass game theme playbook

This playbook optimizes for a strong first native attempt. It does not promise that an
undocumented engine can be converted perfectly; it prevents known unknowns from being
hidden by downstream tuning.

## Required artifacts

Keep all game content and resolved evidence under one private candidate root. Commit
only generic schemas, adapters, tests and free fixtures.

| Artifact | Purpose | Gate it opens |
| --- | --- | --- |
| input receipt | hashes, size, revision, container identity | input integrity |
| engine dossier | public sources, pinned implementations, selected/rejected tools | engine research |
| corpus index | every resource kind, owner archive and stable ID | inventory closure |
| region scorecard | audio, activities, signatures, staging and route coverage per logical region | concept acceptance |
| coordinate receipt | handedness, axes, units, matrices and asymmetric probe | coordinate probe |
| dependency graph | roots, edges, cycles, resolved and unresolved counts | dependency closure |
| source-relation manifests | complete variant matrices with provenance | source relations |
| deterministic conversion receipt | two fresh outputs with equal canonical hashes | conversion determinism |
| witness-scene receipt | second scene, same adapter, unchanged runtime hash | witness scene |
| animation receipt | timing, playback, endpoints, root motion and events | animation semantics |
| effect receipt | emitter count, sockets, direction, scale, density, color and timing | effect semantics |
| interface receipt | automatic menus, controls, accessibility and compatibility | UI generation |
| session receipt | stable identities and typed focus/open intents | session identity |
| isolated runtime receipt | candidate viewer, exact package/binary hashes | isolated runtime |
| visual qualification | oracle/capture matrix with all declared assertions | visual matrix |
| interaction qualification | clicks, right-click, reset, cancel, pin and native priority | interaction matrix |
| pacing receipt | pause and confirmed occlusion submit no new frames | pause/occlusion |
| active receipt | stopped previous bounded process and one qualified activation | native activation |

## Research order

1. Hash the immutable input and record its exact regional/version identity.
2. Identify engine lineage, renderer, archive graph and runtime scripting model.
3. Pin public implementations by revision and license. Read their parsers and render
   paths; do not treat screenshots, wikis or a web viewer as extraction truth.
4. Build a corpus index without exporting assets. Count archives, scenes, models,
   skeletons, animations, materials, textures, effects, audio, UI, collision,
   placements, routes, cameras and behavior records.
5. Trace dependency roots recursively. A loaded mesh does not prove its material,
   animation, effect, UI or audio dependencies are complete.
6. Establish coordinate and time conventions from format/code evidence, then confirm
   them with an asymmetric probe containing translation, rotation and nonuniform scale.
7. Locate variant relations in source tables or metadata. If absent, inspect locally
   exported source code read-only and materialize every branch with symbol and hash.
8. Only then propose the wallpaper composition and its session objects to the user.

The proposal enumerates every logical region, even when the source represents the
world as rooms, cells, screens, biomes or a single static scene. Each region records a
sourced audio identity, one inventoried primary activity, up to three secondary
activities, environmental motion, a camera cue and at least three signature axes.
Every declared axis has a concrete signature value, and non-silent audio names an
inventoried resource rather than only a descriptive label.
The declared route covers every region exactly once and states whether its boundary is
closed, open or static. An unresolved scorecard is shown to the user and closes
generation; it is never filled with repeated generic ambience.

## Conversion rules

- Preserve hierarchy and local transforms before flattening anything.
- Preserve winding, normals, tangents, vertex colors, UV sets, alpha semantics,
  material stages and texture animation independently.
- Record skeleton topology, bind pose and bone palette. Retargeting is a derived asset
  with an explicit loss report, never a filename match.
- For each clip, record source frame rate/timebase, inclusive/exclusive end semantics,
  playback mode, endpoint continuity, root-motion owner and event markers.
- Build open-axis relation matrices for placements and attachments. No default offset
  may fill a missing cell.
- Preserve effect emitter cardinality. A missing socket is distinct from an explicit
  null socket and from an unsupported effect.
- Generate menu stages from qualified catalog axes and capabilities. The connector and
  renderer must not branch on game, actor, vehicle, outfit or resource names.
- Preserve stable instance/session identity across every appearance change and reset.

## Two-scene universality test

Choose a primary scene for the intended composition and a structurally different
witness scene. The witness should exercise at least one different material, dependency
shape, animation or placement pattern. Convert it by changing candidate data only.

Any runtime edit, new game-name branch, guessed fallback or hand-authored compensation
fails the witness gate and returns ownership to the adapter or canonical contract.

## Visual and interaction matrix

Before native activation, render deterministic views for both scenes across declared
camera, time, variant and behavior-state axes. For visible effects, check visibility,
origin, scale, density, orientation, appearance and timing. For assemblies, check
ground contact, relative scale, attachment, culling, alpha and animation continuity.
The visual matrix also includes every region scorecard and every route transition;
adjacent regions must not reproduce the same audio/activity/staging fingerprint.

Run interactions in the isolated candidate surface: left action, right customization,
empty-space add, reset, atomic cancel/accept, pause/resume, pin edit/disable/enable,
session focus/open, and native-object priority. A synthetic click proves routing only;
native input still needs a platform-specific qualification.

## Activation discipline

Do not overwrite the installed application or active theme during authoring. Once the
first sixteen gates pass, resolve the exact previous PID and artifact hashes, stop only
that owned process, install the qualified candidate atomically, activate once, and
write a new active receipt. If native visual review fails, mark the run failed or
partial and return to the owning layer; do not stack a visual offset in the runtime.

## Failure decisions

- `missing`: source resource or semantic is absent.
- `unsupported`: it exists but the selected adapter cannot preserve it.
- `not_applicable`: evidence proves the subsystem or relation does not apply.
- `blocked`: an external/user prerequisite prevents the next gate.
- `fail`: evidence contradicts the expected gate assertion.

Only `pass` advances. A plausible preview, successful compilation or accepted process
launch is not a substitute for the named evidence.
