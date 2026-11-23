/**
 * scripts/app-release/app-release.mjs (wiki AUN-APP-UPDATES §3.1, §3.5, APPUPD-4): keys, manifests,
 * signatures and key lists, through the functions and the CLI. Keys are made per run in a temp dir.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// @ts-expect-error plain JS module without types
import * as tool from '../app-release.mjs';

const SCRIPT = fileURLToPath(new URL('../app-release.mjs', import.meta.url));
const run = (args: string[], env: Record<string, string> = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env } });

function workdir() {
	const dir = mkdtempSync(join(tmpdir(), 'app-release-'));
	return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('versions from tags, Apple rebuilds included', () => {
	assert.equal(tool.versionFromTag('v2026.11.22'), '2026.11.22');
	assert.equal(tool.versionFromTag('v2026.11.22.2'), '2026.11.22.2');
	assert.equal(tool.versionFromTag('v1.5.0-preview.3'), '1.5.0-preview.3');
	assert.equal(tool.versionFromTag('v1.2.3-4'), '1.2.3.4');
});

test('sign and verify; one changed byte fails; dual signing passes on either key', async () => {
	const a = await tool.generateKey();
	const b = await tool.generateKey();
	const bytes = new TextEncoder().encode('{"x":1}');
	const sig = await tool.signBytes(bytes, [a.privateKey]);
	assert.equal(await tool.verifyBytes(bytes, sig, [a.publicKey]), a.keyId);
	const tampered = bytes.slice();
	tampered[2] ^= 1;
	assert.equal(await tool.verifyBytes(tampered, sig, [a.publicKey]), null);
	assert.equal(await tool.verifyBytes(bytes, sig, [b.publicKey]), null);
	const both = await tool.signBytes(bytes, [a.privateKey, b.privateKey]);
	assert.equal(JSON.parse(both).signatures.length, 2);
	assert.equal(await tool.verifyBytes(bytes, both, [b.publicKey]), b.keyId);
});

test('build refuses bad input: repo, channel, notes length, private non-admin files, empty releases', () => {
	const { dir, done } = workdir();
	try {
		const file = join(dir, 'x.nupkg');
		writeFileSync(file, 'data');
		const base = { repo: 'AlUmmahNowTools', tag: 'v2026.11.23', channel: 'stable', notesEn: 'a', notesAr: 'ب', artifacts: [{ app: 'tools', platform: 'windows', arch: 'x64', kind: 'velopack-full', file }] };
		const m = tool.buildManifest(base);
		assert.equal(m.artifacts[0].url, 'https://github.com/Al-Ummah-Now/AlUmmahNowTools/releases/download/v2026.11.23/x.nupkg');
		assert.equal(m.artifacts[0].size, 4);
		assert.equal(m.artifacts[0].sha256, '3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7');
		assert.throws(() => tool.buildManifest({ ...base, repo: 'Other' }));
		assert.throws(() => tool.buildManifest({ ...base, channel: 'nightly' }));
		assert.throws(() => tool.buildManifest({ ...base, private: true }), /only admin/);
		assert.throws(() => tool.buildManifest({ ...base, artifacts: [] }), /at least one/);
		const priv = tool.buildManifest({ ...base, private: true, artifacts: [{ ...base.artifacts[0], app: 'admin', kind: 'msix' }] });
		assert.match(priv.artifacts[0].url, /^r2:\/\/app-releases\/AlUmmahNowTools\/v2026.11.23\//);
	} finally {
		done();
	}
});

test('CLI: keygen → build → sign → verify; no key means unsigned with a notice', () => {
	const { dir, done } = workdir();
	try {
		const keyFile = join(dir, 'release.key');
		const kg = run(['keygen', '--out', keyFile]);
		assert.equal(kg.status, 0, kg.stderr);
		assert.equal(statSync(keyFile).mode & 0o777, 0o600);
		assert.ok(!kg.stdout.includes(readFileSync(keyFile, 'utf8').trim()), 'the private key is never printed');
		const pub = /public key: (\S+)/.exec(kg.stdout)![1];
		assert.equal(run(['keygen', '--out', keyFile]).status, 2, 'never overwrites a key');

		writeFileSync(join(dir, 'en.txt'), 'Faster folder scans.');
		writeFileSync(join(dir, 'ar.txt'), 'فحص أسرع للمجلدات.');
		writeFileSync(join(dir, 'full.nupkg'), 'package');
		writeFileSync(join(dir, 'spec.json'), JSON.stringify([{ app: 'tools', platform: 'windows', arch: 'x64', kind: 'velopack-full', file: join(dir, 'full.nupkg') }]));
		const out = join(dir, 'app-release.json');
		const b = run(['build', '--repo', 'AlUmmahNowTools', '--tag', 'v2026.11.23', '--channel', 'stable', '--notes-en', join(dir, 'en.txt'), '--notes-ar', join(dir, 'ar.txt'), '--artifacts', join(dir, 'spec.json'), '--out', out]);
		assert.equal(b.status, 0, b.stderr);

		const unsigned = run(['sign', '--in', out]);
		assert.equal(unsigned.status, 0);
		assert.match(unsigned.stdout, /::notice::/);
		assert.ok(!existsSync(`${out}.sig`));
		assert.equal(run(['sign', '--in', out, '--require']).status, 2);

		const signed = run(['sign', '--in', out], { UPDATE_SIGNING_KEY: readFileSync(keyFile, 'utf8') });
		assert.equal(signed.status, 0, signed.stderr);
		assert.equal(run(['verify', '--in', out, '--pub', pub]).status, 0);
		writeFileSync(out, readFileSync(out, 'utf8').replace('Faster', 'Slower'));
		assert.equal(run(['verify', '--in', out, '--pub', pub]).status, 1, 'a tampered manifest fails');
	} finally {
		done();
	}
});

test('key lists: ids computed from keys, bad input refused', async () => {
	const k = await tool.generateKey();
	const doc = await tool.buildKeyList({ repo: 'AlUmmahNowApple', serial: '2', keys: [k.publicKey], revoked: ['0badc0de'], yanked: ['1.2.3.1'] });
	assert.deepEqual(doc, { schema: 1, repo: 'AlUmmahNowApple', serial: 2, keys: [{ keyId: k.keyId, publicKey: k.publicKey }], revoked: ['0badc0de'], yanked: ['1.2.3.1'] });
	await assert.rejects(() => tool.buildKeyList({ repo: 'AlUmmahNowApple', serial: '0', keys: [k.publicKey] }));
	await assert.rejects(() => tool.buildKeyList({ repo: 'AlUmmahNowApple', serial: '1', keys: ['short'] }));
});
