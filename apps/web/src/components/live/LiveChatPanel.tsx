'use client';

/**
 * The chat beside a live stream (wiki E17 §5.2), and beside its recording (the replay). Shown only when the
 * server says this stream has one for this viewer; with the feature off nothing of it is on the page.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Player } from 'video.js';
import { ArrowDown, Pin } from 'lucide-react';
import type { LiveChatMessage, LiveChatSettings } from '@al-ummah/shared-types';
import { useAuth } from '@/components/AuthProvider/authContext';
import ReportContentButton from '@/components/moderation/ReportContentButton';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { moderateChat, type LiveChatView } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';
import { LiveChatComposer } from './LiveChatComposer';
import { LiveChatMessageRow, type ChatRowAction } from './LiveChatMessageRow';
import { useChatReplay } from './useChatReplay';
import { useLiveChat } from './useLiveChat';

const NEAR_END_PX = 48;

function Frame({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <section className="flex h-[26rem] min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground lg:h-full" aria-label={title} data-testid={testId}>
      <h2 className="border-b border-border px-3 py-2 text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Follows the newest message while the reader is at the end; otherwise says that there are new ones. */
function useFollow(last: string | undefined) {
  const box = useRef<HTMLDivElement | null>(null);
  const atEnd = useRef(true);
  const [behind, setBehind] = useState(false);
  const toEnd = useCallback(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
    atEnd.current = true;
    setBehind(false);
  }, []);
  const onScroll = useCallback(() => {
    const el = box.current;
    if (!el) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_END_PX;
    if (atEnd.current) setBehind(false);
  }, []);
  useLayoutEffect(() => {
    if (!last) return;
    if (atEnd.current) toEnd();
    else setBehind(true);
  }, [last, toEnd]);
  // The box gets smaller (a note, a problem, the phone's keyboard): still at the end
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (atEnd.current) el.scrollTop = el.scrollHeight; });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { box, onScroll, behind, toEnd };
}

export interface LiveChatPanelProps {
  streamId: string;
  mode: 'live' | 'soon';
  chat: LiveChatView;
  canModerate: boolean;
  /** The chat's settings or state changed: read the stream's state again */
  onChanged: (settings?: LiveChatSettings) => void;
}

