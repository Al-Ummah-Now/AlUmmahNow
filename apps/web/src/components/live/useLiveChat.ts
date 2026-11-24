'use client';

/**
 * A live stream's chat (wiki E17 §5.2, §5.3): the latest messages, then the realtime channel `live:<id>`.
 * While the server has not confirmed the channel (signed out of realtime, reconnecting, refused) the latest
 * page is read instead: every 10 s ± 2 s on air, every 30 s before, never in the background, backing off to
 * 60 s on errors. Each read replaces the messages it covers, so removals made meanwhile are seen too.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { liveChatChannel, type LiveChatMessage, type LiveChatSettings } from '@al-ummah/shared-types';
import { CHAT_PAGE, LiveApiError, readChat } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';
import { useOptionalWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { REALTIME_JOINED, REALTIME_LEFT } from '@/lib/websocket/WebSocketManager';

export const CHAT_POLL_LIVE_MS = 10_000;
export const CHAT_POLL_SOON_MS = 30_000;
export const CHAT_POLL_JITTER_MS = 2_000;
export const CHAT_POLL_MAX_MS = 60_000;
/** The server's shared latest page lives 2 seconds; a little more for the way. */
const SNAPSHOT_AGE_MS = 5_000;
/** Messages kept on the page, and more while the reader has asked for earlier ones. */
export const CHAT_KEPT = 500;

export type ChatStatus = 'loading' | 'ready' | 'failed' | 'closed';

/** Server order: `(createdAt, id)`. */
export const byTime = (a: LiveChatMessage, b: LiveChatMessage): number => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** One more message, or the new version of one, in its place. */
export function withMessage(list: LiveChatMessage[], message: LiveChatMessage, kept = CHAT_KEPT): LiveChatMessage[] {
  const next = [...list.filter((m) => m.id !== message.id), message].sort(byTime);
  return next.length > kept ? next.slice(-kept) : next;
}

/** The server's latest page over what is shown: older messages stay, everything the page covers is the page's, and what is `fresh` stays after it. */
export function withLatest(list: LiveChatMessage[], page: LiveChatMessage[], fresh: (id: string) => boolean = () => false, kept = CHAT_KEPT): LiveChatMessage[] {
  const first = page[0];
  const last = page.at(-1);
  const ids = new Set(page.map((m) => m.id));
  // The page may be up to 2 seconds old: what arrived in that time is newer than it
  const newer = list.filter((m) => !ids.has(m.id) && fresh(m.id) && (!last || byTime(m, last) > 0));
  // Older ones stay only while nothing can be missing between them and the page
  const joins = list.some((m) => ids.has(m.id));
  return [...(first && joins ? list.filter((m) => byTime(m, first) < 0) : []), ...page, ...newer].slice(-kept);
}

export function pollDelay(mode: 'live' | 'soon', failures: number, random = Math.random()): number {
  if (failures > 0) return Math.min(CHAT_POLL_MAX_MS, CHAT_POLL_LIVE_MS * 2 ** failures);
  return mode === 'live' ? CHAT_POLL_LIVE_MS + Math.round((random * 2 - 1) * CHAT_POLL_JITTER_MS) : CHAT_POLL_SOON_MS;
}

export interface LiveChat {
  status: ChatStatus;
  messages: LiveChatMessage[];
  pinned: LiveChatMessage | null;
  /** The realtime channel is confirmed */
  realtime: boolean;
  hasMore: boolean;
  loadOlder: () => Promise<void>;
  reload: () => void;
  add: (message: LiveChatMessage) => void;
  drop: (messageId: string, userId?: string) => void;
  pin: (message: LiveChatMessage | null) => void;
}

