'use client';

/**
 * Studio Go live page for one stream: encoder settings, status, preview, Go live
 * and End stream, then the recording. The page is the same for both live
 * providers (D3): only the encoder help line follows the ingest protocol.
 * State is polled every 5 s (GET /api/live-streams/:id/state).
 */
import { useCallback, useEffect, useId, useState } from 'react';
import Link from '@/components/common/AppLink';
import { ArrowLeft } from 'lucide-react';
import type { LiveIngest, LiveStreamState } from '@al-ummah/shared-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { LivePlayer } from '@/components/live/LivePlayer';
import { useLanguage } from '@/hooks/useLanguage';
import { LiveApiError, endStream, getIngest, getState, getStream, liveErrorCode, startStream, type LiveStreamRow } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';
import { studioLiveHref } from './LiveTab';

export const STUDIO_POLL_MS = 5_000;

export type GoLivePhase = 'ready' | 'waiting' | 'live' | 'ended';

/** Where the stream is, from its state and whether Go live was pressed on this page. */
export function goLivePhase(state: LiveStreamState | null, started: boolean): GoLivePhase {
  if (!state) return 'ready';
  if (state.status === 'ended' || state.status === 'cancelled' || state.sessionStatus === 'ended' || state.sessionStatus === 'failed') return 'ended';
  if (state.receiving) return 'live';
  if (state.status === 'live' || state.sessionStatus === 'live' || started) return 'waiting';
  return 'ready';
}

/** The ffmpeg command with the stream key hidden (copying still copies the real one). */
export function maskKey(text: string, key: string): string {
  return key ? text.split(key).join('•'.repeat(12)) : text;
}

type Load = 'loading' | 'ready' | 'missing' | 'forbidden' | 'failed';

