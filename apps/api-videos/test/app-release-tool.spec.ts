/**
 * APPUPD-4: what scripts/app-release/app-release.mjs writes (the file every app repo's release
 * workflow copies) is exactly what the server and the apps verify (shared-types app-updates.ts).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appReleaseTrustFrom, verifyAppReleaseManifest, verifyAppUpdateKeyList } from '@al-ummah/shared-types';
// @ts-expect-error plain JS module without types
import * as tool from '../../../scripts/app-release/app-release.mjs';

const enc = new TextEncoder();

describe('app-release tool ↔ shared-types verifier', () => {
	it('a built, signed manifest and a root-signed key list verify; changing either fails', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'app-release-compat-'));
		try {
			const root = await tool.generateKey();
			const release = await tool.generateKey();
			const file = join(dir, 'AlUmmahNow.Tools-2026.11.23-win-full.nupkg');
			writeFileSync(file, 'package bytes');
			const manifest = tool.buildManifest({
				repo: 'AlUmmahNowTools',
				tag: 'v2026.11.23',
				channel: 'stable',
				notesEn: 'Faster folder scans.',
				notesAr: 'فحص أسرع للمجلدات.',
				artifacts: [{ app: 'tools', platform: 'windows', arch: 'x64', kind: 'velopack-full', file }],
				publishedAt: '2026-11-23T18:04:11Z',
			});
			const manifestBytes = enc.encode(JSON.stringify(manifest, null, 2) + '\n');
			const keyList = await tool.buildKeyList({ repo: 'AlUmmahNowTools', serial: 1, keys: [release.publicKey] });
			const keyListBytes = enc.encode(JSON.stringify(keyList, null, 2) + '\n');

			const listResult = await verifyAppUpdateKeyList(keyListBytes, await tool.signBytes(keyListBytes, [root.privateKey]), [root.publicKey], { repo: 'AlUmmahNowTools' });
			assert.equal(listResult.ok, true);
			const trust = appReleaseTrustFrom((listResult as { list: never }).list);
			const result = await verifyAppReleaseManifest(manifestBytes, await tool.signBytes(manifestBytes, [release.privateKey]), trust, { repo: 'AlUmmahNowTools', tag: 'v2026.11.23', channels: ['stable'], newerThan: '2026.11.22' });
			assert.equal(result.ok, true, JSON.stringify(result));

			const tampered = manifestBytes.slice();
			tampered[10] ^= 1;
			assert.equal((await verifyAppReleaseManifest(tampered, await tool.signBytes(manifestBytes, [release.privateKey]), trust, { repo: 'AlUmmahNowTools' })).ok, false);
			assert.equal((await verifyAppUpdateKeyList(keyListBytes, await tool.signBytes(keyListBytes, [release.privateKey]), [root.publicKey], { repo: 'AlUmmahNowTools' })).ok, false, 'a release key cannot sign a key list');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