export function useLiveChat(streamId: string, mode: 'live' | 'soon', on: { settings?: (s: LiveChatSettings) => void; closed?: () => void } = {}): LiveChat {
  const [status, setStatus] = useState<ChatStatus>('loading');
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const [pinned, setPinned] = useState<LiveChatMessage | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [failures, setFailures] = useState(0);
  const onRef = useRef(on);
  onRef.current = on;
  // Frames that arrive while a page is being read are newer than it: kept and put back on top
  const reading = useRef(0);
  const during = useRef<Array<(list: LiveChatMessage[]) => LiveChatMessage[]>>([]);
  const kept = useRef(CHAT_KEPT);
  // A pin frame that came during a read is newer than the page's
  const pinnedDuring = useRef(false);
  const addedAt = useRef(new Map<string, number>());
  const fresh = useCallback((id: string) => Date.now() - (addedAt.current.get(id) ?? 0) < SNAPSHOT_AGE_MS, []);
  const change = useCallback((apply: (list: LiveChatMessage[]) => LiveChatMessage[]) => {
    if (reading.current > 0) during.current.push(apply);
    setMessages(apply);
  }, []);

  const read = useCallback(async (signal?: AbortSignal) => {
    reading.current++;
    try {
      const page = await readChat(streamId, { limit: CHAT_PAGE }, signal);
      if (signal?.aborted) return;
      const late = during.current;
      setMessages((list) => late.reduce((l, apply) => apply(l), withLatest(list, page.messages, fresh, kept.current)));
      if (!pinnedDuring.current) setPinned(page.pinned);
      setHasMore((had) => had || page.hasMore);
      setStatus('ready');
      setFailures(0);
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof LiveApiError && error.status === 404) {
        setStatus('closed');
        return;
      }
      logger.debug('[LiveChat] Could not read the chat', { streamId, error });
      setStatus((s) => (s === 'ready' ? s : 'failed'));
      setFailures((n) => n + 1);
    } finally {
      if (--reading.current === 0) {
        during.current = [];
        pinnedDuring.current = false;
      }
    }
  }, [streamId, fresh]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setMessages([]);
    setPinned(null);
    setHasMore(false);
    kept.current = CHAT_KEPT;
    void read(controller.signal);
    return () => controller.abort();
  }, [read]);

  useOptionalWebSocketSubscription(status === 'closed' ? '' : liveChatChannel(streamId), (raw) => {
    const frame = raw as { type?: string; message?: LiveChatMessage | null; messageId?: string; userId?: string; settings?: LiveChatSettings } | null;
    switch (frame?.type) {
      case REALTIME_JOINED:
        setRealtime(true);
        // What was written between the last read and the confirmation
        void read();
        break;
      case REALTIME_LEFT:
        setRealtime(false);
        break;
      case 'live_chat_message': {
        const message = frame.message;
        if (message) {
          addedAt.current.set(message.id, Date.now());
          change((list) => withMessage(list, message, kept.current));
        }
        break;
      }
      case 'live_chat_removed':
        change((list) => list.filter((m) => m.id !== frame.messageId && (!frame.userId || m.userId !== frame.userId)));
        setPinned((p) => {
          const gone = !!p && (p.id === frame.messageId || (!!frame.userId && p.userId === frame.userId));
          if (gone && reading.current > 0) pinnedDuring.current = true;
          return gone ? null : p;
        });
        break;
      case 'live_chat_pinned':
        pinnedDuring.current = reading.current > 0;
        setPinned(frame.message ?? null);
        break;
      case 'live_chat_settings':
        if (frame.settings) onRef.current.settings?.(frame.settings);
        break;
      case 'live_chat_closed':
        setRealtime(false);
        onRef.current.closed?.();
        void read();
        break;
    }
  });

  // Only while the realtime channel is not there
  useEffect(() => {
    if (realtime || status === 'closed') return;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const schedule = () => {
      timer = setTimeout(async () => {
        if (document.visibilityState === 'visible') await read(controller.signal);
        if (!controller.signal.aborted) schedule();
      }, pollDelay(mode, failures));
    };
    schedule();
    // Back from the background: at once
    const onVisible = () => { if (document.visibilityState === 'visible') void read(controller.signal); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [realtime, status, mode, failures, read]);

  const first = messages[0];
  const loadOlder = useCallback(async () => {
    if (!first) return;
    try {
      const page = await readChat(streamId, { before: first.id, limit: 50 });
      kept.current += page.messages.length;
      setMessages((list) => [...page.messages.filter((m) => !list.some((x) => x.id === m.id)), ...list].sort(byTime));
      setHasMore(page.hasMore);
    } catch (error) {
      logger.debug('[LiveChat] Could not read earlier messages', { streamId, error });
    }
  }, [first, streamId]);

  const reload = useCallback(() => void read(), [read]);
  const add = useCallback((message: LiveChatMessage) => {
    addedAt.current.set(message.id, Date.now());
    change((list) => withMessage(list, message, kept.current));
  }, [change]);
  const drop = useCallback((messageId: string, userId?: string) => {
    change((list) => list.filter((m) => m.id !== messageId && (!userId || m.userId !== userId)));
    setPinned((p) => (p && (p.id === messageId || (userId && p.userId === userId)) ? null : p));
  }, [change]);

  return { status, messages, pinned, realtime, hasMore, loadOlder, reload, add, drop, pin: setPinned };
}
