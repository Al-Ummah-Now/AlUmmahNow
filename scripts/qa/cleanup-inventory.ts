/**
 * What the QA cleanup (cleanup-e2e-leftovers.ts) knows, and what it may delete with that.
 * Pure functions only, unit-tested; the runner does the I/O.
 *
 * QA's buckets hold more records than one run can read, so a run never needs all of them: it lists
 * every key (cheap), keeps what the rules need of each record it read with the object's etag (the
 * state, a private R2 object on QA), and reads only what is new or changed until its time is up. An
 * item is deleted only when everything its verdict depends on has been read; the rest waits for a
 * later run.
 *
 * The state holds keys, etags, ids, dates, flags, the kind of an account and which test marker a title
 * or name matched. Never a title, a name, a text or an address; a handle only as its object's key. What a run publishes
 * (publicItems) holds less: this repo, its artifacts and its logs are public.
 */
import {
	type AccountKind,
	type Action,
	type NameMarker,
	type TitleMarker,
	type Verdict,
	accountKind,
	applyMinAge,
	channelMarkers,
	channelVerdict,
	classifyScheduleEntry,
	classifyTabsConfig,
	handleVerdict,
	isTempText,
	junkCommentIds,
	playlistMarker,
	playlistVerdict,
	postVerdict,
	RULES_FINGERPRINT,
	scheduleEntryVideoId,
	sectionVerdict,
	staleChannels,
	type StoredComment,
	videoMarker,
	videoVerdict,
} from './e2e-leftovers.ts';

/** Record stores the cleanup reads, in the order a run takes turns reading them. */
export const STORES = ['profiles', 'channels', 'videos', 'playlists', 'posts', 'sections', 'handles'] as const;
export type Store = (typeof STORES)[number];

