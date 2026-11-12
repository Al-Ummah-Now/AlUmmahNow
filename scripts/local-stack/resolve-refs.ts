/**
 * The commit each sibling repo of the local stack last released, so the stack runs what production
 * runs (not whatever is on their main branch):
 *
 *   node --experimental-strip-types --no-warnings scripts/local-stack/resolve-refs.ts auth [cms www]
 *
 * - auth (AlUmmahNowAuth): every merge to main is released (release.yml on push to main); its
 *   last successful Release run is the released commit.
 * - cms (AlUmmahNowCMS), www (AlUmmahNowUI): a v* tag starts release.yml; the newest tag whose
 *   Release run succeeded.
 *
 * Prints `<name>_sha=<sha>` and `<name>_ref=<ref>` lines (append to $GITHUB_OUTPUT in CI).
 * Uses GITHUB_TOKEN / GH_TOKEN when set (public repos: also works without, at a lower rate limit).
 */
export const SIBLINGS = {
  auth: { repo: 'Al-Ummah-Now/AlUmmahNowAuth', workflow: 'release.yml', released: 'main' },
  cms: { repo: 'Al-Ummah-Now/AlUmmahNowCMS', workflow: 'release.yml', released: 'tag' },
  www: { repo: 'Al-Ummah-Now/AlUmmahNowUI', workflow: 'release.yml', released: 'tag' },
} as const;
export type Sibling = keyof typeof SIBLINGS;

export interface WorkflowRun {
  head_sha: string;
  head_branch: string | null;
  event: string;
  conclusion: string | null;
}

const TAG = /^v\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;

/** The released run among successful Release runs, newest first. */
export function releasedRun(runs: WorkflowRun[], released: 'main' | 'tag'): WorkflowRun | undefined {
  return runs.find((run) =>
    run.conclusion === 'success' && run.event === 'push' && (released === 'main' ? run.head_branch === 'main' : TAG.test(run.head_branch ?? '')),
  );
}

/** Released commits of a sibling, newest first (successful Release runs). */
export async function releasedRefs(name: Sibling): Promise<{ sha: string; ref: string }[]> {
  const { repo, workflow, released } = SIBLINGS[name];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const query = released === 'main' ? 'branch=main&' : '';
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?${query}status=success&event=push&per_page=50`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${repo}: GitHub answered ${res.status} for its ${workflow} runs`);
  const { workflow_runs: runs } = (await res.json()) as { workflow_runs: WorkflowRun[] };
  const out: { sha: string; ref: string }[] = [];
  for (let rest = runs; ; ) {
    const run = releasedRun(rest, released);
    if (!run) break;
    if (!out.some((r) => r.sha === run.head_sha)) out.push({ sha: run.head_sha, ref: run.head_branch ?? run.head_sha });
    rest = rest.slice(rest.indexOf(run) + 1);
  }
  return out;
}

export async function resolveSibling(name: Sibling): Promise<{ sha: string; ref: string }> {
  const { repo, workflow, released } = SIBLINGS[name];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const query = released === 'main' ? 'branch=main&' : '';
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?${query}status=success&event=push&per_page=50`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`${repo}: GitHub answered ${res.status} for its ${workflow} runs`);
  const { workflow_runs: runs } = (await res.json()) as { workflow_runs: WorkflowRun[] };
  const run = releasedRun(runs, released);
  if (!run) throw new Error(`${repo}: no successful release in the last 50 Release runs`);
  return { sha: run.head_sha, ref: run.head_branch ?? run.head_sha };
}

if (import.meta.main) {
  const names = process.argv.slice(2) as Sibling[];
  for (const name of names.length ? names : (['auth'] as Sibling[])) {
    if (!(name in SIBLINGS)) throw new Error(`unknown sibling ${name} (${Object.keys(SIBLINGS).join(', ')})`);
    const { sha, ref } = await resolveSibling(name);
    process.stdout.write(`${name}_sha=${sha}\n${name}_ref=${ref}\n`);
  }
}
