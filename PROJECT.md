# Pushform

Free, open-source 3D modeling in the browser, built around push/pull modeling. Draw shapes, push and pull them into solids, and export the result. No account and no install.

Last updated: 2026-10-26.

## Goals
- A fast, precise push/pull modeler that runs as a static web page.
- Target users: architects, hobbyists and woodworkers. Woodworking support is a must-have, not an extra.
- Exact dimensions everywhere: typed sizes in metric or imperial, with snapping.
- Local-first. No backend; models are saved on the user's device, and the app is hosted as a static site.
- Free forever. Any AI use is bring-your-own: MCP through the command layer, later WebMCP. No in-app calls on our API bill. The app must be fully usable without AI.
- Its own name and visual identity. No SketchUp branding, icons or file format at this stage.
- Planned exports: glTF, OBJ, STL, DXF.

## Non-goals
- Photorealistic rendering.
- Parametric CAD with a history tree.
- Sculpting or animation.
- BIM suites.
- Accounts or cloud storage in v1.
- `.skp` import, for now.

## Product decisions
| Decision | Status |
| --- | --- |
| Target users: architects, hobbyists, woodworkers; woodworking is a must-have | Decided |
| Local-first, static hosting, no backend | Decided |
| Free forever; AI only bring-your-own (MCP via the command layer, later WebMCP) | Decided |
| License (GPL or MIT) | **Open.** No license file until decided. |
| Own name and identity; no SketchUp branding, icons or file format | Decided |
| Exports: glTF, OBJ, STL, DXF | Planned |
| No emojis in UI, code, comments, docs or commits | Rule |
| Visual direction: plain, technical; no gradients, glows or stock AI styling | Rule |
| New faces on the ground face up (SketchUp makes them face down) | Decided 2026-10-26, a deliberate improvement |

### Add-on strategy
We build the most important extension-style features ourselves, in this order:
1. **Woodworking:** cut list, sheet and board layout, material presets with grain direction, joinery, exploded views and labels, costing.
2. **Architecture:** section planes, wall and opening tools, 2D plans, and PDF/DXF export.
3. **Advanced modeling:** fillets, solid booleans, follow me, model cleanup.

Everything else comes from a plugin API built on the command layer.

### Roadmap: properties panel (not milestone 2)
A properties panel that shows a selected rectangle's width and depth and lets the user edit them, with a choice of which corner stays fixed. SketchUp does not offer this for plain faces; it is a planned advantage for woodworkers.

### Hardware and import (roadmap)
- Imports become components: one definition, many instances. Imported meshes are reference geometry: movable and snappable, but not push/pull editable. Show simplified versions when zoomed out.
- Formats:
  - v1: OBJ, STL, glTF.
  - v1.1: STEP/IGES via OpenCascade WebAssembly. It is LGPL, which is compatible with both GPL and MIT when used as a separate library, so the license choice does not block STEP import. Ship it as a separately loaded, replaceable module with its license notice.
  - DXF for 2D profiles.
- On import: ask for units when the file has none, show the real size, and set the insertion point and orientation.
- Placement: glue to face, snap to edges, and per-item placement presets.
- Hardware metadata (manufacturer, part number, price, link) feeds a bill of materials alongside the cut list. Later: drilling patterns that cut or mark holes in the host panel.
- Libraries:
  - A personal library on the device.
  - A small starter library of original models.
  - Later, a community library that links to manufacturer downloads instead of re-hosting their files.

## Architecture
```
src/
  kernel/     pure geometry (mm): shared topology, planar engine, push/pull, erase,
              lines, shapes, triangulation, extract and merge; public API in index.ts,
              opaque Model type
  scene/      definitions (each with its own kernel model) and instances with rigid
              transforms; world-space snap points and edges; scene serialization
  commands/   named commands, CommandSession (execute, preview, amend, undo/redo,
              change events), document
  units/      length settings, parsing and formatting (metric and imperial, Intl)
  i18n/       t(), locale and text direction; English catalog in en.ts
  viewport/   three.js renderer, orbit camera, the scene with the open editing context
              (faded outside), face, edge and instance picking, snapping and axis
              inference across instances, previews, snap marker
  tools/      one file per tool: select, line, rectangle, circle, polygon, pushPull,
              erase, orbit, pan (circle and polygon share radial.ts)
  ui/         tool bar, top actions, units menu, status bar, measurements box, intro,
              right-click menu, Entity Info and Outliner
  app.ts      wiring: input events, keyboard, selection, editing context, refresh on
              document change
  export/     STL and GLB writers (pure: kernel and scene only)
  files.ts    open and save on the device: File System Access API, or upload and download
  storage.ts  autosave to local storage (the recovery copy, with the file name)
tests/        units, kernel (topology, planar, erase, push/pull, lines, shapes),
              commands, precision, measurements box and architecture tests;
              fixtures/ holds a real milestone 1 autosave
reference/    the original Blockout prototype (behavior spec for milestone 1)
```

Data flow: a tool reads the viewport (picking, snapping) and calls `session.preview(...)` for live feedback, or `session.execute(...)` to commit. The session validates the input, runs the pure command, records an undo entry and emits a change event. The app then rebuilds the view and autosaves.

### Layer rules (checked by `tests/architecture.test.ts`)
- The kernel imports nothing outside `src/kernel` except the `earcut` package, uses no DOM globals, and is imported only through `src/kernel/index.ts`.
- Only `src/commands` (and `src/scene`, which loads models) may call kernel mutations (`createModel`, `drawRectangle`, `drawRegularPolygon`, `drawLine`, `pushPull`, `erase`, `extractGeometry`, `transformGeometry`, `mergeGeometry`, `deserialize`). Everything else uses the read-only queries, such as `listFaces`, `listEdges`, `edgeGroup`, `faceMeshes`, `snapPoints`, `bounds`, `solidVolume` and the preview helpers.
- `src/scene` imports only the kernel; `src/export` only the kernel and the scene.
- `src/kernel`, `src/scene`, `src/commands`, `src/units` and `src/export` use no DOM, so commands and exports can run headless for tests, plugins and MCP.

### Kernel (milestone 2)
**Data structure: shared topology with edge uses.**
- A **Vertex** is a point.
- An **Edge** joins two vertices and carries `soft` and `curve` data.
- A **Face** has a normal, an outer loop (counter-clockwise around the normal) and holes (clockwise). Each loop is a cycle of shared vertex ids, and every consecutive pair is an existing edge.
- A **Curve** groups the edges of a circle, polygon or (later) arc, and records its kind, segment count, center, normal and radius.

An edge may bound zero faces (a loose line), one, two, or more (a partition inside a solid), which a strict half-edge structure cannot represent. Adjacency is derived and indexed per operation, not stored. Topologies are immutable: a `Draft` edits a working copy and shares unchanged entities with the previous model, so undo snapshots stay cheap.

**Invariants**, checked by `validate()` after every operation in tests:
- Loops are closed and simple with at least 3 vertices, and every loop step has an edge.
- Faces are planar. Outer loops are counter-clockwise and holes clockwise; holes lie inside the outer loop and may touch it at a single vertex.
- There are no duplicate vertices within 1e-3 mm, no duplicate or zero-length edges, and no orphan vertices.
- In every face plane (and the ground), no two edges cross or overlap, and no vertex sits inside an edge.
- Coplanar faces never overlap.
- Curve and edge references agree.

