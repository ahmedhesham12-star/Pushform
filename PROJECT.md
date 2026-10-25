# Pushform

Free, open-source 3D modeling in the browser, built around push/pull modeling. Draw shapes, push and pull them into solids, and export the result. No account and no install.

Last updated: 2026-10-25.

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

### Add-on strategy
We build the most important extension-style features ourselves, in this order:
1. **Woodworking:** cut list, sheet and board layout, material presets with grain direction, joinery, exploded views and labels, costing.
2. **Architecture:** section planes, wall and opening tools, 2D plans, and PDF/DXF export.
3. **Advanced modeling:** fillets, solid booleans, follow me, model cleanup.

Everything else comes from a plugin API built on the command layer.

### Hardware and import (roadmap, not milestone 1)
- Imports become components: one definition, many instances. Imported meshes are reference geometry: movable and snappable, but not push/pull editable. Show simplified versions when zoomed out.
- Formats:
  - v1: OBJ, STL, glTF.
  - v1.1: STEP/IGES via OpenCascade WebAssembly. It is LGPL, so check license compatibility before release.
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
  kernel/     pure geometry (mm), no three.js or DOM; public API in index.ts, opaque Model type
  commands/   named commands, CommandSession (execute, preview, undo/redo, change events), document
  units/      length settings, parsing and formatting (metric and imperial, Intl)
  i18n/       t(), locale and text direction; English catalog in en.ts
  viewport/   three.js renderer, orbit camera, picking, snapping, previews, snap marker
  tools/      one file per tool: select, rectangle, pushPull, erase, orbit, pan
  ui/         tool bar, top actions, units menu, status bar, measurements box, intro
  app.ts      wiring: input events, keyboard, refresh on document change
  storage.ts  autosave to local storage
