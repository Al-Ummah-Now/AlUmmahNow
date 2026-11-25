/**
 * What the QA cleanup (cleanup-e2e-leftovers.ts) knows, and what it may delete with that.
 * Pure functions only, unit-tested; the runner does the I/O.
 *
 * QA's buckets hold more records than one run can read, so a run never needs all of them: it lists
 * every key (cheap), keeps a short copy of each record it read with the object's etag (the state, an
 * artifact the next run starts from), and reads only what is new or changed until its time is up.
 * An item is deleted only when everything its verdict depends on has been read; the rest waits for a
 * later run. No address of an account outside the test domains is kept in the state.
 */
import {
	type Action,
	type Verdict,
	accountKind,
	applyMinAge,
	blockChannelDeletion,
	classifyChannel,
	classifyHandleEntry,
	classifyPlaylist,
	classifyPost,
	classifyScheduleEntry,
	classifySection,
	classifyTabsConfig,
	classifyVideo,
	junkCommentIds,
	JUNK_COMMENT,
	scheduleEntryVideoId,
	staleProfileChannels,
	type StoredComment,
} from './e2e-leftovers.ts';

/** Record stores the cleanup reads, in the order a run takes turns reading them. */
export const STORES = ['profiles', 'channels', 'videos', 'playlists', 'posts', 'sections', 'handles'] as const;
export type Store = (typeof STORES)[number];

export interface VideoEntry {
	id: string;
	title?: string;
	userId?: string;
	channelId?: string;
	created?: string;
	isPublic?: boolean;
	isDeleted?: boolean;
	uploadStatus?: string;
	/** Probe comments only */
	junk?: { id: string; text?: string; userId?: string; created?: string }[];
}
export interface ChannelEntry {
	id: string;
	name?: string;
	userId?: string;
	email?: string;
	isMain?: boolean;
	handle?: string;
	created?: string;
}
export interface ProfileEntry {
	id: string;
	email?: string;
	channels?: string[];
}
export interface PlaylistEntry {
	id: string;
	title?: string;
	channelId?: string;
	userId?: string;
}
export interface PostEntry {
	id: string;
	channelId: string;
	content?: string;
	status?: string;
	userId?: string;
	created?: string;
}
export interface SectionEntry {
	title?: string;
}
export interface HandleEntry {
	channelId?: string;
	userId?: string;
	handle?: string;
}
interface Entries {
	videos: VideoEntry;
	channels: ChannelEntry;
	profiles: ProfileEntry;
	playlists: PlaylistEntry;
	posts: PostEntry;
	sections: SectionEntry;
	handles: HandleEntry;
}

/** One record read: the object's etag and the short copy (null: not a record). */
export type Cached<T> = [etag: string, entry: T | null];
export type State = { version: string; stores: { [S in Store]: Record<string, Cached<Entries[S]>> } };
/** Every listed key of a store and its etag. */
export type Listing = Record<Store, Map<string, string>>;

/** The short copies depend on these: a change reads everything again. */
export const STATE_VERSION = `1 ${JUNK_COMMENT.source}`;

export const emptyState = (): State => ({
	version: STATE_VERSION,
	stores: { profiles: {}, channels: {}, videos: {}, playlists: {}, posts: {}, sections: {}, handles: {} },
});

/** The state a previous run left; anything unusable means a fresh start. */
export function parseState(text: string | null): State {
	try {
		const parsed = JSON.parse(text ?? '') as State;
		if (parsed?.version === STATE_VERSION && STORES.every((s) => parsed.stores?.[s] && typeof parsed.stores[s] === 'object')) return parsed;
	} catch {
		// a fresh start
	}
	return emptyState();
}

const text = (value: unknown, max = 120): string | undefined => (typeof value === 'string' ? value.slice(0, max) : undefined);
const TEST_DOMAIN = /@(e2e\.alummahnow\.net|delivered\.resend\.dev)$/i;
/** Test addresses as they are; of anyone else only that there is one (accountKind: 'other'). */
export const keptEmail = (email: unknown): string | undefined =>
	typeof email !== 'string' || !email ? undefined : TEST_DOMAIN.test(email.trim()) ? email.trim() : 'non-test';

type Raw = Record<string, unknown>;

