/**
 * Admin live updates: at most one update per second per topic
 * (docs/admin/LIVE_OPS.md §B.3).
 *
 * `/broadcast` items for `admin:<topic>` go to the object `coalesce:admin:<topic>`
 * (same WebSocketDurableObject class: the release's `wrangler versions upload`
 * cannot add classes) instead of straight to the topic router. When the topic
 * has been quiet for a second the events go out at once; otherwise they wait,
 * the latest event per key wins, and an alarm sends them as one update when the
 * second is up. More than ADMIN_LIVE_MAX_EVENTS keys in one window turn into
 * `resync: true` (subscribers refetch instead of patching).
 */
import {
  ADMIN_LIVE_INTERVAL_MS,
  ADMIN_LIVE_UPDATE,
  adminLiveItem,
  adminLiveTopicOf,
  coalesceAdminLiveEvents,
  type AdminLiveEvent,
  type AdminLiveTopic,
} from '@al-ummah/shared-types';
import type { BroadcastItem } from './shards';

/** Object name of a channel's coalescer. */
export function coalescerName(channel: string): string {
  return `coalesce:${channel}`;
}

/** The storage a coalescer needs (a subset of DurableObjectStorage). */
export interface CoalescerStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
}

interface CoalescerState {
  topic: AdminLiveTopic;
  lastFlush: number;
  pending: AdminLiveEvent[];
  overflow: boolean;
}

const STATE_KEY = 'admin-coalesce';

/** Events carried by an admin broadcast item (the shape publishAdminLive sends), or null. */
export function eventsOf(item: BroadcastItem): AdminLiveEvent[] | null {
  const msg = item.message as { type?: unknown; data?: { events?: unknown } } | null;
  if (!msg || msg.type !== ADMIN_LIVE_UPDATE || !Array.isArray(msg.data?.events)) return null;
  const events = (msg.data.events as unknown[]).filter(
    (e): e is AdminLiveEvent => !!e && typeof e === 'object' && typeof (e as AdminLiveEvent).kind === 'string',
  );
  return events;
}

function updateItem(state: CoalescerState, events: AdminLiveEvent[], overflow: boolean, now: number): BroadcastItem {
  const item = adminLiveItem(state.topic, events, now);
  if (overflow) (item.message.data as { resync?: boolean }).resync = true;
  return item;
}

export class AdminCoalescer {
  constructor(
    private storage: CoalescerStorage,
    private send: (item: BroadcastItem) => Promise<void>,
    private now: () => number = Date.now,
  ) {}

  /** Takes a topic's events; returns whether they went out now or wait for the alarm. */
  async add(channel: string, events: AdminLiveEvent[]): Promise<'sent' | 'held'> {
    const topic = adminLiveTopicOf(channel);
    if (!topic) throw new Error(`Not an admin topic: ${channel}`);
    const now = this.now();
    const state: CoalescerState = (await this.storage.get<CoalescerState>(STATE_KEY)) ?? { topic, lastFlush: 0, pending: [], overflow: false };
    const merged = coalesceAdminLiveEvents(state.pending, events);
    if (state.pending.length === 0 && now - state.lastFlush >= ADMIN_LIVE_INTERVAL_MS) {
      await this.storage.put(STATE_KEY, { ...state, lastFlush: now, pending: [], overflow: false });
      await this.send(updateItem(state, merged.events, merged.overflow, now));
      return 'sent';
    }
    await this.storage.put(STATE_KEY, { ...state, pending: merged.events, overflow: state.overflow || merged.overflow });
    if ((await this.storage.getAlarm()) === null) {
      await this.storage.setAlarm(Math.max(now, state.lastFlush + ADMIN_LIVE_INTERVAL_MS));
    }
    return 'held';
  }

  /** Sends what waited. Returns false when this object is not a coalescer (the alarm is someone else's). */
  async alarm(): Promise<boolean> {
    const state = await this.storage.get<CoalescerState>(STATE_KEY);
    if (!state) return false;
    if (state.pending.length === 0) return true;
    const now = this.now();
    await this.storage.put(STATE_KEY, { ...state, lastFlush: now, pending: [], overflow: false });
    await this.send(updateItem(state, state.pending, state.overflow, now));
    return true;
  }
}
