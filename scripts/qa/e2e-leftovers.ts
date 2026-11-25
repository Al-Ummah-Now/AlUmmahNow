/**
 * Selection rules for the QA E2E-leftover cleanup (scripts/qa/cleanup-e2e-leftovers.ts).
 *
 * Pure functions only: they decide, for every record read from QA, whether it is
 * test junk to delete, a fixture or real content to keep, or something a person
 * should look at ("unsure", never deleted). The runner does all the I/O.
 *
 * What counts as a fixture (kept):
 * - everything the QA seed creates (apps/web/e2e/seed/seed-config.ts): the
 *   qa-admin / qa-moderator / qa-creator / qa-viewer accounts, their channels,
 *   the "QA Lecture …" / "QA Nasheed …" videos, playlists and posts;
 * - the pinned E2E users of .github/workflows/e2e-tests.yml
 *   (test-{single,multi,none,scratch}-<E2E_USERS_TIMESTAMP>@e2e.alummahnow.net)
 *   with their channels and "E2E Seed …" videos (apps/web/e2e/test-utils/e2e-videos.ts);
 * - anything owned by an account that is not a recognisable test account, and
 *   the explicit KEEP_VIDEO_IDS;
 * - the theme-demo content (scripts/qa/theme-demo-keep.ts): the demo-<key>
 *   accounts and everything they own, plus the listed channel / video / playlist
 *   ids, whatever their title or state (one demo video stays "processing" on purpose).
 *
 * What counts as junk (deleted):
 * - "E2E Temp …" / "Release E2E …" titled content (specs create it with a
 *   unique suffix and delete it again; a crashed or cancelled run leaves it);
 * - "E2E Seed …" videos and the channels of throwaway test accounts that no
 *   current workflow signs in to any more (every unpinned run registered new ones);
 * - probe comments ("ws probe <n>", "release live comment <n>", "E2E Temp …");
 * - scheduled-publish entries whose video is gone or is being deleted.
 *
 * Throwaway-owned content without a test-looking title (e.g. "Test Video",
 * "Noor Recitations") is reported as unsure instead.
 */

import { createHash } from 'node:crypto';
import { SEED_ACCOUNTS, SEED_CHANNELS, VIEWER_CHANNEL } from '../../apps/web/e2e/seed/seed-config.ts';
import { THEME_DEMO, THEME_DEMO_ACCOUNT_KEYS } from './theme-demo-keep.ts';

export type Action = 'delete' | 'keep' | 'unsure';
export interface Verdict {
	action: Action;
	reason: string;
}

/** E2E_USERS_TIMESTAMP values of the pinned CI users (.github/workflows/e2e-tests.yml matrix). */
export const PINNED_E2E_USER_TIMESTAMPS: readonly string[] = [
	'1795000000001',
	'1795000000002',
	'1795000000003',
	'1795000000004',
	'1795000000005',
];

/** Videos the owner asked to keep whatever their title or owner. */
export const KEEP_VIDEO_IDS: ReadonlySet<string> = new Set(['443418c1-dc70-43d9-944d-5388ab7dc4c3']);

/** Hosts and resource names the cleanup may touch. Anything else is refused. */
export const QA_TARGET = {
	apiHost: 'videos.api.qa.alummahnow.net',
	workerName: 'videos-qa',
	resourceSuffix: '-qa',
} as const;

