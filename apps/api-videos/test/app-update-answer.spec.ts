/**
 * AUN-APP-UPDATES §3.3, §3.4, §3.7, §4.1: the update answer per install source, the minimum rule,
 * version-keyed notes, and the update-failure report. Pure documents; no network.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { updateAnswer, type UpdateContext, type UpdateInput } from '../src/lib/app-updates/answer';
import { minimumProblems } from '../src/lib/app-updates/minimum';
import { emptyReleases, entryKey, type ReleaseEntry, type ReleasesDocument } from '../src/lib/app-updates/releases';
import { buildApp } from './helpers';
import { AppUpdateFailurePost } from '../src/endpoints/app-config/appConfigGet';

const notes = (v: string) => ({ en: `What's new in ${v}.`, ar: `الجديد في ${v}.` });

function entry(over: Partial<ReleaseEntry> & Pick<ReleaseEntry, 'app' | 'platform' | 'version' | 'repo'>): ReleaseEntry {
	const tag = `v${over.version}`;
	return {
		channel: 'stable',
		tag,
		publishedAt: '2026-11-23T18:00:00Z',
		notes: notes(over.version),
		signed: true,
		private: false,
		url: `https://github.com/Al-Ummah-Now/${over.repo}/releases/tag/${tag}`,
		manifestUrl: `https://github.com/Al-Ummah-Now/${over.repo}/releases/download/${tag}/app-release.json`,
		artifacts: [],
		stores: [],
		history: [],
		...over,
	};
}

function releases(entries: ReleaseEntry[], keys: string[] = ['AlUmmahNowTools', 'AlUmmahNowDesktop', 'AlUmmahNowApple', 'AlUmmahNowAndroid']): ReleasesDocument {
	const doc = emptyReleases();
	for (const e of entries) doc.entries[entryKey(e.app, e.platform, e.channel)] = e;
	for (const repo of keys) (doc.keys as Record<string, unknown>)[repo] = { serial: 1, list: `{"repo":"${repo}"}`, sig: '{"signatures":[]}', revoked: [], yanked: [], acceptedAt: '2026-11-23T00:00:00Z' };
	return doc;
}

const tools = entry({
	app: 'tools',
	platform: 'windows',
	repo: 'AlUmmahNowTools',
	version: '2026.11.23',
	artifacts: [{ app: 'tools', platform: 'windows', arch: 'x64', kind: 'velopack-full', url: 'https://github.com/Al-Ummah-Now/AlUmmahNowTools/releases/download/v2026.11.23/full.nupkg', sha256: 'a'.repeat(64), size: 1 }],
});

function ctx(over: Partial<UpdateContext> = {}): UpdateContext {
	return { enabled: true, policy: { minimumVersion: '0.0.0' }, releases: releases([tools]), availability: {}, ...over };
}
const input = (over: Partial<UpdateInput>): UpdateInput => ({ app: 'tools', platform: 'windows', version: '2026.11.22', channel: 'stable', source: 'direct', arch: 'x64', ...over });

describe('update answer per source', () => {
	it('switch off: nothing offered, nothing required', () => {
		const a = updateAnswer(input({ version: '0.1.0' }), ctx({ enabled: false, policy: { minimumVersion: '9.0.0' } }));
		assert.equal(a.enabled, false);
		assert.equal(a.status, 'ok');
		assert.equal(a.action, 'none');
		assert.equal(a.keys, null);
	});

	it('direct: a signed release installs, with its manifest, tag and key list', () => {
		const a = updateAnswer(input({}), ctx());
		assert.equal(a.status, 'recommended');
		assert.equal(a.action, 'install');
		assert.equal(a.manifestUrl, tools.manifestUrl);
		assert.equal(a.tag, 'v2026.11.23');
		assert.equal(a.signed, true);
		assert.deepEqual(a.notes, notes('2026.11.23'));
		assert.deepEqual(a.keys, { list: '{"repo":"AlUmmahNowTools"}', sig: '{"signatures":[]}' });
		assert.equal(a.checkHours, 6);
	});

	it('direct: no installable file for this arch means a download link instead', () => {
		const a = updateAnswer(input({ arch: 'arm64' }), ctx());
		assert.equal(a.action, 'download');
		assert.equal(a.manifestUrl, null);
		assert.equal(a.url, tools.url);
	});

	it('fail closed: an unsigned release, or a repo without keys, is offered to no downloaded build', () => {
		for (const c of [ctx({ releases: releases([{ ...tools, signed: false }]) }), ctx({ releases: releases([tools], []) })]) {
			for (const source of ['direct', 'managed'] as const) {
				const a = updateAnswer(input({ source }), c);
				assert.equal(a.action, 'none', source);
				assert.equal(a.status, 'ok', source);
				assert.equal(a.url, null, source);
				assert.equal(a.manifestUrl, null, source);
			}
		}
	});

	it('App Store: the version Apple serves now, not the uploaded one', () => {
		const viewer = entry({ app: 'viewer', platform: 'ios', repo: 'AlUmmahNowApple', version: '1.3.0.0' });
		const doc = releases([viewer]);
		const noStore = updateAnswer(input({ app: 'viewer', platform: 'ios', version: '1.2.0.0', source: 'appstore' }), ctx({ releases: doc }));
		assert.equal(noStore.status, 'ok', 'still in review: no notice');
		assert.equal(noStore.available, false);
		doc.appStore['net.alummahnow.viewer'] = { version: '1.3.0.0', trackId: 1, url: 'https://apps.apple.com/app/id1', checkedAt: '' };
		const live = updateAnswer(input({ app: 'viewer', platform: 'ios', version: '1.2.0.0', source: 'appstore' }), ctx({ releases: doc }));
		assert.equal(live.status, 'recommended');
		assert.equal(live.action, 'store');
		assert.equal(live.storeUrl, 'https://apps.apple.com/app/id1');
		assert.deepEqual(live.notes, notes('1.3.0.0'));
	});

	it('Apple rebuilds: 1.2.3.2 is newer than 1.2.3.0', () => {
		const doc = releases([]);
		doc.appStore['net.alummahnow.viewer'] = { version: '1.2.3.2', trackId: 1, url: 'https://apps.apple.com/app/id1', checkedAt: '' };
		assert.equal(updateAnswer(input({ app: 'viewer', platform: 'ios', version: '1.2.3.0', source: 'appstore' }), ctx({ releases: doc })).status, 'recommended');
		assert.equal(updateAnswer(input({ app: 'viewer', platform: 'ios', version: '1.2.3.2', source: 'appstore' }), ctx({ releases: doc })).status, 'ok');
	});

	it('TestFlight and Amazon: only once an admin marks the upload available', () => {
		const studio = entry({ app: 'studio', platform: 'ios', repo: 'AlUmmahNowApple', version: '1.4.0.0', channel: 'beta' });
		const c = ctx({ releases: releases([studio]) });
		const before = updateAnswer(input({ app: 'studio', platform: 'ios', version: '1.3.0.0', source: 'testflight', channel: 'beta' }), c);
		assert.equal(before.status, 'ok');
		assert.equal(before.available, false);
		c.availability = { 'studio/ios/testflight': '1.4.0.0' };
		const after = updateAnswer(input({ app: 'studio', platform: 'ios', version: '1.3.0.0', source: 'testflight', channel: 'beta' }), c);
		assert.equal(after.status, 'recommended');
		assert.equal(after.action, 'store');
		assert.equal(after.available, true);
	});

	it('Play: the device decides availability; the answer still carries the version and notes', () => {
		const android = entry({ app: 'viewer', platform: 'android', repo: 'AlUmmahNowAndroid', version: '2026.11.23' });
		const a = updateAnswer(input({ app: 'viewer', platform: 'android', version: '2026.11.20', source: 'play' }), ctx({ releases: releases([android]) }));
		assert.equal(a.available, null);
		assert.equal(a.action, 'store');
		assert.deepEqual(a.notes, notes('2026.11.23'));
	});

	it('beta builds follow the newer of beta and stable; stable builds only stable', () => {
		const beta = entry({ ...tools, version: '2026.11.24', channel: 'beta', tag: 'v2026.11.24' });
		const c = ctx({ releases: releases([tools, beta]) });
		assert.equal(updateAnswer(input({ channel: 'beta' }), c).latestVersion, '2026.11.24');
		assert.equal(updateAnswer(input({ channel: 'stable' }), c).latestVersion, '2026.11.23');
	});

	it('admin builds: versions only, no notes, Download goes to the staff Apps page', () => {
		const admin = entry({ app: 'admin', platform: 'windows', repo: 'AlUmmahNowDesktop', version: '1.4.0', private: true, url: null, manifestUrl: null });
		const c = ctx({ releases: releases([admin]), adminAppsUrl: 'https://admin.alummahnow.net/apps' });
		const a = updateAnswer(input({ app: 'admin', platform: 'windows', version: '1.3.0', source: 'managed' }), c);
		assert.equal(a.action, 'download');
		assert.equal(a.url, 'https://admin.alummahnow.net/apps');
		assert.equal(a.notes, null);
		assert.equal(updateAnswer(input({ app: 'admin', platform: 'windows', version: '1.3.0', source: 'managed' }), { ...c, adminAppsUrl: undefined }).action, 'none');
	});

	it('notes overrides apply to their version only', () => {
		const c = ctx({ policy: { minimumVersion: '0.0.0', notesOverrides: { '2026.11.23': { en: 'Fixed.', ar: 'أُصلح.' }, '2026.11.20': { en: 'Old.', ar: 'قديم.' } } } });
		assert.deepEqual(updateAnswer(input({}), c).notes, { en: 'Fixed.', ar: 'أُصلح.' });
		const next = ctx({ ...c, releases: releases([{ ...tools, version: '2026.11.24', tag: 'v2026.11.24' }]) });
		assert.deepEqual(updateAnswer(input({}), next).notes, notes('2026.11.23'), 'the release’s own notes (entry notes follow its version)');
	});

	it('required with nothing to update to keeps the status but offers no action', () => {
		const a = updateAnswer(input({ app: 'viewer', platform: 'ios', version: '1.0.0', source: 'appstore' }), ctx({ policy: { minimumVersion: '1.1.0' } }));
		assert.equal(a.status, 'required');
		assert.equal(a.action, 'none');
		assert.equal(a.available, false);
	});

	it('checkHours comes from config, clamped to 1–48', () => {
		assert.equal(updateAnswer(input({}), ctx({ checkHours: 100 })).checkHours, 48);
		assert.equal(updateAnswer(input({}), ctx({ checkHours: '3' })).checkHours, 3);
		assert.equal(updateAnswer(input({}), ctx({ checkHours: 'x' })).checkHours, 6);
	});
});

describe('minimum rule (§3.4, §3.7)', () => {
	it('refuses a minimum with no known release, or above what a source offers', () => {
		const doc = releases([tools]);
		doc.appStore['net.alummahnow.viewer'] = { version: '1.2.0', trackId: 1, url: 'https://apps.apple.com/app/id1', checkedAt: '' };
		doc.entries[entryKey('viewer', 'ios', 'stable')] = entry({ app: 'viewer', platform: 'ios', repo: 'AlUmmahNowApple', version: '1.3.0' });
		const problems = minimumProblems(
			{
				'tools/windows': { minimumVersion: '2026.11.23' },
				'tools/macos': { minimumVersion: '2026.11.01' },
				'viewer/ios': { minimumVersion: '1.3.0' },
				'studio/ios': { minimumVersion: '0.0.0' },
				'tools/linux': { minimumVersion: '2026.12.01', latestVersion: '2026.11.01' },
			},
			doc,
			{},
		);
		assert.deepEqual(
			problems.map((p) => p.key),
			['tools/macos', 'viewer/ios', 'tools/linux'],
		);
		assert.match(problems.find((p) => p.key === 'viewer/ios')!.message, /App Store/);
	});

	it('TestFlight marks bound the minimum too', () => {
		const doc = releases([entry({ app: 'studio', platform: 'ios', repo: 'AlUmmahNowApple', version: '1.4.0' })]);
		assert.equal(minimumProblems({ 'studio/ios': { minimumVersion: '1.4.0' } }, doc, { 'studio/ios/testflight': '1.3.0' }).length, 1);
		assert.equal(minimumProblems({ 'studio/ios': { minimumVersion: '1.3.0' } }, doc, { 'studio/ios/testflight': '1.3.0' }).length, 0);
	});
});

class MemoryKV {
	values = new Map<string, string>();
	async get(key: string, opts?: { type?: string }) {
		const v = this.values.get(key);
		if (v === undefined) return null;
		return opts?.type === 'json' ? JSON.parse(v) : v;
	}
	async put(key: string, value: string) {
		this.values.set(key, value);
	}
	async delete(key: string) {
		this.values.delete(key);
	}
}

describe('POST /api/app-config/update-failure', () => {
	const app = () => buildApp((r) => r.post('/api/app-config/update-failure', AppUpdateFailurePost));
	const report = { app: 'tools', platform: 'windows', version: '2026.11.22', repo: 'AlUmmahNowTools', tag: 'v2026.11.23', reason: 'hash' };
	const post = (body: unknown, env: Record<string, unknown>) =>
		app().fetch(new Request('http://x/api/app-config/update-failure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env as never, { waitUntil() {}, passThroughOnException() {} } as never);

	it('notes a known tag once per hour per reason; unknown tags are ignored', async () => {
		const kv = new MemoryKV();
		const doc = emptyReleases();
		doc.seen['github:AlUmmahNowTools'] = ['v2026.11.23'];
		await kv.put('releases', JSON.stringify(doc));
		assert.equal((await post(report, { APP_CONFIG: kv })).status, 202);
		assert.ok(kv.values.has('update-failure:AlUmmahNowTools:v2026.11.23:hash'));
		assert.equal((await post({ ...report, tag: 'v9.9.9' }, { APP_CONFIG: kv })).status, 202);
		assert.ok(!kv.values.has('update-failure:AlUmmahNowTools:v9.9.9:hash'));
	});

	it('refuses unknown reasons and repos, and answers 429 when rate-limited', async () => {
		assert.equal((await post({ ...report, reason: 'whatever' }, {})).status, 400);
		assert.equal((await post({ ...report, repo: 'Other' }, {})).status, 400);
		assert.equal((await post(report, { SUGGEST_LIMITER: { limit: async () => ({ success: false }) } })).status, 429);
	});
});
