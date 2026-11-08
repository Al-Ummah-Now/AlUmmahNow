import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorker, type Deps } from '../check-secrets.ts';
import type { WorkerBinding } from '../cf-api.ts';
import { SECRETS_MANIFEST, type WorkerSecrets } from '../secrets-manifest.ts';

function deps(bindings: WorkerBinding[] | null, opts: { store?: { name: string; status?: string }[]; clients?: Record<string, boolean> } = {}): Deps {
	return {
		bindings: async () => bindings,
		storeSecrets: async () => opts.store ?? [],
		clientIds: async (_db, ids) => new Map(ids.filter((id) => id in (opts.clients ?? {})).map((id) => [id, opts.clients![id]])),
	};
}

const failures = (fs: { ok: boolean; check: string }[]) => fs.filter((f) => !f.ok).map((f) => f.check);

const videos: WorkerSecrets = {
	app: 'api-videos',
	env: 'production',
	worker: 'videos',
	required: [{ name: 'INTERNAL_API_KEY', purpose: 'p' }],
	clientIdVars: [{ name: 'ClientId', required: false }],
};

describe('checkWorker', () => {
	it('passes a seeded worker', async () => {
		const fs = await checkWorker(
			videos,
			deps(
				[
					{ type: 'secrets_store_secret', name: 'INTERNAL_API_KEY', secret_name: 'internal-api-key', store_id: 's' },
					{ type: 'plain_text', name: 'ClientId', text: 'real' },
				],
				{ store: [{ name: 'internal-api-key', status: 'active' }], clients: { real: true } }
			)
		);
		assert.deepEqual(failures(fs), []);
	});

	it('flags the placeholder client id and a binding dropped by wrangler 3', async () => {
		const fs = await checkWorker(videos, deps([{ type: 'plain_text', name: 'ClientId', text: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }]));
		assert.deepEqual(failures(fs), ['secret INTERNAL_API_KEY', 'client 3f2504e0-4f89-11d3-9a0c-0305e82c3301 (var ClientId)']);
	});

	it('requires ClientId only where the app starts logins', async () => {
		assert.deepEqual(failures(await checkWorker({ ...videos, required: [] }, deps([]))), []);
		const web: WorkerSecrets = { app: 'web', env: 'production', worker: 'w', clientIdVars: [{ name: 'ClientId', required: true }] };
		assert.deepEqual(failures(await checkWorker(web, deps([]))), ['client var ClientId']);
	});

	it('fails a Secrets Store binding to a deleted secret and an undeployed worker', async () => {
		const fs = await checkWorker(
			{ ...videos, clientIdVars: [] },
			deps([{ type: 'secrets_store_secret', name: 'INTERNAL_API_KEY', secret_name: 'gone', store_id: 's' }])
		);
		assert.equal(fs.find((f) => f.check === 'secret INTERNAL_API_KEY')?.detail, 'Secrets Store gone does not exist');
		assert.deepEqual(failures(await checkWorker(videos, deps(null))), ['worker exists']);
	});
});

describe('secrets manifest', () => {
	it('covers every deployable app in prod and qa', () => {
		const apps = new Set(SECRETS_MANIFEST.map((e) => `${e.app}:${e.env}`));
		for (const app of ['web', 'admin-web', 'api-videos', 'admin-api', 'websocket-server', 'processor', 'scheduler']) {
			assert.ok(apps.has(`${app}:production`) && apps.has(`${app}:qa`), app);
		}
	});
});
