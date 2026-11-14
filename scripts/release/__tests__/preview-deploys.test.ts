/**
 * PR previews deploy with `wrangler deploy --name <preview>`. With a config that
 * declares a custom domain (the production top level), wrangler moves that domain
 * to the preview: on 2026-11-09 a preview took admin.api.alummahnow.net and served
 * prod traffic. Previews must use a config with no routes and no production data.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseJsonc } from '../jsonc.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const workflow = readFileSync(resolve(ROOT, '.github/workflows/deploy.yml'), 'utf8');

/** Each `cd apps/<app>` + `wrangler deploy ... --name` block, joined across `\` continuations. */
function previewDeploys(): { app: string; command: string }[] {
	const out: { app: string; command: string }[] = [];
	const lines = workflow.split('\n');
	let app = '';
	for (let i = 0; i < lines.length; i++) {
		const cd = lines[i].match(/^\s*cd apps\/([\w-]+)/);
		if (cd) app = cd[1];
		if (!/wrangler deploy\b/.test(lines[i])) continue;
		let command = lines[i];
		while (command.trimEnd().endsWith('\\') && i + 1 < lines.length) command = command.trimEnd().slice(0, -1) + ' ' + lines[++i].trim();
		if (/--name\b/.test(command)) out.push({ app, command });
	}
	return out;
}

describe('PR preview deploys', () => {
	const deploys = previewDeploys();

	it('finds the preview deploys', () => {
		// Only the web preview (2026-11-14): the backend previews on wrangler.qa.jsonc tried to consume QA's queues
		assert.deepEqual(deploys.map((d) => d.app).sort(), ['web']);
	});

	for (const { app, command } of deploys) {
		it(`${app}: deploys its preview config (no routes, queue consumers or crons)`, () => {
			const config = command.match(/--config\s+(\S+)/)?.[1];
			assert.ok(config, `${app} preview must pass --config wrangler.preview.jsonc`);
			assert.match(config, /^wrangler\.preview\.jsonc$/, `${app} preview uses ${config}`);
			const parsed = parseJsonc(readFileSync(resolve(ROOT, 'apps', app, config), 'utf8')) as Record<string, unknown>;
			assert.equal(parsed.routes ?? parsed.route, undefined, `${app}/${config} declares routes; a preview would take them`);
		});
	}
});
