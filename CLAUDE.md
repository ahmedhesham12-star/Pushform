# Pushform: working rules

Browser-based push/pull 3D modeler. TypeScript (strict), Vite, three.js, Vitest, npm. Read PROJECT.md for goals, architecture and decisions.

## Commands
- `npm install`: install dependencies
- `npm run dev`: dev server (http://localhost:5173)
- `npm test`: unit and architecture tests (Vitest, run once). The test scripts start Vitest through `scripts/vitest.mjs` from the canonical project path; with a lowercase drive letter (d:\) every test file failed on Windows.
- `npm run test:watch`: tests in watch mode
- `npm run test:stress`: slow randomized sweeps in `tests/stress` (about 4 minutes; not part of `npm test`)
- `npm run build`: type-check (`tsc --noEmit`), then production build into `dist/`
- `npm run preview`: serve the production build
- `npm run typecheck`: type-check only

Run `npm test` and `npm run build` before every commit. Both must pass.
`npm run test:stress` must also pass before a milestone is merged into `main`.

## Layers (enforced by tests/architecture.test.ts)
- `src/kernel`: pure geometry in millimeters: a shared topology of vertices, edges, faces and curves. No three.js, no DOM, no imports from other layers; the only package allowed is `earcut`. Import it only through `src/kernel/index.ts`. The `Model` type is opaque. Kernel tests check `validate()` (via `checkModel`) after every operation.
- `src/scene`: definitions (each with its own kernel Model), instances and rigid transforms (quaternion, translation in mm, scale fixed at [1, 1, 1] until milestone 4). Pure: imports only the kernel, no three.js or DOM. Scenes are immutable.
- `src/commands`: the only code that may call kernel mutations (besides `src/scene` loading models) (`createModel`, `drawRectangle`, `drawRegularPolygon`, `drawLine`, `pushPull`, `erase`, `extractGeometry`, `transformGeometry`, `mergeGeometry`, `moveGeometry`, `transformSelection`, `offset`, `deserialize`). No three.js or DOM.
- `src/units`, `src/i18n`: shared foundations.
- `src/viewport`: three.js rendering, camera, picking and snapping.
- `src/tools`: one file per tool. Tools change the model only through `session.execute` or `session.preview`.
- `src/ui`: DOM components.
- `src/export`: STL and GLB writers. Pure: imports only the kernel and the scene, no DOM. The app loads it on demand.
- `src/app.ts`: wiring. `src/files.ts`: open and save on the device. `src/storage.ts`: autosave (the recovery copy).

## Conventions
- Every model change is a command: namespaced id (`core.x`), zod input schema with `z.strictObject`, JSON-serializable input and output, and a pure `run()` that returns the same document instance when nothing changed.
- Commands whose numeric inputs can be retyped after they finish declare `amendable` fields (`positive` for sizes, `signed` for distances; `kind: 'count'` for counts typed as `48s`). `CommandSession.amend` handles the rest. Do not build amend logic into tools.
- Commands that create faces return the ids of every face they create.
- Geometry commands take an optional `definitionId` (the root when omitted) and work in that definition's local coordinates. Read and write geometry with `definitionModel`/`withDefinitionModel`, never by reaching into the scene.
- A group definition always has exactly one instance. Copying a group (or a definition holding groups) gives the copy its own definition that shares the immutable Model, so the copies diverge only when one is edited; use `duplicateDefinition` for this. Components share one definition between their instances.
- Tools work in world coordinates (picking, inference and previews). When they call a command they convert with `ctx.viewport.frame` (`toLocal`, `dirToLocal`, `normalToLocal`) and pass `frame.definitionId`, so they work the same inside any group or component. Inference goes through `inferPoint` in `src/tools/inference.ts` and uses the world snap points and edges of every placement (`worldSnapPoints`, `worldEdges`), including faded geometry outside the editing context. Previews go through `ctx.showPreview`, which never changes what picking sees.
- Lengths are stored in mm. Convert only at the edges, with `parseLength`/`parseLengthList`/`parseTypedValues` and `formatLength`/`formatArea` from `src/units`.
- Kernel operations work on a `Draft` and return a new topology; never edit a `Topology` in place. Drawing goes through the planar engine (`insertSegment`, `rebuildPlane`), not hand-built faces.
- Kernel tests run the invariant checker after every operation. Planar changes get randomized cases too (see `tests/planar.test.ts` and `tests/helpers/randomRun.ts`). A seed that finds a bug is pinned as a regression test in `npm test`; long sweeps go in `tests/stress`.
- DOM component tests opt into happy-dom with `// @vitest-environment happy-dom` at the top of the file.
- All user-visible text goes through `t()` with keys in `src/i18n/en.ts`. Never put text in HTML, icons or code literals.
- Numbers shown to users go through Intl (via `src/units`).
- CSS uses logical properties (`inline`/`block`, `start`/`end`). The only physical coordinates are those of the snap marker, the selection rectangle, the right-click menu, and the dimension and text labels with their text field, which follow canvas or pointer pixels.
- Shortcuts and modifiers match SketchUp defaults (PROJECT.md, "SketchUp parity"). Tool and action keys live in `src/tools/shortcuts.ts` (G is Make Component); never assign a reserved key (S, A, B) to anything else. On a Mac, Option replaces Ctrl as a modifier.
- Error codes are stable strings (`tooSmall`, `noSuchFace`); the UI maps them to messages.
- Match the surrounding code: small modules, few comments, and comments explain why.
- Kernel and units changes need tests in `tests/`.

## Rules
- No emojis anywhere: UI, code, comments, docs, commit messages.
- Keep the visual direction plain and technical: no gradients, glows or stock AI styling.
- No SketchUp branding, icons or file formats.
- No license file until the product owner chooses one.
- No network calls or backend. The app must work fully offline once loaded, and without AI.
- Commit in small steps with clear messages. Ask the product owner before pushing.
- On Windows PowerShell 5.1, commit with `git commit -F <file>`, because quotes inside `-m` get mangled.

## Reference
`reference/blockout-modeler.html` is the original single-file prototype and the behavior spec for milestone 1. Do not edit it. `tests/fixtures/milestone1-autosave.json` is a real milestone 1 autosave used by the format conversion tests; do not regenerate it.
