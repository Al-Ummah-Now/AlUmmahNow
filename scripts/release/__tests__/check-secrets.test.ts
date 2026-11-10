import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorker, declaredInConfig, type Deps } from '../check-secrets.ts';
import type { WorkerBinding } from '../cf-api.ts';
import { SECRETS_MANIFEST, type WorkerSecrets } from '../secrets-manifest.ts';
import { APPS } from '../apps.ts';

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

describe('findings never carry a secret value', () => {
	it('reports a secret by name and binding type only', async () => {
		const value = 'super-secret-value-do-not-print';
		const fs = await checkWorker(
			{ ...videos, clientIdVars: [] },
			deps([{ type: 'secret_text', name: 'INTERNAL_API_KEY', text: value }])
		);
		assert.deepEqual(failures(fs), []);
		assert.ok(!JSON.stringify(fs).includes(value), 'a finding contains the secret value');
	});

	it('does not echo a non-secret binding that shadows a required secret', async () => {
		const value = 'pasted-as-plain-var';
		const fs = await checkWorker({ ...videos, clientIdVars: [] }, deps([{ type: 'plain_text', name: 'INTERNAL_API_KEY', text: value }]));
		assert.deepEqual(failures(fs), ['secret INTERNAL_API_KEY']);
		assert.ok(!JSON.stringify(fs).includes(value), 'a finding contains the plain var value');
	});
});

describe('secrets manifest', () => {
	it('covers every deployable app in production, qa and stage', () => {
		const apps = new Set(SECRETS_MANIFEST.map((e) => `${e.app}:${e.env}`));
		for (const app of ['web', 'admin-web', 'api-videos', 'admin-api', 'websocket-server', 'processor', 'scheduler']) {
			for (const env of ['production', 'qa', 'stage']) assert.ok(apps.has(`${app}:${env}`), `${app}:${env}`);
		}
	});

	it('uses the production and stage worker names from apps.ts', () => {
		for (const rule of APPS) {
			for (const env of ['production', 'stage'] as const) {
				const entry = SECRETS_MANIFEST.find((e) => e.app === rule.app && e.env === env);
				assert.equal(entry?.worker, rule[env]?.name, `${rule.app} ${env}`);
			}
		}
	});

	it('passes a secret the deployed worker lacks when this release binds it to an active secret', async () => {
		const next = (store: { name: string; status?: string }[]): Deps => ({
			...deps([], { store }),
			declared: async (_e, name) => (name === 'INTERNAL_API_KEY' ? { store_id: 's', secret_name: 'internal-api-key' } : null),
		});
		const entry = { ...videos, clientIdVars: [] };
		assert.deepEqual(failures(await checkWorker(entry, next([{ name: 'internal-api-key', status: 'active' }]))), []);
		assert.deepEqual(failures(await checkWorker(entry, next([]))), ['secret INTERNAL_API_KEY']);
		assert.deepEqual(failures(await checkWorker(entry, next([{ name: 'internal-api-key', status: 'disabled' }]))), ['secret INTERNAL_API_KEY']);
	});
});

describe('declaredInConfig', () => {
	it('reads the Secrets Store binding from the production and stage configs', () => {
		const root = new URL('../../..', import.meta.url).pathname;
		const web = (env: 'production' | 'stage' | 'qa') => SECRETS_MANIFEST.find((e) => e.app === 'web' && e.env === env)!;
		assert.deepEqual(declaredInConfig(web('production'), 'INTERNAL_API_KEY', root)?.secret_name, 'internal-api-key');
		assert.deepEqual(declaredInConfig(web('stage'), 'INTERNAL_API_KEY', root)?.secret_name, 'internal-api-key-stage');
		assert.equal(declaredInConfig(web('qa'), 'INTERNAL_API_KEY', root), null);
		const admin = SECRETS_MANIFEST.find((e) => e.app === 'admin-api' && e.env === 'production')!;
		assert.equal(declaredInConfig(admin, 'RESEND_API_KEY', root)?.secret_name, 'RESEND_API_KEY');
		assert.equal(declaredInConfig(admin, 'NOPE', root), null);
	});
});
