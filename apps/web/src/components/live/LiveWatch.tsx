'use client';

/**
 * The live watch page (/[locale]/live/[id]). Plays state.playbackUrl while the
 * stream is live and the recording (vodUrl) after it ends, with the same
 * player whichever provider serves the stream. Polls the state every 15 s
 * until the stream is live, then every minute to notice the end. While live it
 * shows how many people are watching (useLiveViewers, AlUmmahNow#30). A premiere (wiki E17
 * §5.4) counts down, then plays its video at everyone's moment, then as any video.
 */
import { dateTimeFormat, numberFormat } from '@al-ummah/shared-types';
import { useCallback, useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { Eye } from 'lucide-react';
import type { Player } from 'video.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/hooks/useLanguage';
import { channelPath } from '@/lib/channel-url';
import { LiveApiError, getPublicChannel, getState, getStream, type LiveChannelView, type LiveStreamRow, type TimedState } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';
import { LiveChatPanel, LiveChatReplay } from './LiveChatPanel';
import { LiveKindBadges } from './LiveKindBadges';
import { LivePlayer } from './LivePlayer';
import { PremiereCountdown } from './PremiereCountdown';
import { PremierePlayer } from './PremierePlayer';
import { ReminderButton } from './ReminderButton';
import { serverOffset, type PremiereClock } from './premiere-clock';
import { useLiveQoe } from './useLiveQoe';
import { useLiveViewers } from './useLiveViewers';

export const WATCH_POLL_MS = 15_000;
export const WATCH_LIVE_POLL_MS = 60_000;
/** A premiere's time has come: it starts within the minute. */
export const WATCH_DUE_POLL_MS = 5_000;

type View = 'loading' | 'missing' | 'failed' | 'ready';

/** What the page shows for a state: the live player, the recording, or a notice. */
export function watchMode(timed: TimedState | null): 'live' | 'recording' | 'soon' | 'ended' | 'cancelled' {
  const state = timed?.state;
  if (!state) return 'soon';
  if (state.status === 'cancelled') return 'cancelled';
  if (state.kind === 'premiere') {
    if (state.status === 'ended') return state.premiereVideoId ? 'recording' : 'ended';
    return state.status === 'live' && state.premiereVideoId ? 'live' : 'soon';
  }
  if (state.status === 'ended' || state.sessionStatus === 'ended') return state.vodUrl ? 'recording' : 'ended';
  if ((state.status === 'live' || state.sessionStatus === 'live') && state.playbackUrl) return 'live';
  return 'soon';
}

export function LiveWatch({ streamId }: { streamId: string }) {
  const { t, lang, isRTL } = useLanguage();
  const text = t.liveWatch;
  const [view, setView] = useState<View>('loading');
  const [stream, setStream] = useState<LiveStreamRow | null>(null);
  const [channel, setChannel] = useState<LiveChannelView | null>(null);
  const [timed, setTimed] = useState<TimedState | null>(null);
  const [player, setPlayer] = useState<{ player: Player | null; attachedAt: number | null }>({ player: null, attachedAt: null });
  const [due, setDue] = useState(false);
  const [gone, setGone] = useState(false);
  const found = watchMode(timed);
  const mode = gone && found === 'recording' ? 'ended' : found;

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [row, state] = await Promise.all([getStream(streamId, signal), getState(streamId, signal)]);
      setStream(row);
      setTimed(state);
      setView('ready');
      if (row.channelId) void getPublicChannel(row.channelId, signal).then(setChannel, () => undefined);
    } catch (error) {
      if (signal?.aborted) return;
      if (error instanceof LiveApiError && (error.status === 404 || error.status === 403)) setView('missing');
      else {
        logger.error('[LiveWatch] Could not load the stream', { streamId, error });
        setView('failed');
      }
    }
  }, [streamId]);

  useEffect(() => {
    const controller = new AbortController();
    // Another stream on the same page starts over
    setDue(false);
    setGone(false);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // Until it is live: every 15 s; while live: every minute (to notice the end); after: until the recording appears
  const done = mode === 'recording' || gone || mode === 'cancelled';
  useEffect(() => {
    if (view !== 'ready' || done) return;
    const every = mode === 'live' ? WATCH_LIVE_POLL_MS : due ? WATCH_DUE_POLL_MS : WATCH_POLL_MS;
    const timer = setInterval(() => {
      getState(streamId).then(setTimed, (error) => logger.debug('[LiveWatch] State poll failed', { streamId, error }));
    }, every);
    return () => clearInterval(timer);
  }, [view, mode, done, due, streamId]);

  const onPlayer = useCallback((p: Player | null, attachedAt: number) => setPlayer({ player: p, attachedAt: p ? attachedAt : null }), []);
  const state = timed?.state ?? null;
  useLiveQoe(mode === 'live' ? player.player : null, player.attachedAt, {
    streamId,
    sessionId: state?.sessionId ?? null,
    provider: state?.provider ?? null,
    sampleRate: state?.qoe?.sampleRate ?? 0,
    playbackUrl: state?.playbackUrl ?? null,
    timing: timed,
  });

  // The chat's settings changed, or it opened or closed: the state says what this viewer may do now
  const refreshState = useCallback(() => {
    getState(streamId).then(setTimed, (error) => logger.debug('[LiveWatch] State read failed', { streamId, error }));
  }, [streamId]);

  const onPremierePlayer = useCallback((p: Player | null) => setPlayer({ player: p, attachedAt: null }), []);
  const onDue = useCallback(() => setDue(true), []);
  const onGone = useCallback(() => setGone(true), []);

  const viewers = useLiveViewers(streamId, view === 'ready' && mode === 'live', state?.viewers);

  const timeFormat = dateTimeFormat(lang === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' });
  const fmt = (iso?: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? timeFormat.format(new Date(iso)) : '');

  if (view === 'loading') {
    return (
      <div className="mx-auto max-w-5xl p-4" aria-busy="true" data-testid="live-watch-loading">
        <Skeleton className="aspect-video w-full" />
        <Skeleton className="mt-4 h-6 w-2/3" />
      </div>
    );
  }
  if (view === 'missing' || view === 'failed') {
    return (
      <div className="mx-auto max-w-5xl p-4 py-12 text-center" data-testid={`live-watch-${view}`}>
        <h1 className="mb-3 text-lg font-semibold text-foreground">{view === 'missing' ? text.notFound : text.loadFailed}</h1>
        {view === 'failed' && <Button onClick={() => { setView('loading'); void load(); }}>{text.retry}</Button>}
        <p className="mt-4"><Link className="underline" href={`/${lang}/live`}>{text.allStreams}</Link></p>
      </div>
    );
  }

  const premiere = state?.kind === 'premiere';
  const startedAt = Date.parse(state?.startedAt ?? '');
  const clock: PremiereClock | null = premiere && mode === 'live' && Number.isFinite(startedAt) ? { startedAt, offset: serverOffset(timed), duration: state?.durationSeconds ?? null } : null;
  const startsAt = Date.parse(state?.scheduledStartTime ?? stream?.scheduledStartTime ?? '');
  const scheduled = Number.isFinite(startsAt) ? text.scheduledFor.replace('{time}', timeFormat.format(new Date(startsAt))) : '';
  const channelName = channel ? channel.nameLocalized?.[lang] || channel.name : null;
  const chat = state?.chat;
  const side = chat?.enabled && (mode === 'live' || mode === 'soon') ? (
    <LiveChatPanel streamId={streamId} mode={mode} chat={chat} canModerate={state?.canModerate === true} onChanged={refreshState} />
  ) : chat?.replay && mode === 'recording' ? (
    <LiveChatReplay streamId={streamId} player={player.player} />
  ) : null;
  return (
    <div className={`mx-auto p-4 ${side ? 'max-w-7xl lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6' : 'max-w-5xl'}`} dir={isRTL ? 'rtl' : 'ltr'} data-testid="live-watch" data-mode={mode} data-provider={state?.provider ?? ''}>
      <div className="min-w-0">
      {premiere && state.premiereVideoId && (mode === 'live' || mode === 'recording') ? (
        <PremierePlayer videoId={state.premiereVideoId} clock={clock} onPlayer={onPremierePlayer} onGone={onGone} />
      ) : mode === 'live' && state?.playbackUrl ? (
        <LivePlayer src={state.playbackUrl} lang={lang} label={text.playerLabel} autoplay muted onPlayer={onPlayer} testId="live-watch-player" />
      ) : mode === 'recording' && state?.vodUrl ? (
        <LivePlayer src={state.vodUrl} lang={lang} label={text.playerLabel} onPlayer={onPlayer} testId="live-watch-recording" />
      ) : (
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-6 text-center" data-testid="live-watch-notice">
          {mode === 'soon' && premiere && (
            <>
              {Number.isFinite(startsAt) && <PremiereCountdown startsAt={startsAt} offset={serverOffset(timed)} onDue={onDue} />}
              <p className="text-sm text-muted-foreground">{text.premiereTogether}</p>
              {scheduled && <p className="text-sm text-muted-foreground">{scheduled}</p>}
            </>
          )}
          {mode === 'soon' && !premiere && (
            <>
              <p className="text-lg font-semibold text-foreground">{text.startingSoon}</p>
              <p className="text-sm text-muted-foreground">{text.startingSoonBody}</p>
              {scheduled && <p className="text-sm text-muted-foreground">{scheduled}</p>}
            </>
          )}
          {mode === 'ended' && premiere && <p className="text-lg font-semibold text-foreground">{text.premiereEnded}</p>}
          {mode === 'ended' && !premiere && (
            <>
              <p className="text-lg font-semibold text-foreground">{text.ended}</p>
              <p className="text-sm text-muted-foreground">{text.recordingPreparing}</p>
            </>
          )}
          {mode === 'cancelled' && <p className="text-lg font-semibold text-foreground">{premiere ? text.premiereCancelled : text.cancelled}</p>}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {mode === 'live' && <Badge variant="destructive" className="text-[var(--fanous-c-button-destructive-text)]" data-testid="live-watch-badge">{text.live}</Badge>}
        {mode === 'soon' && !premiere && <Badge variant="secondary">{text.startingSoon}</Badge>}
        {mode === 'recording' && !premiere && <Badge variant="secondary">{text.recording}</Badge>}
        <LiveKindBadges kind={state?.kind} eventType={state?.eventType} lang={lang === 'ar' ? 'ar' : 'en'} />
        <h1 className="text-xl font-semibold text-foreground" dir="auto" data-testid="live-watch-title">{stream?.title}</h1>
      </div>
      {mode === 'live' && viewers !== null && (
        <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground" data-testid="live-watch-viewers" data-count={viewers}>
          <Eye aria-hidden="true" className="h-4 w-4" />
          {text.watching.replace('{count}', numberFormat(lang === 'ar' ? 'ar' : 'en').format(viewers))}
        </p>
      )}
      {channel && channelName && (
        <p className="mt-1 text-sm text-muted-foreground">
          <Link href={channelPath(lang, channel)} className="hover:underline" dir="auto" data-testid="live-watch-channel">{channelName}</Link>
        </p>
      )}
      {mode === 'live' && state?.startedAt && <p className="mt-1 text-sm text-muted-foreground">{text.startedAt.replace('{time}', fmt(state.startedAt))}</p>}
      {mode === 'soon' && state?.reminder?.enabled && <ReminderButton streamId={streamId} reminder={state.reminder} onChanged={refreshState} />}
      {premiere && mode === 'recording' && state.premiereVideoId && (
        <p className="mt-2 text-sm"><Link className="underline" href={`/${lang}/video/${state.premiereVideoId}`} data-testid="premiere-video-link">{text.premiereVideo}</Link></p>
      )}
      {stream?.description && <p className="mt-3 whitespace-pre-line text-sm text-foreground" dir="auto">{stream.description}</p>}
      </div>
      {side && <div className="mt-4 lg:sticky lg:top-20 lg:mt-0 lg:h-[min(40rem,calc(100dvh-7rem))]">{side}</div>}
    </div>
  );
}
