// Reads a theme package folder from disk: theme.json plus every file under assets/.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PackageFiles } from '../src/types.ts';

export const THEMES_DIR = fileURLToPath(new URL('../themes', import.meta.url));
export const BUILT_IN: { default: string; ids: string[] } = JSON.parse(readFileSync(join(THEMES_DIR, 'index.json'), 'utf8'));

function walk(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
}

export function loadPackageDir(dir: string): PackageFiles {
  const theme = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'));
  const assets: Record<string, Uint8Array> = {};
  let files: string[] = [];
  try { files = walk(join(dir, 'assets')); } catch { files = []; }
  for (const file of files) assets[relative(dir, file).split('\\').join('/')] = new Uint8Array(readFileSync(file));
  return { theme, assets };
}

/** Inlines a package's SVG asset as a data: URL (built-in stylesheets are copied to other sites, so they carry their art). */
export function inlineSvg(files: PackageFiles): (path: string) => string | undefined {
  return (path) => {
    const bytes = files.assets[path];
    if (!bytes || !path.endsWith('.svg')) return undefined;
    return `data:image/svg+xml,${encodeURIComponent(new TextDecoder().decode(bytes).trim())}`;
  };
}
