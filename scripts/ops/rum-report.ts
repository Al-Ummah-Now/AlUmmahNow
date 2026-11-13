/**
 * Field Core Web Vitals report (wiki AUN-SEO phase 4, #1207): p75 LCP, CLS and INP per page kind,
 * device class and locale from the web Worker's Workers Analytics Engine dataset (app/api/rum).
 *
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
 *     node --experimental-strip-types --no-warnings scripts/ops/rum-report.ts [--env production|stage|qa] [--days 7]
 *
 * The token needs Account Analytics: Read. Read-only; the data has no identifiers (D-SEO-9).
 */
import { pathToFileURL } from 'node:url';

export type RumEnv = 'production' | 'stage' | 'qa';

export const DATASETS: Record<RumEnv, string> = {
	production: 'al_ummah_now_rum',
	stage: 'al_ummah_now_rum_stage',
	qa: 'al_ummah_now_rum_qa',
};

/** Good / poor thresholds (web.dev): LCP ms, CLS unitless, INP ms */
export const THRESHOLDS: Record<string, [number, number]> = { LCP: [2500, 4000], CLS: [0.1, 0.25], INP: [200, 500] };

/** The SQL API query: weighted p75 and sample count per metric, page kind, device and locale */
export function rumSql(env: RumEnv, days: number): string {
	const d = Math.max(1, Math.min(90, Math.floor(days)));
	return [
		'SELECT blob1 AS metric, blob2 AS kind, blob3 AS device, blob4 AS locale,',
		'quantileExactWeighted(0.75)(double1, _sample_interval) AS p75, SUM(_sample_interval) AS samples',
		`FROM ${DATASETS[env]}`,
		`WHERE timestamp > NOW() - INTERVAL '${d}' DAY`,
		'GROUP BY metric, kind, device, locale',
		'ORDER BY metric, kind, device, locale',
		'FORMAT JSON',
	].join(' ');
}

export interface RumRow {
	metric: string;
	kind: string;
	device: string;
	locale: string;
	p75: number;
	samples: number;
}

function rating(metric: string, value: number): string {
	const t = THRESHOLDS[metric];
	if (!t) return '';
	return value <= t[0] ? 'good' : value <= t[1] ? 'needs improvement' : 'poor';
}

/** A Markdown table of the rows */
export function formatRumReport(env: RumEnv, days: number, rows: RumRow[]): string {
	const lines = [`### Field Core Web Vitals (${env}, last ${days} days, p75)`, '', '| Metric | Page | Device | Locale | p75 | Rating | Samples |', '|---|---|---|---|---|---|---|'];
	for (const r of rows) {
		const v = Number(r.p75);
		const shown = r.metric === 'CLS' ? v.toFixed(3) : `${Math.round(v)} ms`;
		lines.push(`| ${r.metric} | ${r.kind} | ${r.device} | ${r.locale} | ${shown} | ${rating(r.metric, v)} | ${Math.round(Number(r.samples))} |`);
	}
	if (rows.length === 0) lines.push('| – | – | – | – | – | no data | 0 |');
	return lines.join('\n');
}

async function main(argv: string[]): Promise<void> {
	const arg = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
	const env = (arg('--env') ?? 'production') as RumEnv;
	const days = Number(arg('--days') ?? 7);
	const account = process.env.CLOUDFLARE_ACCOUNT_ID;
	const token = process.env.CLOUDFLARE_API_TOKEN;
	if (!DATASETS[env] || !account || !token) {
		process.stderr.write('usage: CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… rum-report.ts [--env production|stage|qa] [--days 7]\n');
		process.exit(2);
	}
	const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: rumSql(env, days),
	});
	const text = await res.text();
	if (!res.ok) {
		process.stderr.write(`Analytics Engine SQL API answered ${res.status}: ${text.slice(0, 300)}\n`);
		process.exit(1);
	}
	const rows = (JSON.parse(text) as { data?: RumRow[] }).data ?? [];
	process.stdout.write(`${formatRumReport(env, days, rows)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main(process.argv.slice(2)).catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	});
}