**Planar engine.** All drawing goes through two steps:
1. **Inserting segments into a plane.** Points snap to existing vertices or split an edge they land on. Segments split the edges they cross, and parts that run along existing edges reuse them. Edges from other planes that pass through a segment (a box's vertical edge crossing a ground line) are split with it at the crossing, sharing the new vertex, and drawn edges also split the faces of other planes they lie in.
2. **Rebuilding the plane's faces from its edges.** A region becomes a face when an old face covered it, or when a drawn edge lies on its outer boundary (automatic faces).
   - A region covered by an old face keeps that face's orientation. When an old face splits, its largest piece keeps its id.
   - Edges that do not separate regions (loose or dangling lines) stay as edges.

**Push/pull**, generalized from the prototype rules:
- **Stretch:** a vertex moves (stretching the faces around it) only when every other edge at it is parallel to the push direction and the face's edges at it can stretch. A face that covers only part of a neighbor's edge therefore never drags that neighbor's corners.
- **Walls:** every other edge gets a wall, built through the planar engine in the wall's plane:
  - where the wall overlaps an existing face and the push carves into the solid, that part of the face is cut away (a slot or notch, such as a slot open at the front);
  - where the push adds to the solid beside an existing face, that face stays as the single shared face (a box built against another box);
  - elsewhere the wall is a new face, and it merges into a coplanar neighbor with the same orientation (a tab on a wall).
- **Landing:** the moved face lands in its target plane the same way. On a back-to-back face of the same solid, both are cut away (push through, also when the face touches the opposite face's edge). On a face with the same orientation, they merge.
- **Bottom:** only a lone face (sharing no edge) leaves a bottom behind.
- **Inner faces** stay in place when the outer face is pushed, as in SketchUp; the hole gets walls.
- **Clamping:** stretched faces never collapse, and the face stops at the first parallel face of the same solid ahead of it, so a pocket cannot pass through the bottom.
  - When only stretching keeps a face from reaching a face it partly covers, as when re-pushing a slot to the bottom, the push is redone with walls, so it cuts through instead of stopping short.
  - A face that would cover the opposite face completely (a box top pushed onto its own bottom) stops 1 mm short, so a solid never vanishes by overshooting.
- **Stretch safety:** stretched edges are split where they now cross or touch other geometry. If a stretched vertex would land on an existing vertex, or a stretched face would overlap or run into other geometry in its plane, the push is redone with walls, which the planar engine resolves.
- **Preview:** the live preview runs the same command as the commit, so they always agree.
- **Curves:** walls between consecutive circle or arc segments are joined by soft edges, so a pushed circle shades like a cylinder. Polygons stay faceted. The moved loop gets its own copy of the curve.

**Erase** (SketchUp rules):
- Erasing a face keeps its edges.
- Erasing an edge between exactly two coplanar faces merges them; the larger face keeps its id and orientation. Any other edge takes the faces it bounds with it.
- Any edge of a curve erases the whole curve.
- Straight vertices left between two edges are healed.

**Lines.** A line lying in the ground or a face plane is inserted there, splitting edges and faces. A line in open space snaps through existing vertices and splits an edge it ends on. Faces are rebuilt in the planes containing the line and the planes it spans with the edges meeting it, so closing any planar loop creates a face.

**Triangulation** is in the kernel (earcut). `faceMeshes` provides render-ready triangles with smooth normals across soft edges, which mesh export will reuse.

### Commands
Each command has:
- a namespaced id;
- a translated title;
- a zod input schema (strict, so unknown keys are rejected);
- a pure `run(doc, input)` that returns a new document plus a JSON output, or an error code.

Core commands (geometry commands and the group and component commands take the optional `definitionId` of the editing context):

| Command | Output | Amendable |
| --- | --- | --- |
| `core.drawRectangle` | `faceIds` created | width, depth |
| `core.drawLine` (start, direction, length) | `edgeIds`, `faceIds` | length |
| `core.drawCircle` (center, radius, segments, direction) | `faceIds` | radius, segments (count) |
| `core.drawPolygon` (center, radius, sides, direction) | `faceIds` | radius, sides (count) |
| `core.pushPull` | `distance`, `createdFaceIds`, `removedFaceIds` | distance |
| `core.erase` (faceIds, edgeIds, instanceIds) | `removedFaceIds` | |
| `core.clearModel` | | |
| `core.setDisplayUnits` | | |
| `core.makeGroup` (faceIds, edgeIds, instanceIds) | `definitionId`, `instanceId` | |
| `core.makeComponent` (same, plus an optional name) | `definitionId`, `instanceId` | |
| `core.explode` (instanceIds) | `faceIds`, `instanceIds` moved up | |
| `core.makeUnique` (instanceIds) | `definitionIds` created | |
| `core.renameDefinition`, `core.renameInstance` | | |
| `core.copyInstances` (instanceIds, translation) | `instanceIds` | |
| `core.move` (faceIds, edgeIds, instanceIds, direction, distance) | the moved `faceIds`, `edgeIds`, `instanceIds` | distance |
| `core.moveCopies` (same, plus copies and divide) | the copies' `faceIds`, `edgeIds`, `instanceIds` | distance, array (`x5`, `/4`) |
| `core.rotate` (faceIds, edgeIds, instanceIds, center, axis, angle in degrees) | the turned `faceIds`, `edgeIds`, `instanceIds` | angle |
| `core.rotateCopies` (same, plus copies and divide) | the copies' ids | angle, array |
| `core.offset` (faceId, or edgeIds; distance, positive inward) | `faceIds` created, new `edgeIds` | distance |
| `core.drawRectangle` takes an optional `axis` | the first side's direction (to align to an edge) | |

How the session works:
- `execute` is for typed callers. `executeUnchecked` is for untrusted JSON from plugins, MCP or replay.
- A command that changes nothing returns the same document, and no undo step is recorded.
- History keeps document snapshots plus `{commandId, input}` for logs, macros and replay. It is capped at 150 steps.

Plugins call `registry.register(def)` and extend the typed `CommandMap` through declaration merging.

**Amend last operation.** After a command finishes, typed values replace its amendable inputs, as in SketchUp.
- A command opts in by declaring `amendable` fields: `positive` or `signed`, and kind `length` (the default), `count`, `array` or `angle`. A plain typed number fills an angle field when the command has no length fields. Counts are typed with an `s` suffix, like `48s`. An array field takes `x5` (also `5x`, `*5`) or `/4`, typed on its own: the count goes to the field and the divide choice to its boolean `flag` input.
- Typed lengths fill the length fields in order and counts fill the count fields. Either group may be left out, so typing only `48s` changes only the segment count.
- `CommandSession.amend` re-runs the command from the document before it and replaces that history entry, so it stays one undo step. If the amended command fails, the original result is kept.
- Amending ends when any other command runs, on undo or redo, on load, on a left click in the viewport, and on a tool switch. Navigation keeps it available.
- New tools get it by declaring their fields.

### Document format
`.pushform` files are this JSON, version 4 (milestone 4): a scene of definitions, each holding a version 2 topology model, the instances placed in them, its guides and its annotations (dimensions and text). Version 3 (milestone 3) is the same without guides and annotations and still opens.
```
{ format: 'pushform', version: 4, units: { unit, precision },
  scene: { root: definition id, next,
           definitions: { id: { kind: 'root' | 'group' | 'component', name,
                                model: <version 2 model, below>,
                                instances: { id: { definition, name,
                                  transform: { rotation: [x, y, z, w], translation: [x, y, z],
                                               scale: [1, 1, 1] } } },
                                guides?: { id: { kind: 'line', point, direction }
                                              | { kind: 'point', point } },
                                annotations?: { id: { kind: 'dimension', start: anchor, end: anchor,
                                                      offset: [x, y, z] }
                                                  | { kind: 'text', anchor, leader: [x, y, z], text }
                                                  | { kind: 'screenText', position: [x, y], text } } } } } }

anchor: { point: [x, y, z],
          ref?: { path: [instance ids], definition, a: vertex id, b?: vertex id, t?: 0..1 } }

model: { kind: 'topology', version: 2, next,
         vertices: { id: [x, y, z] },
         edges: { id: { v: [a, b], soft?: true, curve?: id } },
         faces: { id: { normal, outer: [vertex ids], holes: [[vertex ids]] } },
         curves: { id: { kind, edges, segments, center, normal, radius? } } }
```
Every level is validated on load: unit quaternions, scale with no zero component (negative mirrors; milestone 4), instances only of existing non-root definitions, no nesting cycles, guide lines with a non-zero direction (stored as a unit vector), dimension and text anchors with a point and, when attached, a reference whose fraction lies strictly between 0 and 1, screen text positions between 0 and 1. **Version 2 documents** (milestone 2) load as the root definition; the conversion is tested against a milestone 2 autosave (`tests/fixtures/milestone2-autosave.json`).

**Version 1 documents** (milestone 1 autosaves, face-loop models) are converted on load:
- Corners at the same position become one shared vertex, and every loop side becomes a shared edge.
- **Face ids are preserved, along with normals and areas.** Vertices and edges get new ids that never collide with them.
- Seams between coplanar push/pull walls, which version 1 hid, become soft edges.
- The conversion is tested against a real milestone 1 autosave (`tests/fixtures/milestone1-autosave.json`).

**Face ids inside milestone 2:** a face keeps its id while it is moved, stretched or merged into. When it is split, the largest piece keeps the id and the other pieces get new ones.

## Technical decisions
| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-25 | Internal unit is the millimeter (float64) | Suits woodworking tolerances, and 1" = 25.4 mm converts exactly. glTF export will scale by 0.001. |
| 2026-10-25 | Coordinates are Y-up, as in the prototype, three.js and glTF | Avoids a conversion layer in the viewport. Revisit if STL/DXF export needs Z-up; that will be a conversion at export time. |
| 2026-10-25 | New files default to meters with 2 decimals | Matches the prototype (product owner's choice). |
| 2026-10-25 | Display formats: mm, cm, m, decimal inches, fractional inches, feet-inches | Fractional inches added for woodworkers (product owner approved). |
| 2026-10-25 | Display unit and precision are stored per file; changing them is an undoable command | Per-file settings were required; making them a command keeps every document change in one place. |
| 2026-10-25 | Typed input accepts either system with suffixes; a bare number uses the file's unit (inches for imperial files) | Required by the brief. Arabic-Indic digits are normalized now for the later Arabic locale. |
| 2026-10-25 | Rounded displayed values get a leading `~` | Precision matters for woodworking; the user should know when a shown value is not exact. |
| 2026-10-25 | Undo via immutable document snapshots with structural sharing | Simple and robust; kept in milestone 2 with the topology kernel. |
| 2026-10-25 | zod for command input validation | Inputs will come from plugins and MCP as untrusted JSON; zod v4 can also emit JSON Schema for MCP tool definitions. |
| 2026-10-25 | No UI framework; plain TypeScript and DOM | The UI is small, and it matches the prototype. |
| 2026-10-25 | three.js (0.186) set up to look like r128: color management off, linear output, light intensity times PI | Keeps the prototype's colors and shading. |
| 2026-10-25 | Barlow font bundled via @fontsource (OFL) | Local-first: no Google Fonts request. Barlow has no Arabic glyphs (see open questions). |
| 2026-10-25 | Imperial files use a 1 ft grid, 2" snap step and 1/4" drag rounding; metric uses a 1 m grid, 50 mm snap and 10 mm drag rounding | Metric values come from the prototype; imperial values are their closest natural equivalents. |
| 2026-10-25 | Autosave key `pushform.autosave.v1` in local storage | The key is the autosave slot; since milestone 2 it holds version 2 documents. |
| 2026-10-25 | Lengths and coordinates are rounded to 1e-6 mm: command inputs on entry, and coordinates the kernel computes | Imperial input is rarely exact in floating point (24" is 609.5999999999999), and sums drift (304.8 + 609.6 is 914.4000000000001). Kept in milestone 2 for every new vertex. |
| 2026-10-25 | "Amend last operation" lives in the command layer; commands declare amendable fields | One implementation serves every current and future tool, plugins and MCP. |
| 2026-10-26 | Edge-use topology instead of a strict half-edge structure (approved) | SketchUp models need loose edges and edges shared by three or more faces. |
| 2026-10-26 | One vertex tolerance of 1e-3 mm for merging points and for points lying on edges and planes | One number keeps the planar engine consistent; it is far below anything users model. |
| 2026-10-26 | Triangulation moves into the kernel, using earcut (approved, ISC license); it replaces three's ShapeUtils | Needed for export; earcut is the same algorithm three.js uses. |
| 2026-10-26 | Push/pull leaves an unpushed inner face in place (approved) | Matches SketchUp. Milestone 1 carried the inner face along. |
| 2026-10-26 | New faces on the ground face up (approved) | A deliberate improvement over SketchUp, which makes them face down. |
| 2026-10-26 | New faces in a plane with no faces: the largest normal component points the positive way; in a plane with faces they follow those faces | Deterministic and independent of the camera. |
| 2026-10-26 | Automatic faces: a region becomes a face when a drawn edge lies on its outer boundary | Closing a loop creates a face, including when a rectangle closes off an area together with existing edges. A region bounded only by old edges stays empty. |
| 2026-10-26 | Push through only when the face lands fully inside the opposite face; otherwise the push stops 1 mm short | Superseded the same day by the next three rows. |
| 2026-10-26 | Stretch only when every other edge at a moved vertex is parallel to the push direction; otherwise build walls | Testing found slots reaching a box edge dragged the wall's corners (diagonal edges) and the push applied 0 mm. |
| 2026-10-26 | Walls and the landed face go through the planar engine: carving cuts covered faces away, adding beside a face keeps it as the shared face, same-orientation neighbors merge | One rule covers slots, notches, tabs, push-through (including faces touching the opposite face's edge) and boxes built against boxes. |
| 2026-10-26 | A face that would cover its opposite face completely stops 1 mm short | Pushing a box top onto its bottom would otherwise delete the whole solid. |
| 2026-10-26 | Shortcuts and modifiers match SketchUp defaults; Polygon has no shortcut and G is reserved for Make Component; Option replaces Ctrl on a Mac (product owner) | Target users are SketchUp users; matching their muscle memory is a product requirement. |
| 2026-10-26 | A wall built by pushing a face down beside a box merges with the box's coplanar, same-facing wall (approved by the product owner) | Matches SketchUp's automatic merging of coplanar neighbors. Covered by the push-down case of repro A. |
| 2026-10-26 | Segment insertion splits edges from other planes that pass through the segment; a push that stretches into conflicts is redone with walls | Review finding (crossing edges) and randomized push/pull runs. Stretching stays the first choice because it keeps meaning, such as a pocket shrinking as its floor rises; walls are the safe fallback. |
| 2026-10-26 | One undo step per line segment (approved) | Matches SketchUp; amend changes the last segment. |
| 2026-10-26 | Curves group circle and polygon edges; only circle and arc walls get soft edges | Requested: select and erase a curve as one, and shade a pushed circle as a cylinder. A pushed polygon should stay a faceted prism. |
| 2026-10-26 | Circle and polygon radius goes to the corners; the first corner points toward the radius click | Matches SketchUp's default. |
| 2026-10-26 | The measurements box is read-only unless an operation is in progress, the last one can be amended, or the tool takes idle input (a segment count) | Testing feedback: a read-only value looked editable. |
| 2026-10-26 | happy-dom as a dev dependency, enabled per test file | Unit tests for DOM components without a browser. |
| 2026-10-26 | Milestone 3 scene: definitions own their geometry; instances carry a unit quaternion, a translation and a scale fixed at [1, 1, 1] (approved) | Geometry in different definitions never merges. The scale field avoids another format change when Flip and Scale arrive in milestone 4. |
| 2026-10-26 | A new group or component's origin is the minimum corner of the selection's bounding box, axes aligned to the parent (approved) | Predictable, and matches what SketchUp does for a new group. |
| 2026-10-26 | Edges shared between grouped geometry and geometry left behind are copied (approved) | Both sides keep their faces intact. |
| 2026-10-26 | Copying a group shares its geometry until the first edit (approved): the copy gets its own definition that points to the same immutable model | Every group keeps exactly one instance, so editing one copy never changes another. |
| 2026-10-26 | Explode merges through the kernel's planar engine: coplanar regions join, crossing edges split | One engine for drawing and exploding; randomized extract, move and merge runs check the invariants. |
| 2026-10-26 | Inference uses every visible placement in world coordinates, including faded geometry outside the editing context (product owner) | Parts are assembled by snapping to other parts, such as a drawer corner to the carcass's inner edge. |
| 2026-10-26 | Drawing on another group's face draws in its plane, in the open context | Faces of other groups are inference targets; Rectangle, Circle and Polygon take an optional plane normal for this. |
| 2026-10-26 | Selection methods from SketchUp in the Select tool: double- and triple-click, window and crossing, Ctrl+A (product owner, checkpoint (a) feedback) | Selecting whole objects one face at a time missed hidden faces such as a box's bottom. |
| 2026-10-26 | Windows and crossings select hidden items too; a group or component is inside a window when its bounding box is, and a crossing takes it when it touches one of its edges | Matches SketchUp, which selects through the model; the bounding-box rule is the product owner's. |
| 2026-10-26 | Double- and triple-clicks use the browser's click count, which follows the system's double-click time | Separate quick clicks at one spot behave the same as in the rest of the system. |
| 2026-10-26 | Clicks select on release; a press that moves 6 px becomes a window | A drag that starts on a face must not select that face first. |
| 2026-10-26 | Moving loose geometry stretches what is connected to it; a stretch that would bend a face out of its plane, fold it, run it into other geometry in its plane or land a point on a point is refused (approved: blocked moves). Folding into planar triangles is the first milestone 4 step | Keeps every face flat and the topology valid without an intersection engine. The bend refusal is superseded by folding (milestone 4, below). |
| 2026-10-26 | Geometry not connected to anything moves in place and keeps its ids; when it lands on other geometry it is extracted and merged back, so points landing on points join (approved) | The planar engine already merges coplanar faces and splits edges for explode and copies. |
| 2026-10-26 | Move and copy are two commands: `core.move` (amend: distance) and `core.moveCopies` (amend: distance, array) | Arrays only make sense after a copy; typing `x5` after a plain move says the values do not fit. |
| 2026-10-26 | Typed arrays are recognized only when typed on their own | `x` also separates values (`600 x 400`). |
| 2026-10-26 | Previews draw into separate meshes; picking and inference keep using the committed scene, and the Move tool also excludes the selection it moves | Geometry being moved must not catch the pointer, or the destination would run away. |
| 2026-10-26 | Points and edges win over faces in every tool's inference, and hidden points are not inferred (Move testing feedback) | Rectangle, Circle and Polygon snapped only to points and the grid, so an edge under the pointer showed "On face"; a hidden midpoint could capture the pointer through a face. |
| 2026-10-26 | Push/pull infers the level of any point, edge or face under the pointer; hits on faces use the face's exact plane | SketchUp's push-to-surface; float32 mesh hits would leave faces a few millionths of a mm off. |
| 2026-10-26 | Move and Rotate share one kernel operation (a rigid motion of a selection) and one command implementation; arrays are a transform per copy | Rotating loose geometry follows exactly the stretch and refusal rules of moving it. |
| 2026-10-26 | Axis inference and arrow-key locks use the open context's axes | Matches SketchUp, where editing a turned group uses its axes. |
| 2026-10-26 | Offset added to milestone 3, after Rotate (product owner) | Needed for frames, rebates and inlays. |
| 2026-10-26 | Offset offsets every loop of a face, as SketchUp does (product owner, checkpoint (b)): inward shrinks the outer loop and grows the holes, outward the opposite; refused when a loop would collapse or loops would cross or touch; the new loops go through the planar engine, and every region of the offset shape becomes a face | One rule (offset to the left of every loop) covers outer loops and holes, since holes run the other way. |
| 2026-10-26 | Rectangles align to a turned edge or face (product owner); the default rectangle axes are the plane's axes projected into the plane | Drawing on rotated objects followed the world axes and came out skewed; on slanted faces the old axes did not lie in the face. |
| 2026-10-26 | Offset's new loop follows the pointer (distance from the boundary), and clicks finish on release so a double-click can repeat the last offset | Matches SketchUp; measuring from the first click made an offset started in a face's middle go outward. |
| 2026-10-26 | `npm test` starts Vitest through `scripts/vitest.mjs`, from the canonical project path | On Windows a working directory with a lowercase drive letter (VS Code terminals can open as d:\) made Vitest load itself twice; every test file then failed before running a test. |
| 2026-10-26 | Files open and save through the File System Access API where the browser has it (Save writes back to the opened file), otherwise through a file input and a download | Works offline in every browser; nothing leaves the device. |
| 2026-10-26 | A model is unsaved when the session's document is not the one last saved or opened (documents are immutable) | Undoing back to the saved state clears the marker, as in desktop apps. |
| 2026-10-26 | The autosave stays the recovery copy and also remembers the file name and whether it was saved; the file handle is not kept across reloads | After a reload, Save asks where again. |
| 2026-10-26 | STL: binary, millimeters, Z up (a quarter turn about red, no mirroring); every group and component placed | Slicers and CAD tools take Z as up; this is the export-time conversion planned in milestone 1. |
| 2026-10-26 | GLB: our own writer (approved), meters, Y up; the node tree follows the scene and each definition is one mesh shared by its instances; one double-sided default material; checked with the Khronos glTF validator in the tests (dev dependency, Apache-2.0) | Keeps components as instances in other programs; no exporter dependency in the app. |
| 2026-10-26 | Export code loads on demand; the bundle warning limit is 900 kB until three.js is split out | The main bundle (about 800 kB, three.js about 600 kB of it) passed the old 800 kB limit. |
| 2026-10-26 | rebuildPlane first splits edges of its plane that cross or pass through a vertex; a stretch checks the shape of every face it touched | Found by the mixed random run: loose lines are not split against each other while their plane has no face, and a hole could be moved out of its face in one jump. |
| 2026-10-26 | Volumes read in m³ from 0.01 m³ and cm³ below (metric files), ft³ from 1 ft³ and in³ below (imperial files), with at least three significant digits and thousands separators, whatever the file's length precision (product owner) | A millimeter file showed 31716960000 mm³. Only lengths follow the file's precision; Entity Info is the only place volumes appear. |
| 2026-10-26 | Solid volume in Entity Info for a group or component whose own geometry is closed and consistently oriented; none when it holds other groups or components | Cheap to compute exactly; nested solids are a later step. |
| 2026-10-26 | Folding (milestone 4): a stretched face bent out of its plane is triangulated where it was, diagonals are flipped until every fold is a ridge seen from the face's front, and triangles left in one plane join into one piece; the largest piece keeps the face's id. Fold edges are soft only when the face has a soft edge (part of a smooth surface). A fold that would turn a piece over or cross other geometry is refused (`moveCrosses`); `moveBends` is gone | Matches SketchUp 2023 (see "Verified in SketchUp"). |
| 2026-10-26 | Move with nothing selected takes the endpoint under the pointer on its own, so a corner can be moved; Rotate does not (`core.move` and `core.rotate` take `vertexIds`) | SketchUp parity. Rotate's first click places the center, which often snaps to a corner. |
| 2026-10-26 | A move is also checked in every face plane (and the ground) through a moved point | Stress sweep 5 with corners (seed 5441): a moved point landed inside an edge that stayed put. |
| 2026-10-26 | Guides belong to a definition, next to its geometry, in its local coordinates (document version 4); copies of a group keep them, and exploding moves them up to the parent | Guides live in the editing context (product owner); keeping them out of the kernel means they never split or join geometry. |
| 2026-10-26 | Commands: `core.addGuideLine` (through two points), `core.addGuideOffset` (parallel to an edge, amend: distance), `core.addGuidePoint` (amend: distance), `core.addGuideAngle` (the Protractor, amend: angle), `core.deleteGuides` (the open context); `core.erase` takes `guideIds` | One command per way of making a guide, so each amends what was typed. |
| 2026-10-26 | Guide lines are drawn dashed, cut to the part of the line in view (rebuilt when the camera moves); guide points as crosses of constant screen size | Infinite lines cannot be drawn, and lines passing behind the camera did not draw at all. |
| 2026-10-26 | Inference with guides: guide points and intersections (guide with guide, guide with edge, near the pointer) rank with endpoints; points on guide lines come after points on edges | SketchUp's order; a guide line also gives a rectangle its direction, like an edge. |
| 2026-10-26 | The tool bar has two columns of icon buttons in groups (select and erase, draw, edit, construction, view); names are tooltips and accessible labels, shortcut keys stay on the buttons | Product owner (milestone 4 plan): nine tools are coming and one column needed scrolling on a laptop. |
| 2026-10-26 | Tape Measure (T): guides by default, Ctrl (Option) for measuring only; from an edge or guide line a parallel guide, from a point to a point a guide line through both, from a point to anywhere a guide point; a typed distance places the guide and typing again amends it | Product owner (milestone 4 plan), following SketchUp. |
| 2026-10-26 | Protractor (no shortcut, as in SketchUp): center, a point on the base line, then the angle, giving an angled guide line through the center; 15 degree snapping, exact angles on points, edges and guides, typed angles and amend. It shares the protractor with Rotate (`src/tools/protractorGeometry.ts`) | Product owner (milestone 4). Rotate now also takes exact angles from guides. |
| 2026-10-26 | Hiding guides (View menu) is a setting of this device, not of the file; hidden guides are not drawn, picked or snapped to. Delete All Guides acts on the open editing context | The product owner approved these defaults with the milestone 4 plan. |
| 2026-10-27 | Dimensions are annotations of a definition, in its local mm. Each end is an anchor: its point, and a reference to a vertex, or to a fraction of the way between two vertices (an edge's midpoint), through an instance path from that definition | Vertex ids are never reused within a model, so a reference stays right while the vertex lives; two vertices instead of an edge id survive edges being split. |
| 2026-10-27 | The command session brings every anchor up to date after each command that changes the document (previews and amends too), so dimensions follow geometry and undo snapshots hold both. A reference that no longer resolves (made into a group, exploded, rebuilt) attaches again by position, first to a vertex then to an edge; with nothing there the dimension stays where it was, detached | SketchUp 2023 keeps a dimension whose geometry is erased, detached, with its last value (see "Verified in SketchUp"). References name the definition at the end of their path, because ids only mean something within one model. |
| 2026-10-27 | `core.addDimension` takes two points and an offset; each end attaches to the vertex or edge at its point (the context's own geometry first, then nested groups and components). `core.erase` takes `annotationIds`; exploding moves a group's dimensions up | Tools, plugins and MCP clients pass points, not ids; the command finds what they touch. |
| 2026-10-27 | The Dimension tool: two points, or a click along an edge for its ends, then the pointer places the line. It lies in the plane of the face under the pointer when that face holds the measured line, otherwise in the axis plane through the line that faces the view. Values are DOM labels over the canvas (file units and precision), hidden behind faces; lines are drawn like edges, with tick marks | A screen-direction rule cannot tell the planes apart (every direction square to the line projects onto the same screen normal); hovering a face is a direct way to choose. |
| 2026-10-27 | Text: leader text (`core.addText`: a point, which attaches like a dimension end, a leader vector and the text) and screen text (`core.addScreenText`: a position as fractions of the view from its top left corner, held by the open context's definition and shown once however many times it is placed). `core.editText` changes either; writing the same text is no change, so no undo step | Screen text belongs to the open context's definition (approved default). Text is the user's content, so it does not go through `t()`. |
| 2026-10-27 | The Text tool starts a leader with what it points at: a point's coordinates in red, green, blue (our x, -z, y), an edge's length, a face's area, a group's or component's name; a first click on empty space places screen text. The text is written in place in a field over the canvas: Enter or leaving it finishes, Shift+Enter starts a line, Escape drops it. Double-click with Select writes over a text | SketchUp's defaults as far as we know them (listed under "Not verified"). The field takes the focus after the pointer press, whose default action would otherwise take it away again and finish the text at once. |
| 2026-10-27 | Move and Rotate take dimensions and text (`annotationIds`). Attached ends go where their geometry goes; free ends go with the move. The text, and a point on the dimension line, go with the move, and the leader or offset is measured again from the ends: a dimension moved on its own slides square to its measured line, one moved with its geometry keeps its offset, and free text in a selection moves with it. Screen text does not move; copies do not copy dimensions or text yet | Product owner, checkpoint (b) feedback. One rule for every rigid move, so Rotate needs nothing of its own. |
| 2026-10-27 | Make Group and Make Component take the selected dimensions and text into the new definition. References to geometry that went with them name the new definition (extracted geometry keeps its vertex ids); ends on geometry left outside come loose, since a definition's annotations only reach its own geometry and what is nested in it | As in SketchUp (product owner, checkpoint (b) feedback). Copies of the group then carry them, through `duplicateDefinition`. |
| 2026-10-27 | Instance transforms keep rotation, translation and scale (any non-zero scale; negative is a mirror). World placements are affine maps: a nested product can skew, which drawing, picking, inference and export handle; a transform is only needed again when exploding, and `decompose` refuses a skewed one (`explodeWouldSkew`) | Approved with the plan (keep TRS, refuse skew). `compose` stays exact for the rigid moves and turns tools make. |
| 2026-10-27 | Placing geometry with a scale maps face normals through the inverse transpose, reverses face loops under a mirror so faces keep facing outward, scales curve radii under a uniform scale and drops them under a stretch (a circle becomes an ellipse; `radius` is now optional in the topology, which stays version 2) | Explode needs it now; Scale and Flip on loose geometry use the same rules. |
| 2026-10-27 | Export: STL turns each triangle's winding around under a mirrored placement; GLB writes the node's scale and leaves winding to readers, as the glTF spec defines it from the node's determinant. Entity Info multiplies a group's volume by the absolute determinant of its scale | Facets must face outward in either format. |
| 2026-10-27 | Inside a scaled group or component, lengths shown and typed are its own: Push/Pull, Line, Tape Measure, Dimension, Text and the circle and polygon radius measure in the context's coordinates (`Frame.localDistance`) | Approved default: a definition's geometry is edited in its own mm; dimensions placed outside show the scaled length. |
| 2026-10-28 | `core.scale` scales a selection about a point, by one factor in every direction or along one to three axes at right angles. Loose geometry goes through the kernel's `transformSelection` with an affine map: connected geometry stretches and folds as with Move; a negative factor mirrors and reverses the loops of faces that move whole; a circle keeps its radius when its plane scales evenly (scaled by it) and loses it otherwise; an edge shrunk to nothing is refused (`scaleTooSmall`). Instances take `decompose(scale x transform)`, refused when it would skew one (`scaleWouldSkew`) | Plan step 8; the skew refusal is approved decision 2. A cylinder scaled along its axis keeps its circles. |
| 2026-10-28 | Typing after a scale: a plain number is a factor (2, 0.5, -1 mirrors) that replaces the old one, sign and all; a length with units is divided by the selection's size along that direction (the distance the grip moves along, for a uniform scale). One value per direction scaled. Commands can now give their amendable fields per input | As in SketchUp, where 2 means twice and 2m means two meters. |
| 2026-10-28 | Scale tool (S): grips on the selection's box in the context's axes, or on a lone instance's own box (so a turned group scales along its own sides without skewing); flat directions get no grips. Dragged factors are rounded to the two decimals shown; a snap to a point gives the exact factor | Plan step 9. A box in the context's axes around a turned group would need a skew, which is refused (`scaleWouldSkew`). |
| 2026-10-28 | Flip (`core.flip`, right-click Flip along red, green or blue) mirrors the selection about the middle of its box: a lone group or component along its own axis, so it stays where it is; anything else along the context's axis. It is a scale of -1 through the same code as Scale. When a mirror is taken into an instance's transform, the scale signs are chosen to keep its rotation where they can, so a group flipped along green shows -1 on green. A flat face flipped along its normal turns over | Plan step 10, wording as SketchUp's menu. |
| 2026-10-28 | Entity Info shows a group's or component's scale along its red, green and blue axes when it is not 1, and warns "Scaled non-uniformly: its parts are no longer their real size." when it is stretched (a mirror alone is not) | Plan step 10; matters for cut lists later. |

## SketchUp parity: shortcuts and modifiers
Our users come from SketchUp, so matching their muscle memory is a product requirement. On a Mac, Option takes the place of Ctrl in every modifier below. The shortcut map and reserved keys live in `src/tools/shortcuts.ts`, and `tests/shortcuts.test.ts` checks them.

**In place now (milestones 2 and 3):**

| Input | Action |
| --- | --- |
| Space | Select |
| M | Move (milestone 3) |
| Q | Rotate (milestone 3) |
| S | Scale (milestone 4) |
| F | Offset (milestone 3) |
| L | Line |
| R | Rectangle |
| C | Circle |
| P | Push/Pull |
| E | Eraser |
| T | Tape Measure (milestone 4) |
| O | Orbit |
| H | Pan |
| Shift+Z | Zoom Extents |
| Ctrl+O, Ctrl+S, Ctrl+Shift+S | Open, Save, Save As (milestone 3) |
| Ctrl+N | New, where the browser lets a page have it (an installed app); otherwise File, New |
| Middle drag | Orbit |
| Shift + middle drag | Pan |
| Scroll | Zoom (to the cursor) |
| Polygon | No default shortcut, as in SketchUp |
| G | Make Component (milestone 3) |
| Double-click a group or component | Edit it (Select tool) |
| Double-click a face / an edge | The face and its edges / the edge and its faces |
| Triple-click a face or edge | Everything connected to it |
| Drag left to right / right to left | Window (fully inside, solid outline) / crossing (touched, dashed outline) |
| Ctrl+A | Select everything in the open context (guides too, when shown) |
| Esc with nothing selected | Close the group or component being edited |
| Short right click | Context menu (milestone 3) |

- **Select modifiers:** Shift toggles items in and out of the selection, Ctrl adds only, Ctrl+Shift removes only. They apply the same way to faces, edges, groups and components, to clicks and to windows.
- **Selection follows the editing context:** inside a group or component only its own geometry and the groups and components placed in it can be selected; Ctrl+A, windows and triple-clicks stay inside it.
- **Right button:** a short right click without dragging opens the context menu, as in SketchUp; right-clicking something unselected selects it first. A right drag still orbits (and Shift + right drag pans), carried over from the prototype. Ctrl-click on a Mac is a right click.
- **Context menu items:** Make Component (G), Make Group, Edit Group/Component, Close Group/Component (Esc), Explode, Make Unique, Delete, Flip along red, green or blue (a lone group or component: along its own axes, worded "the group's red"; milestone 4), Zoom to selection.
- **Clicking outside** the group or component being edited (on faded geometry or empty space) closes it.

**Reserved for later tools** (never assign them to anything else): A 2-point Arc, B Paint Bucket.

- **Move (milestone 3):** with nothing selected, a corner (endpoint) under the pointer moves on its own (milestone 4), and faces bent out of their plane fold. Ctrl (Option on a Mac) toggles copying, tapped during the move or held at the first click. After a copy, typing `x5` makes a multiply array (5 copies at the same spacing; `5x` and `*5` too) and `/4` a divide array (the distance split into 4 equal steps). Arrays and distances are amendable like other operations. Arrow keys lock an axis, as in the Line tool. With nothing selected, Move takes the face, edge, group or component under the pointer.

- **Push/Pull (milestone 3):** while pushing, hovering a point, edge or face anywhere else (other groups and components and faded geometry too) ends the face level with it. Double-clicking a face repeats the last push/pull distance on it.
- **Inference order, every tool:** endpoints and midpoints first, then points on edges, then faces or the ground. Points and edges hidden behind faces are not inferred.

- **Protractor (milestone 4):** the same protractor as Rotate; click the center, a point on the base line and the angle, or type it, for an angled guide line. No shortcut, as in SketchUp.
- **Rotate (milestone 3):** the protractor lies on the face under the pointer or the ground; arrow keys lock it to the red, green or blue axis before the center is clicked. Click the center, the start of the angle and the end, or type an angle. Angles snap to 15 degree steps near them; points and edges under the pointer give exact angles. Ctrl copies and `x5`, `/4` make arrays, as in Move. A plain number typed after a rotation is an angle in degrees.
- **Scale (milestone 4):** green grips on the selection's bounding box, in the open context's axes, or a lone group's or component's own box. With nothing selected, a click takes the face, edge, group or component under the pointer. A corner grip scales the same in every direction (along the diagonal), an edge middle along two directions, a side middle along one; Shift switches between even and per-direction scaling, and holding Ctrl (Option on a Mac) scales about the center instead of the opposite grip. The grip under the pointer turns red and the status line says what it does. Click and click, or drag; the factor shows with two decimals and is applied as shown, unless the pointer snaps to a point. Type a factor (2, 0.5, -1 mirrors) or a length with units, one value per direction, during the scale or afterwards to amend it.
- **Offset (milestone 3):** click a face and move in or out: the new loop follows the pointer; click again or type a distance, and typing afterwards amends it. A face's holes are offset with it: inward they grow, outward they shrink. With connected edges selected (an open chain or a loop in one plane), those are offset. Straight corners stay sharp; circles and polygons offset as curves with the same segment count. Double-clicking a face repeats the last offset.
- **Axes inside a group or component** are its own axes: arrow-key locks and axis inference follow a turned instance.

**Parity list for later milestones (not built yet):**
- **Push/Pull:** Ctrl creates a new starting face instead of moving the original.
- **Eraser:** Shift hides edges, Ctrl softens and smooths edges.
- **Paint Bucket:** Alt (Cmd on Mac) samples a material.
- **Later:** a settings screen for custom shortcuts.

## Deliberate improvements over SketchUp
- **Ground faces face up.** SketchUp makes them face down.
- **Rectangles align to edges** (checkpoint (b), product owner): a rectangle started on an edge that runs along neither axis, or on a face none of whose edges runs along an axis, follows that edge (or the face's edge nearest the start): its first side runs along the edge and the second across it in the face's plane. Started in empty space, on the ground, or on a face with an edge along an axis, it follows the axes as before (inside a group or component, that group's own axes).
- **Rectangles on slanted faces** get sides that lie on the face; the plane's axes are projected into it.

## Differences from SketchUp
- **Ground faces face up**, deliberately (see above).
- **New faces in a free plane** use a fixed rule (largest normal component positive), not the camera or neighboring solids. There is no "reverse face" command yet.
- **Pushing a whole face onto its opposite face** (a box top onto its bottom) stops 1 mm short. SketchUp deletes the solid.
- **A box built against another box** keeps one shared wall, split where the heights differ. This is the behavior the product owner specified (repros A and B). **Unverified against SketchUp** until the product owner confirms it there.
- **Walls of different solids** that cross each other do not intersect (there is no "intersect faces"). Faces pushed level with a neighbor merge only when they end up adjacent.
- **Inference is simpler.** There are endpoints, midpoints, points on edges, points on faces, the three axes and arrow-key axis locks. Parallel, perpendicular and "from point" inference are not built yet.
- **Erase has no modifiers** yet (Shift hide, Ctrl soften; on the parity list).
- **Push/pull has no "new face" modifier** yet (Ctrl; on the parity list).
- **Right drag orbits**; a short right click opens the context menu (see SketchUp parity). SketchUp has no right-drag orbit.
- **Copying a group** gives the copy its own definition right away (sharing the geometry in memory), instead of SketchUp's shared definition that is made unique on the first edit. The user sees the same behavior.
- **The Outliner** sorts by name and shows the copy count of each component.

## Verified in SketchUp
Checked on 2026-10-26 in SketchUp 2023 (Windows), by scripts run through the Ruby API (`transform_entities`, which applies SketchUp's own geometry rules) in an untitled model, with every change undone afterwards.
- **Folding keeps the surface convex outward.** A moved point folds a face along diagonals chosen so each fold is a ridge seen from the face's front, never a valley:
  - a box-top corner moved up 200 mm: one fold, along the diagonal through the moved corner;
  - a vertex of a flat 12-sided top moved up: fold edges from the moved vertex to all nine non-adjacent vertices (ten triangles);
  - a box's top front edge moved sideways: the side it bulges out of folds through the moved vertex; the side it moves into folds between the moved vertex's two neighbors.
- **A box's top edge moved straight up** gives a sloped top with no fold.
- **Fold edges are plain** (not soft, smooth or hidden), except in a smooth surface: when a cylinder's side walls (between soft edges) fold, the new edges are soft and smooth.
- Moving one vertex of a circle through the API moves the whole circle; folds inside curves appear once the curve is exploded.
- **Dimensions** (checked 2026-10-27, `add_dimension_linear` on box vertices): ends attach to vertices and follow them when the geometry moves (the value updates). Erasing the geometry keeps the dimension, detached, with its last value.

**Not verified** (interactive tool behavior the Ruby API cannot drive); these follow our best knowledge of SketchUp and are for the product owner to check:
- Tape Measure details: what a point-to-point measure creates, and how guide points are made.
- The scope of Delete Guides (the open context or the whole model).
- Leader text defaults (coordinates on a point, length on an edge, area on a face, name on a group or component).
- Arc tangency colors.
- Which plane the Dimension tool places a dimension line in as the pointer moves.
- What a length typed on a Scale corner grip scales.

## Differences from the prototype
- **Bug fix:** pulling a lone face downward built its side walls facing inward. Walls of a lone face now always face outward.
- New units menu (unit and precision) in the top bar.
- Values are shown with unit symbols ("0.60 m") instead of a unit in the label ("Dimensions (m)").
- Typed values accept units and both systems. A bare number uses the file's unit.
- Typed values after a finished operation amend it.
- Since milestone 2:
  - rectangles may overlap or cross faces;
  - pushing an outer face leaves an inner face in place;
  - pockets stop at the bottom or push through;
  - line, circle and polygon tools exist;
  - edges can be selected and erased.
- Brand is Pushform instead of Blockout. Models saved by the prototype itself are not loaded; milestone 1 autosaves are.

## Status
**Milestone 1** (2026-10-25): prototype parity, units, i18n, command layer and amend. Merged into `main` locally; the product owner pushes.

**Milestone 2** (2026-10-26), on branch `milestone-2`:
- **Topology kernel:** shared topology with the invariant checker; overlapping shapes split faces; automatic faces; erase merges and removes faces; generalized push/pull with push-through and clamping at the opposite face; curves and soft edges; triangulation in the kernel.
- **Tools:** line (axis inference, arrow-key locks, edge snapping, typed lengths), circle and polygon (typed radius and counts), rectangle on the new kernel.
- **Selection:** faces and edges, curves as one, SketchUp modifiers (Shift toggles, Ctrl adds, Ctrl+Shift removes; Option on a Mac), and Delete with the erase rules.
- **Shortcuts** match SketchUp defaults (see SketchUp parity).
- **Amend:** for line length, circle radius and segments, polygon radius and sides, as well as rectangle and push/pull.
- **Documents:** version 2 format, with version 1 conversion that keeps face ids.
- **Testing feedback fixed:** overlapping rectangles split faces instead of failing; the measurements box is read-only when there is nothing to type; push/pull on a face covering part of a neighbor's edge (a slot reaching the box edge) builds straight walls and notches the neighbor instead of dragging its corners.
- **Verification:**
  - 329 unit tests pass in about 6 s and the production build succeeds. The randomized rectangle and push/pull runs on horizontal faces (`tests/crossings.test.ts`, about 5.5 s) cover seed 11 for 80 steps, 8 seeds for 40 steps, and the 7 seeds that found bugs. Two longer sweeps of 120 seeds at 60 steps each run with `npm run test:stress` (about 85 s, the two sweeps in parallel); they pass and must pass before a milestone is merged into `main`. Boxes built against boxes follow the behavior the product owner specified (repros A and B in `tests/slots.test.ts`): one shared wall, split where the heights differ. The tests confirm that specification, not SketchUp's behavior, which is still unverified. They include randomized overlapping rectangles (grid-aligned and arbitrary), and randomized slots, notches and tabs on a box, with invariant checks after every step and preview-equals-commit checks.
  - Scripted browser checks (not in the repo) covered: overlaps, pockets and push-through, edge selection and erase, the line tool, circles and polygons, amend, autosave, and loading a milestone 1 autosave.

**Milestone 3** (2026-10-26), on branch `milestone-3`, complete; checkpoints (a), (b) and (c) passed. Merged into `main` and pushed:
- **Scene layer and document version 3**, with version 2 conversion.
- **Kernel:** extract, rigid transform and merge (explode, copies), solid volume.
- **Commands:** make group, make component, explode, make unique, rename definition and instance, copy instances, erase instances; nesting.
- **Viewport:** instances drawn from shared geometry with their transforms; editing contexts (double-click to open, Esc or a click outside to close, everything outside faded); picking returns context faces and edges, instances in the context, or geometry outside it; inference across all instances and contexts in world coordinates.
- **Right-click menu** and G for Make Component.
- **Panels:** Entity Info (one group or component: type, editable definition and instance names, copy count, volume; several items: how many of each type, with total area and length) and Outliner (tree, copy counts, click to select, double-click or F2 to rename, right-click menu).
- **Files (step 9):** New, Open, Save and Save As in a File menu and with Ctrl+O, Ctrl+S, Ctrl+Shift+S (Ctrl+N where allowed); the file name and an unsaved marker in the top bar and the window title; a warning before leaving with unsaved changes; the autosave as the recovery copy.
- **Export (step 10):** binary STL (mm, Z up) and GLB (meters, Y up), both with every group and component placed; the GLB keeps components as shared meshes and passes the Khronos validator.
- **Offset tool (added after step 8):** faces (with their holes) and edge chains, sharp corners, curves keep their segment count, amend, double-click repeat, refused when too large.
- **Checkpoint (b) feedback:** rectangles align to turned edges and faces (an improvement over SketchUp), follow a turned group's axes inside it, and lie on slanted faces; Offset offsets holes too.
- **Move testing feedback:** edge and point inference win over faces in every tool; hidden points are not inferred; Push/Pull ends level with points, edges and faces anywhere; double-click repeats the last push/pull.
- **Rotate tool (step 8):** protractor on faces or locked axes, center, start and angle with inference, 15 degree snapping, typed angles and amend, Ctrl copy and arrays; loose geometry turns with the same rules as moving; axes inside groups follow the group.
- **Move tool (step 7):** start and destination with shared inference (Line and Move), typed distance, amend, Ctrl copy, arrays (`x5`, `5x`, `*5`, `/4`), loose geometry that stretches with bending and crossing moves refused.
- **Checkpoint (a) feedback:** double-click, triple-click, window and crossing selection, Ctrl+A; modifiers on groups and components; Make Group and Make Component on mixed selections.
- **Acceptance test** (`tests/acceptance.test.ts`): a carcass group (800 x 500 x 720 mm, open front, 18 mm panels, made with Offset and Push/Pull), a drawer component placed three times with a move-copy array (one copy, then `x2` typed), three front groups, and the middle drawer with its front pulled open 300 mm; saved and reopened (file and autosave) and compared, edited after reopening, and exported (STL, and GLB through the Khronos validator).
- **Verification:**
  - 560 unit tests pass in about 9 s, and the production build succeeds.
  - `npm run test:stress` passes: six sweeps, 1890 seeds, about 4 minutes. New in milestone 3: 3 (extract and merge), 4 (scene commands), 5 (moving and turning loose geometry, 1000 seeds) and 6 (every milestone 3 command mixed, with amend, undo and redo and a save and open after every step, 200 seeds).
  - Sweeps 5 and 6 found four kernel bugs, all fixed with the failing seeds pinned in `npm test`: a corner landing on a vertex during a stretch, a hole moved out of its face in one jump, and loose lines crossing in a plane that later got a face.
  - Scripted browser checks (not in the repo) cover instances and contexts, snapping to other instances and faded geometry, the menu and panels, selection, Move, Rotate, Offset, push to surface, rectangle alignment, files and export.

**Milestone 4** (in progress, started 2026-10-26), on branch `milestone-4`: precise furniture and architectural work. The product owner could rebuild the cabinet carcass and dividers but had no way to mark exact positions for dividers and shelves, and no proper rounded tops. Scope, as specified by the product owner:
1. **Folding** (first)
   - A Move or Rotate of loose geometry that would bend a face out of its plane folds that face into planar pieces along a diagonal, as SketchUp does, instead of being refused. Moving a box's top edge up makes a sloped top; moving a corner makes folded faces.
   - Fold edges are soft (hidden, smooth shading) only where SketchUp makes them so; otherwise visible.
   - Moves that would cross or overlap other geometry stay refused for now, with the existing message.
2. **Tape Measure** (T)
   - Click two points to measure the distance; the measurements box shows it.
   - Click and drag from an edge to create a guide line parallel to it; type a distance for an exact offset. Click and drag from a point to create a guide point. Amend works.
   - Click a point and then a second point with nothing under the first click to create a guide line between them (SketchUp behavior where applicable).
   - Guides are snap targets for every tool, including intersections between guides and between guides and edges.
   - Guides live in the current editing context, can be selected and erased, hidden and shown (View menu or a toggle), and are saved in the file. "Delete all guides" in the menu.
   - Guide lines draw as dashed, infinite lines; guide points as small crosses.
3. **Protractor**
   - Pick a center and a base direction, then an angle, to create an angled guide line; typed angles and 15 degree snapping; amend works.
4. **Dimensions and Text**
   - Linear dimensions between two points or along an edge, offset to a side by a drag, showing the length in the file's units and precision.
   - Dimensions attached to geometry follow it when it moves or is edited, and update their value.
   - Text labels: a leader line from a point to a text box, editable. Screen text with no leader.
   - Dimensions and text are saved in the file, selectable, erasable, and live in the current editing context.
5. **Scale** (S) **and Flip**
   - Scale: select geometry or instances, drag a grip on the bounding box (corner grips scale uniformly, edge and face grips along one or two axes), or type a factor (2, 0.5) or a target length with units (600mm). Ctrl scales about the center. Amend works.
   - Scaling a group or component instance from outside uses the instance's scale field. Scaling geometry inside a definition changes the definition.
   - Flip: right-click Flip Along red, green or blue. On instances it flips the scale sign (a mirrored instance of the same definition); on loose geometry it mirrors the geometry and keeps faces facing outward.
   - Mirrored and scaled instances render, pick, snap, export and report volume correctly.
   - Entity Info shows a warning when an instance is scaled non-uniformly, since its parts no longer match their real size (this matters for future cut lists).
6. **Arcs**
   - 2-Point Arc (A): two endpoints, then the bulge; typed bulge or radius; segment count with the "s" suffix. Tangent inference to connected edges (the arc turns cyan when tangent, as in SketchUp).
   - Arc (center, start, end) and 3-Point Arc, and Pie (closed pie-shaped face).
   - Arcs are curves like circles: one selection, soft edges between walls when pushed.
   - Rounded corner workflow: draw a rectangle, draw tangent arcs at its corners, erase the corner edges, and get one face that push/pulls into a rounded panel.

Checkpoints for the product owner's manual testing: (a) after folding, Tape Measure and Protractor; (b) after Dimensions and Text; (c) after Scale, Flip and arcs.

Progress (2026-10-27): checkpoints (a) and (b) passed. Done since: dimensions (step 5), text (step 6), moving and grouping them (checkpoint (b) feedback), scaled and mirrored instances (step 7). 671 unit tests pass and the build succeeds.

Progress (2026-10-26): ready for checkpoint (a). Done: folding (with single corners moved by Move), guides (data, drawing, selection, inference, View menu), Tape Measure and the two-column tool bar, Protractor. 622 unit tests pass and the build succeeds; stress sweeps 5 (1500 seeds, with corners) and 6 pass after folding. The mixed random run gets folding, scale, flip and arcs in step 13.

Decisions approved for milestone 4 (2026-10-26, product owner):
- **Tape Measure follows SketchUp:** guides are created by default (the cursor shows a +) and Ctrl toggles measure-only. From an edge: a guide line parallel to it, at the pointer's offset or a typed one. From a point to another point: a guide line through both. From a point to anywhere else: a guide point there. The measurements box always shows the distance.
- **Instances keep rotation, translation and scale** (scale may be negative or non-uniform). An operation that would skew one instance is refused with a message: non-uniform scale along axes that are not the instance's own, or exploding a non-uniformly scaled group with turned groups inside. Uniform scale and Flip always work.
- **SketchUp behavior is checked in SketchUp itself** (through the SketchUp connection, in a new empty model) where it is uncertain; results are listed under "Verified in SketchUp".
- **The tool bar has two columns** of grouped buttons; labels are tooltips and shortcut keys stay on the buttons.

### Known limitations
- The differences from SketchUp listed above.
- Each operation recomputes its whole plane and an adjacency index. That is fine for typical models; very large models may slow down.
- Undo history is not kept across reloads.
- In a normal browser tab, Ctrl+N opens a browser window; New is in the File menu. Without the File System Access API (Firefox, Safari), every save is a download.
- Export covers STL and GLB; OBJ and DXF are next steps. Edges without faces are not exported.
- A stretch that would land a point on another point is refused rather than merging the two points (an island that lands on a point does merge).
- While moving loose geometry, its own endpoints and midpoints at the original position are still inference targets (its faces and edges are not).

## Next steps (proposed, not yet approved)
1. **After milestone 4** (out of its scope):
   1. **Tags** (layers) for showing and hiding parts.
   2. **Materials** (the Paint Bucket, B), carried into GLB export.
   3. **Solid tools**: union, subtract and intersect for groups and components that are solids, and solid volume for groups holding other groups.
   4. **Hardware import**: manufacturer models (STEP or glTF) placed as components.
   5. **OBJ and DXF export.**
   6. **Intersecting moved geometry** with what it lands on.
2. A stretch that lands a point on another point merges the two instead of being refused.
3. **Dimension text** (product owner, checkpoint (b) feedback): replace a dimension's value with your own text or add to it, with `<>` standing for the measured length, as in SketchUp.
4. **Copying dimensions and text** with Move and Rotate copies, as SketchUp does.
5. Kernel: intersecting faces of different solids, and confirming the box-against-box result in SketchUp (product owner).
6. Inference: parallel, perpendicular and "from point", and a reverse-face command.
7. Arabic locale: catalog, an Arabic-capable font, and an RTL layout pass.
8. Tooling: ESLint and Prettier, browser end-to-end tests in CI, and code-splitting three.js (the main bundle is about 800 kB).
9. MCP bridge: expose the command layer to external AI clients (bring-your-own, local).
   - Read-only query commands so external callers can find geometry: list faces with id, center, normal, size and area. Today these queries exist only as kernel functions used inside the app.
   - Every face-creating command now returns the ids of the faces it creates, including push/pull walls and bottoms (done in milestone 2).
   - Face ids: kept across the milestone 2 conversion (see document format). Any future change that cannot keep them must bump the document format version.

## Open questions
- License: GPL or MIT.
- Arabic font choice, since Barlow has no Arabic glyphs.
- Default units: currently meters for every new file. Revisit when woodworking features land, for example a setting or a locale-based default.
- Decimal comma input. Users in many regions type 1,5 for 1.5. Today the parser accepts only a decimal point, and a comma separates values ("600, 400"), so "1,5" is read as two values. Proposed approach: follow the locale's decimal separator, and switch the list separator to ";" when the decimal separator is a comma. Decide during the localization work. No code change yet.
