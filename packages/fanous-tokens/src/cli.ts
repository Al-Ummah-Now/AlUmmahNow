// `cli.ts` validates every theme and writes generated/<theme>/. `--check` fails on a problem or stale output.
// `cli.ts build --out <dir> [--theme <id>]` emits one flat theme for an app build. ACTIVE_THEME sets the theme.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrastPairs } from './contrast.ts';
import { generateAll } from './generate.ts';
import { composeTokens, loadThemes, loadTokens, resolveTheme, THEMES_DIR, themeModel, validateThemes } from './themes.ts';
import { buildModel } from './model.ts';

export const GENERATED_DIR = fileURLToPath(new URL('../generated', import.meta.url));

export function listFiles(dir: string): string[] {
  let names: string[];
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap((n) => {
    const full = join(dir, n);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

const write = (path: string, content: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

const themes = loadThemes();
const tokens = loadTokens();
const errors = validateThemes(themes, tokens);
if (errors.length) {
  errors.forEach((e) => console.error(e));
  process.exit(1);
}

if (process.argv[2] === 'build') {
  const id = flag('--theme') ?? process.env.ACTIVE_THEME ?? themes.defaultTheme;
  const out = flag('--out');
  if (!out) { console.error('build needs --out <dir>'); process.exit(1); }
  if (!themes.byId[id]) { console.error(`Unknown theme "${id}". Registered: ${themes.ids.join(', ')}`); process.exit(1); }
  rmSync(out, { recursive: true, force: true });
  const files = generateAll(themeModel(id, themes, tokens));
  for (const [path, content] of Object.entries(files)) write(join(out, path), content);
  // Asset paths in the flat manifest point into the output, so nothing refers to another theme.
  const copy = (value: any): any => {
    if (typeof value === 'string' && /^[a-z0-9-]+\/assets\//.test(value)) {
      const name = basename(value);
      mkdirSync(join(out, 'assets'), { recursive: true });
      copyFileSync(join(THEMES_DIR, value), join(out, 'assets', name));
      return `assets/${name}`;
    }
    if (Array.isArray(value)) return value.map(copy);
    if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]));
    return value;
  };
  const { color, brandColor, ...slots } = resolveTheme(id, themes);
  write(join(out, 'theme.json'), `${JSON.stringify(copy(slots), null, 2)}\n`);
  console.log(`Built theme ${id} into ${out}.`);
  process.exit(0);
}

const files: Record<string, string> = {};
for (const id of themes.ids) {
  const model = buildModel(composeTokens(tokens, resolveTheme(id, themes)));
  console.log(`${id}: ${contrastPairs(model).length} colour pairs pass.`);
  for (const [path, content] of Object.entries(generateAll(model))) files[`${id}/${path}`] = content;
}

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
  for (const [path, content] of Object.entries(files)) write(join(GENERATED_DIR, path), content);
  console.log(`Wrote ${Object.keys(files).length} files to generated/.`);
}
