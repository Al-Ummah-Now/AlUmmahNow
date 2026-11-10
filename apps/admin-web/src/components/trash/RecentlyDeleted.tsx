'use client';

/**
 * The "Recently deleted" table for one kind: who deleted each item, when, why, and when it is
 * removed for good (days left, or queued for permanent deletion). Restore asks for an in-app
 * confirmation; "Delete permanently now" needs the item's id typed (ConfirmButton typeToConfirm).
 */
import type { TrashItem, TrashKind } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate } from '@/i18n/translate';
import { trashRemaining, trashTitle } from '@/lib/trash';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { purgeTrashItem, restoreTrashItem } from '@/lib/api/trash';

const thClass = 'text-start px-4 py-3 text-fg-muted font-medium whitespace-nowrap';
const tdClass = 'px-4 py-3 align-top';

export function RecentlyDeleted({ kind, items }: { kind: TrashKind; items: TrashItem[] }) {
  const { t, locale } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  const now = new Date();

  if (items.length === 0) {
    return (
      <p className="text-fg-muted" data-testid="trash-empty">
        {t('trash.empty')}
      </p>
    );
  }

  return (
    <div>
      <ActionFeedback error={error} message={message} />
      <div className="overflow-x-auto bg-surface border border-border rounded-lg">
        <table className="w-full text-sm" data-testid={`trash-table-${kind}`}>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className={thClass}>{t('trash.item')}</th>
              <th scope="col" className={thClass}>{t('trash.deletedBy')}</th>
              <th scope="col" className={thClass}>{t('trash.deletedAt')}</th>
              <th scope="col" className={thClass}>{t('trash.reason')}</th>
              <th scope="col" className={thClass}>{t('trash.remaining')}</th>
              <th scope="col" className={thClass}>{t('trash.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const name = trashTitle(item, locale);
              return (
                <tr key={item.id} className="border-t border-border" data-testid="trash-row" data-id={item.id} data-queued={item.purgeRequestedAt ? 'true' : 'false'}>
                  <td className={tdClass}>
                    <div className="font-medium text-fg" dir="auto">{name}</div>
                    <div className="text-xs text-fg-subtle" dir="ltr">{item.id}</div>
                  </td>
                  <td className={tdClass} dir="auto">{item.deletedBy ?? '—'}</td>
                  <td className={`${tdClass} whitespace-nowrap`}>{formatDate(item.deletedAt, locale, true)}</td>
                  <td className={tdClass} dir="auto">{item.reason ?? <span className="text-fg-subtle">{t('trash.noReason')}</span>}</td>
                  <td className={`${tdClass} whitespace-nowrap`} data-testid="trash-remaining">
                    {trashRemaining(item, now, t)}
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-wrap gap-2">
                      <ConfirmButton
                        label={t('trash.restore')}
                        title={t('trash.restoreTitle', { name })}
                        body={t('trash.restoreBody')}
                        confirmLabel={t('trash.restore')}
                        busy={busy === `restore:${item.id}`}
                        disabled={busy !== null}
                        testId={`trash-restore-${item.id}`}
                        onConfirm={() => run(`restore:${item.id}`, () => restoreTrashItem(kind, item.id), { success: t('trash.restored') })}
                      />
                      {!item.purgeRequestedAt && (
                        <ConfirmButton
                          label={t('trash.purge')}
                          title={t('trash.purgeTitle', { name })}
                          body={t('trash.purgeBody')}
                          confirmLabel={t('trash.purge')}
                          typeToConfirm={item.id}
                          danger
                          busy={busy === `purge:${item.id}`}
                          disabled={busy !== null}
                          testId={`trash-purge-${item.id}`}
                          onConfirm={() => run(`purge:${item.id}`, () => purgeTrashItem(kind, item.id), { success: t('trash.purgeQueued') })}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
