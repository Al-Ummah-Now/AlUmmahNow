'use client';

import { forwardRef, useState, type ReactNode } from 'react';
import { AlertCircle, Check, CheckCircle2, Clock, Copy, Download, ExternalLink, Loader2, RotateCcw, UploadCloud } from 'lucide-react';
import { linkBackLine, type YtImport, type YtImportItem, type YtStepState } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useLanguage } from '@/hooks/useLanguage';
import { uploadErrorMessage } from '@/lib/upload/report-upload-error';
import { itemErrorKey, rowPhase, type LiveState, type ProgressCounts } from '@/lib/youtube-import/wizard';
import { num, useFill, StepHeading, Thumb } from './parts';

interface Props {
  locale: string;
  current: YtImport;
  items: YtImportItem[];
  live: ReadonlyMap<string, LiveState>;
  counts: ProgressCounts;
  done: boolean;
  retrying: ReadonlySet<string>;
  onRetry: (item: YtImportItem) => void;
  onCancel: () => void;
  /** The files picker shown when items wait for their files (after a reload) */
  resume: ReactNode;
  channelHref: string;
  contentHref: string;
  shortUrl: (videoId: string) => string;
  onDownloadCsv: () => void;
  onNewImport: () => void;
  notice: string;
}

export const ImportStep = forwardRef<HTMLHeadingElement, Props>(function ImportStep(props, headingRef) {
  const { locale, current, items, live, counts, done, retrying, onRetry, onCancel, resume, channelHref, contentHref, shortUrl, onDownloadCsv, onNewImport, notice } = props;
  const { t } = useLanguage();
  const fill = useFill();
  const text = t.studio.youtube.progress;
  const doneText = t.studio.youtube.done;
  const lang = locale === 'ar' ? 'ar' : 'en';
  const ready = items.filter((i) => i.state === 'ready' && i.videoId);
  const quotaWaiting = items.some((i) => i.captions === 'waiting_quota' || i.thumbnail === 'waiting_quota');
  const overall = counts.total > 0 ? Math.round((counts.ready / counts.total) * 100) : 0;

  return (
    <section className="yt-panel" data-testid="yt-import" data-done={done || undefined}>
      {done ? (
        <div className="yt-done mb-6" data-testid="yt-done">
          <span className="yt-done-mark" aria-hidden="true"><CheckCircle2 className="h-7 w-7" /></span>
          <div className="min-w-0 flex-1">
            <StepHeading ref={headingRef} testId="yt-step-heading">{doneText.heading}</StepHeading>
            <p className="-mt-3 mb-4 text-sm text-foreground" data-testid="yt-done-summary">
              {fill(doneText.body, { ready: counts.ready, failed: counts.failed > 0 ? fill(doneText.failedPart, { count: counts.failed }) : '' })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="min-h-11"><Link href={channelHref} data-testid="yt-view-channel">{doneText.viewChannel}</Link></Button>
              <Button asChild variant="outline" className="min-h-11"><Link href={contentHref} data-testid="yt-view-content">{doneText.viewContent}</Link></Button>
              <Button variant="ghost" className="min-h-11" onClick={onNewImport} data-testid="yt-new-import">{doneText.newImport}</Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <StepHeading ref={headingRef} body={text.keepOpen} testId="yt-step-heading">{text.heading}</StepHeading>
          <div className="yt-card mb-5 p-4">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground" data-testid="yt-progress-summary">
                {fill(text.summary, { ready: counts.ready, active: counts.active, failed: counts.failed, waiting: counts.waiting })}
              </p>
              <span className="text-sm tabular-nums text-muted-foreground">{num(lang, counts.ready)}/{num(lang, counts.total)}</span>
            </div>
            <Progress value={overall} aria-label={text.heading} aria-valuetext={`${num(lang, counts.ready)}/${num(lang, counts.total)}`} />
          </div>
        </>
      )}

      <p role="status" aria-live="polite" className={notice ? 'mb-3 text-sm text-foreground' : 'sr-only'} data-testid="yt-import-notice">{notice}</p>

      {resume}

      {quotaWaiting && (
        <p className="yt-note mb-4 flex items-start gap-2 rounded-md p-3 text-sm" data-testid="yt-quota-note">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {text.quotaNote}
        </p>
      )}

      <ul className="yt-list" data-testid="yt-progress-list">
        {items.map((item) => (
          <ProgressRow key={item.id} item={item} live={live.get(item.id)} lang={lang} retrying={retrying.has(item.id)} onRetry={() => onRetry(item)} />
        ))}
      </ul>

      {done && ready.length > 0 && (
        <div className="yt-card mt-6 p-4 sm:p-5" data-testid="yt-link-back">
          <h3 className="text-base font-semibold text-foreground">{doneText.linkBackTitle}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">{doneText.linkBackBody}</p>
          <ul className="mt-4 space-y-2">
            {ready.slice(0, 50).map((item) => (
              <LinkBackRow key={item.id} title={item.title} line={linkBackLine(shortUrl(item.videoId!), lang)} />
            ))}
          </ul>
          <Button variant="outline" className="mt-4 min-h-11 gap-2" onClick={onDownloadCsv} data-testid="yt-download-csv">
            <Download className="h-4 w-4" aria-hidden="true" />
            {doneText.downloadCsv}
          </Button>
        </div>
      )}

      {!done && current.status === 'importing' && (
        <div className="mt-6 flex justify-end">
          <Button variant="outline" className="min-h-11" onClick={onCancel} data-testid="yt-cancel">{text.cancel}</Button>
        </div>
      )}
    </section>
  );
});

function stepLabel(name: string, state: YtStepState, steps: Record<YtStepState, string>): string | null {
  if (state === 'none' || !steps[state]) return null;
  return `${name}: ${steps[state]}`;
}

function ProgressRow({ item, live, lang, retrying, onRetry }: { item: YtImportItem; live: LiveState | undefined; lang: string; retrying: boolean; onRetry: () => void }) {
  const { t } = useLanguage();
  const fill = useFill();
  const text = t.studio.youtube.progress;
  const phase = rowPhase(item, live);
  // Bytes sent are not bytes stored: 100% only once the server has the whole file (then Processing)
  const percent = Math.min(live?.percent ?? 0, 99);
  const errors = text.errors as Record<string, string>;
  // This page's own failure (with its reference) first, else the server's reason
  const errorKey = live?.errorCode ?? itemErrorKey(item.error);
  const errorText = phase === 'failed' ? uploadErrorMessage(errors[errorKey] ?? errors.generic, live?.reference ?? '', lang) : '';
  const captionsGone = item.captions === 'failed' && item.error === 'youtube_not_connected';
  const label =
    phase === 'uploading'
      ? live?.reconnecting
        ? text.reconnecting
        : fill(text.uploading, { percent })
      : phase === 'needsFile'
        ? text.needsFile
        : text[phase];
  const thumb = stepLabel(text.thumbnail, item.thumbnail, text.step);
  const captions = stepLabel(text.captions, item.captions, text.step);

  return (
    <li className="yt-row yt-progress-row" data-phase={phase} data-testid="yt-progress-row" data-item-id={item.id}>
      <Thumb item={item} className="w-24 sm:w-32" />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium text-foreground"><bdi>{item.title}</bdi></p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="yt-phase inline-flex items-center gap-1 font-medium" data-phase={phase} data-testid="yt-phase">
            <PhaseIcon phase={phase} />
            {label}
          </span>
          {thumb && <span className="text-muted-foreground" data-testid="yt-thumb-step">{thumb}</span>}
          {captions && <span className="text-muted-foreground" data-step={item.captions} data-testid="yt-captions-step">{captions}</span>}
        </p>
        {phase === 'uploading' && <Progress value={percent} className="mt-2 h-1.5" aria-label={label} />}
        {errorText && <p className="yt-error mt-1 text-xs" data-testid="yt-row-error">{errorText}</p>}
        {captionsGone && <p className="mt-1 text-xs text-muted-foreground" data-testid="yt-captions-gone">{text.captionsDisconnected}</p>}
      </div>
      {phase === 'failed' && (
        <Button variant="outline" size="sm" className="min-h-11 shrink-0 gap-1.5" onClick={onRetry} disabled={retrying} data-testid="yt-retry">
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {text.tryAgain}
        </Button>
      )}
      {phase === 'ready' && item.videoId && (
        // In a div: pages.css flattens a list item whose direct child links to a video
        <div className="shrink-0">
          <Button asChild variant="ghost" size="icon" className="h-11 w-11">
            <Link href={`/${lang}/video/${encodeURIComponent(item.videoId)}`} aria-label={`${item.title}`} data-testid="yt-watch">
              <ExternalLink className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}
    </li>
  );
}

function PhaseIcon({ phase }: { phase: ReturnType<typeof rowPhase> }) {
  const cls = 'h-3.5 w-3.5';
  switch (phase) {
    case 'ready':
      return <Check className={cls} aria-hidden="true" />;
    case 'failed':
    case 'needsFile':
      return <AlertCircle className={cls} aria-hidden="true" />;
    case 'uploading':
      return <UploadCloud className={cls} aria-hidden="true" />;
    case 'preparing':
    case 'processing':
      return <Loader2 className={`${cls} animate-spin motion-reduce:animate-none`} aria-hidden="true" />;
    default:
      return <Clock className={cls} aria-hidden="true" />;
  }
}

function LinkBackRow({ title, line }: { title: string; line: string }) {
  const { t } = useLanguage();
  const fill = useFill();
  const text = t.studio.youtube.done;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <li className="yt-linkback flex flex-col gap-2 rounded-md p-3 sm:flex-row sm:items-center" data-testid="yt-link-back-row">
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground"><bdi>{title}</bdi></p>
        <p className="text-sm font-medium text-foreground [overflow-wrap:anywhere]" dir="auto">{line}</p>
      </div>
      <Button variant="outline" size="sm" className="min-h-11 shrink-0 gap-1.5" onClick={() => void copy()} aria-label={fill(text.copyFor, { title })} data-testid="yt-copy-line">
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        <span aria-live="polite">{copied ? text.copied : text.copy}</span>
      </Button>
    </li>
  );
}
