import { THEME_DEMO } from '../theme-demo-keep.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	PINNED_E2E_USER_TIMESTAMPS,
	accountKind,
	applyMinAge,
	assertQaTarget,
	blockChannelDeletion,
	classifyChannel,
	isThemeDemoChannel,
	classifyHandleEntry,
	classifyTabsConfig,
	classifyPlaylist,
	classifyPost,
	classifyScheduleEntry,
	classifySection,
	classifyVideo,
	junkCommentIds,
	scheduleEntryVideoId,
	staleProfileChannels,
} from '../e2e-leftovers.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

const EMAILS: Record<string, string> = {
	seed: 'qa-creator@delivered.resend.dev',
	pinned: 'test-single-1795000000001@e2e.alummahnow.net',
	oldRun: 'test-single-1794059336742@delivered.resend.dev',
	release: 'rel-multi-a-1794197203564-r8082e@e2e.alummahnow.net',
	probe: 'probe-ch-1794124464912-4rv8m7@e2e.alummahnow.net',
	owner: 'someone@msn.com',
};
const owner = (userId: string | undefined) => (userId ? EMAILS[userId] : undefined);
const video = (userId: string, title: string, id = 'v1') => ({ id, userId, title });

describe('accountKind', () => {
	it('recognises the seed, pinned CI, throwaway and other accounts', () => {
		assert.equal(accountKind(EMAILS.seed), 'seed');
		assert.equal(accountKind('QA-Viewer@delivered.resend.dev'), 'seed');
		assert.equal(accountKind(EMAILS.pinned), 'pinned-e2e');
		assert.equal(accountKind('test-scratch-1795000000005@e2e.alummahnow.net'), 'pinned-e2e');
		assert.equal(accountKind(EMAILS.oldRun), 'throwaway');
		assert.equal(accountKind(EMAILS.release), 'throwaway');
		assert.equal(accountKind(EMAILS.probe), 'throwaway');
		assert.equal(accountKind('test-settings-mw89io20@delivered.resend.dev'), 'throwaway');
		assert.equal(accountKind(EMAILS.owner), 'other');
		assert.equal(accountKind(undefined), 'unknown');
	});

	it('does not treat look-alike addresses as test accounts', () => {
		for (const e of [
			'test-single-1795000000001@e2e.alummahnow.net.evil.com',
			'test-single-1795000000001@gmail.com',
			'xtest-single-1794059336742@delivered.resend.dev',
			'qa-creator@gmail.com',
		]) {
			assert.equal(accountKind(e), 'other', e);
		}
	});

	it('pins only the current CI user timestamps (the old delivered.resend.dev users are retired)', () => {
		assert.equal(accountKind('test-single-1795000000001@delivered.resend.dev'), 'throwaway');
		assert.equal(accountKind('test-single-1795000000006@e2e.alummahnow.net'), 'throwaway');
	});

	it('matches the users pinned in .github/workflows/e2e-tests.yml', () => {
		const workflow = readFileSync(join(ROOT, '.github/workflows/e2e-tests.yml'), 'utf8');
		const pinned = [...new Set([...workflow.matchAll(/"users":"(\d+)"/g)].map((m) => m[1]))].sort();
		assert.deepEqual(pinned, [...PINNED_E2E_USER_TIMESTAMPS].sort());
	});
});

