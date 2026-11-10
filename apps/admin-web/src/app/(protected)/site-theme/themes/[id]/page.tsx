import { notFound } from 'next/navigation';
import type { ThemePackage } from '@al-ummah/theme-packages';
import { getThemeDetail } from '@/lib/api/admin';
import { AdminApiError } from '@/lib/api/errors';
import { getAdminSession } from '@/lib/auth';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { logger } from '@/lib/logger';
import { ThemeEditor } from '../../builder/ThemeEditor';

export const dynamic = 'force-dynamic';

export default async function ThemeEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(id)) notFound();
  const { t } = await getI18n();
  const session = await getAdminSession();
  let detail: Awaited<ReturnType<typeof getThemeDetail>> | null = null;
  try {
    detail = await getThemeDetail(id);
  } catch (error) {
    if (!(error instanceof AdminApiError && error.status === 404)) {
      logger.error('[theme-builder] Failed to load theme', { id, error: error instanceof Error ? error.message : String(error) });
      return <ErrorAlert testId="theme-editor-load-error">{t('themeBuilder.failed', { error: error instanceof Error ? error.message : String(error) })}</ErrorAlert>;
    }
  }
  if (!detail?.theme) notFound();
  return (
    <ThemeEditor
      initial={detail.theme as unknown as ThemePackage}
      assets={detail.assets}
      latestVersion={detail.latestVersion}
      activeVersion={detail.active ? detail.activeVersion : null}
      canEdit={session?.user.role === 'admin' || session?.user.role === 'super_admin'}
    />
  );
}
