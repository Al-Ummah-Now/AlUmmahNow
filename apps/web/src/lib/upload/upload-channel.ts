/**
 * Which channel an upload goes to (the upload page's channel picker).
 *
 * The picker is the one source of truth for the destination: the page, the
 * upload form, the API's `channelId` header (checked server side against the
 * channel record's owner and members) and every per-channel key on the page
 * follow the chosen channel.
 *
 * Eligible channels: owned ones and those where the account's channel role
 * allows `video.upload` (the shared role matrix), never a suspended one.
 *
 * Default, in order:
 * 1. a `?channel=<id>` deep link, when that channel is eligible;
 * 2. the last channel picked on this page (per user, in this browser), as long
 *    as the header's active channel is still the one that was active when it
 *    was picked: switching channel in the header always wins;
 * 3. the header's active channel (ActiveChannelContext), then the session's;
 * 4. the first eligible channel.
 */
import { can, type ChannelRole } from '@al-ummah/shared-types';

export interface UploadChannelCandidate {
  id: string;
  userId?: string;
  name: string;
  nameLocalized?: Record<string, string>;
  avatarUrl?: string;
  handle?: string;
  isMain?: boolean;
  role?: ChannelRole;
  isSuspended?: boolean;
}

/** The role the account holds on a channel: its own role, or owner when it owns it. */
export function roleOn(channel: Pick<UploadChannelCandidate, 'role' | 'userId'>, userId: string | undefined): ChannelRole | undefined {
  if (channel.role) return channel.role;
  if (userId && channel.userId === userId) return 'owner';
  return undefined;
}

/**
 * Channels the account may upload to. A channel listed without a role (the
 * session cookie's first-paint cache) counts as allowed: the live list
 * replaces it within moments and the API checks again.
 */
export function uploadEligibleChannels<T extends UploadChannelCandidate>(channels: readonly T[] | undefined, userId: string | undefined): T[] {
  if (!channels) return [];
  const seen = new Set<string>();
  return channels.filter((channel) => {
    if (!channel?.id || seen.has(channel.id)) return false;
    seen.add(channel.id);
    if (channel.isSuspended) return false;
    const role = roleOn(channel, userId);
    return !role || can(role, 'video.upload');
  });
}

export interface RememberedUploadChannel {
  channelId: string;
  /** The header's active channel when it was picked */
  navChannelId: string | null;
}

export interface InitialUploadChannelInput {
  eligible: readonly Pick<UploadChannelCandidate, 'id'>[];
  deepLinkId?: string | null;
  remembered?: RememberedUploadChannel | null;
  /** The header's active channel (ActiveChannelContext) */
  navChannelId?: string | null;
  /** The session's channel (the account menu's choice) */
  sessionChannelId?: string | null;
}

export type UploadChannelSource = 'link' | 'remembered' | 'nav' | 'session' | 'first' | 'none';

/** The channel the picker starts on, and why. */
export function initialUploadChannel(input: InitialUploadChannelInput): { id: string | null; source: UploadChannelSource } {
  const ids = new Set(input.eligible.map((c) => c.id));
  const nav = input.navChannelId ?? null;
  if (input.deepLinkId && ids.has(input.deepLinkId)) return { id: input.deepLinkId, source: 'link' };
  const remembered = input.remembered;
  if (remembered && ids.has(remembered.channelId) && (remembered.navChannelId ?? null) === (nav ?? input.sessionChannelId ?? null)) {
    return { id: remembered.channelId, source: 'remembered' };
  }
  if (nav && ids.has(nav)) return { id: nav, source: 'nav' };
  if (input.sessionChannelId && ids.has(input.sessionChannelId)) return { id: input.sessionChannelId, source: 'session' };
  const first = input.eligible[0]?.id;
  return first ? { id: first, source: 'first' } : { id: null, source: 'none' };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_PREFIX = 'aun-upload-channel:';

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readRememberedUploadChannel(userId: string | undefined, storage: StorageLike | null = defaultStorage()): RememberedUploadChannel | null {
  if (!userId || !storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_PREFIX + userId) || 'null') as Partial<RememberedUploadChannel> | null;
    if (!parsed || typeof parsed.channelId !== 'string' || !parsed.channelId) return null;
    return { channelId: parsed.channelId, navChannelId: typeof parsed.navChannelId === 'string' ? parsed.navChannelId : null };
  } catch {
    return null;
  }
}

export function rememberUploadChannel(userId: string | undefined, value: RememberedUploadChannel, storage: StorageLike | null = defaultStorage()): void {
  if (!userId || !storage) return;
  try {
    storage.setItem(STORAGE_PREFIX + userId, JSON.stringify(value));
  } catch {
    // Storage blocked or full: the picker then starts on the header's channel
  }
}

export interface UploadPageWork {
  /** Batch rows (any status) */
  rows: ReadonlyArray<{ status: string; videoId?: string; bytesUploaded?: number }>;
  /** A file is chosen in single mode */
  singleHasFile: boolean;
  /** The single upload is sending, paused or finishing */
  singleBusy: boolean;
  /** The single upload finished and its result card is shown */
  singleDone: boolean;
}

/**
 * What changing the destination channel means right now:
 * - `locked`: an upload has started (bytes sent to a video on the current
 *   channel). It is never moved; the picker is disabled until it finishes
 *   or is removed.
 * - `confirm`: files are chosen but not started; they would go to the new
 *   channel and the playlists and categories picked for them reset.
 * - `free`: nothing chosen yet.
 */
export function channelChangeState(work: UploadPageWork): 'locked' | 'confirm' | 'free' {
  if (work.singleBusy || work.singleDone) return 'locked';
  const started = work.rows.some((row) => {
    if (row.status === 'initiating' || row.status === 'uploading' || row.status === 'paused' || row.status === 'processing') return true;
    // Queued, nothing sent: its placeholder video is dropped and the file re-added
    // on the new channel (requeueableRows). A failed row with a video, or any
    // bytes sent, still belongs to its channel.
    if (row.status === 'pending') return (row.bytesUploaded ?? 0) > 0;
    return !!row.videoId && row.status !== 'completed' && row.status !== 'cancelled';
  });
  if (started) return 'locked';
  if (work.singleHasFile || work.rows.length > 0) return 'confirm';
  return 'free';
}

/**
 * Batch rows that move to a newly picked channel: queued, nothing sent yet.
 * Adding a file to the batch already creates its placeholder video on the
 * current channel, so these are removed and their files added again (the
 * upload reaper clears the empty placeholders).
 */
export function requeueableRows<T extends { status: string; bytesUploaded?: number }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.status === 'pending' && !((row.bytesUploaded ?? 0) > 0));
}

/** The channel's name in the page language. */
export function channelDisplayName(channel: Pick<UploadChannelCandidate, 'name' | 'nameLocalized'>, lang: string): string {
  return channel.nameLocalized?.[lang] || channel.name;
}
