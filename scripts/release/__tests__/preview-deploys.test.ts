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
		assert.deepEqual(deploys.map((d) => d.app).sort(), ['admin-api', 'admin-web', 'api-videos', 'processor', 'web', 'websocket-server']);
	});

	for (const { app, command } of deploys) {
		it(`${app}: never deploys the production config under a preview name`, () => {
			const config = command.match(/--config\s+(\S+)/)?.[1];
			if (!config) {
				// An env block inherits no routes or bindings from the top level
				assert.match(command, /--env\s+(development|qa)\b/, `${app} preview must pass --config <qa/preview config> or a non-prod --env`);
				return;
			}
			assert.match(config, /^wrangler\.(qa|preview)\.jsonc$/, `${app} preview uses ${config}`);
			const parsed = parseJsonc(readFileSync(resolve(ROOT, 'apps', app, config), 'utf8')) as Record<string, unknown>;
			assert.equal(parsed.routes ?? parsed.route, undefined, `${app}/${config} declares routes; a preview would take them`);
		});
	}
});
