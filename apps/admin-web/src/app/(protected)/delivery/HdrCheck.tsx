'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HdrCheckItem, HdrCheckRun } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { getHdrCheck, retryMediaJobs, startHdrCheck } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { ConfirmButton } from '@/components/content/actions';
import { smallButtonClass } from '@/components/content/parts';
import { LocalTime } from '@/components/LocalTime';
import type { Translator } from '@/i18n/translate';
import { logger } from '@/lib/logger-client';
import { deliveryFormats } from './format';
import { HDR_KIND_LABEL, HDR_NOW_LABEL, HDR_REENCODE_MAX, hdrSelectable, notQueued } from './hdr-check-view';

const REFRESH_MS = 10_000;
const checkClass = 'size-5 shrink-0 accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

/**
 * Videos published in HDR colors before every rendition became standard color: a read-only check, and
 * re-encoding of the videos an admin picks (from their kept originals, like "Transcode again").
 */
export function HdrCheck({ initial, failed }: { initial: HdrCheckRun | null; failed: boolean }) {
  const { t, locale } = useLanguage();
  const f = deliveryFormats(locale);
  const [run, setRun] = useState(initial);
  const [error, setError] = useState<string | null>(failed ? t('hdrCheck.loadFailed') : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(false);

  // While it runs: the figures alone (no record reads); once done, the list with where each video is now
  const refresh = useCallback(async (live = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await getHdrCheck(live);
      if (result.ok) {
        const next = result.data;
        if (live && next?.status === 'done') {
          inFlight.current = false;
          return refresh(false);
        }
        setRun((prev) => (live && next && prev ? { ...next, items: prev.items } : next));
        setError(null);
      } else setError(t('hdrCheck.loadFailed'));
    } catch (e) {
      logger.warn('[delivery] HDR check request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('hdrCheck.loadFailed'));
    } finally {
      inFlight.current = false;
    }
  }, [t]);

  const running = run?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [running, refresh]);

  async function act<T>(action: () => Promise<{ ok: true; data: T } | { ok: false; status: number }>, failure: string, done: (data: T) => void) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        logger.warn('[delivery] HDR check action failed', { status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : failure);
        return;
      }
      done(result.data);
      await refresh();
    } catch (e) {
      logger.error('[delivery] HDR check action request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  const selectable = running ? [] : hdrSelectable(run?.items ?? []);
  const chosen = selectable.filter((id) => picked.has(id)).slice(0, HDR_REENCODE_MAX);
  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const allPicked = selectable.length > 0 && selectable.slice(0, HDR_REENCODE_MAX).every((id) => picked.has(id));

  return (
    <section className={`${cardClass} mb-6 space-y-4`} aria-labelledby="hdr-check-title" data-testid="hdr-check">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id="hdr-check-title" className="text-lg font-semibold text-fg">{t('hdrCheck.title')}</h2>
          <p className="text-fg-muted text-sm mt-1">{t('hdrCheck.intro')}</p>
        </div>
        <button type="button" className={smallButtonClass} disabled={busy || running} onClick={() => void act(startHdrCheck, t('hdrCheck.startFailed'), () => setPicked(new Set()))} data-testid="hdr-check-start">
          {running ? t('hdrCheck.running') : t('hdrCheck.start')}
        </button>
      </div>
      {error && <ErrorAlert testId="hdr-check-error">{error}</ErrorAlert>}
      <p role="status" className="text-sm text-fg empty:hidden" data-testid="hdr-check-notice">{notice}</p>
      {!run && !failed && <p className="text-sm text-fg-muted" data-testid="hdr-check-never">{t('hdrCheck.never')}</p>}
      {run && (
        <>
          <p className="text-sm text-fg" data-testid="hdr-check-counts">
            {t('hdrCheck.counts', { checked: f.integer(run.counts.checked), hdr: f.integer(run.counts.hdr) })}
            {run.counts.unreadable > 0 && ` ${t('hdrCheck.unreadable', { count: f.integer(run.counts.unreadable) })}`}
            {run.truncated && ` ${t('hdrCheck.truncated', { count: f.integer(run.items.length) })}`}
          </p>
          <p className="text-sm text-fg-muted">
            <LocalTime value={run.finishedAt ?? run.updatedAt} withTime />
          </p>
          {run.items.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input type="checkbox" className={checkClass} checked={allPicked} disabled={selectable.length === 0} onChange={() => setPicked(allPicked ? new Set() : new Set(selectable.slice(0, HDR_REENCODE_MAX)))} data-testid="hdr-check-all" />
                  {t('hdrCheck.selectAll', { count: f.integer(Math.min(selectable.length, HDR_REENCODE_MAX)) })}
                </label>
                <ConfirmButton
                  label={t('hdrCheck.reencode', { count: f.integer(chosen.length) })}
                  title={t('hdrCheck.confirmTitle', { count: f.integer(chosen.length) })}
                  body={t('hdrCheck.confirmBody')}
                  confirmLabel={t('hdrCheck.confirm')}
                  primary
                  disabled={busy || chosen.length === 0}
                  busy={busy}
                  testId="hdr-check-reencode"
                  dialogTestId="hdr-check-confirm"
                  onConfirm={() => act(() => retryMediaJobs(chosen), t('hdrCheck.reencodeFailed'), (data) => {
                    const left = notQueued(data?.results);
                    const queued = chosen.length - left.length;
                    const names = left.map((id) => run.items.find((i) => i.id === id)?.title || id);
                    setNotice([t('hdrCheck.queued', { count: f.integer(queued) }), ...(left.length ? [t('hdrCheck.notQueued', { count: f.integer(left.length), videos: names.join(locale === 'ar' ? '، ' : ', ') })] : [])].join(' '));
                    setPicked(new Set(left));
                  })}
                />
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border" data-testid="hdr-check-list">
                {run.items.map((item) => <Row key={item.id} item={item} t={t} picked={picked.has(item.id)} selectable={selectable.includes(item.id)} onToggle={() => toggle(item.id)} />)}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Row({ item, t, picked, selectable, onToggle }: { item: HdrCheckItem; t: Translator; picked: boolean; selectable: boolean; onToggle: () => void }) {
  const name = item.title || item.id;
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3" data-video-id={item.id} data-now={item.now}>
      <input type="checkbox" className={checkClass} checked={picked && selectable} disabled={!selectable} onChange={onToggle} aria-label={t('hdrCheck.select', { video: name })} />
      <Link href={`/videos/${encodeURIComponent(item.id)}`} className={`${linkClass} min-w-0 flex-1 break-words text-sm`} dir="auto">{name}</Link>
      <span className="text-sm text-fg-muted">{t(HDR_KIND_LABEL[item.kind])}</span>
      {item.now && item.now !== 'same' && <span className="rounded bg-chip-reviewing-bg px-2 py-1 text-sm font-medium text-chip-reviewing-fg">{t(HDR_NOW_LABEL[item.now])}</span>}
    </li>
  );
}
