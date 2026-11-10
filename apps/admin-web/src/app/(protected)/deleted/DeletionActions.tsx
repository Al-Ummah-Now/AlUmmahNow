'use client';

import { requestPermanentDeletion, restoreDeletion } from '@/lib/api/content';
import type { AdminDeletionKind, AdminDeletionStatus } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { ConfirmButton, useContentAction } from '@/components/content/actions';

/**
 * Restore (confirm dialog) and "Delete permanently now" (type the id to
 * confirm; it only queues the item for the next cleanup run, so it stays
 * restorable until that run starts).
 */
export function DeletionActions({ kind, id, status, canRestore, canPurge }: { kind: AdminDeletionKind; id: string; status: AdminDeletionStatus; canRestore: boolean; canPurge: boolean }) {
  const { t } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  const purging = status === 'purging';
  if (purging || (!canRestore && !canPurge)) return null;
  return (
    <div className="flex flex-col items-start gap-2">
      {canRestore && (
        <ConfirmButton
          label={t('deleted.restore')}
          title={t('deleted.restoreTitle')}
          body={t('deleted.restoreBody')}
          confirmLabel={t('deleted.restore')}
          busy={busy === 'restore'}
          disabled={!!busy}
          testId="deleted-restore"
          onConfirm={() => run('restore', () => restoreDeletion(kind, id), { success: t('deleted.restored') })}
        />
      )}
      {canPurge && status === 'deleted' && (
        <ConfirmButton
          label={t('deleted.purgeNow')}
          title={t('deleted.purgeTitle')}
          body={t('deleted.purgeBody')}
          confirmLabel={t('deleted.purgeNow')}
          typeToConfirm={id}
          danger
          busy={busy === 'purge'}
          disabled={!!busy}
          testId="deleted-purge"
          onConfirm={() => run('purge', () => requestPermanentDeletion(kind, id), { success: t('deleted.purgeQueued') })}
        />
      )}
      <div aria-live="polite">
        {error && <span role="alert" className="text-danger-fg text-xs">{error}</span>}
        {message && <span className="text-success-fg text-xs">{message}</span>}
      </div>
    </div>
  );
}
