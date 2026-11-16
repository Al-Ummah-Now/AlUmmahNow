/**
 * Cross-unit references that package.json does not declare: relative paths (`../..`) in imports,
 * CSS @import, require(), package scripts and config files that leave their own workspace unit,
 * plus bare `@al-ummah/<pkg>` imports. Turbo, Nx and pnpm cannot see the relative ones, so the
 * selector's graph lists them in EXTRA_EDGES and a test keeps that list equal to this scan.
 *
 * A unit is a workspace package (`apps/<name>`, `packages/<name>`), a `scripts/<name>` folder, or the
 * repo root for everything else.
 *
 * Usage: node --experimental-strip-types scripts/ci/select/import-edges.ts   (prints JSON)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Reference {
  /** The file that holds the reference (the user). */
  from: string;
  /** The repo path it points at (the used file, or a folder). */
  to: string;
  /** The text that was matched, for messages. */
  spec: string;
  /** `package`: a bare `@al-ummah/<pkg>` import (`to` is the package folder); `path`: a relative path. */
  kind: 'path' | 'package';
}

const SCANNED = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs|css|scss|json|jsonc)$/;
/** Generated or vendored copies, lockfiles: a path inside them is never a reference of ours. */
const SKIP = [/(^|\/)package-lock\.json$/, /\.schema\.snapshot\.sql$/, /(^|\/)__screenshots__\//, /\.snap$/];
/** `../` runs followed by a path; stops at quotes, spaces, `)` and the like. */
const RELATIVE = /(?<![\w.])((?:\.\.\/)+[\w@\-.\[\]/]*[\w\-\]])/g;
/** Relative specifiers of import/export/require/CSS @import statements, `./` included. */
const STATEMENT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+|@import\s+(?:url\()?)['"](\.{1,2}\/[^'"]+)['"]/g;
const BARE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](@al-ummah\/[\w-]+)(?:\/[^'"]*)?['"]/g;

export function unitOf(path: string): string {
  const parts = path.split('/');
  if ((parts[0] === 'apps' || parts[0] === 'packages' || parts[0] === 'scripts') && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return '.';
}

export function trackedFiles(root: string): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

/** Folders that hold at least one tracked file, so a reference to a folder resolves too. */
function folderSet(files: readonly string[]): Set<string> {
  const dirs = new Set<string>();
  for (const f of files) {
    let d = posix.dirname(f);
    while (d !== '.' && !dirs.has(d)) {
      dirs.add(d);
      d = posix.dirname(d);
    }
  }
  return dirs;
}

const EXTENSIONS = ['', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.css', '.json', '/index.ts', '/index.tsx', '/index.js'];

/** The tracked file or folder a relative reference in `from` lands on, if any. */
export function resolveRelative(from: string, spec: string, files: ReadonlySet<string>, folders: ReadonlySet<string>): string | undefined {
  const base = posix.normalize(posix.join(posix.dirname(from), spec)).replace(/\/$/, '');
  if (base.startsWith('..')) return undefined;
  for (const ext of EXTENSIONS) if (files.has(base + ext)) return base + ext;
  // TypeScript's ESM style: './x.js' written for './x.ts'
  const ts = base.replace(/\.(m?)js$/, '.$1ts');
  if (ts !== base && files.has(ts)) return ts;
  if (folders.has(base)) return base;
  return undefined;
}

/** Workspace package name → its folder, from every apps/* and packages/* package.json. */
export function workspacePackages(root: string, files: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of files) {
    if (!/^(apps|packages)\/[^/]+\/package\.json$/.test(f)) continue;
    const pkg = JSON.parse(readFileSync(resolve(root, f), 'utf8')) as { name?: string };
    if (pkg.name) out.set(pkg.name, posix.dirname(f));
  }
  return out;
}

/**
 * Every cross-unit reference in the tracked tree, plus the references between files of the same unit
 * for the units in `intraUnits` (units split into sub-nodes).
 */
export function scanReferences(root: string, files: readonly string[] = trackedFiles(root), intraUnits: readonly string[] = []): Reference[] {
  const fileSet = new Set(files);
  const folders = folderSet(files);
  const packages = workspacePackages(root, files);
  const out: Reference[] = [];
  const seen = new Set<string>();
  const add = (ref: Reference) => {
    const key = `${ref.from}\0${ref.to}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  for (const from of files) {
    if (!SCANNED.test(from) || SKIP.some((re) => re.test(from))) continue;
    let text: string;
    try {
      text = readFileSync(resolve(root, from), 'utf8');
    } catch {
      continue; // deleted in the working tree
    }
    const unit = unitOf(from);
    for (const m of text.matchAll(RELATIVE)) {
      const to = resolveRelative(from, m[1], fileSet, folders);
      // `<rootDir>/../..` (jest) and package.json scripts resolve from the package folder, which is
      // where those files live, so the same resolution covers them.
      if (to && unitOf(to) !== unit && unitOf(to) !== '.') add({ from, to, spec: m[1], kind: 'path' });
    }
    if (intraUnits.includes(unit)) {
      for (const m of text.matchAll(STATEMENT)) {
        const to = resolveRelative(from, m[1], fileSet, folders);
        if (to && unitOf(to) === unit && to !== from) add({ from, to, spec: m[1], kind: 'path' });
      }
    }
    if (!/\.(json|jsonc|css|scss)$/.test(from)) {
      for (const m of text.matchAll(BARE)) {
        const dir = packages.get(m[1]);
        if (dir && dir !== unit) add({ from, to: dir, spec: m[1], kind: 'package' });
      }
    }
  }
  return out.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  process.stdout.write(`${JSON.stringify(scanReferences(root), null, 2)}\n`);
}
