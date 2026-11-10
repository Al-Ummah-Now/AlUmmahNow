'use client';

import { useId, useState } from 'react';
import { banUser, deleteUserData, unbanUser, updateUser } from '@/lib/api/content';
import type { AdminContentPermission } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass, primaryButtonClass } from '@/components/ui';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { Notice, SectionCard, smallButtonClass } from '@/components/content/parts';

interface Props {
  user: { id: string; displayName: string; userName: string | null; bio: string; isBanned: boolean; profileDeleted: boolean };
  permissions: AdminContentPermission[];
}

/**
 * Profile edit, videos ban and videos data delete. All of it is on Al Ummah
 * Now videos only: nothing here calls Auth, revokes sessions or deletes the
 * sign-in account.
 */
export function UserActions({ user, permissions }: Props) {
  const { t } = useLanguage();
  const ids = useId();
  const { run, busy, error, message } = useContentAction();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [userName, setUserName] = useState(user.userName ?? '');
  const [bio, setBio] = useState(user.bio);

  const canManage = permissions.includes('users:manage');
  const canErase = canManage && permissions.includes('content:delete');
  if (!canManage) return <Notice testId="content-read-only">{t('content.readOnly')}</Notice>;

  const edit: { displayName?: string; userName?: string; bio?: string } = {};
  if (displayName.trim() !== user.displayName) edit.displayName = displayName.trim();
  if (userName.trim() !== (user.userName ?? '')) edit.userName = userName.trim();
  if (bio !== user.bio) edit.bio = bio;

  return (
    <div className="space-y-6" data-testid="user-actions">
      <ActionFeedback error={error} message={message} />

      {!user.profileDeleted && (
        <SectionCard title={t('users.profileTitle')} id={`${ids}-profile`} testId="user-edit">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (Object.keys(edit).length) await run('edit', () => updateUser(user.id, edit), { success: t('content.saved') });
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${ids}-name`} className="text-sm text-fg-muted">{t('users.displayName')}</label>
                <input id={`${ids}-name`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} required dir="auto" className={fieldClass} data-testid="user-edit-name" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${ids}-username`} className="text-sm text-fg-muted">{t('users.userName')}</label>
                <input id={`${ids}-username`} value={userName} onChange={(e) => setUserName(e.target.value)} maxLength={60} dir="ltr" className={fieldClass} data-testid="user-edit-username" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-bio`} className="text-sm text-fg-muted">{t('users.bio')}</label>
              <textarea id={`${ids}-bio`} value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={2000} dir="auto" className={`${fieldClass} w-full`} data-testid="user-edit-bio" />
            </div>
            <button type="submit" className={`${primaryButtonClass} disabled:opacity-60`} disabled={!!busy || Object.keys(edit).length === 0} data-testid="user-edit-save">
              {busy === 'edit' ? t('content.working') : t('content.save')}
            </button>
          </form>
        </SectionCard>
      )}

      <SectionCard title={t('users.accessTitle')} id={`${ids}-access`} testId="user-access">
        <p className="text-sm text-fg-muted mb-4">{t('users.accessHint')}</p>
        <div className="flex flex-wrap gap-2">
          {user.isBanned ? (
            <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => run('unban', () => unbanUser(user.id), { success: t('content.queued') })} data-testid="user-unban">
              {busy === 'unban' ? t('content.working') : t('users.unban')}
            </button>
          ) : (
            <ConfirmButton
              label={t('users.ban')}
              title={t('users.banTitle')}
              body={t('users.banBody')}
              confirmLabel={t('users.ban')}
              withReason
              danger
              busy={busy === 'ban'}
              disabled={!!busy}
              testId="user-ban"
              onConfirm={(reason) => run('ban', () => banUser(user.id, reason), { success: t('content.queued') })}
            />
          )}
          {canErase && !user.profileDeleted && (
            <ConfirmButton
              label={t('users.deleteData')}
              title={t('users.deleteDataTitle')}
              body={t('users.deleteDataBody')}
              confirmLabel={t('users.deleteData')}
              typeToConfirm={user.id}
              danger
              busy={busy === 'erase'}
              disabled={!!busy}
              testId="user-delete-data"
              withReason
              reasonHint={t('deleted.reasonHint')}
              onConfirm={(reason) => run('erase', () => deleteUserData(user.id, reason), { success: t('deleted.movedToBin') })}
            />
          )}
        </div>
      </SectionCard>
    </div>
  );
}
