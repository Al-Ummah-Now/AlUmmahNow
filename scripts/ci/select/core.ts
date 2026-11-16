/**
 * The selection engine: changed files → graph nodes → breadth-first walk over "used → users" edges →
 * the suites whose dependsOn the walk reaches. Pure functions over the graph data in graph.ts and the
 * workspace package.json files; select.ts is the CLI around it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchAny } from './glob.ts';
import { BUILD_JOB, EXTRA_EDGES, IGNORE, NODES, PLACEMENT_FILE, SUITES, type NodeDef } from './graph.ts';

export const IGNORED = 'ignore';

export type SuiteId = keyof typeof SUITES & string;

export interface Plan {
  /** `all`: every suite runs (fail open, a global input, a full event). `selected`: only `suites`. */
  mode: 'all' | 'selected';
  /** Why the plan is `all`, or a one-line summary of the selection. */
  reason: string;
  /** Every suite id → whether it runs. */
  suites: Record<string, boolean>;
  /** Job ids in Local E2E → whether they run (build, web, admin, release). */
  jobs: Record<string, boolean>;
  /** For each selected suite, the chain that selected it: file → node → … → suite. */
  why: Record<string, string>;
  /** Changed files counted (ignored files included). */
  files: number;
}

const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n] as const));

export function nodeById(id: string): NodeDef | undefined {
  return NODE_BY_ID.get(id);
}

/** The node a repo path belongs to: IGNORED, a node id, or undefined when nothing maps it. */
export function nodeOf(path: string): string | undefined {
  if (matchAny(IGNORE, path)) return IGNORED;
  for (const node of NODES) if (matchAny(node.globs, path)) return node.id;
  return undefined;
}

export interface Edge {
  from: string;
  to: string;
  why: string;
}

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** Declared `workspace:` deps between the units the graph names, as node edges. */
export function workspaceEdges(readPackage: (unit: string) => PackageJson | undefined): Edge[] {
  const units = NODES.filter((n) => n.unit);
  const byName = new Map<string, string>();
  const manifests = new Map<string, PackageJson>();
  for (const node of units) {
    const pkg = readPackage(node.unit as string);
    if (!pkg) continue;
    manifests.set(node.id, pkg);
    if (pkg.name) byName.set(pkg.name, node.id);
  }
  const edges: Edge[] = [];
  for (const [consumer, pkg] of manifests) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
    for (const [name, range] of Object.entries(deps)) {
      const used = byName.get(name);
      if (used && used !== consumer && String(range).startsWith('workspace:')) {
        edges.push({ from: used, to: consumer, why: `${NODE_BY_ID.get(consumer)?.unit}/package.json depends on ${name}` });
      }
    }
  }
  return edges;
}

export function readWorkspacePackage(root: string) {
  return (unit: string): PackageJson | undefined => {
    try {
      return JSON.parse(readFileSync(resolve(root, unit, 'package.json'), 'utf8')) as PackageJson;
    } catch {
      return undefined;
    }
  };
}

/** Every edge of the graph: declared deps, sub-node → parent, and the extra (undeclared) edges. */
export function allEdges(declared: Edge[]): Edge[] {
  const partOf = NODES.filter((n) => n.partOf).map((n) => ({ from: n.id, to: n.partOf as string, why: `${n.id} is part of ${n.partOf}` }));
  return [...declared, ...partOf, ...EXTRA_EDGES];
}

export type Adjacency = Map<string, Edge[]>;

export function adjacency(edges: Edge[]): Adjacency {
  const out: Adjacency = new Map();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }
  return out;
}

/** Breadth-first from `start`: each reached node → the node it was reached from (undefined for start). */
export function walk(adj: Adjacency, start: string): Map<string, string | undefined> {
  const parent = new Map<string, string | undefined>([[start, undefined]]);
  const queue = [start];
  while (queue.length) {
    const node = queue.shift() as string;
    for (const e of adj.get(node) ?? []) {
      if (parent.has(e.to)) continue;
      parent.set(e.to, node);
      queue.push(e.to);
    }
  }
  return parent;
}

function chain(parent: Map<string, string | undefined>, end: string): string[] {
  const out: string[] = [];
  for (let n: string | undefined = end; n !== undefined; n = parent.get(n)) out.unshift(n);
  return out;
}

export function emptySelection(value: boolean): { suites: Record<string, boolean>; jobs: Record<string, boolean> } {
  const suites = Object.fromEntries(Object.keys(SUITES).map((s) => [s, value]));
  return { suites, jobs: jobsFor(suites) };
}