function findComment(list: StoredComment[] | undefined, id: string): (StoredComment & { dateCreated?: string }) | undefined {
	for (const c of list ?? []) {
		if (c.id === id) return c;
		const reply = findComment(c.replies, id);
		if (reply) return reply;
	}
	return undefined;
}

/** A record as read → what the rules need of it; null when it is not a record of the store. */
export function shorten<S extends Store>(store: S, raw: Raw | null): Entries[S] | null {
	const of = (): Entries[Store] | null => {
		if (!raw || typeof raw !== 'object') return null;
		if (store === 'sections') return { title: text(raw.title) };
		if (store === 'handles') return { channelId: text(raw.channelId), userId: text(raw.userId), handle: text(raw.handle) };
		if (typeof raw.id !== 'string' || !raw.id) return null;
		switch (store as Store) {
			case 'videos': {
				const comments = Array.isArray(raw.comments) ? (raw.comments as StoredComment[]) : undefined;
				const junk = junkCommentIds({ id: raw.id, comments }).map((id) => {
					const c = findComment(comments, id);
					return { id, text: text(c?.text), userId: c?.userId, created: c?.dateCreated };
				});
				return {
					id: raw.id, title: text(raw.title), userId: text(raw.userId), channelId: text(raw.channelId), created: text(raw.dateCreated),
					isPublic: raw.isPublic as boolean | undefined, isDeleted: raw.isDeleted as boolean | undefined, uploadStatus: text(raw.uploadStatus),
					...(junk.length ? { junk } : {}),
				};
			}
			case 'channels':
				return { id: raw.id, name: text(raw.name), userId: text(raw.userId), email: keptEmail(raw.email), isMain: raw.isMain === true, handle: text(raw.handle), created: text(raw.dateCreated) };
			case 'profiles': {
				const email = keptEmail(raw.email);
				const kind = accountKind(email);
				const mine = kind === 'throwaway' || kind === 'pinned-e2e';
				return { id: raw.id, email, ...(mine && Array.isArray(raw.channels) ? { channels: raw.channels.filter((c): c is string => typeof c === 'string') } : {}) };
			}
			case 'playlists':
				return { id: raw.id, title: text(raw.title), channelId: text(raw.channelId), userId: text(raw.userId) };
			default:
				return { id: raw.id, channelId: text(raw.channelId) ?? '', content: text(raw.content), status: text(raw.status), userId: text(raw.userId), created: text(raw.createdAt) };
		}
	};
	// JSON drops undefined fields, so a copy read from the state equals a fresh one
	return of() as Entries[S] | null;
}

/** Forget what is gone or changed; what is left is current. */
export function prune(state: State, listing: Listing): void {
	for (const store of STORES) {
		const cached = state.stores[store] as Record<string, Cached<unknown>>;
		for (const key of Object.keys(cached)) if (listing[store].get(key) !== cached[key][0]) delete cached[key];
	}
}

export interface Pending {
	store: Store;
	key: string;
	etag: string;
}

/** What is still to be read, the stores taking turns so that each run gets further in all of them. */
export function pendingReads(state: State, listing: Listing): Pending[] {
	const queues = STORES.map((store) => [...listing[store]].filter(([key]) => !state.stores[store][key]).map(([key, etag]) => ({ store, key, etag })));
	const out: Pending[] = [];
	for (let i = 0, more = true; more; i++) {
		more = false;
		for (const queue of queues) {
			if (i >= queue.length) continue;
			out.push(queue[i]);
			more = true;
		}
	}
	return out;
}

export interface InventoryItem {
	kind: 'video' | 'comment' | 'channel' | 'playlist' | 'post' | 'section' | 'schedule-entry' | 'profile-ref' | 'handle' | 'tabs';
	id: string;
	title?: string;
	owner?: string;
	parent?: string;
	action: Action | 'wait';
	reason: string;
	detail?: Record<string, unknown>;
}

const WAIT = (what: string) => ({ action: 'wait' as const, reason: `${what} not read yet (a later run decides)` });

export function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

