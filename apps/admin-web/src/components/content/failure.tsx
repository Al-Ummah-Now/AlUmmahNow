/**
 * Why a video failed and what to do, the same on every page (Videos list, video page, Processing, Delivery,
 * Errors). Presentational, server and client safe: it takes the translator.
 */
import type { VideoFailure } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { linkClass } from '@/components/ui';
import type { Translator } from '@/i18n/translate';
import { failureHref, failureReasonLabel, failureStepLabel } from '@/lib/video-failure';

export function FailureWhy({ failure: f, t, link = true, className = '' }: { failure: VideoFailure; t: Translator; /** Off on the page it leads to */ link?: boolean; className?: string }) {
  return (
    <div className={`max-w-prose space-y-1 text-sm ${className}`} data-testid="failure-why" data-reason={f.reason} data-cause={f.cause} data-step={f.step}>
      <p className="text-fg">{t(failureReasonLabel(f.reason))}</p>
      <p className="text-fg">
        <span className="font-medium">{t('videoFailure.todo')}</span> {t(failureStepLabel(f))}
      </p>
      {f.fileName && (
        <p className="text-xs text-fg-muted [overflow-wrap:anywhere]">
          {t('videoFailure.file')} <bdi dir="auto">{f.fileName}</bdi>
        </p>
      )}
      {f.plays && <p className="text-xs text-fg-muted">{t('videoFailure.plays')}</p>}
      {link && (
        <p>
          <Link href={failureHref(f.videoId)} className={linkClass} data-testid="failure-link">
            {t('videoFailure.details')}
          </Link>
        </p>
      )}
    </div>
  );
}