describe('classifyVideo', () => {
	it('keeps the owner-requested video whatever it is', () => {
		const v = { id: '443418c1-dc70-43d9-944d-5388ab7dc4c3', userId: 'oldRun', title: 'E2E Temp batch x 1' };
		assert.equal(classifyVideo(v, owner).action, 'keep');
	});

	it('keeps the QA seed fixtures and other seed-account content', () => {
		assert.equal(classifyVideo(video('seed', 'QA Lecture 1 — Introduction to Tafsir'), owner).reason, 'QA seed fixture');
		assert.equal(classifyVideo(video('seed', 'QA Nasheed Short — Vertical Clip'), owner).action, 'keep');
		assert.equal(classifyVideo(video('seed', 'Something new'), owner).action, 'keep');
		assert.equal(classifyVideo(video('seed', 'E2E Temp left on a seed account'), owner).action, 'delete');
	});

	it('deletes temp E2E and release content of test accounts, including pinned ones', () => {
		for (const [u, t] of [
			['oldRun', 'E2E Temp batch mw6h8bd6ez9q 1'],
			['pinned', 'E2E Temp dashboard-public mw8nthnxxnj5'],
			['release', 'Release E2E upload mw7sydib'],
		]) {
			assert.equal(classifyVideo(video(u, t), owner).action, 'delete', t);
		}
	});

	it('keeps the E2E seed videos of pinned users and deletes those of retired accounts', () => {
		assert.equal(classifyVideo(video('pinned', 'E2E Seed Scheduled Video'), owner).action, 'keep');
		assert.equal(classifyVideo(video('oldRun', 'E2E Seed Scheduled Video'), owner).action, 'delete');
		assert.equal(classifyVideo(video('nobody', 'E2E Seed Video'), owner).action, 'delete');
	});

	it('never deletes content of non-test accounts; temp titles there are unsure', () => {
		assert.equal(classifyVideo(video('owner', 'My lecture'), owner).action, 'keep');
		assert.equal(classifyVideo(video('owner', 'E2E Temp something'), owner).action, 'unsure');
	});

	it('puts throwaway-owned videos without a test title on the unsure list', () => {
		assert.equal(classifyVideo(video('oldRun', 'Test Video'), owner).action, 'unsure');
		assert.equal(classifyVideo(video('pinned', 'Test Video'), owner).action, 'keep');
	});

	it('requires the marker at the start of the title', () => {
		assert.equal(classifyVideo(video('oldRun', 'Not an E2E Temp video'), owner).action, 'unsure');
		assert.equal(classifyVideo(video('oldRun', 'E2E Temporary'), owner).action, 'unsure');
	});
});

describe('junkCommentIds', () => {
	it('finds probe comments and replies, and keeps everything else', () => {
		const ids = junkCommentIds({
			id: 'v',
			comments: [
				{ id: 'a', text: 'ws probe 1794035449099' },
				{ id: 'b', text: 'tres', replies: [{ id: 'b1', text: 'release live comment 1794167488544' }, { id: 'b2', text: 'thanks' }] },
				{ id: 'c', text: 'E2E Temp Comment keep mw64dvrddqer' },
				{ id: 'd', text: 'JazakAllahu khairan for this QA lecture! [qa-seed]' },
				{ id: 'e', text: 'a ws probe 1' },
				{ id: 'f', text: 'ws probe' },
			],
		});
		assert.deepEqual(ids, ['a', 'b1', 'c']);
	});

	it('does not look into the replies of a comment that goes anyway', () => {
		assert.deepEqual(junkCommentIds({ id: 'v', comments: [{ id: 'a', text: 'ws probe 1', replies: [{ id: 'a1', text: 'ws probe 2' }] }] }), ['a']);
	});
});

describe('classifyChannel', () => {
	const ch = (email: string, name: string, isMain = true) => ({ id: 'c', email, name, isMain });

	it('keeps seed, pinned and non-test channels', () => {
		assert.equal(classifyChannel(ch(EMAILS.seed, 'QA Nasheeds')).reason, 'QA seed fixture');
		assert.equal(classifyChannel(ch(EMAILS.pinned, 'E2E Single Channel')).action, 'keep');
		assert.equal(classifyChannel(ch(EMAILS.owner, 'test')).action, 'keep');
		assert.equal(classifyChannel({ id: 'c', name: 'E2E Single Channel' }).action, 'keep');
	});

	it('deletes the channels of retired throwaway accounts', () => {
		for (const [e, n] of [
			[EMAILS.oldRun, 'E2E Multi Channel Two'],
			[EMAILS.release, 'Release E2E A channel 2 mw8qp7us'],
			[EMAILS.probe, 'Probe ch'],
			['rel-chunks-1794150552483-hucmrl@e2e.alummahnow.net', '#290 chunks mw7yx61f'],
			['test-mobile288-1794144244080@delivered.resend.dev', 'Mobile Edit 288'],
		]) {
			assert.equal(classifyChannel(ch(e, n)).action, 'delete', n);
		}
	});

	it('deletes leftover throwaway channels of pinned users, never their main channel', () => {
		assert.equal(classifyChannel(ch(EMAILS.pinned, 'E2E Temp Channel abc', false)).action, 'delete');
		assert.equal(classifyChannel(ch(EMAILS.pinned, 'قناة اختبار 1', false)).action, 'delete');
		assert.equal(classifyChannel(ch(EMAILS.pinned, 'E2E Temp Channel abc', true)).action, 'keep');
	});

	it('is unsure about throwaway channels with a realistic name', () => {
		assert.equal(classifyChannel(ch('test-settings-mw89io20@delivered.resend.dev', 'Noor Recitations')).action, 'unsure');
	});
});