export function LiveChatPanel({ streamId, mode, chat, canModerate, onChanged }: LiveChatPanelProps) {
  const { t } = useLanguage();
  const text = t.liveWatch;
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { confirm, dialog } = useConfirm();
  const { status, messages, pinned, realtime, hasMore, loadOlder, reload, add, drop, pin } = useLiveChat(streamId, mode, { settings: onChanged, closed: () => onChanged() });
  const { box, onScroll, behind, toEnd } = useFollow(messages.at(-1)?.id);
  const [notice, setNotice] = useState<{ text: string; undo?: LiveChatMessage } | null>(null);
  const [reporting, setReporting] = useState<LiveChatMessage | null>(null);
  // Realtime starts a moment after the page: said only when it stays away
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (realtime) { setLate(false); return; }
    const timer = setTimeout(() => setLate(true), 15_000);
    return () => clearTimeout(timer);
  }, [realtime]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 8_000);
    return () => clearTimeout(timer);
  }, [notice]);

  const act = useCallback(async (action: ChatRowAction, message: LiveChatMessage) => {
    if (action === 'report') {
      setReporting(message);
      return;
    }
    const own = message.userId === userId;
    if (action === 'remove' && own && !(await confirm({ title: text.chatRemoveOwnTitle, description: text.chatRemoveOwnBody, confirmLabel: text.chatRemove, testId: 'live-chat-remove-own' }))) return;
    if (action === 'block_author' && !(await confirm({ title: text.chatBlockTitle.replace('{name}', message.authorName), description: text.chatBlockBody, confirmLabel: text.chatBlock, testId: 'live-chat-block-dialog' }))) return;
    try {
      await moderateChat(streamId, message.id, action);
      if (action === 'remove') {
        drop(message.id);
        setNotice({ text: text.chatRemoved, ...(own ? {} : { undo: message }) });
      } else if (action === 'block_author') {
        drop(message.id, message.userId);
        setNotice({ text: text.chatBlocked });
      } else pin(action === 'pin' ? { ...message, isPinned: true } : null);
    } catch (error) {
      logger.warn('[LiveChat] Action failed', { streamId, action, error: error instanceof Error ? error.message : String(error) });
      setNotice({ text: text.chatActionFailed });
      reload();
    }
  }, [confirm, drop, pin, reload, streamId, text, userId]);

  const undo = useCallback(async (message: LiveChatMessage) => {
    setNotice(null);
    try {
      await moderateChat(streamId, message.id, 'restore');
      add({ ...message, isPinned: false });
    } catch (error) {
      logger.warn('[LiveChat] Undo failed', { streamId, error: error instanceof Error ? error.message : String(error) });
      setNotice({ text: text.chatActionFailed });
    }
  }, [add, streamId, text]);

  return (
    <Frame title={text.chat} testId="live-chat">
      {pinned && (
        <div className="flex items-start gap-2 border-b border-border bg-muted px-3 py-2 text-sm" data-testid="live-chat-pinned">
          <Pin aria-hidden="true" className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" />
          <p className="min-w-0 flex-1">
            <span className="sr-only">{text.chatPinned}: </span>
            <span className="me-1.5 font-semibold text-muted-foreground" dir="auto">{pinned.authorName}</span>
            <span className="[overflow-wrap:anywhere]" dir="auto">{pinned.text}</span>
          </p>
          {canModerate && <Button variant="ghost" size="sm" onClick={() => void act('unpin', pinned)} data-testid="live-chat-unpin-banner">{text.chatUnpin}</Button>}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {/* Focusable: a scrolling area must be reachable by keyboard */}
        <div ref={box} onScroll={onScroll} tabIndex={0} className="h-full overflow-y-auto px-1 py-2" data-testid="live-chat-scroll">
          {hasMore && <div className="py-1 text-center"><Button variant="ghost" size="sm" onClick={() => void loadOlder()} data-testid="live-chat-older">{text.chatOlder}</Button></div>}
          {messages.length > 0 ? (
            <div role="log" aria-label={text.chat} aria-live="polite" aria-relevant="additions">
              <ol>
                {messages.map((m) => <LiveChatMessageRow key={m.id} message={m} userId={userId} canModerate={canModerate} pinned={pinned?.id === m.id} onAction={(action, message) => void act(action, message)} />)}
              </ol>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-sm text-muted-foreground" data-testid={`live-chat-${status === 'ready' ? 'empty' : status}`}>
              <p>{status === 'loading' ? text.chatLoading : status === 'failed' ? text.chatFailed : status === 'closed' ? text.chatClosed : text.chatEmpty}</p>
              {status === 'failed' && <Button variant="outline" size="sm" onClick={reload}>{text.retry}</Button>}
            </div>
          )}
        </div>
        {behind && (
          <Button size="sm" className="absolute bottom-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2" onClick={toEnd} data-testid="live-chat-new">
            <ArrowDown aria-hidden="true" className="h-4 w-4" />
            {text.chatNewMessages}
          </Button>
        )}
      </div>
      {late && status === 'ready' && <p className="px-3 py-1 text-xs text-muted-foreground" role="status" data-testid="live-chat-late">{text.chatPaused}</p>}
      {notice && (
        <p className="flex items-center justify-between gap-2 border-t border-border px-3 py-1 text-sm" role="status" data-testid="live-chat-notice">
          {notice.text}
          {notice.undo && <Button variant="ghost" size="sm" onClick={() => void undo(notice.undo!)} data-testid="live-chat-undo">{text.chatUndo}</Button>}
        </p>
      )}
      {status !== 'closed' && <LiveChatComposer streamId={streamId} chat={chat} canModerate={canModerate} onPosted={(m) => { add(m); toEnd(); }} onClosed={() => { onChanged(); reload(); }} />}
      {dialog}
      {reporting && (
        <ReportContentButton
          contentType="live_chat"
          contentId={reporting.id}
          contentTitle={reporting.text}
          hideTrigger
          open
          onOpenChange={(open) => { if (!open) setReporting(null); }}
        />
      )}
    </Frame>
  );
}

/** The chat as it was, beside the recording. Nothing on the page when there is none. */
export function LiveChatReplay({ streamId, player }: { streamId: string; player: Player | null }) {
  const { t } = useLanguage();
  const text = t.liveWatch;
  const { messages, started, off, loading } = useChatReplay(streamId, player);
  const { box, onScroll, behind, toEnd } = useFollow(messages.at(-1)?.id);
  if (off) return null;
  return (
    <Frame title={text.chatReplay} testId="live-chat-replay">
      <div className="relative min-h-0 flex-1">
        <div ref={box} onScroll={onScroll} tabIndex={0} className="h-full overflow-y-auto px-1 py-2">
          {messages.length > 0 ? (
            // Not a live region: it moves with the recording, and reading it out would talk over it
            <ol aria-label={text.chatReplay}>
              {messages.map((m) => <LiveChatMessageRow key={m.id} message={m} userId={null} canModerate={false} pinned={false} showTime />)}
            </ol>
          ) : (
            <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground" data-testid="live-chat-replay-empty">
              {!started ? text.chatReplayEmpty : loading ? text.chatLoading : text.chatReplayNone}
            </p>
          )}
        </div>
        {behind && (
          <Button size="sm" className="absolute bottom-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2" onClick={toEnd}>
            <ArrowDown aria-hidden="true" className="h-4 w-4" />
            {text.chatNewMessages}
          </Button>
        )}
      </div>
    </Frame>
  );
}
