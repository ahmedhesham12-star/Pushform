// Starts Vitest from the canonical project path. On Windows a working directory
// spelled with a lowercase drive letter (VS Code terminals can open as d:\) made
// Vitest load itself twice, and every test file failed before running a test.
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = realpathSync.native(process.cwd());
process.chdir(root);
await import(pathToFileURL(join(root, 'node_modules', 'vitest', 'vitest.mjs')).href);