tests/        units, kernel, commands and architecture tests
reference/    the original Blockout prototype (behavior spec for milestone 1)
```

Data flow: a tool reads the viewport (picking, snapping) and calls `session.preview(...)` for live feedback, or `session.execute(...)` to commit. The session validates the input, runs the pure command, records an undo entry and emits a change event. The app then rebuilds the view and autosaves.

### Layer rules (checked by `tests/architecture.test.ts`)
- The kernel imports nothing outside `src/kernel`, uses no DOM globals, and is imported only through `src/kernel/index.ts`.
- Only `src/commands` may call kernel mutations. Everything else uses the read-only queries (`listFaces`, `getFace`, `faceArea`, `renderEdges`, `snapPoints`, `bounds`, `planeAxes`, `previewRectangle`).
- `src/commands` and `src/units` use no DOM, so commands can run headless for tests, plugins and MCP.

### Commands
Each command has:
- a namespaced id;
- a translated title;
- a zod input schema (strict, so unknown keys are rejected);
- a pure `run(doc, input)` that returns a new document plus a JSON output, or an error code.

Core commands:
- `core.drawRectangle`
- `core.pushPull`
- `core.deleteFace`
- `core.clearModel`
- `core.setDisplayUnits`

How the session works:
- `execute` is for typed callers. `executeUnchecked` is for untrusted JSON from plugins, MCP or replay.
- A command that changes nothing returns the same document, and no undo step is recorded.
- History keeps document snapshots plus `{commandId, input}` for logs, macros and replay. It is capped at 150 steps.

Plugins call `registry.register(def)` and extend the typed `CommandMap` through declaration merging.

**Amend last operation.** After a command finishes, typed values replace its amendable inputs, as in SketchUp.
- A command opts in by declaring `amendable` fields, for example `[{ key: 'width', mode: 'positive' }, { key: 'depth', mode: 'positive' }]`.
- Typed values are magnitudes applied in the original direction. In `signed` mode (distances), a negative value reverses the direction.
- `CommandSession.amend(values)` re-runs the command from the document before it and replaces that history entry, so it stays one undo step. If the amended command fails, the original result is kept.
- Amending ends when any other command runs, on undo or redo, on load, or when the app calls `clearAmend()`. The app calls it on a left click in the viewport and on a tool switch. Navigation keeps it available.
- Core amendable commands: `core.drawRectangle` (width, depth) and `core.pushPull` (distance). Future tools such as line, move, rotate, offset and arrays get it by declaring their fields.

### Document format
JSON: `{ format: 'pushform', version: 1, units: { unit, precision }, model: { kind: 'face-loop', version: 1, next, faces } }`. Both levels are validated on load.

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
| 2026-10-25 | Undo via immutable document snapshots with structural sharing | Same model as the prototype, simple and robust. Milestone 2 can move to inverse operations behind the same session API. |
| 2026-10-25 | zod for command input validation | Inputs will come from plugins and MCP as untrusted JSON; zod v4 can also emit JSON Schema for MCP tool definitions. |
| 2026-10-25 | No UI framework; plain TypeScript and DOM | The UI is small, and it matches the prototype. |
| 2026-10-25 | three.js (0.186) set up to look like r128: color management off, linear output, light intensity times PI | Keeps the prototype's colors and shading. |
| 2026-10-25 | Barlow font bundled via @fontsource (OFL) | Local-first: no Google Fonts request. Barlow has no Arabic glyphs (see open questions). |
| 2026-10-25 | Triangulation stays in the viewport (three ShapeUtils) | Rendering-only in milestone 1. It moves to the kernel when mesh export arrives. |
| 2026-10-25 | Imperial files use a 1 ft grid, 2" snap step and 1/4" drag rounding; metric uses a 1 m grid, 50 mm snap and 10 mm drag rounding | Metric values come from the prototype; imperial values are their closest natural equivalents. |
| 2026-10-25 | Autosave key `pushform.autosave.v1` in local storage | Same behavior as the prototype; there is no file open or save yet. |
| 2026-10-25 | Lengths and coordinates are rounded to 1e-6 mm: command inputs on entry (zod `length` and `point3` schemas), and coordinates the kernel computes from them (rectangle corners, moved points) | Imperial input is rarely exact in floating point (24" is 609.5999999999999), and sums drift (304.8 + 609.6 is 914.4000000000001). Rounding stores equal decimals as identical numbers. Rounding only the inputs would not be enough, because of the sums. |
| 2026-10-25 | "Amend last operation" lives in the command layer; commands declare amendable fields | Requested after testing (SketchUp behavior). One implementation serves every current and future tool, plugins and MCP. |

## Differences from the prototype
- **Bug fix:** pulling a lone face downward built its side walls facing inward, which showed the back-face color from outside. Walls of a lone face now always face outward. Covered by a kernel test.
- New units menu (unit and precision) in the top bar.
- Values are shown with unit symbols ("0.60 m") instead of a unit in the label ("Dimensions (m)").
- Typed values accept units and both systems. A bare number uses the file's unit.
- Typed values after a rectangle or push/pull is finished amend that operation (the prototype ignored them). After a command, the measurements box shows the values it would amend.
- Brand is Pushform instead of Blockout; the intro text mentions typed units.
- The autosave key and format changed, so models saved by the prototype are not loaded.

## Status (milestone 1, 2026-10-25)
Done on branch `milestone-1`:
- The project is set up with strict TypeScript, Vite, Vitest and the current three.js.
- Behavior is at parity with the prototype:
  - rectangle tool, on the ground and inside faces (cutting holes)
  - push/pull: stretches perpendicular neighbors, adds walls on open edges, leaves a bottom behind on lone faces, carries inset faces
  - clamping
  - endpoint and midpoint snapping
  - typed exact dimensions
  - select (with area), erase, Delete key
  - orbit, pan, zoom to cursor, zoom to fit
  - undo and redo
  - front and back face colors
  - autosave
  - light and dark themes
- Units module with parsing and formatting tests in both systems.
- Command layer with undo/redo tests and plugin registration.
- Architecture test enforcing the layer rules.
- Amend last operation for rectangle and push/pull, through the command layer.
- Verification: 162 unit tests pass and the production build succeeds. A scripted browser smoke test (not in the repo) drew, pushed, cut a pocket, used undo/redo, deleted, switched units and reloaded, with no console errors.

### Known limitations (inherited from the prototype)
- Rectangles must sit fully inside a face; splitting a face along an edge is not implemented.
- A pocket can be pushed through the bottom of a solid. Only upward movement of a pocket floor is clamped.
- Undo history is not kept across reloads.
- No file open, save or export yet; the only persistence is the browser autosave.
- No line tool, move, copy or components yet.

## Next steps (proposed, not yet approved)
1. Milestone 2: half-edge kernel behind the current `src/kernel/index.ts` API, with edge splitting and rectangles that touch or cross face edges.
2. File open and save (`.pushform` JSON download and upload) and the first export (glTF or STL).
3. Line tool, move and copy, and components (also needed for imports).
4. Arabic locale: catalog, an Arabic-capable font, and an RTL layout pass.
5. Tooling: ESLint and Prettier, browser end-to-end tests in CI, and code-splitting three.js.

## Open questions
- License: GPL or MIT. This also affects whether the LGPL OpenCascade build can ship.
- Arabic font choice, since Barlow has no Arabic glyphs.
- Default units: currently meters for every new file. Revisit when woodworking features land, for example a setting or a locale-based default.