/** Owner label for the inventory: test accounts by address, anyone else only by kind. */
function ownerLabel(email: string | undefined, userId: string | undefined): string {
	const kind = accountKind(email);
	if (kind === 'other') return `non-test account ${userId ?? ''}`.trim();
	return email ?? `unknown (${userId ?? 'no user id'})`;
}

/** The verdict of every record read so far. `state` must be pruned against `listing`. */
export function buildInventory(
	state: State,
	listing: Listing,
	keys: { schedule: string[]; tabs: string[] },
	options: { now: number; minAgeMs: number },
): { items: InventoryItem[]; channels: ChannelEntry[]; videosByChannel: Map<string, string[]> } {
	const { now, minAgeMs } = options;
	const read = <S extends Store>(store: S) => Object.values(state.stores[store]).map((c) => (c as Cached<Entries[S]>)[1]).filter((e): e is NonNullable<typeof e> => e !== null) as Entries[S][];
	const complete = (store: Store) => listing[store].size === Object.keys(state.stores[store]).length;
	const videos = read('videos');
	const channels = read('channels');
	const profiles = read('profiles');
	const allChannels = complete('channels');
	const allVideos = complete('videos');

	// Owner address of a user id: from the profile, else from one of the user's channels
	const fromProfile = new Map<string, string>();
	for (const p of profiles) if (p.email) fromProfile.set(p.id, p.email);
	const fromChannel = new Map<string, string>();
	for (const c of channels) if (c.userId && c.email && !fromChannel.has(c.userId)) fromChannel.set(c.userId, c.email);
	const ownerEmail = (userId: string | undefined) => (userId ? (fromProfile.get(userId) ?? fromChannel.get(userId)) : undefined);
	const ownerKnown = (userId: string | undefined) =>
		!userId || fromProfile.has(userId) || (allChannels && (!listing.profiles.has(userId) || !!state.stores.profiles[userId]));

	const items: InventoryItem[] = [];
	const videoAction = new Map<string, Action | 'wait'>();
	const actionsOnChannel = new Map<string, (Action | 'wait')[]>();
	const videosByChannel = new Map<string, string[]>();
	for (const v of videos) {
		const label = ownerLabel(ownerEmail(v.userId), v.userId);
		const verdict = ownerKnown(v.userId) ? applyMinAge(classifyVideo(v, ownerEmail), v.created, now, minAgeMs) : WAIT('owner');
		videoAction.set(v.id, verdict.action);
		if (v.channelId) {
			push(actionsOnChannel, v.channelId, verdict.action);
			if (verdict.action === 'delete') push(videosByChannel, v.channelId, v.id);
		}
		items.push({
			kind: 'video', id: v.id, title: v.title, owner: label, parent: v.channelId, ...verdict,
			detail: { isPublic: v.isPublic ?? null, isDeleted: v.isDeleted ?? false, uploadStatus: v.uploadStatus ?? null, created: v.created ?? null },
		});
		if (verdict.action === 'delete') continue;
		for (const c of v.junk ?? []) {
			const cv = applyMinAge({ action: 'delete', reason: 'test probe comment' }, c.created, now, minAgeMs);
			items.push({ kind: 'comment', id: c.id, title: c.text, owner: ownerLabel(ownerEmail(c.userId), c.userId), parent: v.id, ...cv });
		}
	}

	const channelAction = new Map<string, Action>();
	for (const c of channels) {
		const on = actionsOnChannel.get(c.id) ?? [];
		let verdict: Verdict | ReturnType<typeof WAIT> = applyMinAge(classifyChannel(c), c.created, now, minAgeMs);
		if (verdict.action === 'delete') {
			verdict = !allVideos || on.includes('wait') ? WAIT('a video that may be on it') : blockChannelDeletion(verdict, on as Action[]);
		}
		// Waiting channels count as kept for everything that depends on them
		channelAction.set(c.id, verdict.action === 'wait' ? 'keep' : verdict.action);
		items.push({ kind: 'channel', id: c.id, title: c.name, owner: ownerLabel(c.email, c.userId), ...verdict, detail: { isMain: c.isMain ?? false, handle: c.handle ?? null } });
	}
	for (const p of read('playlists')) {
		items.push({ kind: 'playlist', id: p.id, title: p.title, owner: ownerLabel(ownerEmail(p.userId), p.userId), parent: p.channelId, ...classifyPlaylist(p, p.channelId ? channelAction.get(p.channelId) : undefined) });
	}
	for (const p of read('posts')) {
		const verdict = applyMinAge(classifyPost(p.content, channelAction.get(p.channelId), p.channelId), p.created, now, minAgeMs);
		items.push({ kind: 'post', id: p.id, title: p.content, owner: ownerLabel(ownerEmail(p.userId), p.userId), parent: p.channelId, ...verdict, detail: { status: p.status ?? null } });
	}
	for (const [key, [, section]] of Object.entries(state.stores.sections)) {
		const channelId = key.split('/')[0];
		items.push({ kind: 'section', id: key, title: section?.title, parent: channelId, ...classifySection(section?.title, channelAction.get(channelId), channelId) });
	}
	for (const key of keys.schedule) {
		const id = scheduleEntryVideoId(key);
		// Whether a video exists is known from the listing, read or not
		const action = id ? (videoAction.get(id) ?? (listing.videos.has(id) ? 'keep' : 'missing')) : 'keep';
		items.push({ kind: 'schedule-entry', id: key, parent: id ?? undefined, ...classifyScheduleEntry(key, action === 'wait' ? 'keep' : action) });
	}
	const existing = new Set(listing.channels.keys());
	const deleting = new Set([...channelAction].filter(([, action]) => action === 'delete').map(([id]) => id));
	for (const p of profiles) {
		const stale = staleProfileChannels(p, existing, deleting);
		if (stale.length > 0) items.push({ kind: 'profile-ref', id: p.id, owner: p.email, action: 'delete', reason: 'profile lists channels that are deleted', detail: { channels: stale } });
	}
	for (const [key, [, entry]] of Object.entries(state.stores.handles)) {
		const email = ownerEmail(entry?.userId);
		const verdict = classifyHandleEntry(entry, email, existing, deleting);
		if (verdict.action === 'keep') continue;
		items.push({ kind: 'handle', id: key, title: entry?.handle, owner: ownerLabel(email, entry?.userId), parent: entry?.channelId, ...(ownerKnown(entry?.userId) ? verdict : WAIT('owner')) });
	}
	for (const key of keys.tabs) {
		const verdict = classifyTabsConfig(key, existing, deleting);
		if (verdict.action !== 'keep') items.push({ kind: 'tabs', id: key, ...verdict });
	}
	return { items, channels, videosByChannel };
}

