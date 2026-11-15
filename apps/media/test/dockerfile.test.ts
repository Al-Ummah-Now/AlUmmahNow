import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'container');

describe('container image', () => {
	it('copies every module the job server imports (review.mjs was left out of the image once)', () => {
		const docker = readFileSync(join(dir, 'Dockerfile'), 'utf8');
		const copied = docker.split('\n').filter((l) => l.startsWith('COPY ')).flatMap((l) => l.slice(5).trim().split(/\s+/).slice(0, -1));
		const all = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
		const included = (f: string) => copied.includes(f) || copied.includes('*.mjs');
		for (const f of all) {
			for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/from '\.\/([^']+)'/g)) assert.ok(included(m[1]!), `${f} imports ${m[1]}, which the Dockerfile does not copy`);
		}
		assert.ok(included('server.mjs'));
	});
});
