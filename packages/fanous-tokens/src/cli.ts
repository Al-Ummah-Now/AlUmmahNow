// `generate` writes generated/. `generate --check` fails on an AA contrast failure or stale output.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastFailures, contrastPairs } from './contrast.ts';
import { generateAll } from './generate.ts';
import { loadModel } from './model.ts';

export const GENERATED_DIR = fileURLToPath(new URL('../generated', import.meta.url));

export function listFiles(dir: string): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap((n) => {
    const full = join(dir, n);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const model = loadModel();
const pairs = contrastPairs(model);
const failures = contrastFailures(model);
for (const p of failures) {
  console.error(`AA FAIL ${p.theme}: ${p.fg} ${p.fgHex} on ${p.bg} ${p.bgHex} = ${p.ratio.toFixed(2)} (needs ${p.required})`);
}
if (failures.length) process.exit(1);
console.log(`Contrast: ${pairs.length} pairs pass WCAG 2.1 AA in both themes.`);

const files = generateAll(model);
if (process.argv.includes('--check')) {
  const onDisk = listFiles(GENERATED_DIR).map((f) => relative(GENERATED_DIR, f));
  const stale = [
    ...Object.entries(files).filter(([p, c]) => { try { return readFileSync(join(GENERATED_DIR, p), 'utf8') !== c; } catch { return true; } }).map(([p]) => p),
    ...onDisk.filter((p) => !(p in files)),
  ];
  if (stale.length) {
    console.error(`Generated outputs are stale, run pnpm tokens:generate:\n  ${stale.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Generated outputs are current (${onDisk.length} files).`);
} else {
  rmSync(GENERATED_DIR, { recursive: true, force: true });
  for (const [path, content] of Object.entries(files)) {
    const target = join(GENERATED_DIR, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  console.log(`Wrote ${Object.keys(files).length} files to generated/.`);
}
