/**
 * Guards the layer boundaries described in PROJECT.md by scanning imports.
 * - kernel: pure geometry, no three.js, no DOM, no imports from other layers
 *   (packages only from KERNEL_PACKAGES).
 * - commands: no three.js or DOM, so it can run headless (tests, MCP, plugins).
 * - Only src/commands may call kernel mutations, and only through src/kernel/index.ts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const SRC = resolve(__dirname, '../src');
/** Pure, DOM-free packages the kernel may use. */
const KERNEL_PACKAGES = ['earcut'];
const KERNEL_MUTATIONS = ['createModel', 'drawRectangle', 'drawRegularPolygon', 'drawLine', 'pushPull', 'erase', 'deserialize'];
const DOM_GLOBALS = /\b(window|document|localStorage|sessionStorage|navigator|requestAnimationFrame|HTMLElement)\b/;

interface ImportInfo {
  file: string;
  layer: string;
  spec: string;
  /** Layer the import resolves to, or null for packages. */
  target: string | null;
  /** Path under src for local imports, e.g. "kernel/model". */
  targetPath: string | null;
  names: string[];
}

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(SRC, f));
}

const layerOf = (file: string) => relative(SRC, file).split(sep)[0]!.replace(/\.ts$/, '');

/** Remove comments and string contents so only code identifiers remain. */
function codeOnly(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/'[^'\n]*'|"[^"\n]*"/g, "''");
}

function importsOf(file: string): ImportInfo[] {
  const code = readFileSync(file, 'utf8');
  const out: ImportInfo[] = [];
  const re = /(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(re)) {
    const spec = m[2]!;
    const names = (/\{([\s\S]*)\}/.exec(m[1]!)?.[1] ?? '')
      .split(',')
      .map((n) => n.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]!)
      .filter(Boolean);
    let target: string | null = null;
    let targetPath: string | null = null;
    if (spec.startsWith('.')) {
      targetPath = relative(SRC, resolve(dirname(file), spec)).split(sep).join('/');
      target = targetPath.split('/')[0]!;
    }
    out.push({ file: relative(SRC, file), layer: layerOf(file), spec, target, targetPath, names });
  }
  return out;
}

const all = sourceFiles().flatMap(importsOf);

describe('architecture', () => {
  test('there are source files to check', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  test('kernel imports nothing outside src/kernel except allowed packages', () => {
    const bad = all.filter(
      (i) => i.layer === 'kernel' && i.target !== 'kernel' && !KERNEL_PACKAGES.includes(i.spec),
    );
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  test.each(['kernel', 'scene', 'commands', 'units'])('%s uses no DOM globals', (layer) => {
    const bad = sourceFiles()
      .filter((f) => layerOf(f) === layer)
      .filter((f) => DOM_GLOBALS.test(codeOnly(readFileSync(f, 'utf8'))));
    expect(bad.map((f) => relative(SRC, f))).toEqual([]);
  });

  test('commands does not import three.js or UI layers', () => {
    const bad = all.filter(
      (i) => i.layer === 'commands' && (i.spec === 'three' || ['viewport', 'tools', 'ui'].includes(i.target ?? '')),
    );
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  test('other layers import the kernel only through its index', () => {
    const bad = all.filter(
      (i) => i.layer !== 'kernel' && i.target === 'kernel' && i.targetPath !== 'kernel' && i.targetPath !== 'kernel/index',
    );
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  test('only commands (and the scene layer, which loads models) call kernel mutations', () => {
    const bad = all.filter(
      (i) =>
        i.layer !== 'kernel' &&
        i.layer !== 'commands' &&
        i.layer !== 'scene' &&
        i.target === 'kernel' &&
        i.names.some((n) => KERNEL_MUTATIONS.includes(n)),
    );
    expect(bad.map((i) => `${i.file} -> ${i.names.join(', ')}`)).toEqual([]);
  });

  test('the scene layer depends only on the kernel', () => {
    const bad = all.filter((i) => i.layer === 'scene' && (i.target === null || !['scene', 'kernel'].includes(i.target)));
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });

  test('nothing imports the kernel with a namespace import', () => {
    const bad = all.filter((i) => i.layer !== 'kernel' && i.target === 'kernel' && i.names.length === 0);
    expect(bad.map((i) => `${i.file} -> ${i.spec}`)).toEqual([]);
  });
});
