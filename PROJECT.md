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
  storage.ts  autosave to local storage
tests/        units, kernel (topology, planar, erase, push/pull, lines, shapes),
              commands, precision, measurements box and architecture tests;
              fixtures/ holds a real milestone 1 autosave
reference/    the original Blockout prototype (behavior spec for milestone 1)
```

Data flow: a tool reads the viewport (picking, snapping) and calls `session.preview(...)` for live feedback, or `session.execute(...)` to commit. The session validates the input, runs the pure command, records an undo entry and emits a change event. The app then rebuilds the view and autosaves.

### Layer rules (checked by `tests/architecture.test.ts`)
- The kernel imports nothing outside `src/kernel` except the `earcut` package, uses no DOM globals, and is imported only through `src/kernel/index.ts`.
- Only `src/commands` (and `src/scene`, which loads models) may call kernel mutations (`createModel`, `drawRectangle`, `drawRegularPolygon`, `drawLine`, `pushPull`, `erase`, `extractGeometry`, `transformGeometry`, `mergeGeometry`, `deserialize`). Everything else uses the read-only queries, such as `listFaces`, `listEdges`, `edgeGroup`, `faceMeshes`, `snapPoints`, `bounds`, `solidVolume` and the preview helpers.
- `src/scene` imports only the kernel.
- `src/kernel`, `src/scene`, `src/commands` and `src/units` use no DOM, so commands can run headless for tests, plugins and MCP.

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
JSON, version 3 (milestone 3): a scene of definitions, each holding a version 2 topology model, and the instances placed in them.
```
{ format: 'pushform', version: 3, units: { unit, precision },
  scene: { root: definition id, next,
           definitions: { id: { kind: 'root' | 'group' | 'component', name,
                                model: <version 2 model, below>,
                                instances: { id: { definition, name,
                                  transform: { rotation: [x, y, z, w], translation: [x, y, z],
                                               scale: [1, 1, 1] } } } } } } }

model: { kind: 'topology', version: 2, next,
         vertices: { id: [x, y, z] },
         edges: { id: { v: [a, b], soft?: true, curve?: id } },
         faces: { id: { normal, outer: [vertex ids], holes: [[vertex ids]] } },
         curves: { id: { kind, edges, segments, center, normal, radius } } }