const TEMP_TITLE = /^(E2E Temp|Release E2E)\b/;
const E2E_SEED_TITLE = /^E2E Seed /;
const JUNK_COMMENT = /^(ws probe \d+|release live comment \d+|E2E Temp\b.*)$/s;
/** Channel names the E2E and release suites give the channels of their throwaway accounts. */
const TEST_CHANNEL_NAME = /^(E2E |Release |Probe ch$|#\d+ chunks |Mobile Edit \d+$)/;
/** Throwaway channel prefixes the specs themselves create (apps/web/e2e/seed/seed-users.ts). */
export const DISPOSABLE_CHANNEL_PREFIXES: readonly string[] = ['E2E Temp Channel', 'قناة اختبار'];

const SEED_EMAILS: ReadonlySet<string> = new Set(SEED_ACCOUNTS.map((a) => a.email.toLowerCase()));
const SEED_VIDEO_TITLES: ReadonlySet<string> = new Set(SEED_CHANNELS.flatMap((c) => c.videos.map((v) => v.title)));
const SEED_CHANNEL_NAMES: ReadonlySet<string> = new Set([...SEED_CHANNELS.map((c) => c.name), VIEWER_CHANNEL.name]);
const SEED_PLAYLIST_TITLES: ReadonlySet<string> = new Set(SEED_CHANNELS.map((c) => c.playlistTitle));

const PINNED_E2E_EMAIL = new RegExp(
	`^test-(single|multi|none|scratch)-(${PINNED_E2E_USER_TIMESTAMPS.join('|')})@e2e\\.alummahnow\\.net$`,
);
/** The theme-demo accounts (kept with everything they own). */
const THEME_DEMO_EMAIL = new RegExp(`^demo-(${THEME_DEMO_ACCOUNT_KEYS.join('|')})@delivered\\.resend\\.dev$`);
/** Addresses the E2E, release and agent probe flows register (code sink or Resend test inboxes). */
// e2e+<run>-<attempt>-<name>: per-run CI accounts (apps/web/e2e/test-utils/run-users.ts); their
// teardown erases them, and what a killed runner left is junk like any throwaway's
const THROWAWAY_EMAIL = /^((test|rel|probe)-[a-z0-9-]+|e2e\+\d+-\d+-[a-z0-9-]+)@(e2e\.alummahnow\.net|delivered\.resend\.dev)$/;

export type AccountKind = 'seed' | 'demo' | 'pinned-e2e' | 'throwaway' | 'other' | 'unknown';

export function accountKind(email: string | null | undefined): AccountKind {
	if (!email) return 'unknown';
	const e = email.trim().toLowerCase();
	if (SEED_EMAILS.has(e)) return 'seed';
	if (THEME_DEMO_EMAIL.test(e)) return 'demo';
	if (PINNED_E2E_EMAIL.test(e)) return 'pinned-e2e';
	if (THROWAWAY_EMAIL.test(e)) return 'throwaway';
	return 'other';
}

export interface StoredComment {
	id: string;
	userId?: string;
	text?: string;
	replies?: StoredComment[];
}

export interface VideoLike {
	id: string;
	title?: string;
	userId?: string;
	channelId?: string;
	comments?: StoredComment[];
}

export interface ChannelLike {
	id: string;
	name?: string;
	userId?: string;
	email?: string;
	isMain?: boolean;
}

/** userId → account email (channel records carry the owner's email). */
export type OwnerLookup = (userId: string | undefined) => string | undefined;

/** What a title says: all the rules need of it, so a title itself is never stored. */
export type TitleMarker = 'temp' | 'e2e-seed' | 'seed';
export function videoMarker(title: string | undefined): TitleMarker | undefined {
	const t = title ?? '';
	return TEMP_TITLE.test(t) ? 'temp' : E2E_SEED_TITLE.test(t) ? 'e2e-seed' : SEED_VIDEO_TITLES.has(t) ? 'seed' : undefined;
}

export function classifyVideo(video: VideoLike, ownerEmail: OwnerLookup): Verdict {
	return videoVerdict({ id: video.id, channelId: video.channelId, marker: videoMarker(video.title) }, accountKind(ownerEmail(video.userId)));
}

export function videoVerdict(video: { id: string; channelId?: string; marker?: TitleMarker }, kind: AccountKind): Verdict {
	if (KEEP_VIDEO_IDS.has(video.id)) return { action: 'keep', reason: 'on the keep list (owner request)' };
	if (THEME_DEMO.videoIds.has(video.id) || kind === 'demo' || isThemeDemoChannel(video.channelId)) return { action: 'keep', reason: 'theme-demo content' };
	if (kind === 'seed') {
		if (video.marker === 'seed') return { action: 'keep', reason: 'QA seed fixture' };
		if (video.marker === 'temp') return { action: 'delete', reason: 'temp E2E title on a seed account' };
		return { action: 'keep', reason: 'owned by a QA seed account' };
	}
	if (kind === 'other') {
		return video.marker === 'temp'
			? { action: 'unsure', reason: 'temp E2E title, but owned by a non-test account' }
			: { action: 'keep', reason: 'owned by a non-test account' };
	}
	if (video.marker === 'temp') return { action: 'delete', reason: 'temp E2E content left by a crashed or cancelled run' };
	if (video.marker === 'e2e-seed') {
		return kind === 'pinned-e2e'
			? { action: 'keep', reason: 'E2E seed fixture of a pinned CI user' }
			: { action: 'delete', reason: `E2E seed copy of a retired test account (${kind})` };
	}
	if (kind === 'pinned-e2e') return { action: 'keep', reason: 'owned by a pinned CI user' };
	return { action: 'unsure', reason: `owned by a ${kind} test account, title is not a test marker` };
}

/** Comments (and replies) to remove from a video that is itself kept. Returns comment ids. */
export function junkCommentIds(video: VideoLike): string[] {
	const ids: string[] = [];
	const walk = (list: StoredComment[] | undefined) => {
		for (const c of list ?? []) {
			if (JUNK_COMMENT.test((c.text ?? '').trim())) ids.push(c.id);
			else walk(c.replies);
		}
	};
	walk(video.comments);
	return ids;
}

/** What a channel name says. */
export type NameMarker = 'seed' | 'disposable' | 'test';
export function channelMarkers(name: string | undefined): NameMarker[] {
	const n = name ?? '';
	return [
		...(SEED_CHANNEL_NAMES.has(n) ? ['seed' as const] : []),
		...(DISPOSABLE_CHANNEL_PREFIXES.some((p) => n.startsWith(p)) ? ['disposable' as const] : []),
		...(TEST_CHANNEL_NAME.test(n) ? ['test' as const] : []),
	];
}

export function classifyChannel(channel: ChannelLike): Verdict {
	return channelVerdict({ id: channel.id, isMain: channel.isMain, markers: channelMarkers(channel.name) }, accountKind(channel.email));
}

export function channelVerdict(channel: { id: string; isMain?: boolean; markers: readonly NameMarker[] }, kind: AccountKind): Verdict {
	const is = (marker: NameMarker) => channel.markers.includes(marker);
	if (THEME_DEMO.channelIds.has(channel.id) || kind === 'demo') return { action: 'keep', reason: 'theme-demo channel' };
	if (kind === 'seed') return { action: 'keep', reason: is('seed') ? 'QA seed fixture' : 'owned by a QA seed account' };
	if (kind === 'other' || kind === 'unknown') return { action: 'keep', reason: `owned by a ${kind === 'other' ? 'non-test' : 'unidentified'} account` };
	if (is('disposable') && !channel.isMain) {
		return { action: 'delete', reason: 'throwaway channel a spec created and did not remove' };
	}
	if (kind === 'pinned-e2e') return { action: 'keep', reason: 'channel of a pinned CI user' };
	return is('test')
		? { action: 'delete', reason: 'channel of a retired throwaway test account' }
		: { action: 'unsure', reason: 'throwaway test account, but the channel name is not a test marker' };
}

export function isThemeDemoChannel(channelId: string | undefined): boolean {
	return !!channelId && THEME_DEMO.channelIds.has(channelId);
}

export function playlistMarker(title: string | undefined): TitleMarker | undefined {
	const t = title ?? '';
	return SEED_PLAYLIST_TITLES.has(t) ? 'seed' : TEMP_TITLE.test(t) ? 'temp' : undefined;
}

export function classifyPlaylist(p: { id?: string; title?: string; channelId?: string }, channelVerdict: Action | undefined): Verdict {
	return playlistVerdict({ id: p.id, channelId: p.channelId, marker: playlistMarker(p.title) }, channelVerdict);
}

export function playlistVerdict(p: { id?: string; channelId?: string; marker?: TitleMarker }, channelVerdict: Action | undefined): Verdict {
	if ((p.id && THEME_DEMO.playlistIds.has(p.id)) || isThemeDemoChannel(p.channelId)) return { action: 'keep', reason: 'theme-demo playlist' };
	if (p.marker === 'seed') return { action: 'keep', reason: 'QA seed fixture' };
	if (p.marker === 'temp') return { action: 'delete', reason: 'temp E2E playlist' };
	if (channelVerdict === 'delete') return { action: 'delete', reason: 'playlist of a channel being deleted' };
	return { action: 'keep', reason: 'not a test playlist' };
}

/** Whether a post's text or a section's title marks it as a test's. */
export const isTempText = (text: string | undefined): boolean => TEMP_TITLE.test((text ?? '').trim());

/** Community posts are judged by their text; posts of deleted channels go with the channel. */
export function classifyPost(text: string | undefined, channelVerdict: Action | undefined, channelId?: string): Verdict {
	return postVerdict(isTempText(text), channelVerdict, channelId);
}

export function postVerdict(temp: boolean, channelVerdict: Action | undefined, channelId?: string): Verdict {
	if (isThemeDemoChannel(channelId)) return { action: 'keep', reason: 'post of a theme-demo channel' };
	if (channelVerdict === 'delete') return { action: 'delete', reason: 'post of a channel being deleted' };
	if (temp) return { action: 'delete', reason: 'temp E2E post' };
	return { action: 'keep', reason: 'not a test post' };
}

export function classifySection(title: string | undefined, channelVerdict: Action | undefined, channelId?: string): Verdict {
	return sectionVerdict(TEMP_TITLE.test(title ?? ''), channelVerdict, channelId);
}

export function sectionVerdict(temp: boolean, channelVerdict: Action | undefined, channelId?: string): Verdict {
	if (isThemeDemoChannel(channelId)) return { action: 'keep', reason: 'section of a theme-demo channel' };
	if (channelVerdict === 'delete') return { action: 'delete', reason: 'section of a channel being deleted' };
	if (temp) return { action: 'delete', reason: 'temp E2E channel section' };
	return { action: 'keep', reason: 'not a test section' };
}

/** Scheduled-publish entry `<yyyy-mm-dd>/<hh>/<videoId>.json` → video id. */
export function scheduleEntryVideoId(key: string): string | null {
	const m = /^\d{4}-\d{2}-\d{2}\/\d{2}\/([^/]+)\.json$/.exec(key);
	return m ? m[1] : null;
}

export function classifyScheduleEntry(key: string, videoAction: Action | 'missing'): Verdict {
	if (!scheduleEntryVideoId(key)) return { action: 'keep', reason: 'not a schedule entry key' };
	if (videoAction === 'missing') return { action: 'delete', reason: 'video no longer exists (the scheduler would retry it forever)' };
	if (videoAction === 'delete') return { action: 'delete', reason: 'video is being deleted' };
	return { action: 'keep', reason: 'video is kept' };
}

/**
 * Channel ids a test account's profile still lists although the channel is gone
 * (or is being deleted). Profiles of other accounts are never edited.
 */
export function staleProfileChannels(
	profile: { email?: string; channels?: string[] },
	existing: ReadonlySet<string>,
	deleting: ReadonlySet<string>,
): string[] {
	return staleChannels(accountKind(profile.email), profile.channels, existing, deleting);
}

export function staleChannels(kind: AccountKind, channels: readonly string[] | undefined, existing: ReadonlySet<string>, deleting: ReadonlySet<string>): string[] {
	if (kind !== 'throwaway' && kind !== 'pinned-e2e') return [];
	return (channels ?? []).filter((id) => !existing.has(id) || deleting.has(id));
}

/**
 * @handle index entries (channel-tabs bucket, `channel-handles/<handle>`) and tab
 * configs (`channel-tabs/<channelId>`) whose channel is gone. ChannelDelete
 * releases them; a delete interrupted half-way leaves them behind, blocking the
 * handle. Dead handles are only released for test accounts.
 */
export function classifyHandleEntry(
	entry: { channelId?: string } | null,
	ownerEmail: string | undefined,
	existing: ReadonlySet<string>,
	deleting: ReadonlySet<string>,
): Verdict {
	return handleVerdict(entry, accountKind(ownerEmail), existing, deleting);
}

export function handleVerdict(entry: { channelId?: string } | null, kind: AccountKind, existing: ReadonlySet<string>, deleting: ReadonlySet<string>): Verdict {
	if (!entry?.channelId) return { action: 'keep', reason: 'unreadable handle entry' };
	if (existing.has(entry.channelId) && !deleting.has(entry.channelId)) return { action: 'keep', reason: 'channel exists' };
	if (isThemeDemoChannel(entry.channelId)) return { action: 'keep', reason: 'handle of a theme-demo channel' };
	if (kind === 'throwaway' || kind === 'pinned-e2e') return { action: 'delete', reason: 'handle of a deleted test channel' };
	return { action: 'unsure', reason: `handle of a missing channel, owner is ${kind === 'unknown' ? 'unidentified' : 'not a test account'}` };
}

export function classifyTabsConfig(key: string, existing: ReadonlySet<string>, deleting: ReadonlySet<string>): Verdict {
	const id = /^channel-tabs\/([^/]+)$/.exec(key)?.[1];
	if (!id) return { action: 'keep', reason: 'not a tab config key' };
	if (isThemeDemoChannel(id)) return { action: 'keep', reason: 'tab config of a theme-demo channel' };
	if (existing.has(id) && !deleting.has(id)) return { action: 'keep', reason: 'channel exists' };
	return { action: 'delete', reason: 'tab config of a deleted channel' };
}

/** Changes with any rule that reads a title, a name, a text or an address: what was read under other rules is read again. */
export const RULES_FINGERPRINT = createHash('sha256')
	.update(
		JSON.stringify([
			[TEMP_TITLE, E2E_SEED_TITLE, JUNK_COMMENT, TEST_CHANNEL_NAME, PINNED_E2E_EMAIL, THEME_DEMO_EMAIL, THROWAWAY_EMAIL].map(String),
			DISPOSABLE_CHANNEL_PREFIXES,
			[SEED_EMAILS, SEED_VIDEO_TITLES, SEED_CHANNEL_NAMES, SEED_PLAYLIST_TITLES].map((set) => [...set].sort()),
		]),
	)
	.digest('hex')
	.slice(0, 16);

/** Default for --min-age-hours: E2E jobs run up to ~110 minutes. */
export const DEFAULT_MIN_AGE_MS = 2 * 60 * 60 * 1000;

/**
 * Keeps anything created less than `minAgeMs` ago: a CI or release run that is
 * still going may be using it, and cleans it up itself when it finishes.
 */
export function applyMinAge(verdict: Verdict, created: string | undefined, now: number, minAgeMs: number): Verdict {
	if (verdict.action !== 'delete' || !created) return verdict;
	const t = Date.parse(created);
	if (Number.isNaN(t) || now - t >= minAgeMs) return verdict;
	return { action: 'keep', reason: `${verdict.reason}; created less than ${Math.round(minAgeMs / 60000)} min ago, a running E2E job may still use it` };
}

/**
 * A channel can only go if nothing kept or unsure still points at it: deleting a
 * channel soft-deletes whatever videos remain on it.
 */
export function blockChannelDeletion(channel: Verdict, remainingVideoActions: Action[]): Verdict {
	if (channel.action !== 'delete') return channel;
	if (remainingVideoActions.some((a) => a !== 'delete')) {
		return { action: 'unsure', reason: `${channel.reason}, but it still holds a video that is not being deleted` };
	}
	return channel;
}

/**
 * Refuses anything that is not QA: the api host, the worker name and every
 * bucket / database name must be the QA ones.
 */
export function assertQaTarget(target: { apiUrl: string; workerName: string; resourceNames: string[] }): void {
	let host: string;
	try {
		host = new URL(target.apiUrl).host;
	} catch {
		throw new Error(`refusing to run: ${JSON.stringify(target.apiUrl)} is not a URL`);
	}
	if (host !== QA_TARGET.apiHost) throw new Error(`refusing to run against ${host}: only ${QA_TARGET.apiHost} (QA) is allowed`);
	if (target.workerName !== QA_TARGET.workerName) {
		throw new Error(`refusing to run with worker config ${JSON.stringify(target.workerName)}: expected ${QA_TARGET.workerName}`);
	}
	const bad = target.resourceNames.filter((n) => !n.endsWith(QA_TARGET.resourceSuffix));
	if (target.resourceNames.length === 0 || bad.length > 0) {
		throw new Error(`refusing to run: non-QA resources in the config: ${bad.join(', ') || '(none listed)'}`);
	}
}
