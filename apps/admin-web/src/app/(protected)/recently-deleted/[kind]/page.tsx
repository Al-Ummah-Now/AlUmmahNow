import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { TrashItem } from '@al-ummah/shared-types';
import { listTrash } from '@/lib/api/trash';
import { getAdminSession } from '@/lib/auth';
import { canManageTrash, parseTrashKind, TRASH_HOME } from '@/lib/trash';
import { getI18n } from '@/i18n/server';
import { translateDynamic } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { RecentlyDeleted } from '@/components/trash/RecentlyDeleted';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ kind: string }>;
}

/** Recently deleted contact messages, themes or creator tiers: restore, or delete permanently now. */
export default async function RecentlyDeletedPage({ params }: PageProps) {
  const kind = parseTrashKind((await params).kind);
  if (!kind) notFound();
  const { t } = await getI18n();
  const session = await getAdminSession();
  if (!canManageTrash(session?.user.role)) return <ErrorAlert testId="trash-no-access">{t('trash.forbidden')}</ErrorAlert>;

  let items: TrashItem[] | null = null;
  try {
    items = await listTrash(kind);
  } catch (e) {
    logger.error('[trash] Failed to load deleted items', { kind, error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div data-testid="recently-deleted" data-kind={kind}>
      <Link href={TRASH_HOME[kind]} className={linkClass}>
        {t('trash.back')}
      </Link>
      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('trash.kindTitle', { kind: translateDynamic(t, 'trash.kind', kind) })}</h1>
        <p className="text-fg-muted mt-1 max-w-3xl">{t('trash.subtitle')}</p>
      </div>
      {items ? <RecentlyDeleted kind={kind} items={items} /> : <ErrorAlert testId="trash-load-failed">{t('trash.loadFailed')}</ErrorAlert>}
    </div>
  );
}