```
Every level is validated on load: unit quaternions, scale exactly [1, 1, 1] until Flip and Scale arrive in milestone 4, instances only of existing non-root definitions, no nesting cycles. **Version 2 documents** (milestone 2) load as the root definition; the conversion is tested against a milestone 2 autosave (`tests/fixtures/milestone2-autosave.json`).

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
| 2026-10-26 | Moving loose geometry stretches what is connected to it; a stretch that would bend a face out of its plane, fold it, run it into other geometry in its plane or land a point on a point is refused (approved: blocked moves). Folding into planar triangles is the first milestone 4 step | Keeps every face flat and the topology valid without an intersection engine. |
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
| 2026-10-26 | Solid volume in Entity Info for a group or component whose own geometry is closed and consistently oriented; none when it holds other groups or components | Cheap to compute exactly; nested solids are a later step. |

## SketchUp parity: shortcuts and modifiers
Our users come from SketchUp, so matching their muscle memory is a product requirement. On a Mac, Option takes the place of Ctrl in every modifier below. The shortcut map and reserved keys live in `src/tools/shortcuts.ts`, and `tests/shortcuts.test.ts` checks them.

**In place now (milestones 2 and 3):**

| Input | Action |
| --- | --- |
| Space | Select |
| M | Move (milestone 3) |
| Q | Rotate (milestone 3) |
| F | Offset (milestone 3) |
| L | Line |
| R | Rectangle |
| C | Circle |
| P | Push/Pull |
| E | Eraser |
| O | Orbit |
| H | Pan |
| Shift+Z | Zoom Extents |
| Middle drag | Orbit |
| Shift + middle drag | Pan |
| Scroll | Zoom (to the cursor) |
| Polygon | No default shortcut, as in SketchUp |
| G | Make Component (milestone 3) |
| Double-click a group or component | Edit it (Select tool) |
| Double-click a face / an edge | The face and its edges / the edge and its faces |
| Triple-click a face or edge | Everything connected to it |
| Drag left to right / right to left | Window (fully inside, solid outline) / crossing (touched, dashed outline) |
| Ctrl+A | Select everything in the open context |
| Esc with nothing selected | Close the group or component being edited |
| Short right click | Context menu (milestone 3) |

- **Select modifiers:** Shift toggles items in and out of the selection, Ctrl adds only, Ctrl+Shift removes only. They apply the same way to faces, edges, groups and components, to clicks and to windows.
- **Selection follows the editing context:** inside a group or component only its own geometry and the groups and components placed in it can be selected; Ctrl+A, windows and triple-clicks stay inside it.
- **Right button:** a short right click without dragging opens the context menu, as in SketchUp; right-clicking something unselected selects it first. A right drag still orbits (and Shift + right drag pans), carried over from the prototype. Ctrl-click on a Mac is a right click.
- **Context menu items:** Make Component (G), Make Group, Edit Group/Component, Close Group/Component (Esc), Explode, Make Unique, Delete, Zoom to selection.
- **Clicking outside** the group or component being edited (on faded geometry or empty space) closes it.

**Reserved for later tools** (never assign them to anything else): M Move, Q Rotate, S Scale, F Offset, A 2-point Arc, B Paint Bucket, T Tape Measure.

- **Move (milestone 3):** Ctrl (Option on a Mac) toggles copying, tapped during the move or held at the first click. After a copy, typing `x5` makes a multiply array (5 copies at the same spacing; `5x` and `*5` too) and `/4` a divide array (the distance split into 4 equal steps). Arrays and distances are amendable like other operations. Arrow keys lock an axis, as in the Line tool. With nothing selected, Move takes the face, edge, group or component under the pointer.

- **Push/Pull (milestone 3):** while pushing, hovering a point, edge or face anywhere else (other groups and components and faded geometry too) ends the face level with it. Double-clicking a face repeats the last push/pull distance on it.
- **Inference order, every tool:** endpoints and midpoints first, then points on edges, then faces or the ground. Points and edges hidden behind faces are not inferred.

- **Rotate (milestone 3):** the protractor lies on the face under the pointer or the ground; arrow keys lock it to the red, green or blue axis before the center is clicked. Click the center, the start of the angle and the end, or type an angle. Angles snap to 15 degree steps near them; points and edges under the pointer give exact angles. Ctrl copies and `x5`, `/4` make arrays, as in Move. A plain number typed after a rotation is an angle in degrees.
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

**Milestone 3** (in progress), on branch `milestone-3`. Done through checkpoint (a):
- **Scene layer and document version 3**, with version 2 conversion.
- **Kernel:** extract, rigid transform and merge (explode, copies), solid volume.
- **Commands:** make group, make component, explode, make unique, rename definition and instance, copy instances, erase instances; nesting.
- **Viewport:** instances drawn from shared geometry with their transforms; editing contexts (double-click to open, Esc or a click outside to close, everything outside faded); picking returns context faces and edges, instances in the context, or geometry outside it; inference across all instances and contexts in world coordinates.
- **Right-click menu** and G for Make Component.
- **Panels:** Entity Info (one group or component: type, editable definition and instance names, copy count, volume; several items: how many of each type, with total area and length) and Outliner (tree, copy counts, click to select, double-click or F2 to rename, right-click menu).
- **Offset tool (added after step 8):** faces (with their holes) and edge chains, sharp corners, curves keep their segment count, amend, double-click repeat, refused when too large.
- **Checkpoint (b) feedback:** rectangles align to turned edges and faces (an improvement over SketchUp), follow a turned group's axes inside it, and lie on slanted faces; Offset offsets holes too.
- **Move testing feedback:** edge and point inference win over faces in every tool; hidden points are not inferred; Push/Pull ends level with points, edges and faces anywhere; double-click repeats the last push/pull.
- **Rotate tool (step 8):** protractor on faces or locked axes, center, start and angle with inference, 15 degree snapping, typed angles and amend, Ctrl copy and arrays; loose geometry turns with the same rules as moving; axes inside groups follow the group.
- **Move tool (step 7):** start and destination with shared inference (Line and Move), typed distance, amend, Ctrl copy, arrays (`x5`, `5x`, `*5`, `/4`), loose geometry that stretches with bending and crossing moves refused.
- **Checkpoint (a) feedback:** double-click, triple-click, window and crossing selection, Ctrl+A; modifiers on groups and components; Make Group and Make Component on mixed selections.
- **Verification:** 522 unit tests pass and the build succeeds; the stress sweeps pass, including the new 3 (extract and merge), 4 (scene commands) and 5 (moving loose geometry, 1000 seeds). Scripted browser checks (not in the repo) cover instances, contexts, snapping to another copy, the menu and the panels.

### Known limitations
- The differences from SketchUp listed above.
- Each operation recomputes its whole plane and an adjacency index. That is fine for typical models; very large models may slow down.
- Undo history is not kept across reloads.
- There is no file open, save or export yet; the only storage is the browser autosave (milestone 3, steps 9 and 10).
- A stretch that would land a point on another point is refused rather than merging the two points (an island that lands on a point does merge).
- While moving loose geometry, its own endpoints and midpoints at the original position are still inference targets (its faces and edges are not).

## Next steps (proposed, not yet approved)
1. File open and save (`.pushform` JSON download and upload) and the first export (glTF or STL, from `faceMeshes`).
2. Move, copy, rotate and offset tools, then components (also needed for imports).
3. Kernel: intersecting faces of different solids, and confirming the box-against-box result in SketchUp (product owner).
4. Inference: parallel, perpendicular and "from point", and a reverse-face command.
5. Arabic locale: catalog, an Arabic-capable font, and an RTL layout pass.
6. Tooling: ESLint and Prettier, browser end-to-end tests in CI, and code-splitting three.js.
7. MCP bridge: expose the command layer to external AI clients (bring-your-own, local).
   - Read-only query commands so external callers can find geometry: list faces with id, center, normal, size and area. Today these queries exist only as kernel functions used inside the app.
   - Every face-creating command now returns the ids of the faces it creates, including push/pull walls and bottoms (done in milestone 2).
   - Face ids: kept across the milestone 2 conversion (see document format). Any future change that cannot keep them must bump the document format version.

## Open questions
- License: GPL or MIT.
- Arabic font choice, since Barlow has no Arabic glyphs.
- Default units: currently meters for every new file. Revisit when woodworking features land, for example a setting or a locale-based default.
- Decimal comma input. Users in many regions type 1,5 for 1.5. Today the parser accepts only a decimal point, and a comma separates values ("600, 400"), so "1,5" is read as two values. Proposed approach: follow the locale's decimal separator, and switch the list separator to ";" when the decimal separator is a comma. Decide during the localization work. No code change yet.
