# Pushform: working rules

Browser-based push/pull 3D modeler. TypeScript (strict), Vite, three.js, Vitest, npm. Read PROJECT.md for goals, architecture and decisions.

## Commands
- `npm install`: install dependencies
- `npm run dev`: dev server (http://localhost:5173)
- `npm test`: unit and architecture tests (Vitest, run once)
- `npm run test:watch`: tests in watch mode
- `npm run build`: type-check (`tsc --noEmit`), then production build into `dist/`
- `npm run preview`: serve the production build
- `npm run typecheck`: type-check only

Run `npm test` and `npm run build` before every commit. Both must pass.

## Layers (enforced by tests/architecture.test.ts)
- `src/kernel`: pure geometry in millimeters: a shared topology of vertices, edges, faces and curves. No three.js, no DOM, no imports from other layers; the only package allowed is `earcut`. Import it only through `src/kernel/index.ts`. The `Model` type is opaque. Kernel tests check `validate()` (via `checkModel`) after every operation.
- `src/commands`: the only code that may call kernel mutations (`createModel`, `drawRectangle`, `pushPull`, `erase`, `deserialize`). No three.js or DOM.
- `src/units`, `src/i18n`: shared foundations.
- `src/viewport`: three.js rendering, camera, picking and snapping.
- `src/tools`: one file per tool. Tools change the model only through `session.execute` or `session.preview`.
- `src/ui`: DOM components.
- `src/app.ts`: wiring. `src/storage.ts`: autosave.

## Conventions
- Every model change is a command: namespaced id (`core.x`), zod input schema with `z.strictObject`, JSON-serializable input and output, and a pure `run()` that returns the same document instance when nothing changed.
- Commands whose numeric inputs can be retyped after they finish declare `amendable` fields (`positive` for sizes, `signed` for distances). `CommandSession.amend` handles the rest. Do not build amend logic into tools.
- Lengths are stored in mm. Convert only at the edges, with `parseLength`/`parseLengthList` and `formatLength`/`formatArea` from `src/units`.
- All user-visible text goes through `t()` with keys in `src/i18n/en.ts`. Never put text in HTML, icons or code literals.
- Numbers shown to users go through Intl (via `src/units`).
- CSS uses logical properties (`inline`/`block`, `start`/`end`). The only physical coordinates are the snap marker's, which follow canvas pixels.
- Error codes are stable strings (`outsideFace`); the UI maps them to messages.
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
`reference/blockout-modeler.html` is the original single-file prototype and the behavior spec for milestone 1. Do not edit it.