export function GoLive({ locale, channelId, streamId }: { locale: string; channelId: string; streamId: string }) {
  const { t, lang } = useLanguage();
  const text = t.studio.live.goLive;
  const errors = t.studio.live.errors;
  const ids = useId();

  const [load, setLoad] = useState<Load>('loading');
  const [stream, setStream] = useState<LiveStreamRow | null>(null);
  const [ingest, setIngest] = useState<LiveIngest | null>(null);
  const [state, setState] = useState<LiveStreamState | null>(null);
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState<'start' | 'end' | null>(null);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const phase = goLivePhase(state, started);

  const fetchAll = useCallback(async (signal?: AbortSignal) => {
    try {
      const [row, settings] = await Promise.all([getStream(streamId, signal), getIngest(streamId, signal)]);
      setStream(row);
      setIngest(settings.ingest);
      setState(settings.state);
      setLoad('ready');
    } catch (err) {
      if (signal?.aborted) return;
      if (err instanceof LiveApiError && err.status === 404) setLoad('missing');
      else if (err instanceof LiveApiError && err.status === 403) setLoad('forbidden');
      else {
        const code = liveErrorCode(err);
        if (code === 'generic') logger.error('[StudioGoLive] Could not load the stream', { streamId, error: err });
        setError(code === 'generic' ? '' : errors[code]);
        setLoad('failed');
      }
    }
  }, [streamId, errors]);

  useEffect(() => {
    const controller = new AbortController();
    void fetchAll(controller.signal);
    return () => controller.abort();
  }, [fetchAll]);

  // Every 5 s until the recording is known
  const settled = phase === 'ended' && !!state?.vodUrl;
  useEffect(() => {
    if (load !== 'ready' || settled) return;
    const timer = setInterval(() => {
      getState(streamId).then(({ state: next }) => setState(next), (err) => logger.debug('[StudioGoLive] State poll failed', { streamId, error: err }));
    }, STUDIO_POLL_MS);
    return () => clearInterval(timer);
  }, [load, settled, streamId]);

  const goLive = async () => {
    setBusy('start');
    setError('');
    try {
      const out = await startStream(streamId);
      // A provider that failed to start hands the stream to the other one: its settings replace these
      if (out.ingest) setIngest(out.ingest);
      setState(out.state);
      setStarted(true);
    } catch (err) {
      const code = liveErrorCode(err);
      if (code === 'generic') logger.error('[StudioGoLive] Go live failed', { streamId, error: err });
      setError(errors[code]);
    } finally {
      setBusy(null);
    }
  };

  const end = async (confirmed: boolean) => {
    setConfirmEnd(false);
    if (!confirmed) return;
    setBusy('end');
    setError('');
    try {
      const out = await endStream(streamId);
      setState(out.state);
    } catch (err) {
      logger.error('[StudioGoLive] End stream failed', { streamId, error: err });
      setError(errors[liveErrorCode(err)]);
    } finally {
      setBusy(null);
    }
  };

  const copy = (label: string, value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => setCopied(`${label}: ${text.copied}`),
      (err) => logger.debug('[StudioGoLive] Copy failed', { error: err }),
    );
  };

  const timeFormat = new Intl.DateTimeFormat(lang === 'ar' ? 'ar' : 'en', { dateStyle: 'medium', timeStyle: 'short' });
  const back = (
    <Link href={studioLiveHref(locale, channelId)} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:underline" data-testid="studio-golive-back">
      <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
      {text.back}
    </Link>
  );

  if (load === 'loading') {
    return (
      <div aria-busy="true" data-testid="studio-golive-loading">
        {back}
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (load !== 'ready') {
    const message = load === 'missing' ? text.notFound : load === 'forbidden' ? text.notOwner : error || text.loadFailed;
    return (
      <div data-testid={`studio-golive-${load}`}>
        {back}
        <p className="py-8 text-foreground">{message}</p>
        {load === 'failed' && <Button onClick={() => { setLoad('loading'); void fetchAll(); }}>{t.studio.live.retry}</Button>}
      </div>
    );
  }

  const statusLine = phase === 'live' ? text.live : phase === 'waiting' ? text.waiting : phase === 'ended' ? text.ended : text.ready;
  const watchHref = `/${locale}/live/${encodeURIComponent(streamId)}`;

  return (
    <div data-testid="studio-golive" data-phase={phase}>
      {back}
      <h1 className="mb-4 text-xl font-semibold text-foreground" dir="auto">{stream?.title}</h1>

      <section aria-labelledby={`${ids}-status`} className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 id={`${ids}-status`} className="mb-2 text-base font-semibold text-foreground">{text.status}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {phase === 'live' && <Badge variant="destructive">{t.studio.live.status.live}</Badge>}
          <p role="status" aria-live="polite" className="text-foreground" data-testid="studio-golive-status">{statusLine}</p>
        </div>
        {phase === 'live' && (
          <p className="mt-1 text-sm text-muted-foreground" data-testid="studio-golive-details">
            {state?.startedAt ? text.startedAt.replace('{time}', timeFormat.format(new Date(state.startedAt))) : ''}
            {state?.startedAt && state?.bitrateKbps ? ' · ' : ''}
            {state?.bitrateKbps ? text.bitrate.replace('{kbps}', String(Math.round(state.bitrateKbps))) : ''}
          </p>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-destructive" data-testid="studio-golive-error">{error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {phase === 'ready' && (
            <Button onClick={() => void goLive()} disabled={busy !== null} className="min-h-11" data-testid="studio-golive-start">
              {busy === 'start' ? text.starting : text.goLive}
            </Button>
          )}
          {(phase === 'waiting' || phase === 'live') && (
            <Button variant="destructive" onClick={() => setConfirmEnd(true)} disabled={busy !== null} className="min-h-11" data-testid="studio-golive-end">
              {busy === 'end' ? text.ending : text.end}
            </Button>
          )}
          {phase !== 'ended' && (
            <Button asChild variant="outline" className="min-h-11">
              <Link href={watchHref}>{text.watchPage}</Link>
            </Button>
          )}
        </div>
        {phase === 'ended' && (
          <div className="mt-3" data-testid="studio-golive-recording">
            {state?.vodUrl ? (
              <>
                <p className="font-medium text-foreground">{text.recordingReady}</p>
                <Link href={watchHref} className="text-sm underline" data-testid="studio-golive-recording-link">{text.watchRecording}</Link>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{text.recordingPreparing}</p>
            )}
          </div>
        )}
      </section>

      {phase === 'live' && state?.playbackUrl && (
        <section aria-labelledby={`${ids}-preview`} className="mb-6">
          <h2 id={`${ids}-preview`} className="mb-2 text-base font-semibold text-foreground">{text.preview}</h2>
          <div className="max-w-xl">
            <LivePlayer src={state.playbackUrl} lang={lang} label={text.preview} autoplay muted testId="studio-golive-preview" />
          </div>
        </section>
      )}

      {phase !== 'ended' && ingest && (
        <section aria-labelledby={`${ids}-encoder`} className="rounded-lg border border-border bg-card p-4" data-testid="studio-golive-encoder" data-protocol={ingest.protocol}>
          <h2 id={`${ids}-encoder`} className="mb-1 text-base font-semibold text-foreground">{text.encoder}</h2>
          <p className="mb-4 text-sm text-muted-foreground" data-testid="studio-golive-help">{text.help[ingest.protocol]}</p>

          <Field id={`${ids}-server`} label={text.server} testId="studio-golive-server">
            <input id={`${ids}-server`} readOnly value={ingest.url} dir="ltr" className="min-h-11 w-full min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 font-mono text-sm text-foreground" data-testid="studio-golive-server" />
            <Button variant="outline" className="min-h-11" onClick={() => copy(text.server, ingest.url)} data-testid="studio-golive-copy-server">{text.copy}</Button>
          </Field>

          <Field id={`${ids}-key`} label={text.streamKey} testId="studio-golive-key">
            <input
              id={`${ids}-key`}
              readOnly
              type={revealed ? 'text' : 'password'}
              value={ingest.streamKey}
              dir="ltr"
              autoComplete="off"
              className="min-h-11 w-full min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 font-mono text-sm text-foreground"
              data-testid="studio-golive-key"
            />
            <Button variant="outline" className="min-h-11" onClick={() => setRevealed((r) => !r)} aria-pressed={revealed} data-testid="studio-golive-reveal">{revealed ? text.hide : text.reveal}</Button>
            <Button variant="outline" className="min-h-11" onClick={() => copy(text.streamKey, ingest.streamKey)} data-testid="studio-golive-copy-key">{text.copy}</Button>
          </Field>
          <p className="mb-4 text-xs text-muted-foreground">{text.keyWarning}</p>

          <div className="grid gap-1">
            <span id={`${ids}-ffmpeg`} className="text-sm font-medium text-foreground">{text.ffmpeg}</span>
            <pre aria-labelledby={`${ids}-ffmpeg`} dir="ltr" className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md border border-input p-3 font-mono text-xs text-foreground" data-testid="studio-golive-ffmpeg">
              {revealed ? ingest.ffmpegExample : maskKey(ingest.ffmpegExample, ingest.streamKey)}
            </pre>
            <div>
              <Button variant="outline" className="min-h-11" onClick={() => copy(text.ffmpeg, ingest.ffmpegExample)} data-testid="studio-golive-copy-ffmpeg">{text.copy}</Button>
            </div>
          </div>
          <p role="status" aria-live="polite" className="sr-only" data-testid="studio-golive-copied">{copied}</p>
        </section>
      )}

      <ConfirmDialog
        open={confirmEnd}
        onResult={(confirmed) => void end(confirmed)}
        title={text.endTitle}
        description={text.endBody}
        confirmLabel={text.end}
        testId="studio-golive-end-dialog"
      />
    </div>
  );
}

function Field({ id, label, testId, children }: { id: string; label: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 grid gap-1" data-testid={`${testId}-field`}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">{label}</label>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
