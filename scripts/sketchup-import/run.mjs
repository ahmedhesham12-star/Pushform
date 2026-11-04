// Converts a dump written by dump.rb into a .pushform file, and writes the
// conversion report next to it.
//   node scripts/sketchup-import/run.mjs <dump folder> [output.pushform]
// Vite's module runner loads convert.ts and the app sources it imports.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const [folder, output] = process.argv.slice(2);
if (!folder) {
  console.error('usage: node scripts/sketchup-import/run.mjs <dump folder> [output.pushform]');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const { module } = await runnerImport(join(here, 'convert.ts'), { root: resolve(here, '../..'), logLevel: 'error' });
const dump = JSON.parse(readFileSync(join(folder, 'model.json'), 'utf8'));
const texture = (file) => {
  const path = join(folder, basename(file));
  return existsSync(path) ? readFileSync(path).toString('base64') : null;
};
const started = Date.now();
const { text, report } = module.convert(dump, texture);
const name = (dump.title || 'SketchUp model').replace(/[\\/:*?"<>|]/g, '_');
const target = output ?? join(folder, `${name}.pushform`);
writeFileSync(target, text);
const lines = `Source: ${dump.path || dump.title} (SketchUp ${dump.sketchup})\nSaved: ${target}\nTime: ${((Date.now() - started) / 1000).toFixed(1)} s\n${module.reportText(report)}\n`;
writeFileSync(target.replace(/\.pushform$/, '') + '.report.txt', lines);
console.log(lines);
