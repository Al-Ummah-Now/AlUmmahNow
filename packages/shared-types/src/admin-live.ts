/**
 * Live updates in the videos admin (docs/admin/LIVE_OPS.md, Part B).
 *
 * Producers (api-videos, admin-api, processor, media, the ops collector) send
 * events to the realtime worker's `/broadcast` on `admin:<topic>` channels.
 * The realtime worker checks the subscriber's role per topic, never lets a
 * client publish there, and coalesces each topic to at most one update per
 * second: the latest event per `key` wins and the batch goes out as one
 * `admin.update` message.
 *
 * Events are hints, not the source of truth: a page patches what it shows or
 * refetches its own API. Missing one is never wrong.
 */
import { isAdmin, isModerator } from './roles';

/** Who may subscribe to a topic. */
export type AdminLiveLevel = 'admin' | 'moderator';

export const ADMIN_LIVE_TOPICS = {
  /** Admin jobs: purges, transfers, erasures, rebuilds, repairs. */
  jobs: 'admin',
  /** R2 transcode status per video and "transcoding now" counts. */
  media: 'admin',
  /** Queue backlog. */
  queues: 'admin',
  /** Upload and encode status. */
  uploads: 'admin',
  /** New error groups, needs-action items and counts. */
  errors: 'admin',
  /** Reports, AI flags, contact and auth requests queues changed. */
  moderation: 'moderator',
  /** Live-stream sessions starting and stopping. */
  live: 'admin',
  /** Platform metrics: threshold alerts and new collector data. */
  ops: 'admin',
} as const satisfies Record<string, AdminLiveLevel>;

export type AdminLiveTopic = keyof typeof ADMIN_LIVE_TOPICS;

export const ADMIN_LIVE_PREFIX = 'admin:';
/** Shortest gap between two updates of one topic. */
export const ADMIN_LIVE_INTERVAL_MS = 1000;
/** Most events one update carries; beyond that subscribers get `resync`. */
export const ADMIN_LIVE_MAX_EVENTS = 50;
/** Message type of a coalesced update. */
export const ADMIN_LIVE_UPDATE = 'admin.update';

export function adminLiveChannel(topic: AdminLiveTopic): string {
  return `${ADMIN_LIVE_PREFIX}${topic}`;
}

export function isAdminLiveChannel(channel: string): boolean {
  return channel.startsWith(ADMIN_LIVE_PREFIX);
}

/** The topic of an `admin:<topic>` channel, or null for an unknown one. */
export function adminLiveTopicOf(channel: string): AdminLiveTopic | null {
  if (!isAdminLiveChannel(channel)) return null;
  const topic = channel.slice(ADMIN_LIVE_PREFIX.length);
  return Object.prototype.hasOwnProperty.call(ADMIN_LIVE_TOPICS, topic) ? (topic as AdminLiveTopic) : null;
}

/** The admin level a token's roles give: 'admin' (admins, super admins), 'moderator', or null. */
export function adminLevelOf(roles: unknown): AdminLiveLevel | null {
  if (isAdmin(roles)) return 'admin';
  if (isModerator(roles)) return 'moderator';
  return null;
}

/** True when `level` may subscribe to `channel` (a known admin topic only). */
export function canSubscribeAdminLive(level: AdminLiveLevel | null | undefined, channel: string): boolean {
  const topic = adminLiveTopicOf(channel);
  if (!topic || !level) return false;
  return ADMIN_LIVE_TOPICS[topic] === 'moderator' || level === 'admin';
}

/**
 * One event. `kind` names it; `key` identifies what it is about, and a later
 * event with the same key within the interval replaces the earlier one
 * (`job:<id>`, `counts`, `backlog:<queue>`). Without a key, `kind` is the key.
 */
export interface AdminLiveEvent {
  kind: string;
  key?: string;
  [field: string]: unknown;
}

/** What subscribers receive: the envelope's `data`. */
export interface AdminLiveUpdate {
  type: typeof ADMIN_LIVE_UPDATE;
  topic: AdminLiveTopic;
  events: AdminLiveEvent[];
  /** True when events were dropped: refetch instead of patching. */
  resync?: boolean;
}

export function adminLiveEventKey(event: AdminLiveEvent): string {
  return event.key ?? event.kind;
}

/**
 * Merges pending events with new ones, latest per key wins, keeping first-seen
 * order. Returns at most `max` events and whether any were dropped.
 */
export function coalesceAdminLiveEvents(
  pending: readonly AdminLiveEvent[],
  incoming: readonly AdminLiveEvent[],
  max = ADMIN_LIVE_MAX_EVENTS,
): { events: AdminLiveEvent[]; overflow: boolean } {
  const byKey = new Map<string, AdminLiveEvent>();
  for (const e of [...pending, ...incoming]) byKey.set(adminLiveEventKey(e), e);
  const events = [...byKey.values()];
  return events.length > max ? { events: events.slice(-max), overflow: true } : { events, overflow: false };
}

/** The `/broadcast` item for one topic's events (the envelope the web clients route on). */
export function adminLiveItem(topic: AdminLiveTopic, events: AdminLiveEvent[], now = Date.now()) {
  const channel = adminLiveChannel(topic);
  return { channel, message: { type: ADMIN_LIVE_UPDATE, channel, timestamp: now, data: { type: ADMIN_LIVE_UPDATE, topic, events } } };
}

type SecretLike = string | { get(): Promise<string> } | undefined | unknown;

export interface AdminLiveEnv {
  WEBSOCKET_URL?: string;
  INTERNAL_API_KEY?: SecretLike;
}

async function secretValue(binding: SecretLike): Promise<string> {
  if (!binding) return '';
  if (typeof binding === 'string') return binding;
  const b = binding as { get?: () => Promise<string> };
  return typeof b.get === 'function' ? (await b.get()) ?? '' : '';
}

/**
 * Sends events to `admin:<topic>`. Never throws; returns false when it could
 * not (no realtime URL or key configured, or the realtime worker refused).
 * Run it inside `waitUntil` so a request never waits on it.
 */
export async function publishAdminLive(
  env: AdminLiveEnv,
  topic: AdminLiveTopic,
  events: AdminLiveEvent | AdminLiveEvent[],
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const list = Array.isArray(events) ? events : [events];
  if (!env?.WEBSOCKET_URL || list.length === 0) return false;
  try {
    const key = await secretValue(env.INTERNAL_API_KEY);
    if (!key) return false;
    const base = env.WEBSOCKET_URL.replace(/^ws(s?):/, 'http$1:').replace(/\/ws\/?$/, '').replace(/\/$/, '');
    const res = await fetcher(`${base}/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({ items: [adminLiveItem(topic, list)] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
