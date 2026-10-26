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
              lines, shapes, triangulation; public API in index.ts, opaque Model type
  commands/   named commands, CommandSession (execute, preview, amend, undo/redo,
              change events), document
  units/      length settings, parsing and formatting (metric and imperial, Intl)
  i18n/       t(), locale and text direction; English catalog in en.ts
  viewport/   three.js renderer, orbit camera, face and edge picking, snapping and
              axis inference, previews, snap marker
  tools/      one file per tool: select, line, rectangle, circle, polygon, pushPull,
              erase, orbit, pan (circle and polygon share radial.ts)
  ui/         tool bar, top actions, units menu, status bar, measurements box, intro
  app.ts      wiring: input events, keyboard, selection, refresh on document change
  storage.ts  autosave to local storage
tests/        units, kernel (topology, planar, erase, push/pull, lines, shapes),
              commands, precision, measurements box and architecture tests;
              fixtures/ holds a real milestone 1 autosave
reference/    the original Blockout prototype (behavior spec for milestone 1)
```

Data flow: a tool reads the viewport (picking, snapping) and calls `session.preview(...)` for live feedback, or `session.execute(...)` to commit. The session validates the input, runs the pure command, records an undo entry and emits a change event. The app then rebuilds the view and autosaves.

### Layer rules (checked by `tests/architecture.test.ts`)
- The kernel imports nothing outside `src/kernel` except the `earcut` package, uses no DOM globals, and is imported only through `src/kernel/index.ts`.
- Only `src/commands` may call kernel mutations (`createModel`, `drawRectangle`, `drawRegularPolygon`, `drawLine`, `pushPull`, `erase`, `deserialize`). Everything else uses the read-only queries, such as `listFaces`, `listEdges`, `edgeGroup`, `faceMeshes`, `snapPoints`, `bounds` and the preview helpers.
- `src/commands` and `src/units` use no DOM, so commands can run headless for tests, plugins and MCP.

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

Core commands:

| Command | Output | Amendable |
| --- | --- | --- |
| `core.drawRectangle` | `faceIds` created | width, depth |
| `core.drawLine` (start, direction, length) | `edgeIds`, `faceIds` | length |
| `core.drawCircle` (center, radius, segments, direction) | `faceIds` | radius, segments (count) |
| `core.drawPolygon` (center, radius, sides, direction) | `faceIds` | radius, sides (count) |
| `core.pushPull` | `distance`, `createdFaceIds`, `removedFaceIds` | distance |
| `core.erase` (faceIds, edgeIds) | `removedFaceIds` | |
| `core.clearModel` | | |
| `core.setDisplayUnits` | | |

How the session works:
- `execute` is for typed callers. `executeUnchecked` is for untrusted JSON from plugins, MCP or replay.
- A command that changes nothing returns the same document, and no undo step is recorded.
- History keeps document snapshots plus `{commandId, input}` for logs, macros and replay. It is capped at 150 steps.

Plugins call `registry.register(def)` and extend the typed `CommandMap` through declaration merging.

**Amend last operation.** After a command finishes, typed values replace its amendable inputs, as in SketchUp.
- A command opts in by declaring `amendable` fields: `positive` or `signed`, and kind `length` (the default) or `count`. Counts are typed with an `s` suffix, like `48s`.
- Typed lengths fill the length fields in order and counts fill the count fields. Either group may be left out, so typing only `48s` changes only the segment count.
- `CommandSession.amend` re-runs the command from the document before it and replaces that history entry, so it stays one undo step. If the amended command fails, the original result is kept.
- Amending ends when any other command runs, on undo or redo, on load, on a left click in the viewport, and on a tool switch. Navigation keeps it available.
- New tools get it by declaring their fields.

### Document format
JSON, version 2:
```
{ format: 'pushform', version: 2, units: { unit, precision },
  model: { kind: 'topology', version: 2, next,
           vertices: { id: [x, y, z] },
           edges: { id: { v: [a, b], soft?: true, curve?: id } },
           faces: { id: { normal, outer: [vertex ids], holes: [[vertex ids]] } },
           curves: { id: { kind, edges, segments, center, normal, radius } } } }
