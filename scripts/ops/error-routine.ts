/**
 * The daily and after-release check of the recorded production errors (.github/workflows/prod-errors-routine.yml).
 *
 *   node --experimental-strip-types scripts/ops/error-routine.ts --summary summary.json --baseline baseline.json --next next.json
 *
 * Compares this run's public summary (prod-errors.ts --summary: group ids, allow-listed words and counts only) with
 * the last run's baseline. One GitHub issue is opened, or updated while open, only when there is an error group that
 * no earlier run saw, or a kind of needs-action item with more open items than last time. It is never closed here.
 * Everything written is on the allow list of public-report.ts; the full report is the run's sealed artifact.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { type ErrorSummary } from './public-report.ts';

export const TITLE = 'Production errors: something new to look at';
export const LABEL = 'prod-errors';
/** Known groups kept from run to run. */
const MAX_KNOWN = 2000;

export interface Baseline {
	v: 1;
	known: string[];
	actions: Record<string, number>;
}

export interface Findings {
	groups: ErrorSummary['groups'];
	actions: { kind: string; before: number; now: number }[];
}

/** No baseline (the first run): nothing is new. An unreadable part of the report keeps what was known. */
export function compare(prev: Baseline | null, now: ErrorSummary): { findings: Findings; next: Baseline } {
	const known = new Set(prev?.known ?? []);
	const groups = now.groups ?? [];
	const actions = now.actions ?? prev?.actions ?? {};
	const findings: Findings = {
		groups: prev ? groups.filter((g) => !known.has(g.id) && !g.test) : [],
		actions: prev ? Object.entries(actions).map(([kind, n]) => ({ kind, before: prev.actions[kind] ?? 0, now: n })).filter((a) => a.now > a.before) : [],
	};
	const next = [...new Set([...groups.map((g) => g.id), ...(prev?.known ?? [])])].slice(0, MAX_KNOWN);
	return { findings, next: { v: 1, known: next, actions } };
}

export const hasFindings = (f: Findings) => f.groups.length > 0 || f.actions.length > 0;

export function issueBody(f: Findings, runUrl: string): string {
	const out = ['The production error check found something no earlier run had. Details are in admin, on the Errors page, and in the sealed report of the run.', ''];
	if (f.groups.length) out.push('**New error groups**', ...f.groups.map((g) => `- \`${g.id}\` ${g.line}`), '');
	if (f.actions.length) out.push('**More items that need action**', ...f.actions.map((a) => `- ${a.kind}: ${a.before} → ${a.now}`), '');
	out.push(`[Run](${runUrl})`);
	return out.join('\n');
}

async function github(path: string, init?: RequestInit): Promise<Response> {
	const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
		...init,
		headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
	});
	if (!res.ok) throw new Error(`GitHub ${init?.method ?? 'GET'} ${path.split('?')[0]}: HTTP ${res.status}`);
	return res;
}

/** Opens the issue, or comments on the open one. */
export async function publish(f: Findings, runUrl: string, gh = github): Promise<'opened' | 'updated'> {
	const body = issueBody(f, runUrl);
	const open = (await (await gh(`/issues?state=open&labels=${LABEL}&per_page=10`)).json()) as { number: number; pull_request?: unknown }[];
	const issue = open.find((i) => !i.pull_request);
	if (!issue) {
		await gh('/issues', { method: 'POST', body: JSON.stringify({ title: TITLE, body, labels: [LABEL] }) });
		return 'opened';
	}
	await gh(`/issues/${issue.number}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
	return 'updated';
}

async function main(): Promise<void> {
	const arg = (name: string) => process.argv[process.argv.indexOf(`--${name}`) + 1]!;
	const summary = JSON.parse(readFileSync(arg('summary'), 'utf8')) as ErrorSummary;
	const prev = existsSync(arg('baseline')) ? (JSON.parse(readFileSync(arg('baseline'), 'utf8')) as Baseline) : null;
	const { findings, next } = compare(prev, summary);
	const runUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
	const did = hasFindings(findings) ? await publish(findings, runUrl) : 'nothing new';
	// Only after the issue: a failed run leaves the old baseline, and the next one finds the same again
	writeFileSync(arg('next'), JSON.stringify(next));
	process.stdout.write(`${prev ? did : 'first run: baseline written'}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error) => {
		process.stderr.write(`error-routine failed: ${error instanceof Error && error.message.startsWith('GitHub ') ? error.message : 'unexpected error'}\n`);
		process.exit(1);
	});
}
