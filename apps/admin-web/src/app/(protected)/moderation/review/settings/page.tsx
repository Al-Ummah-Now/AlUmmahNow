import Link from '@/components/AppLink';
import { getReviewSettings, type ReviewSettingsView } from '@/lib/api/review';
import { getI18n } from '@/i18n/server';
import { ErrorAlert, linkClass } from '@/components/ui';
import { logger } from '@/lib/logger';
import { getAdminSession } from '@/lib/auth';
import { canManageReviewSettings } from '@/lib/roles';
import { ReviewSettingsForm } from './ReviewSettingsForm';

export const dynamic = 'force-dynamic';

/**
 * Review settings (admins; every threshold editable, VR5; ETA VR6; budget VR14; retention VR12).
 * Moderators and reviewers (VR7) see them read-only: admin-api changes them for admins only.
 */
export default async function ReviewSettingsPage() {
  const { t } = await getI18n();
  const canEdit = canManageReviewSettings((await getAdminSession())?.user.role);
  let view: ReviewSettingsView | null = null;
  try {
    view = await getReviewSettings();
  } catch (e) {
    logger.error('[review] Failed to load the settings', { error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <div className="space-y-6">
      <Link href="/moderation/review" className={linkClass}>
        <span aria-hidden="true" className="inline-block rtl:rotate-180">&larr;</span> {t('review.back')}
      </Link>
      <h1 className="text-2xl font-bold text-fg">{t('review.settings.title')}</h1>
      {!view && <ErrorAlert testId="review-settings-error">{t('review.settings.failed')}</ErrorAlert>}
      {view && !view.allowedHere && <p className="rounded border border-border bg-surface-2 p-3 text-fg" data-testid="review-not-here">{t('review.settings.notHere')}</p>}
      {view && !canEdit && <p className="text-fg-subtle" data-testid="review-settings-read-only">{t('review.settings.readOnly')}</p>}
      {view && <ReviewSettingsForm initial={view.settings} canEdit={canEdit} />}
    </div>
  );
}
