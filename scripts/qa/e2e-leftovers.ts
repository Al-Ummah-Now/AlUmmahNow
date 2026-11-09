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
 *   the explicit KEEP_VIDEO_IDS.
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

import { SEED_ACCOUNTS, SEED_CHANNELS, VIEWER_CHANNEL } from '../../apps/web/e2e/seed/seed-config.ts';

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
/** Addresses the E2E, release and agent probe flows register (code sink or Resend test inboxes). */
const THROWAWAY_EMAIL = /^(test|rel|probe)-[a-z0-9-]+@(e2e\.alummahnow\.net|delivered\.resend\.dev)$/;

export type AccountKind = 'seed' | 'pinned-e2e' | 'throwaway' | 'other' | 'unknown';

export function accountKind(email: string | null | undefined): AccountKind {
	if (!email) return 'unknown';
	const e = email.trim().toLowerCase();
	if (SEED_EMAILS.has(e)) return 'seed';
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

export function classifyVideo(video: VideoLike, ownerEmail: OwnerLookup): Verdict {
	const title = video.title ?? '';
	const kind = accountKind(ownerEmail(video.userId));
	if (KEEP_VIDEO_IDS.has(video.id)) return { action: 'keep', reason: 'on the keep list (owner request)' };
	if (kind === 'seed') {
		if (SEED_VIDEO_TITLES.has(title)) return { action: 'keep', reason: 'QA seed fixture' };
		if (TEMP_TITLE.test(title)) return { action: 'delete', reason: 'temp E2E title on a seed account' };
		return { action: 'keep', reason: 'owned by a QA seed account' };
	}
	if (kind === 'other') {
		return TEMP_TITLE.test(title)
			? { action: 'unsure', reason: 'temp E2E title, but owned by a non-test account' }
			: { action: 'keep', reason: 'owned by a non-test account' };
	}
	if (TEMP_TITLE.test(title)) return { action: 'delete', reason: 'temp E2E content left by a crashed or cancelled run' };
	if (E2E_SEED_TITLE.test(title)) {
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

export function classifyChannel(channel: ChannelLike): Verdict {
	const name = channel.name ?? '';
	const kind = accountKind(channel.email);
	if (kind === 'seed') return { action: 'keep', reason: SEED_CHANNEL_NAMES.has(name) ? 'QA seed fixture' : 'owned by a QA seed account' };
	if (kind === 'other' || kind === 'unknown') return { action: 'keep', reason: `owned by a ${kind === 'other' ? 'non-test' : 'unidentified'} account` };
	if (DISPOSABLE_CHANNEL_PREFIXES.some((p) => name.startsWith(p)) && !channel.isMain) {
		return { action: 'delete', reason: 'throwaway channel a spec created and did not remove' };
	}
	if (kind === 'pinned-e2e') return { action: 'keep', reason: 'channel of a pinned CI user' };
	return TEST_CHANNEL_NAME.test(name)
		? { action: 'delete', reason: 'channel of a retired throwaway test account' }
		: { action: 'unsure', reason: 'throwaway test account, but the channel name is not a test marker' };
}

export function classifyPlaylist(p: { title?: string; channelId?: string }, channelVerdict: Action | undefined): Verdict {
	const title = p.title ?? '';
	if (SEED_PLAYLIST_TITLES.has(title)) return { action: 'keep', reason: 'QA seed fixture' };
	if (TEMP_TITLE.test(title)) return { action: 'delete', reason: 'temp E2E playlist' };
	if (channelVerdict === 'delete') return { action: 'delete', reason: 'playlist of a channel being deleted' };
	return { action: 'keep', reason: 'not a test playlist' };
}

/** Community posts are judged by their text; posts of deleted channels go with the channel. */
export function classifyPost(text: string | undefined, channelVerdict: Action | undefined): Verdict {
	if (channelVerdict === 'delete') return { action: 'delete', reason: 'post of a channel being deleted' };
	if (TEMP_TITLE.test((text ?? '').trim())) return { action: 'delete', reason: 'temp E2E post' };
	return { action: 'keep', reason: 'not a test post' };
}

export function classifySection(title: string | undefined, channelVerdict: Action | undefined): Verdict {
	if (channelVerdict === 'delete') return { action: 'delete', reason: 'section of a channel being deleted' };
	if (TEMP_TITLE.test(title ?? '')) return { action: 'delete', reason: 'temp E2E channel section' };
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
	const kind = accountKind(profile.email);
	if (kind !== 'throwaway' && kind !== 'pinned-e2e') return [];
	return (profile.channels ?? []).filter((id) => !existing.has(id) || deleting.has(id));
}

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
