import { listVideoCategoriesAdmin, videoCategoryHistory } from '@/lib/api/categories';
import type { VideoCategoryAdminList, VideoCategoryHistoryEntry } from '@/lib/api/category-types';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { CategoriesAdmin } from './CategoriesAdmin';

export const dynamic = 'force-dynamic';

/**
 * Videos admin › Categories (owner 2026-11-15): add, rename (en + ar), reorder,
 * retire and restore the video categories that uploads, Studio, Explore,
 * search filters and AI suggestions use. Every admin role reads; admins and
 * super admins change (admin-api videos:categories, audited).
 */
export default async function CategoriesPage() {
  const { t } = await getI18n();
  let list: VideoCategoryAdminList | null = null;
  let history: VideoCategoryHistoryEntry[] = [];
  try {
    [list, history] = await Promise.all([listVideoCategoriesAdmin(), videoCategoryHistory(20).catch(() => [])]);
  } catch (error) {
    logger.error('[categories] Failed to load', { error: error instanceof Error ? error.message : String(error) });
  }

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('videoCategories.title')}</h1>
        <p className="text-fg-muted mt-1">{t('videoCategories.subtitle')}</p>
      </div>
      {list ? <CategoriesAdmin initial={list} history={history} /> : <ErrorAlert testId="categories-load-error">{t('videoCategories.loadError')}</ErrorAlert>}
    </div>
  );
}
