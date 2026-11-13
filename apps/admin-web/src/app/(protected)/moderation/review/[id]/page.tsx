import { notFound } from 'next/navigation';
import Link from '@/components/AppLink';
import { getReviewDetail, type ReviewDetailView } from '@/lib/api/review';
import { getVideo } from '@/lib/api/content';
import { AdminApiError } from '@/lib/api/errors';
import { getI18n } from '@/i18n/server';
import { ErrorAlert, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ReviewWorkspace } from './ReviewWorkspace';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

/** One review (docs/specs/VIDEO-REVIEW.md §7): player, flagged frames, transcript, reasons, decision. */
export default async function ReviewPage({ params }: PageProps) {
  const { id } = await params;
  const { t } = await getI18n();
  let detail: ReviewDetailView | null = null;
  let failed = false;
  try {
    detail = await getReviewDetail(id);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    failed = true;
    logger.error('[review] Failed to load the review', { id, error: e instanceof Error ? e.message : String(e) });
  }
  // The admin preview: Bunny HLS signed for admins (the same as the video page)
  let media: { playUrl: string | null; videoUrl: string | null; poster: string | null } = { playUrl: null, videoUrl: null, poster: null };
  if (detail?.review.subject_type === 'video') {
    try {
      const v = (await getVideo(detail.review.subject_id)) as unknown as { playUrl?: string | null; videoUrl?: string | null; thumbnailUrl?: string | null };
      media = { playUrl: v.playUrl ?? null, videoUrl: v.videoUrl ?? null, poster: v.thumbnailUrl ?? null };
    } catch (e) {
      logger.warn('[review] Preview unavailable', { id, error: e instanceof Error ? e.message : String(e) });
    }
  } else if (detail?.review.subject_type === 'livestream') {
    // A live stream's recording: its HLS playlist, already signed by api-videos
    media = { playUrl: detail.subject?.playUrl ?? null, videoUrl: null, poster: detail.subject?.posterUrl ?? null };
  }
  return (
    <div className="space-y-6">
      <Link href="/moderation/review" className={linkClass}>
        <span aria-hidden="true" className="inline-block rtl:rotate-180">&larr;</span> {t('review.back')}
      </Link>
      {failed && <ErrorAlert testId="review-detail-error">{t('review.failed')}</ErrorAlert>}
      {detail && <ReviewWorkspace detail={detail} media={media} />}
    </div>
  );
}