export function jobsFor(suites: Record<string, boolean>): Record<string, boolean> {
  const jobs: Record<string, boolean> = {};
  for (const [id, suite] of Object.entries(SUITES)) {
    if (suite.workflow !== 'local-e2e.yml') continue;
    for (const job of suite.jobs) jobs[job] = Boolean(suites[id]);
  }
  jobs[BUILD_JOB.job] = BUILD_JOB.for.some((s) => suites[s]);
  return jobs;
}

export function planAll(reason: string, files = 0): Plan {
  return { mode: 'all', reason, ...emptySelection(true), why: {}, files };
}

/** What a set of changed nodes selects; `origin` names the file each start node came from. */
export function selectFromNodes(adj: Adjacency, starts: Array<{ node: string; origin: string }>, files: number): Plan {
  const selection = emptySelection(false);
  const why: Record<string, string> = {};
  for (const { node, origin } of starts) {
    const parent = walk(adj, node);
    for (const reached of parent.keys()) {
      if (NODE_BY_ID.get(reached)?.global) {
        return planAll(`global input: ${origin} → ${chain(parent, reached).join(' → ')}`, files);
      }
    }
    for (const [id, suite] of Object.entries(SUITES)) {
      if (selection.suites[id]) continue;
      const hit = suite.dependsOn.find((d) => parent.has(d));
      if (!hit) continue;
      selection.suites[id] = true;
      why[id] = [origin, ...chain(parent, hit), suite.name].join(' → ');
    }
  }
  const chosen = Object.keys(selection.suites).filter((s) => selection.suites[s]);
  return {
    mode: 'selected',
    reason: chosen.length ? `selected: ${chosen.join(', ')}` : 'no E2E suite reached',
    suites: selection.suites,
    jobs: jobsFor(selection.suites),
    why,
    files,
  };
}

const ROW = /^\s*'([^']+)':\s*(\{.*\}),?\s*$/;

/**
 * The spec paths whose placement rows differ between two versions of placement.ts, or undefined
 * when anything outside the rows changed (the type, the doc comment, the helper): then the caller
 * selects everything.
 */
export function placementChanges(baseText: string, headText: string): string[] | undefined {
  const parse = (text: string) => {
    const rows = new Map<string, string>();
    const rest: string[] = [];
    for (const line of text.split('\n')) {
      const m = ROW.exec(line);
      if (m) rows.set(m[1], m[2]);
      else rest.push(line);
    }
    return { rows, rest: rest.join('\n') };
  };
  const base = parse(baseText);
  const head = parse(headText);
  if (base.rest !== head.rest || head.rows.size === 0) return undefined;
  const changed = new Set<string>();
  for (const [key, value] of head.rows) if (base.rows.get(key) !== value) changed.add(key);
  for (const key of base.rows.keys()) if (!head.rows.has(key)) changed.add(key);
  return [...changed].sort();
}

export interface SelectInput {
  files: string[];
  adj: Adjacency;
  /** Base and head text of placement.ts, read only when it changed. */
  placement?: () => { base: string; head: string };
}

/** Changed files → plan. Throws only on programming errors; the CLI turns any throw into `all`. */
export function selectFiles({ files, adj, placement }: SelectInput): Plan {
  const starts: Array<{ node: string; origin: string }> = [];
  for (const file of files) {
    const node = nodeOf(file);
    if (node === IGNORED) continue;
    if (node === undefined) return planAll(`unmapped file: ${file} (add it to scripts/ci/select/graph.ts)`, files.length);
    if (file === PLACEMENT_FILE) {
      if (!placement) return planAll(`${file} changed and its base version could not be read`, files.length);
      let specs: string[] | undefined;
      try {
        const { base, head } = placement();
        specs = placementChanges(base, head);
      } catch (error) {
        return planAll(`${file}: ${(error as Error).message}`, files.length);
      }
      if (!specs) return planAll(`${file} changed outside its rows`, files.length);
      for (const spec of specs) {
        const specNode = nodeOf(spec);
        if (!specNode || specNode === IGNORED) return planAll(`${file}: row ${spec} maps to no suite`, files.length);
        starts.push({ node: specNode, origin: `${file} [${spec}]` });
      }
      continue;
    }
    starts.push({ node, origin: file });
  }
  return selectFromNodes(adj, starts, files.length);
}