describe('blockChannelDeletion', () => {
	const del = { action: 'delete' as const, reason: 'channel of a retired throwaway test account' };
	it('keeps a channel that still holds a kept or unsure video', () => {
		assert.equal(blockChannelDeletion(del, ['delete', 'unsure']).action, 'unsure');
		assert.equal(blockChannelDeletion(del, ['keep']).action, 'unsure');
	});
	it('lets it go when every video on it goes', () => {
		assert.equal(blockChannelDeletion(del, ['delete', 'delete']).action, 'delete');
		assert.equal(blockChannelDeletion(del, []).action, 'delete');
	});
	it('never turns a keep into a delete', () => {
		assert.equal(blockChannelDeletion({ action: 'keep', reason: 'x' }, ['delete']).action, 'keep');
	});
});

describe('posts, playlists, sections', () => {
	it('deletes temp posts and the posts of deleted channels', () => {
		assert.equal(classifyPost('E2E Temp Quiz mw1 how many pillars?', 'keep').action, 'delete');
		assert.equal(classifyPost('Assalamu alaikum! Welcome… [qa-seed]', 'keep').action, 'keep');
		assert.equal(classifyPost('Anything', 'delete').action, 'delete');
		assert.equal(classifyPost(undefined, undefined).action, 'keep');
	});
	it('keeps the seed playlists', () => {
		assert.equal(classifyPlaylist({ title: 'QA Lectures — Starter Playlist' }, 'delete').action, 'keep');
		assert.equal(classifyPlaylist({ title: 'E2E Temp playlist x' }, 'keep').action, 'delete');
		assert.equal(classifyPlaylist({ title: 'Mine' }, 'delete').action, 'delete');
		assert.equal(classifyPlaylist({ title: 'Mine' }, 'keep').action, 'keep');
	});
	it('deletes temp sections', () => {
		assert.equal(classifySection('E2E Temp Second mw6fhlnrzz3m', 'keep').action, 'delete');
		assert.equal(classifySection('Recent uploads', 'keep').action, 'keep');
		assert.equal(classifySection('Recent uploads', 'delete').action, 'delete');
	});
});

describe('schedule entries', () => {
	it('reads the video id from the key', () => {
		assert.equal(scheduleEntryVideoId('2026-11-12/15/c0935e93-ef70-4d08-973a-16037f44cd9d.json'), 'c0935e93-ef70-4d08-973a-16037f44cd9d');
		assert.equal(scheduleEntryVideoId('index.json'), null);
		assert.equal(scheduleEntryVideoId('2026-11-12/c0935e93.json'), null);
	});
	it('deletes entries of missing or deleted videos only', () => {
		const key = '2026-11-12/15/v.json';
		assert.equal(classifyScheduleEntry(key, 'missing').action, 'delete');
		assert.equal(classifyScheduleEntry(key, 'delete').action, 'delete');
		assert.equal(classifyScheduleEntry(key, 'keep').action, 'keep');
		assert.equal(classifyScheduleEntry(key, 'unsure').action, 'keep');
		assert.equal(classifyScheduleEntry('other/key', 'missing').action, 'keep');
	});
});

