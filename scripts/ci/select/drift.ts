/**
 * Edge drift: the import scan (import-edges.ts) against the committed graph (graph.ts + package.json).
 *
 * - missing: a file uses a file of another node, and the user's node selects a suite (or every suite,
 *   through a global input) that the used node does not. A change to the used file would skip a suite
 *   that the change can break. The placement table is exempt: select.ts diffs it row by row.
 * - stale: an EXTRA_EDGES entry that no reference in the tree supports any more.
 *
 * Usage: node --experimental-strip-types scripts/ci/select/drift.ts   (exit 1 on drift)
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adjacency, allEdges, IGNORED, nodeById, nodeOf, readWorkspacePackage, walk, workspaceEdges, type Adjacency } from './core.ts';
import { EXTRA_EDGES, NODES, SPLIT_UNITS, SUITES } from './graph.ts';
import { scanReferences, trackedFiles, type Reference } from './import-edges.ts';

const PLACEMENT_NODE = 'e2e:placement';

export interface Drift {
  missing: string[];
  stale: string[];
}

/** What a change to `node` selects: `*` for everything (a global input is reached), else suite ids. */
export function selection(adj: Adjacency, node: string): Set<string> {
  const reached = walk(adj, node);
  if ([...reached.keys()].some((n) => nodeById(n)?.global)) return new Set(['*']);
  return new Set(Object.entries(SUITES).filter(([, s]) => s.dependsOn.some((d) => reached.has(d))).map(([id]) => id));
}

function covers(used: Set<string>, user: Set<string>): boolean {
  if (used.has('*')) return true;
  if (user.has('*')) return false;
  return [...user].every((s) => used.has(s));
}

/** The nodes a reference points at: one for a file, the nodes of its files for a folder or a package. */
function targetNodes(ref: Reference, files: readonly string[]): string[] {
  if (ref.kind === 'package') {
    const unit = NODES.find((n) => n.unit === ref.to);
    return unit ? [unit.id] : [];
  }
  const direct = nodeOf(ref.to);
  if (files.includes(ref.to)) return direct ? [direct] : [];
  const prefix = `${ref.to}/`;
  const nodes = new Set<string>();
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    const n = nodeOf(f);
    if (n && n !== IGNORED && n !== 'unit-tests') nodes.add(n);
  }
  return [...nodes];
}

/**
 * The node a referencing file belongs to. A workspace package.json is a global input as a changed
 * file, but what its scripts run (`build` running a theme-packages script) is used by its unit.
 */
function userNode(file: string): string | undefined {
  const manifest = /^((?:apps|packages)\/[^/]+)\/package\.json$/.exec(file);
  if (manifest) return NODES.find((n) => n.unit === manifest[1])?.id;
  return nodeOf(file);
}

export function drift(refs: readonly Reference[], files: readonly string[], adj: Adjacency): Drift {
  const missing = new Set<string>();
  const witnessed = new Set<string>();
  const memo = new Map<string, Set<string>>();
  const sel = (node: string) => {
    if (!memo.has(node)) memo.set(node, selection(adj, node));
    return memo.get(node) as Set<string>;
  };
  for (const ref of refs) {
    const user = userNode(ref.from);
    if (!user || user === IGNORED) continue;
    for (const used of targetNodes(ref, files)) {
      if (used === user || used === IGNORED || used === PLACEMENT_NODE) continue;
      witnessed.add(`${used}→${user}`);
      if (!covers(sel(used), sel(user))) {
        missing.add(`${used} → ${user}: ${ref.from} uses ${ref.to} (${ref.spec}); ${[...sel(user)].join(',')} vs ${[...sel(used)].join(',') || 'nothing'}`);
      }
    }
  }
  const stale = EXTRA_EDGES.filter((e) => !witnessed.has(`${e.from}→${e.to}`)).map((e) => `${e.from} → ${e.to} (${e.why})`);
  return { missing: [...missing].sort(), stale };
}

export function driftOfTree(root: string): Drift {
  const files = trackedFiles(root);
  const refs = scanReferences(root, files, SPLIT_UNITS);
  const adj = adjacency(allEdges(workspaceEdges(readWorkspacePackage(root))));
  return drift(refs, files, adj);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const d = driftOfTree(root);
  for (const m of d.missing) process.stdout.write(`missing edge: ${m}\n`);
  for (const s of d.stale) process.stdout.write(`stale edge: ${s}\n`);
  process.exit(d.missing.length || d.stale.length ? 1 : 0);
}
