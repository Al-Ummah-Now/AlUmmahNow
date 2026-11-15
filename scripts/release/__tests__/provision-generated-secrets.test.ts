import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, createPrivateKey, sign, verify } from 'node:crypto';
import { GENERATORS, generateVapid, provision, summary, type Deps } from '../provision-generated-secrets.ts';
import { GENERATED_SECRETS } from '../secrets-manifest.ts';

function fake(existing: string[], opts: { fail?: boolean } = {}) {
	const created: { storeId: string; secrets: { name: string; value: string; scopes: string[] }[] }[] = [];
	const masked: string[] = [];
	const deps: Deps = {
		existing: async () => new Set(existing),
		create: async (storeId, secrets) => {
			if (opts.fail) throw new Error('POST /secrets_store/stores/s/secrets -> 403 10000: Authentication error');
			created.push({ storeId, secrets });
		},
		mask: (v) => void masked.push(v),
		generators: { vapid: () => ({ publicKey: 'PUB', privateKey: 'PRIV' }) },
	};
	return { deps, created, masked };
}

describe('generateVapid', () => {
	it('makes a P-256 pair in the web-push format (65-byte point, 32-byte d) that signs and verifies', () => {
		const { publicKey, privateKey } = generateVapid();
		const point = Buffer.from(publicKey, 'base64url');
		assert.equal(point.length, 65);
		assert.equal(point[0], 4);
		assert.equal(Buffer.from(privateKey, 'base64url').length, 32);
		const jwk = { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') };
		const priv = createPrivateKey({ key: { ...jwk, d: privateKey }, format: 'jwk' });
		const sig = sign('sha256', Buffer.from('x'), priv);
		assert.ok(verify('sha256', Buffer.from('x'), createPublicKey({ key: jwk, format: 'jwk' }), sig));
		assert.notEqual(generateVapid().privateKey, privateKey);
	});
});

describe('provision', () => {
	it('creates each env pair in one request, scope workers, with the env suffix, masking every value', async () => {
		const f = fake([]);
		const out = await provision(['qa', 'stage', 'production'], f.deps, { storeId: 's' });
		assert.deepEqual(out.map((o) => [o.env, o.result]), [['qa', 'created'], ['stage', 'created'], ['production', 'created']]);
		assert.deepEqual(f.created.map((c) => c.secrets.map((s) => s.name)), [
			['vapid-public-key-qa', 'vapid-private-key-qa'],
			['vapid-public-key-stage', 'vapid-private-key-stage'],
			['vapid-public-key', 'vapid-private-key'],
		]);
		assert.ok(f.created.every((c) => c.storeId === 's' && c.secrets.every((s) => s.scopes.join() === 'workers')));
		assert.deepEqual(f.created[0]!.secrets.map((s) => s.value), ['PUB', 'PRIV']);
		assert.deepEqual(f.masked, ['PUB', 'PRIV', 'PUB', 'PRIV', 'PUB', 'PRIV']);
	});

	it('never overwrites: an existing pair is skipped and nothing is generated for it', async () => {
		const f = fake(['vapid-public-key-qa', 'vapid-private-key-qa']);
		const out = await provision(['qa'], f.deps);
		assert.deepEqual(out, [{ env: 'qa', names: ['vapid-public-key-qa', 'vapid-private-key-qa'], result: 'skipped', detail: 'exists' }]);
		assert.deepEqual(f.created, []);
		assert.deepEqual(f.masked, []);
	});

	it('half a pair creates nothing and is reported as partial', async () => {
		const f = fake(['vapid-private-key-stage']);
		const [o] = await provision(['stage'], f.deps);
		assert.equal(o!.result, 'partial');
		assert.match(o!.detail!, /only vapid-private-key-stage exists/);
		assert.deepEqual(f.created, []);
	});

	it('dry run reports what it would create and creates nothing', async () => {
		const f = fake([]);
		const out = await provision(['production'], f.deps, { dryRun: true });
		assert.equal(out[0]!.result, 'would create');
		assert.deepEqual(f.created, []);
	});

	it('a failed create is reported per env without values', async () => {
		const f = fake([], { fail: true });
		const out = await provision(['qa'], f.deps);
		assert.equal(out[0]!.result, 'failed');
		const text = summary(out);
		assert.match(text, /\| qa \| `vapid-public-key-qa`, `vapid-private-key-qa` \| failed \(.*403/);
		assert.doesNotMatch(text, /PUB|PRIV/);
	});

	it('the summary lists names and results only', async () => {
		const f = fake(['vapid-public-key', 'vapid-private-key']);
		const text = summary(await provision(['qa', 'production'], f.deps));
		assert.match(text, /\| qa \| .* \| created \|/);
		assert.match(text, /\| production \| .* \| skipped \(exists\) \|/);
		assert.doesNotMatch(text, /PUB|PRIV/);
	});

	it('every generated group has a generator', () => {
		for (const g of GENERATED_SECRETS) {
			const parts = Object.keys(GENERATORS[g.generated]());
			assert.deepEqual(parts.sort(), Object.keys(g.names).sort());
		}
	});
});