export type Counts = Record<Action | 'wait', number>;
export function summarize(items: InventoryItem[]): Record<string, Counts> {
	const out: Record<string, Counts> = {};
	for (const i of items) (out[i.kind] ??= { delete: 0, keep: 0, unsure: 0, wait: 0 })[i.action]++;
	return out;
}

/** When each part of a run must be over, from its start. The job's own limit is above the last one. */
export const DEADLINES_MIN = { list: 12, read: 30, write: 48, reconcile: 54 } as const;

/**
 * Runs `fn` over the items until the deadline, or until `maxFailuresInRow` fail in a row (the
 * connection is gone); nothing new starts after that. `left` is what was not started.
 */
export async function mapUntil<T>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<boolean>,
	options: { deadline: number; now?: () => number; maxFailuresInRow?: number },
): Promise<{ done: number; failed: number; left: number }> {
	const now = options.now ?? Date.now;
	const maxInRow = options.maxFailuresInRow ?? Infinity;
	let next = 0;
	let done = 0;
	let failed = 0;
	let inRow = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length && now() < options.deadline && inRow < maxInRow) {
			const item = items[next++];
			if (await fn(item)) {
				done++;
				inRow = 0;
			} else {
				failed++;
				inRow++;
			}
		}
	}));
	return { done, failed, left: items.length - next };
}

/**
 * A run is red only when it got nowhere: there was something to read or delete and not one of it
 * succeeded. Anything left over, or failed once, is for the next run.
 */
export function stalled(run: { toRead: number; read: number; toDelete: number; deleted: number }): string | null {
	if (run.toRead > 0 && run.read === 0) return `none of ${run.toRead} records could be read`;
	if (run.toDelete > 0 && run.deleted === 0) return `none of ${run.toDelete} leftovers could be deleted`;
	return null;
}