describe('staleProfileChannels', () => {
	const existing = new Set(['a', 'b', 'c']);
	const deleting = new Set(['b']);
	it('lists deleted and missing channels of test accounts', () => {
		assert.deepEqual(staleProfileChannels({ email: EMAILS.oldRun, channels: ['a', 'b', 'gone'] }, existing, deleting), ['b', 'gone']);
		assert.deepEqual(staleProfileChannels({ email: EMAILS.pinned, channels: ['a', 'gone'] }, existing, deleting), ['gone']);
		assert.deepEqual(staleProfileChannels({ email: EMAILS.oldRun }, existing, deleting), []);
	});
	it('never edits seed or real accounts', () => {
		assert.deepEqual(staleProfileChannels({ email: EMAILS.owner, channels: ['gone'] }, existing, deleting), []);
		assert.deepEqual(staleProfileChannels({ email: EMAILS.seed, channels: ['gone'] }, existing, deleting), []);
		assert.deepEqual(staleProfileChannels({ channels: ['gone'] }, existing, deleting), []);
	});
});

describe('theme-demo keep-list', () => {
	const demoChannel = [...THEME_DEMO.channelIds][0];
	const demoVideo = [...THEME_DEMO.videoIds][0];
	const demoPlaylist = [...THEME_DEMO.playlistIds][0];
	const demoEmail = 'demo-aswaq@delivered.resend.dev';
	it('has the 7 channels, 47 videos and 4 playlists of the seeded demo set', () => {
		assert.equal(THEME_DEMO.channelIds.size, 7);
		assert.equal(THEME_DEMO.videoIds.size, 47);
		assert.equal(THEME_DEMO.playlistIds.size, 4);
		assert.ok(THEME_DEMO.videoIds.has('e42e5deb-c86a-40b0-b8ec-6072fc550dba'), 'Lantern Makers of Old Cairo (unplayable on purpose)');
	});
	it('treats the demo accounts as their own kind, not as test accounts', () => {
		assert.equal(accountKind(demoEmail), 'demo');
		assert.equal(accountKind('demo-nobody@delivered.resend.dev'), 'other');
	});
	it('keeps demo videos, channels, playlists, posts, sections, handles and tabs whatever they look like', () => {
		const lookup = (u: string | undefined) => (u === 'd' ? demoEmail : u === 'r' ? EMAILS.release : undefined);
		assert.equal(classifyVideo({ id: demoVideo, userId: 'r', title: 'E2E Temp x' }, lookup).action, 'keep');
		assert.equal(classifyVideo({ id: 'other', userId: 'd', title: 'E2E Temp x' }, lookup).action, 'keep');
		assert.equal(classifyVideo({ id: 'other', userId: 'r', channelId: demoChannel, title: 'Release E2E x' }, lookup).action, 'keep');
		assert.equal(classifyChannel({ id: demoChannel, email: EMAILS.release, name: 'Release E2E x' }).action, 'keep');
		assert.equal(classifyChannel({ id: 'c', email: demoEmail, name: 'E2E Temp Channel x' }).action, 'keep');
		assert.equal(classifyPlaylist({ id: demoPlaylist, title: 'E2E Temp p' }, 'delete').action, 'keep');
		assert.equal(classifyPlaylist({ id: 'p', channelId: demoChannel, title: 'E2E Temp p' }, 'delete').action, 'keep');
		assert.equal(classifyPost('E2E Temp post', 'delete', demoChannel).action, 'keep');
		assert.equal(classifySection('E2E Temp s', 'delete', demoChannel).action, 'keep');
		assert.equal(classifyHandleEntry({ channelId: demoChannel }, EMAILS.release, new Set(), new Set()).action, 'keep');
		assert.equal(classifyTabsConfig(`channel-tabs/${demoChannel}`, new Set(), new Set()).action, 'keep');
		assert.ok(isThemeDemoChannel(demoChannel) && !isThemeDemoChannel(undefined));
	});
	it('matches apps/web/demo-content/demo-set.json once that file is on the branch', () => {
		const file = join(ROOT, 'apps/web/demo-content/demo-set.json');
		if (!existsSync(file)) return;
		const set = JSON.parse(readFileSync(file, 'utf8'));
		assert.deepEqual([...THEME_DEMO.channelIds].sort(), [...set.channels].sort());
		assert.deepEqual([...THEME_DEMO.videoIds].sort(), [...new Set([...set.videos, ...set.shorts, ...set.extraVideos])].sort());
		assert.deepEqual([...THEME_DEMO.playlistIds].sort(), [...set.playlists].sort());
	});
});

