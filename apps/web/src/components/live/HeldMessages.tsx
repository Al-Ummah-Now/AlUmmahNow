'use client';

/** Live chat messages the AI scan held (wiki E17, E17-D4): for those who moderate, who show or remove each. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveChatMessage } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { LiveApiError, heldChat, moderateChat } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';

export const HELD_POLL_MS = 30_000;

/** `messages` is null until the first answer, and stays so for who may not see them. */
export function useHeldMessages(streamId: string, active: boolean) {
  const [messages, setMessages] = useState<LiveChatMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const read = useCallback(async (signal?: AbortSignal) => {
    try {
      const list = await heldChat(streamId, signal);
      if (signal?.aborted) return;
      setMessages(list);
      setFailed(false);
    } catch (error) {
      if (signal?.aborted) return;
      // Off, or no longer a moderator
      if (error instanceof LiveApiError && (error.status === 404 || error.status === 403)) setMessages(null);
      else setFailed(true);
    }
  }, [streamId]);
  useEffect(() => {
    setMessages(null);
    setFailed(false);
    if (!active) return;
    const controller = new AbortController();
    void read(controller.signal);
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void read(controller.signal); }, HELD_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [active, read]);

  const decide = useCallback(async (message: LiveChatMessage, action: 'restore' | 'remove'): Promise<boolean> => {
    try {
      await moderateChat(streamId, message.id, action);
      setMessages((list) => list?.filter((m) => m.id !== message.id) ?? null);
      return true;
    } catch (error) {
      logger.warn('[LiveChat] Held message not decided', { streamId, action, error: error instanceof Error ? error.message : String(error) });
      void read();
      return false;
    }
  }, [streamId, read]);
  return { messages, failed, decide };
}

export function HeldList({ messages, onDecide }: { messages: LiveChatMessage[]; onDecide: (message: LiveChatMessage, action: 'restore' | 'remove') => Promise<boolean> }) {
  const { t } = useLanguage();
  const text = t.liveWatch;
  const [failed, setFailed] = useState(false);
  // Being decided: a second press would be refused as a conflict
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const running = useRef(new Set<string>());
  const decide = async (message: LiveChatMessage, action: 'restore' | 'remove') => {
    if (running.current.has(message.id)) return;
    running.current.add(message.id);
    setBusy(new Set(running.current));
    const done = await onDecide(message, action);
    running.current.delete(message.id);
    setBusy(new Set(running.current));
    setFailed(!done);
  };
  return (
    <>
      <ul className="divide-y divide-border" data-testid="live-chat-held-list">
        {messages.map((m) => (
          <li key={m.id} className="py-2 text-sm" data-testid="live-chat-held" data-message-id={m.id}>
            <p className="[overflow-wrap:anywhere]">
              <span className="me-1.5 font-semibold text-muted-foreground" dir="auto">{m.authorName}</span>
              <span className="text-foreground" dir="auto">{m.text}</span>
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={busy.has(m.id)} onClick={() => void decide(m, 'restore')} data-testid="live-chat-held-show">{text.chatHeldShow}</Button>
              <Button variant="ghost" size="sm" disabled={busy.has(m.id)} onClick={() => void decide(m, 'remove')} data-testid="live-chat-held-remove">{text.chatHeldRemove}</Button>
            </div>
          </li>
        ))}
      </ul>
      <p role="status" className="text-sm text-[var(--fanous-color-error-text)] empty:hidden">{failed ? text.chatActionFailed : ''}</p>
    </>
  );
}
