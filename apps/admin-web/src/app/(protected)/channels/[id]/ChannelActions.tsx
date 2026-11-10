'use client';

import { useId, useState } from 'react';
import {
  deleteChannel,
  setChannelVerified,
  suspendChannel,
  transferChannel,
  unsuspendChannel,
  updateChannel,
  uploadChannelImage,
} from '@/lib/api/content';
import type { AdminContentPermission } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass, primaryButtonClass } from '@/components/ui';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { Notice, SectionCard, smallButtonClass } from '@/components/content/parts';

interface Props {
  channel: { id: string; name: string; handle: string | null; description: string; isVerified: boolean; isSuspended: boolean; isDeleted: boolean };
  permissions: AdminContentPermission[];
}

/** Edit, images, verification, suspension, transfer and delete for one channel; each shown only to roles that may use it. */
export function ChannelActions({ channel, permissions }: Props) {
  const { t } = useLanguage();
  const ids = useId();
  const { run, busy, error, message } = useContentAction();
  const [name, setName] = useState(channel.name);
  const [handle, setHandle] = useState(channel.handle ?? '');
  const [description, setDescription] = useState(channel.description);
  const [newOwner, setNewOwner] = useState('');

  const can = (p: AdminContentPermission) => permissions.includes(p);
  const canManage = can('channels:manage');
  if (channel.isDeleted) return null;
  if (!canManage && !can('content:delete') && !can('channels:transfer')) {
    return <Notice testId="content-read-only">{t('content.readOnly')}</Notice>;
  }

  const edit: Record<string, string> = {};
  if (name.trim() !== channel.name) edit.name = name.trim();
  if (handle.trim().replace(/^@/, '') !== (channel.handle ?? '')) edit.handle = handle.trim().replace(/^@/, '');
  if (description !== channel.description) edit.description = description;

  const upload = (kind: 'avatar' | 'cover') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    const form = new FormData();
    form.set('photo', file);
    await run(kind, () => uploadChannelImage(channel.id, kind, form), { success: t('content.saved') });
  };

  return (
    <div className="space-y-6" data-testid="channel-actions">
      <ActionFeedback error={error} message={message} />

      {canManage && (
        <SectionCard title={t('channels.editTitle')} id={`${ids}-edit`} testId="channel-edit">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (Object.keys(edit).length) await run('edit', () => updateChannel(channel.id, edit), { success: t('content.saved') });
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${ids}-name`} className="text-sm text-fg-muted">{t('channels.name')}</label>
                <input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required dir="auto" className={fieldClass} data-testid="channel-edit-name" />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor={`${ids}-handle`} className="text-sm text-fg-muted">{t('channels.handle')}</label>
                <input id={`${ids}-handle`} value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={60} dir="ltr" className={fieldClass} data-testid="channel-edit-handle" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-desc`} className="text-sm text-fg-muted">{t('channels.description')}</label>
              <textarea id={`${ids}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={5000} dir="auto" className={`${fieldClass} w-full`} data-testid="channel-edit-description" />
            </div>
            <button type="submit" className={`${primaryButtonClass} disabled:opacity-60`} disabled={!!busy || Object.keys(edit).length === 0} data-testid="channel-edit-save">
              {busy === 'edit' ? t('content.working') : t('content.save')}
            </button>
          </form>
        </SectionCard>
      )}

      {canManage && (
        <SectionCard title={t('channels.imagesTitle')} id={`${ids}-images`}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(['avatar', 'cover'] as const).map((kind) => (
              <div key={kind} className="flex flex-col gap-1">
                <label htmlFor={`${ids}-${kind}`} className="text-sm text-fg-muted">
                  {t(kind === 'avatar' ? 'channels.avatar' : 'channels.cover')}
                </label>
                <input id={`${ids}-${kind}`} type="file" accept="image/jpeg,image/png,image/webp" onChange={upload(kind)} disabled={!!busy} className="text-sm text-fg file:me-3 file:rounded file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-fg" data-testid={`channel-${kind}-input`} />
                <span className="text-xs text-fg-subtle">{busy === kind ? t('content.working') : t('content.imageHint')}</span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {canManage && (
        <SectionCard title={t('channels.moderationTitle')} id={`${ids}-mod`}>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={smallButtonClass}
              disabled={!!busy}
              onClick={() => run('verify', () => setChannelVerified(channel.id, !channel.isVerified), { success: t('content.saved') })}
              data-testid="channel-verify"
            >
              {busy === 'verify' ? t('content.working') : channel.isVerified ? t('channels.unverify') : t('channels.verify')}
            </button>
            {channel.isSuspended ? (
              <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => run('unsuspend', () => unsuspendChannel(channel.id), { success: t('content.queued') })} data-testid="channel-unsuspend">
                {busy === 'unsuspend' ? t('content.working') : t('channels.unsuspend')}
              </button>
            ) : (
              <ConfirmButton
                label={t('channels.suspend')}
                title={t('channels.suspendTitle')}
                body={t('channels.suspendBody')}
                confirmLabel={t('channels.suspend')}
                withReason
                danger
                busy={busy === 'suspend'}
                disabled={!!busy}
                testId="channel-suspend"
                onConfirm={(reason) => run('suspend', () => suspendChannel(channel.id, reason), { success: t('content.queued') })}
              />
            )}
          </div>
        </SectionCard>
      )}

      {can('channels:transfer') && (
        <SectionCard title={t('channels.transferTitle')} id={`${ids}-transfer`} testId="channel-transfer">
          <p className="text-sm text-fg-muted mb-3">{t('channels.transferHint')}</p>
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label htmlFor={`${ids}-owner`} className="text-sm text-fg-muted">{t('channels.newOwnerId')}</label>
              <input id={`${ids}-owner`} value={newOwner} onChange={(e) => setNewOwner(e.target.value)} dir="ltr" maxLength={200} className={fieldClass} data-testid="channel-transfer-owner" />
            </div>
            <ConfirmButton
              label={t('channels.transfer')}
              title={t('channels.transferConfirm', { owner: newOwner.trim() })}
              body={t('channels.transferHint')}
              confirmLabel={t('channels.transfer')}
              disabled={!!busy || !newOwner.trim()}
              busy={busy === 'transfer'}
              testId="channel-transfer-submit"
              onConfirm={async () => {
                if (await run('transfer', () => transferChannel(channel.id, newOwner.trim()), { success: t('content.queued') })) setNewOwner('');
              }}
            />
          </div>
        </SectionCard>
      )}

      {can('content:delete') && (
        <SectionCard title={t('channels.dangerTitle')} id={`${ids}-delete`}>
          <p className="text-sm text-fg-muted mb-3">{t('channels.deleteBody')}</p>
          <ConfirmButton
            label={t('channels.delete')}
            title={t('channels.deleteTitle')}
            body={t('channels.deleteBody')}
            confirmLabel={t('channels.delete')}
            typeToConfirm={channel.handle ?? channel.id}
            danger
            busy={busy === 'delete'}
            disabled={!!busy}
            testId="channel-delete"
            onConfirm={() => run('delete', () => deleteChannel(channel.id), { success: t('content.queued') })}
          />
        </SectionCard>
      )}
    </div>
  );
}