describe('handles and tab configs', () => {
	const existing = new Set(['a', 'b']);
	const deleting = new Set(['b']);
	it('releases dead handles of test accounts only', () => {
		assert.equal(classifyHandleEntry({ channelId: 'gone' }, EMAILS.release, existing, deleting).action, 'delete');
		assert.equal(classifyHandleEntry({ channelId: 'b' }, EMAILS.oldRun, existing, deleting).action, 'delete');
		assert.equal(classifyHandleEntry({ channelId: 'a' }, EMAILS.oldRun, existing, deleting).action, 'keep');
		assert.equal(classifyHandleEntry({ channelId: 'gone' }, EMAILS.owner, existing, deleting).action, 'unsure');
		assert.equal(classifyHandleEntry({ channelId: 'gone' }, undefined, existing, deleting).action, 'unsure');
		assert.equal(classifyHandleEntry(null, EMAILS.oldRun, existing, deleting).action, 'keep');
	});
	it('removes tab configs of channels that are gone', () => {
		assert.equal(classifyTabsConfig('channel-tabs/gone', existing, deleting).action, 'delete');
		assert.equal(classifyTabsConfig('channel-tabs/b', existing, deleting).action, 'delete');
		assert.equal(classifyTabsConfig('channel-tabs/a', existing, deleting).action, 'keep');
		assert.equal(classifyTabsConfig('channel-handles/x', existing, deleting).action, 'keep');
	});
});

describe('applyMinAge', () => {
	const now = Date.parse('2026-11-09T12:00:00Z');
	const del = { action: 'delete' as const, reason: 'temp' };
	it('keeps what a running job may still use', () => {
		assert.equal(applyMinAge(del, '2026-11-09T11:00:00Z', now, 2 * 3600e3).action, 'keep');
		assert.equal(applyMinAge(del, '2026-11-09T09:59:59Z', now, 2 * 3600e3).action, 'delete');
		assert.equal(applyMinAge(del, undefined, now, 2 * 3600e3).action, 'delete');
		assert.equal(applyMinAge(del, '2026-11-09T11:59:00Z', now, 0).action, 'delete');
	});
	it('only ever downgrades a delete', () => {
		assert.equal(applyMinAge({ action: 'unsure', reason: 'x' }, '2026-11-09T11:00:00Z', now, 3600e3).action, 'unsure');
	});
});

describe('assertQaTarget', () => {
	const ok = { apiUrl: 'https://videos.api.qa.alummahnow.net', workerName: 'videos-qa', resourceNames: ['videos-qa', 'al-ummah-now-search-qa'] };
	it('accepts the QA config', () => {
		assert.doesNotThrow(() => assertQaTarget(ok));
	});
	it('refuses production, stage and look-alike hosts', () => {
		for (const apiUrl of ['https://videos.api.alummahnow.net', 'https://videos.api.stage.alummahnow.net', 'https://videos.api.qa.alummahnow.net.evil.com', 'not a url']) {
			assert.throws(() => assertQaTarget({ ...ok, apiUrl }), /refusing to run/, apiUrl);
		}
	});
	it('refuses a non-QA worker config or resource', () => {
		assert.throws(() => assertQaTarget({ ...ok, workerName: 'videos' }), /refusing/);
		assert.throws(() => assertQaTarget({ ...ok, resourceNames: ['videos', 'al-ummah-now-search-qa'] }), /non-QA resources in the config: videos$/);
		assert.throws(() => assertQaTarget({ ...ok, resourceNames: [] }), /refusing/);
	});
	it('matches the bucket names in apps/api-videos/wrangler.qa.jsonc', () => {
		const qa = readFileSync(join(ROOT, 'apps/api-videos/wrangler.qa.jsonc'), 'utf8');
		assert.match(qa, /"name":\s*"videos-qa"/);
		for (const b of ['videos-qa', 'channels-qa', 'community-posts-qa', 'scheduled-videos-qa', 'al-ummah-now-search-qa']) assert.ok(qa.includes(`"${b}"`), b);
	});
});
