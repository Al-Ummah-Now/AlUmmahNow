/**
 * PR previews (deploy.yml, `deploy-preview` label) share QA's account and some of its bindings, so
 * a preview Worker must never take work that belongs to QA (run 43572945300, 2026-11-14: the
 * backend previews were deployed with wrangler.qa.jsonc and tried to attach themselves as consumers
 * of QA's queues; a queue has one consumer, so had it worked the preview would have taken QA's
 * messages, and its crons would have repeated QA's jobs on QA's data):
 *
 * - every workflow deploy of a `*-pr-*` Worker uses a `wrangler.preview.jsonc`;
 * - no `apps/<app>/wrangler.preview.jsonc` (top level or any env) has queue consumers or crons.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc } from './jsonc.ts';
import type { DeployCommand } from './deploy-commands.ts';

/** A deploy of a preview Worker: named `*-pr-<n>` or through a step's preview-name output. */
const PREVIEW_DEPLOY = /--name[=\s]+(?:\$\{\{[^}]*preview-name|\S*-pr-)/;

export function checkPreviewDeploys(commands: DeployCommand[]): string[] {
	return commands
		.filter((c) => PREVIEW_DEPLOY.test(c.command) && !/--config[=\s]+\S*wrangler\.preview\.jsonc\b/.test(c.command))
		.map((c) => `${c.source}:${c.line}: a preview Worker must deploy with its wrangler.preview.jsonc (no QA queue consumers, no crons): ${c.command}`);
}

type Config = Record<string, unknown> & { env?: Record<string, Record<string, unknown>> };

/** Problems in one preview config: queue consumers or crons at the top level or in any env. */
export function checkPreviewConfig(file: string, config: Config): string[] {
	const out: string[] = [];
	const scopes: [string, Record<string, unknown>][] = [['top level', config], ...Object.entries(config.env ?? {}).map(([n, c]) => [`env.${n}`, c] as [string, Record<string, unknown>])];
	for (const [where, scope] of scopes) {
		const consumers = (scope.queues as { consumers?: unknown[] } | undefined)?.consumers;
		if (Array.isArray(consumers) && consumers.length > 0) out.push(`${file} (${where}): a preview never consumes queues (it would take QA's messages)`);
		const crons = (scope.triggers as { crons?: unknown[] } | undefined)?.crons;
		if (Array.isArray(crons) && crons.length > 0) out.push(`${file} (${where}): a preview runs no crons (they would repeat QA's jobs on QA's data)`);
	}
	return out;
}

export function checkPreviewConfigs(root: string): string[] {
	const apps = join(root, 'apps');
	if (!existsSync(apps)) return [];
	const out: string[] = [];
	for (const app of readdirSync(apps)) {
		const file = `apps/${app}/wrangler.preview.jsonc`;
		if (existsSync(join(root, file))) out.push(...checkPreviewConfig(file, parseJsonc(readFileSync(join(root, file), 'utf8')) as Config));
	}
	return out;
}
