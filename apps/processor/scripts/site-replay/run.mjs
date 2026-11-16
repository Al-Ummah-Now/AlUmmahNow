#!/usr/bin/env node
/**
 * Replays the site counters lost before #1476 into analytics_daily (#1477, src/lib/site-replay.ts).
 *
 *   node scripts/site-replay/run.mjs --env qa|stage|prod --cutoff <ISO> [--from YYYY-MM-DD] [--apply]
 *
 * --cutoff: the deploy time of the first processor version with #1476 in that env, less 60 s
 *   (`wrangler deployments list --name <processor>`): messages received after it were counted live,
 *   and a minute covers those still queued at the deploy (an under-count of seconds at worst, never
 *   a double count).
 * Without --apply it is a dry run (counts per day). Running --apply again writes nothing: each site
 * and day carries a marker row.
 *
 * It writes a config binding only MESSAGES_BUCKET and NOTIFICATIONS_DB of that env to a temp dir,
 * serves scripts/site-replay/worker.ts with `wrangler dev --remote` (nothing is deployed, no queue
 * consumer, no cron) and calls it once.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const processorDir = resolve(here, '..', '..');

function arg(name) {
	const i = process.argv.indexOf(`--${name}`);
	return i === -1 ? undefined : process.argv[i + 1];
}
const envName = arg('env');
const cutoff = arg('cutoff');
const from = arg('from');
const apply = process.argv.includes('--apply');
if (!['qa', 'stage', 'prod'].includes(envName ?? '') || !cutoff || !Number.isFinite(Date.parse(cutoff))) {
	console.error('usage: run.mjs --env qa|stage|prod --cutoff <ISO> [--from YYYY-MM-DD] [--apply]');
	process.exit(2);
}

/** JSONC without comments or trailing commas (strings kept intact). */
export function parseJsonc(text) {
	let out = '';
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') {
			let j = i + 1;
			while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j;
		} else if (c === '/' && text[i + 1] === '/') {
			while (i < text.length && text[i] !== '\n') i++;
			out += '\n';
		} else if (c === '/' && text[i + 1] === '*') {
			i = text.indexOf('*/', i + 2) + 1;
		} else out += c;
	}
	return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

const file = envName === 'qa' ? 'wrangler.qa.jsonc' : 'wrangler.jsonc';
const root = parseJsonc(readFileSync(join(processorDir, file), 'utf8'));
const cfg = envName === 'stage' ? { ...root, ...root.env.stage } : root;
const d1 = (cfg.d1_databases ?? []).find((d) => d.binding === 'NOTIFICATIONS_DB');
const r2 = (cfg.r2_buckets ?? []).find((b) => b.binding === 'MESSAGES_BUCKET');
if (!d1 || !r2) throw new Error(`NOTIFICATIONS_DB or MESSAGES_BUCKET missing in ${file} (${envName})`);

const dir = mkdtempSync(join(tmpdir(), 'site-replay-'));
const config = {
	name: `site-replay-${envName}`,
	main: join(here, 'worker.ts'),
	compatibility_date: root.compatibility_date,
	compatibility_flags: root.compatibility_flags,
	d1_databases: [{ binding: 'NOTIFICATIONS_DB', database_name: d1.database_name, database_id: d1.database_id, remote: true }],
	r2_buckets: [{ binding: 'MESSAGES_BUCKET', bucket_name: r2.bucket_name, remote: true }],
	vars: apply ? { REPLAY_ALLOW_APPLY: '1' } : {},
};
const configPath = join(dir, 'wrangler.json');
writeFileSync(configPath, JSON.stringify(config, null, 2));
console.error(`[site-replay] ${envName}: ${d1.database_name} + ${r2.bucket_name}, cutoff ${cutoff}, ${apply ? 'APPLY' : 'dry run'}`);

const port = 18000 + Math.floor(Math.random() * 1000);
const child = spawn('npx', ['wrangler', 'dev', '--remote', '-c', configPath, '--port', String(port), '--inspector-port', String(port + 1000)], {
	cwd: processorDir,
	stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => (log += d));
child.stderr.on('data', (d) => (log += d));

const stop = () => {
	child.kill('SIGTERM');
	rmSync(dir, { recursive: true, force: true });
};
try {
	const query = new URLSearchParams({ cutoff, ...(from ? { from } : {}), ...(apply ? { apply: '1' } : {}) });
	let result;
	for (let attempt = 0; attempt < 90 && !result; attempt++) {
		await new Promise((r) => setTimeout(r, 2000));
		if (!/Ready on/.test(log)) continue;
		try {
			const res = await fetch(`http://127.0.0.1:${port}/?${query}`, { signal: AbortSignal.timeout(600_000) });
			result = { status: res.status, body: await res.json() };
		} catch {
			/* not serving yet */
		}
	}
	if (!result) throw new Error(`wrangler dev did not answer:\n${log.slice(-2000)}`);
	console.log(JSON.stringify(result.body, null, 2));
	if (result.status !== 200) process.exitCode = 1;
} finally {
	stop();
}