export interface VideoEntry {
	id: string;
	userId?: string;
	channelId?: string;
	created?: string;
	marker?: TitleMarker;
	/** Probe comments only */
	junk?: { id: string; created?: string }[];
}
export interface ChannelEntry {
	id: string;
	userId?: string;
	kind: AccountKind;
	markers: NameMarker[];
	isMain?: boolean;
	isDeleted?: boolean;
	dateCreated?: string;
}
export interface ProfileEntry {
	id: string;
	kind: AccountKind;
	/** Test accounts only */
	channels?: string[];
}
export interface PlaylistEntry {
	id: string;
	channelId?: string;
	marker?: TitleMarker;
}
export interface PostEntry {
	id: string;
	channelId: string;
	created?: string;
	temp: boolean;
}
export interface SectionEntry {
	temp: boolean;
}
export interface HandleEntry {
	channelId?: string;
	userId?: string;
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

/** One record read: the etag it was read with and what the rules need of it (null: not a record). */
export type Cached<T> = [etag: string, entry: T | null];
export type State = { version: string; stores: { [S in Store]: Record<string, Cached<Entries[S]>> } };
/** Every listed key of a store and its etag. */
export type Listing = Record<Store, Map<string, string>>;

/** Read under other rules (or in another form): read again. */
export const STATE_VERSION = `2 ${RULES_FINGERPRINT}`;

export const emptyState = (): State => ({
	version: STATE_VERSION,
	stores: { profiles: {}, channels: {}, videos: {}, playlists: {}, posts: {}, sections: {}, handles: {} },
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** Whether `entry` is what `shorten` makes of a record of this store. */
function isEntry(store: Store, entry: unknown): boolean {
	if (entry === null) return true;
	if (!isRecord(entry)) return false;
	const strings = (keys: string[]) => keys.every((k) => entry[k] === undefined || typeof entry[k] === 'string');
	if (store === 'sections') return typeof entry.temp === 'boolean';
	if (store === 'handles') return strings(['channelId', 'userId']);
	if (typeof entry.id !== 'string' || !strings(['userId', 'channelId', 'created', 'dateCreated', 'kind', 'marker'])) return false;
	switch (store) {
		case 'videos':
			return entry.junk === undefined || (Array.isArray(entry.junk) && entry.junk.every((j) => isRecord(j) && typeof j.id === 'string'));
		case 'channels':
			return typeof entry.kind === 'string' && Array.isArray(entry.markers);
		case 'profiles':
			return typeof entry.kind === 'string' && (entry.channels === undefined || (Array.isArray(entry.channels) && entry.channels.every((c) => typeof c === 'string')));
		case 'posts':
			return typeof entry.channelId === 'string' && typeof entry.temp === 'boolean';
		default:
			return true;
	}
}

/** The state a previous run left; anything that is not exactly one means a fresh start. */
export function parseState(text: string | null): State {
	try {
		const parsed: unknown = JSON.parse(text ?? '');
		if (isRecord(parsed) && parsed.version === STATE_VERSION && isRecord(parsed.stores)) {
			const stores = parsed.stores;
			const ok = STORES.every((store) => {
				const cached = stores[store];
				return isRecord(cached) && Object.values(cached).every((c) => Array.isArray(c) && c.length === 2 && typeof c[0] === 'string' && isEntry(store, c[1]));
			});
			if (ok) return parsed as State;
		}
	} catch {
		// a fresh start
	}
	return emptyState();
}

function findComment(list: StoredComment[] | undefined, id: string): (StoredComment & { dateCreated?: string }) | undefined {
	for (const c of list ?? []) {
		if (c.id === id) return c;
		const reply = findComment(c.replies, id);
		if (reply) return reply;
	}
	return undefined;
}

/** A record as read → what the rules need of it; null when it is not a record of the store. */
export function shorten<S extends Store>(store: S, raw: Record<string, unknown> | null): Entries[S] | null {
	const of = (): Entries[Store] | null => {
		if (!isRecord(raw)) return null;
		if (store === 'sections') return { temp: videoMarker(str(raw.title)) === 'temp' };
		if (store === 'handles') return { channelId: str(raw.channelId), userId: str(raw.userId) };
		if (typeof raw.id !== 'string' || !raw.id) return null;
		const id = raw.id;
		switch (store as Store) {
			case 'videos': {
				const comments = Array.isArray(raw.comments) ? (raw.comments as StoredComment[]) : undefined;
				const junk = junkCommentIds({ id, comments }).map((c) => ({ id: c, created: findComment(comments, c)?.dateCreated }));
				return { id, userId: str(raw.userId), channelId: str(raw.channelId), created: str(raw.dateCreated), marker: videoMarker(str(raw.title)), ...(junk.length ? { junk } : {}) };
			}
			case 'channels':
				return { id, userId: str(raw.userId), kind: accountKind(str(raw.email)), markers: channelMarkers(str(raw.name)), isMain: raw.isMain === true, isDeleted: raw.isDeleted === true, dateCreated: str(raw.dateCreated) };
			case 'profiles': {
				const kind = accountKind(str(raw.email));
				const test = kind === 'throwaway' || kind === 'pinned-e2e';
				return { id, kind, ...(test && Array.isArray(raw.channels) ? { channels: raw.channels.filter((c): c is string => typeof c === 'string') } : {}) };
			}
			case 'playlists':
				return { id, channelId: str(raw.channelId), marker: playlistMarker(str(raw.title)) };
			default:
				return { id, channelId: str(raw.channelId) ?? '', created: str(raw.createdAt), temp: isTempText(str(raw.content)) };
		}
	};
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
}

/** What is still to be read, the stores taking turns so that each run gets further in all of them. */
export function pendingReads(state: State, listing: Listing): Pending[] {
	const queues = STORES.map((store) => [...listing[store].keys()].filter((key) => !state.stores[store][key]).map((key) => ({ store, key })));
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
	/** Record id; for a section, a handle, a tab config and a schedule entry, the key */
	id: string;
	/** Object key, and the etag the verdict is about: the runner deletes only that version */
	key: string;
	etag?: string;
	owner?: AccountKind;
	parent?: string;
	action: Action | 'wait';
	reason: string;
	/** profile-ref: the channel ids to drop */
	channels?: string[];
}

/** What goes with a channel: it is deleted only when these are gone. */
export interface OnChannel {
	videos: string[];
	playlists: string[];
	posts: string[];
	sections: string[];
}

const WAIT = (what: string) => ({ action: 'wait' as const, reason: `${what} not read yet (a later run decides)` });

export function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	const list = map.get(key);
	if (list) list.push(value);
	else map.set(key, [value]);
}

export interface Inventory {
	items: InventoryItem[];
	channels: ChannelEntry[];
	onChannel: Map<string, OnChannel>;
}

/** The verdict of every record read so far. `state` must be pruned against `listing`. */
export function buildInventory(
	state: State,
	listing: Listing,
	keys: { schedule: Map<string, string>; tabs: Map<string, string> },
	options: { now: number; minAgeMs: number },
): Inventory {
	const { now, minAgeMs } = options;
	type Row<S extends Store> = { key: string; etag: string; entry: Entries[S] };
	const rows = <S extends Store>(store: S): Row<S>[] =>
		Object.entries(state.stores[store] as Record<string, Cached<Entries[S]>>).flatMap(([key, [etag, entry]]) => (entry ? [{ key, etag, entry }] : []));
	const complete = (store: Store) => [...listing[store].keys()].every((key) => !!state.stores[store][key]);
	const videos = rows('videos');
	const channels = rows('channels');
	const profiles = rows('profiles');
	const playlists = rows('playlists');
	const posts = rows('posts');
	const sections = rows('sections');
	const allChannels = complete('channels');
	// A channel goes with everything on it, so everything that may be on one must be known
	const missing = (['channels', 'videos', 'playlists', 'posts', 'sections'] as const).filter((store) => !complete(store));

	// Kind of a user's account: from the profile, else from one of the user's channels
	const fromProfile = new Map<string, AccountKind>();
	for (const { entry: p } of profiles) if (p.kind !== 'unknown') fromProfile.set(p.id, p.kind);
	const fromChannel = new Map<string, AccountKind>();
	for (const { entry: c } of channels) if (c.userId && c.kind !== 'unknown' && !fromChannel.has(c.userId)) fromChannel.set(c.userId, c.kind);
	const ownerKind = (userId: string | undefined): AccountKind => (userId ? (fromProfile.get(userId) ?? fromChannel.get(userId) ?? 'unknown') : 'unknown');
	const ownerKnown = (userId: string | undefined) =>
		!userId || fromProfile.has(userId) || (allChannels && (!listing.profiles.has(userId) || !!state.stores.profiles[userId]));

	const items: InventoryItem[] = [];
	type Any = Verdict | ReturnType<typeof WAIT>;
	const onChannel = new Map<string, OnChannel>();
	const blocked = new Map<string, Set<string>>();
	/** What is on a channel, and whether it would go with it. */
	const hold = (channelId: string | undefined, store: keyof OnChannel, id: string, ifDeleted: Any): void => {
		if (!channelId) return;
		let on = onChannel.get(channelId);
		if (!on) onChannel.set(channelId, (on = { videos: [], playlists: [], posts: [], sections: [] }));
		on[store].push(id);
		if (ifDeleted.action === 'delete') return;
		const why = blocked.get(channelId) ?? new Set<string>();
		blocked.set(channelId, why.add(ifDeleted.action));
	};
	const post = (p: PostEntry, action: Action | undefined) => applyMinAge(postVerdict(p.temp, action, p.channelId), p.created, now, minAgeMs);

	const videoAction = new Map<string, Action | 'wait'>();
	for (const { key, etag, entry: v } of videos) {
		const owner = ownerKind(v.userId);
		const verdict: Any = ownerKnown(v.userId) ? applyMinAge(videoVerdict(v, owner), v.created, now, minAgeMs) : WAIT('owner');
		videoAction.set(v.id, verdict.action);
		hold(v.channelId, 'videos', v.id, verdict);
		items.push({ kind: 'video', id: v.id, key, etag, owner, parent: v.channelId, ...verdict });
		if (verdict.action === 'delete') continue;
		for (const c of v.junk ?? []) {
			items.push({ kind: 'comment', id: c.id, key, parent: v.id, ...applyMinAge({ action: 'delete', reason: 'test probe comment' }, c.created, now, minAgeMs) });
		}
	}
	for (const { entry: p } of playlists) hold(p.channelId, 'playlists', p.id, playlistVerdict(p, 'delete'));
	for (const { entry: p } of posts) hold(p.channelId, 'posts', p.id, post(p, 'delete'));
	for (const { key, entry: s } of sections) hold(key.split('/')[0], 'sections', key, sectionVerdict(s.temp, 'delete', key.split('/')[0]));

	const channelAction = new Map<string, Action>();
	for (const { key, etag, entry: c } of channels) {
		let verdict: Any = applyMinAge(channelVerdict(c, c.kind), c.dateCreated, now, minAgeMs);
		if (verdict.action === 'delete') {
			const why = blocked.get(c.id);
			if (missing.length > 0 || why?.has('wait')) verdict = WAIT('something that may be on it');
			else if (why) verdict = { action: 'unsure', reason: `${verdict.reason}, but it still holds something that is not being deleted` };
		}
		// Waiting channels count as kept for everything that depends on them
		channelAction.set(c.id, verdict.action === 'wait' ? 'keep' : verdict.action);
		items.push({ kind: 'channel', id: c.id, key, etag, owner: c.kind, ...verdict });
	}
	const actionOf = (channelId: string | undefined) => (channelId ? channelAction.get(channelId) : undefined);
	for (const { key, etag, entry: p } of playlists) items.push({ kind: 'playlist', id: p.id, key, etag, parent: p.channelId, ...playlistVerdict(p, actionOf(p.channelId)) });
	for (const { key, etag, entry: p } of posts) items.push({ kind: 'post', id: p.id, key, etag, parent: p.channelId, ...post(p, actionOf(p.channelId)) });
	for (const { key, etag, entry: s } of sections) {
		const channelId = key.split('/')[0];
		items.push({ kind: 'section', id: key, key, etag, parent: channelId, ...sectionVerdict(s.temp, actionOf(channelId), channelId) });
	}
	for (const [key, etag] of keys.schedule) {
		const id = scheduleEntryVideoId(key);
		// Whether a video exists is known from the listing, read or not
		const action = id ? (videoAction.get(id) ?? (listing.videos.has(id) ? 'keep' : 'missing')) : 'keep';
		items.push({ kind: 'schedule-entry', id: key, key, etag, parent: id ?? undefined, ...classifyScheduleEntry(key, action === 'wait' ? 'keep' : action) });
	}
	const existing = new Set(listing.channels.keys());
	const deleting = new Set([...channelAction].filter(([, action]) => action === 'delete').map(([id]) => id));
	for (const { key, etag, entry: p } of profiles) {
		const stale = staleChannels(p.kind, p.channels, existing, deleting);
		if (stale.length > 0) items.push({ kind: 'profile-ref', id: p.id, key, etag, owner: p.kind, action: 'delete', reason: 'profile lists channels that are deleted', channels: stale });
	}
	for (const { key, etag, entry: h } of rows('handles')) {
		const owner = ownerKind(h.userId);
		const verdict = handleVerdict(h, owner, existing, deleting);
		if (verdict.action === 'keep') continue;
		items.push({ kind: 'handle', id: key, key, etag, owner, parent: h.channelId, ...(ownerKnown(h.userId) ? verdict : WAIT('owner')) });
	}
	for (const [key, etag] of keys.tabs) {
		const verdict = classifyTabsConfig(key, existing, deleting);
		if (verdict.action !== 'keep') items.push({ kind: 'tabs', id: key, key, etag, parent: key.replace(/^channel-tabs\//, ''), ...verdict });
	}
	return { items, channels: channels.map((c) => c.entry), onChannel };
}

/** Items as a run may publish them: no key (a handle's key is the handle) and nothing that is kept. */
export function publicItems(items: readonly InventoryItem[]) {
	return items
		.filter((i) => i.action !== 'keep')
		.map(({ kind, id, owner, parent, action, reason }) => ({ kind, id: kind === 'handle' ? '(a handle)' : id, owner, parent, action, reason }));
}

export type Counts = Record<Action | 'wait', number>;
export function summarize(items: InventoryItem[]): Record<string, Counts> {
	const out: Record<string, Counts> = {};
	for (const i of items) (out[i.kind] ??= { delete: 0, keep: 0, unsure: 0, wait: 0 })[i.action]++;
	return out;
}

/** When each part of a run must be over, from its start. The job's own limit is above the last one. */
export const DEADLINES_MIN = { list: 12, read: 30, channels: 44, write: 48, reconcile: 54 } as const;

export type Outcome = 'done' | 'skipped' | 'failed';
export interface Tally {
	done: number;
	skipped: number;
	failed: number;
	left: number;
}

/**
 * Runs `fn` over the items until the deadline, or until `maxFailuresInRow` fail in a row (the
 * connection is gone); nothing new starts after that. `left` is what was not started.
 */
export async function mapUntil<T>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<Outcome>,
	options: { deadline: number; now?: () => number; maxFailuresInRow?: number },
): Promise<Tally> {
	const now = options.now ?? Date.now;
	const maxInRow = options.maxFailuresInRow ?? Infinity;
	let next = 0;
	const tally = { done: 0, skipped: 0, failed: 0 };
	let inRow = 0;
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length && now() < options.deadline && inRow < maxInRow) {
			const outcome = await fn(items[next++]);
			tally[outcome]++;
			inRow = outcome === 'failed' ? inRow + 1 : 0;
		}
	}));
	return { ...tally, left: items.length - next };
}

/**
 * A run is red only when it got nowhere: there was something to read or delete and not one of it
 * succeeded. Anything left over, skipped because it changed, or failed once, is for the next run.
 */
export function stalled(run: { toRead: number; read: number; toDelete: number; deleted: number; skipped: number }): string | null {
	if (run.toRead > 0 && run.read === 0) return `none of ${run.toRead} records could be read`;
	if (run.toDelete > run.skipped && run.deleted === 0) return `none of ${run.toDelete} leftovers could be deleted`;
	return null;
}
