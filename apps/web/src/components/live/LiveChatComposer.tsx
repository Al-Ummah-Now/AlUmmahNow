'use client';

/** Writing in a live chat (wiki E17 §5.2): pace, length and the account's first-message check are the server's; their answers are shown here. */
import { useEffect, useId, useState, type FormEvent } from 'react';
import { LIVE_CHAT_MAX_LENGTH, apiErrorMessage, fillTemplate, formatNumber, type LiveChatMessage } from '@al-ummah/shared-types';
import { ComposerAvatar } from '@/components/comments-shared/ComposerAvatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useHumanCheck } from '@/hooks/useHumanCheck';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useProfile } from '@/hooks/useProfile';
import { loginRoutePath } from '@/lib/auth/silent-sign-in';
import { userDisplayName } from '@/lib/display-name';
import { LiveApiError, postChat, type LiveChatView } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';

/** The count is shown only near the end. */
const COUNT_FROM = 100;
const lengthOf = (value: string) => [...value].length;

export interface LiveChatComposerProps {
  streamId: string;
  chat: LiveChatView;
  canModerate: boolean;
  onPosted: (message: LiveChatMessage) => void;
  /** The chat turned out to be closed (404) */
  onClosed: () => void;
}

export function LiveChatComposer({ streamId, chat, canModerate, onPosted, onClosed }: LiveChatComposerProps) {
  const { t, lang } = useLanguage();
  const text = t.liveWatch;
  const { user } = useAuth();
  const { profile } = useProfile(user);
  const { user: account } = useMultiAccount();
  const { ensureHuman, checking, messages: human } = useHumanCheck();
  const channel = account?.channel || null;
  const id = useId();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [problem, setProblem] = useState('');

  const wait = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [waitUntil]);

  if (!user) {
    return (
      <div className="border-t border-border p-3">
        <Button variant="outline" className="w-full" onClick={() => { window.location.href = loginRoutePath(window.location.pathname, lang); }} data-testid="live-chat-sign-in">
          {text.chatSignIn}
        </Button>
      </div>
    );
  }
  if (!chat.canPost) {
    return <p className="border-t border-border p-3 text-sm text-muted-foreground" data-testid="live-chat-not-open">{text.chatNotOpen}</p>;
  }

  const left = LIVE_CHAT_MAX_LENGTH - lengthOf(draft);
  const name = channel?.nameLocalized?.[lang]?.trim() || channel?.name?.trim() || userDisplayName(profile, lang, user.email);
  const canSend = draft.trim() !== '' && left >= 0 && !sending && wait === 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    setSending(true);
    setProblem('');
    try {
      // An account's first comment, post or message is checked once (normally invisible)
      const check = await ensureHuman('comment');
      if (!check.ok) {
        setProblem(human.failed);
        return;
      }
      const message = await postChat(streamId, draft.trim(), { channelId: channel?.id ?? null, humanToken: check.token });
      setDraft('');
      onPosted(message);
      // Slow mode: the server would refuse the next one sooner
      if (chat.slowModeSeconds > 0 && !canModerate) setWaitUntil(Date.now() + chat.slowModeSeconds * 1000);
    } catch (error) {
      if (error instanceof LiveApiError && error.status === 404) {
        onClosed();
        return;
      }
      logger.warn('[LiveChat] Message not sent', { streamId, error: error instanceof Error ? error.message : String(error) });
      const api = error instanceof LiveApiError ? error : null;
      if (api?.retryAfter && api.status === 429) setWaitUntil(Date.now() + api.retryAfter * 1000);
      setProblem(api?.code === 'human_check_required' ? human.failed : apiErrorMessage(api?.code ?? 'internal_error', api?.status ?? 500, lang === 'ar' ? 'ar' : 'en'));
    } finally {
      setNow(Date.now());
      setSending(false);
    }
  }

  const notes = [
    chat.slowModeSeconds > 0 && !canModerate ? fillTemplate(lang, text.chatSlowMode, { seconds: chat.slowModeSeconds }) : '',
    chat.subscribersOnly ? text.chatSubscribersOnly : '',
  ].filter(Boolean);

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2 border-t border-border p-3" data-testid="live-chat-form">
      {notes.length > 0 && <p className="text-xs text-muted-foreground" id={`${id}-notes`} data-testid="live-chat-notes">{notes.join(' ')}</p>}
      <div className="flex items-center gap-2">
        <ComposerAvatar src={channel ? channel.avatarUrl : profile?.avatarUrl} name={name} as={channel ? 'channel' : 'member'} className="h-8 w-8" testId="live-chat-identity" />
        <Input
          value={draft}
          onChange={(e) => { setDraft(e.target.value); if (problem) setProblem(''); }}
          placeholder={text.chatPlaceholder}
          aria-label={text.chatPlaceholder}
          aria-invalid={left < 0 || undefined}
          aria-describedby={[notes.length ? `${id}-notes` : '', problem ? `${id}-problem` : ''].filter(Boolean).join(' ') || undefined}
          autoComplete="off"
          dir="auto"
          className="min-w-0 flex-1"
          data-testid="live-chat-input"
        />
        <Button type="submit" disabled={!canSend} aria-busy={sending || checking} data-testid="live-chat-send">
          {wait > 0 ? text.chatWait.replace('{seconds}', formatNumber(lang, wait)) : sending ? text.chatSending : text.chatSend}
        </Button>
      </div>
      {left <= COUNT_FROM && <p className={`text-xs ${left < 0 ? 'text-[var(--fanous-color-error-text)]' : 'text-muted-foreground'}`} data-testid="live-chat-left">{text.chatLeft.replace('{count}', formatNumber(lang, left))}</p>}
      {problem && <p role="alert" id={`${id}-problem`} className="text-sm text-[var(--fanous-color-error-text)]" data-testid="live-chat-problem">{problem}</p>}
    </form>
  );
}
