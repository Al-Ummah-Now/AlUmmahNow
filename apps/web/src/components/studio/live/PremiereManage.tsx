'use client';

/** One premiere in Studio (wiki E17 §5.4): when it is, its video, starting, ending and cancelling it, its settings. */
import { useCallback, useEffect, useId, useState } from 'react';
import { apiErrorMessage, dateTimeFormat, fillTemplate } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useLanguage } from '@/hooks/useLanguage';
import { LiveApiError, endStream, getStream, startStream, swapPremiere, updateStream, type LiveStreamRow } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';
import type { LiveOffers } from '@/lib/studio/nav';
import { HeldReview } from './HeldReview';
import { LiveSettings } from './LiveSettings';
import { PremiereVideoPicker } from './PremiereVideoPicker';

const POLL_MS = 10_000;

export function PremiereManage({ locale, channelId, stream: first, offers }: { locale: string; channelId: string; stream: LiveStreamRow; offers: LiveOffers }) {
  const { t, lang } = useLanguage();
  const text = t.studio.live.apps;
  const id = useId();
  const { confirm, dialog } = useConfirm();
  const [stream, setStream] = useState(first);
  const [busy, setBusy] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);

  const read = useCallback(() => getStream(first.id).then(setStream, (error) => logger.debug('[StudioPremiere] Not read', { streamId: first.id, error })), [first.id]);
  const open = stream.status === 'scheduled' || stream.status === 'live';
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => void read(), POLL_MS);
    return () => clearInterval(timer);
  }, [open, read]);

  const run = async (change: () => Promise<unknown>, done = '') => {
    setBusy(true);
    setNotice(null);
    try {
      await change();
      if (done) setNotice({ text: done });
    } catch (error) {
      const api = error instanceof LiveApiError ? error : null;
      if (!api?.code) logger.error('[StudioPremiere] Change failed', { streamId: first.id, error });
      setNotice({ text: apiErrorMessage(api?.code ?? '', api?.status ?? 0, lang), bad: true });
    } finally {
      await read();
      setBusy(false);
    }
  };
  const startNow = async () => {
    if (await confirm({ title: text.startNowTitle, description: text.startNowBody, confirmLabel: text.startNow, danger: false, testId: 'studio-premiere-start-dialog' })) await run(() => startStream(stream.id));
  };
  const end = async () => {
    if (await confirm({ title: text.endTitle, description: text.endBody, confirmLabel: text.end, testId: 'studio-premiere-end-dialog' })) await run(() => endStream(stream.id));
  };
  const cancel = async () => {
    if (await confirm({ title: text.cancelTitle, description: text.cancelBody, confirmLabel: text.cancel, cancelLabel: text.keep, testId: 'studio-premiere-cancel-dialog' })) await run(() => updateStream(stream.id, { status: 'cancelled' }));
  };

  const at = stream.scheduledStartTime ? dateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(stream.scheduledStartTime)) : '';
  const status = stream.status === 'scheduled' ? text.premiereWaiting.replace('{date}', at) : stream.status === 'live' ? text.premiereLive : stream.status === 'ended' ? text.premiereOver : text.premiereCancelled;
  const videoHref = stream.premiereVideoId ? `/${locale}/studio/${encodeURIComponent(channelId)}/content/videos/${encodeURIComponent(stream.premiereVideoId)}/edit` : null;
  return (
    <div data-testid="studio-premiere" data-status={stream.status}>
      <h1 className="mb-4 text-xl font-semibold text-foreground" dir="auto">{stream.title}</h1>
      <section aria-labelledby={`${id}-status`} className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 id={`${id}-status`} className="mb-2 text-base font-semibold text-foreground">{t.studio.live.goLive.status}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{text.premiere}</Badge>
          <p role="status" className="text-foreground" data-testid="studio-premiere-status">{status}</p>
        </div>
        {stream.status === 'scheduled' && !!stream.reminderCount && <p className="mt-1 text-sm text-muted-foreground" data-testid="studio-premiere-reminded">{fillTemplate(lang, text.reminded, { count: stream.reminderCount })}</p>}
        {videoHref && <p className="mt-2 text-sm"><Link href={videoHref} className="underline" data-testid="studio-premiere-video-link">{text.videoOpen}</Link></p>}
        <p role="alert" className={`mt-2 text-sm empty:hidden ${notice?.bad ? 'text-[var(--fanous-color-error-text)]' : 'text-muted-foreground'}`} data-testid="studio-premiere-notice">{notice?.text ?? ''}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {stream.status === 'scheduled' && (
            <>
              <Button disabled={busy} className="min-h-11" onClick={() => void startNow()} data-testid="studio-premiere-start">{text.startNow}</Button>
              <Button variant="outline" disabled={busy} className="min-h-11" aria-expanded={swapping} onClick={() => setSwapping((s) => !s)} data-testid="studio-premiere-swap">{text.swap}</Button>
              <Button variant="outline" disabled={busy} className="min-h-11" onClick={() => void cancel()} data-testid="studio-premiere-cancel">{text.cancel}</Button>
            </>
          )}
          {stream.status === 'live' && <Button variant="destructive" disabled={busy} className="min-h-11" onClick={() => void end()} data-testid="studio-premiere-end">{text.end}</Button>}
          {stream.status !== 'cancelled' && <Button asChild variant="outline" className="min-h-11"><Link href={`/${locale}/live/${encodeURIComponent(stream.id)}`}>{t.studio.live.goLive.watchPage}</Link></Button>}
        </div>
        {swapping && stream.status === 'scheduled' && (
          <div className="mt-4 grid gap-1">
            <label htmlFor={`${id}-swap`} className="text-sm font-medium text-foreground">{text.swap}</label>
            <PremiereVideoPicker channelId={channelId} inputId={`${id}-swap`} except={stream.premiereVideoId ?? undefined} onPick={(v) => { setSwapping(false); void run(() => swapPremiere(stream.id, v.id), text.swapped); }} />
          </div>
        )}
      </section>
      {offers.chat && open && <HeldReview streamId={stream.id} />}
      {stream.status !== 'cancelled' && <LiveSettings stream={stream} offers={offers} onSaved={() => void read()} />}
      {dialog}
    </div>
  );
}