```
Both levels are validated on load.

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
| 2026-10-26 | A wall built by pushing a face down beside a box merges with the box's coplanar, same-facing wall (approved by the product owner) | Matches SketchUp's automatic merging of coplanar neighbors. Covered by the push-down case of repro A. |
| 2026-10-26 | Segment insertion splits edges from other planes that pass through the segment; a push that stretches into conflicts is redone with walls | Review finding (crossing edges) and randomized push/pull runs. Stretching stays the first choice because it keeps meaning, such as a pocket shrinking as its floor rises; walls are the safe fallback. |
| 2026-10-26 | One undo step per line segment (approved) | Matches SketchUp; amend changes the last segment. |
| 2026-10-26 | Curves group circle and polygon edges; only circle and arc walls get soft edges | Requested: select and erase a curve as one, and shade a pushed circle as a cylinder. A pushed polygon should stay a faceted prism. |
| 2026-10-26 | Circle and polygon radius goes to the corners; the first corner points toward the radius click | Matches SketchUp's default. |
| 2026-10-26 | The measurements box is read-only unless an operation is in progress, the last one can be amended, or the tool takes idle input (a segment count) | Testing feedback: a read-only value looked editable. |
| 2026-10-26 | happy-dom as a dev dependency, enabled per test file | Unit tests for DOM components without a browser. |

## Differences from SketchUp
- **Ground faces face up**, deliberately. SketchUp makes them face down.
- **New faces in a free plane** use a fixed rule (largest normal component positive), not the camera or neighboring solids. There is no "reverse face" command yet.
- **Pushing a whole face onto its opposite face** (a box top onto its bottom) stops 1 mm short. SketchUp deletes the solid.
- **A box built against another box** keeps one shared wall, split where the heights differ. This is the behavior the product owner specified (repros A and B). **Unverified against SketchUp** until the product owner confirms it there.
- **Walls of different solids** that cross each other do not intersect (there is no "intersect faces"). Faces pushed level with a neighbor merge only when they end up adjacent.
- **Inference is simpler.** There are endpoints, midpoints, points on edges, points on faces, the three axes and arrow-key axis locks. Parallel, perpendicular and "from point" inference are not built yet.
- **Erase has no modifiers** (no hide or soften while erasing).
- **Push/pull has no "new face" modifier** (SketchUp's Ctrl).

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
- **Selection:** faces and edges, curves as one, Shift to add or remove, and Delete with the erase rules.
- **Amend:** for line length, circle radius and segments, polygon radius and sides, as well as rectangle and push/pull.
- **Documents:** version 2 format, with version 1 conversion that keeps face ids.
- **Testing feedback fixed:** overlapping rectangles split faces instead of failing; the measurements box is read-only when there is nothing to type; push/pull on a face covering part of a neighbor's edge (a slot reaching the box edge) builds straight walls and notches the neighbor instead of dragging its corners.
- **Verification:**
  - 320 unit tests pass in about 6 s and the production build succeeds. The randomized rectangle and push/pull runs on horizontal faces (`tests/crossings.test.ts`, about 5.5 s) cover seed 11 for 80 steps, 8 seeds for 40 steps, and the 7 seeds that found bugs. Two longer sweeps of 120 seeds at 60 steps each run with `npm run test:stress` (about 85 s, the two sweeps in parallel); they pass and must pass before a milestone is merged into `main`. Boxes built against boxes follow the behavior the product owner specified (repros A and B in `tests/slots.test.ts`): one shared wall, split where the heights differ. The tests confirm that specification, not SketchUp's behavior, which is still unverified. They include randomized overlapping rectangles (grid-aligned and arbitrary), and randomized slots, notches and tabs on a box, with invariant checks after every step and preview-equals-commit checks.
  - Scripted browser checks (not in the repo) covered: overlaps, pockets and push-through, edge selection and erase, the line tool, circles and polygons, amend, autosave, and loading a milestone 1 autosave.

### Known limitations
- The differences from SketchUp listed above.
- Each operation recomputes its whole plane and an adjacency index. That is fine for typical models; very large models may slow down.
- Undo history is not kept across reloads.
- There is no file open, save or export yet; the only storage is the browser autosave.
- No move, copy, rotate, offset or components yet.

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
