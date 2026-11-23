'use client';

import { useId, useState } from 'react';
import {
  deleteChannel,
  setChannelVerified,
  suspendChannel,
  unsuspendChannel,
  updateChannel,
  uploadChannelImage,
  type ChannelLabelEvent,
} from '@/lib/api/content';
import type { AdminContentPermission } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate } from '@/i18n/translate';
import { fieldClass, primaryButtonClass } from '@/components/ui';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { Notice, SectionCard, smallButtonClass } from '@/components/content/parts';
import { ChannelTransfer } from './ChannelTransfer';
import { ScholarLabelDialog, type LabelKind, type LabelMode } from './ScholarLabelDialog';
import { ChannelHandleTools } from './ChannelHandleTools';

interface Props {
  channel: {
    id: string;
    name: string;
    handle: string | null;
    description: string;
    isVerified: boolean;
    verificationKind: LabelKind | null;
    isSuspended: boolean;
    isDeleted: boolean;
    ownerId: string | null;
    videos: number;
    playlists: number;
  };
  permissions: AdminContentPermission[];
  /** Scholar label grants and removals, newest first (admins only) */
  labelHistory?: ChannelLabelEvent[];
}

/** Edit, images, verification, suspension, transfer and delete for one channel; each shown only to roles that may use it. */
export function ChannelActions({ channel, permissions, labelHistory = [] }: Props) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const { run, busy, error, message } = useContentAction();
  const [name, setName] = useState(channel.name);
  const [labelMode, setLabelMode] = useState<LabelMode | null>(null);
  const [handle, setHandle] = useState(channel.handle ?? '');
  const [description, setDescription] = useState(channel.description);

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
            {channel.isVerified && channel.verificationKind && (
              <span className="self-center text-sm text-fg-muted" data-testid="channel-label-kind">
                {t('channels.labelCurrent', { kind: t(channel.verificationKind === 'scholar' ? 'channels.kindScholar' : 'channels.kindInstitution') })}
              </span>
            )}
            {channel.isVerified ? (
              <>
                <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => setLabelMode('change')} data-testid="channel-label-change">
                  {t('channels.labelChange')}
                </button>
                <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => setLabelMode('remove')} data-testid="channel-verify">
                  {busy === 'verify' ? t('content.working') : t('channels.labelRemove')}
                </button>
              </>
            ) : (
              <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => setLabelMode('grant')} data-testid="channel-verify">
                {busy === 'verify' ? t('content.working') : t('channels.labelGrant')}
              </button>
            )}
            <ScholarLabelDialog
              open={labelMode !== null}
              mode={labelMode ?? 'grant'}
              currentKind={channel.verificationKind}
              onCancel={() => setLabelMode(null)}
              onConfirm={(reason, kind) => {
                const removing = labelMode === 'remove';
                setLabelMode(null);
                void run('verify', () => setChannelVerified(channel.id, !removing, reason, kind), { success: t('content.saved') });
              }}
            />
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
          {labelHistory.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-2">{t('channels.labelHistory')}</h3>
              <ul className="space-y-2" data-testid="channel-label-history">
                {labelHistory.map((event) => (
                  <li key={event.id} className="text-sm border-s-2 border-border ps-3">
                    <div className="text-fg">
                      {event.verified
                        ? t('channels.labelGranted', { kind: t(event.kind === 'institution' ? 'channels.kindInstitution' : 'channels.kindScholar') })
                        : t('channels.labelRemoved')}
                    </div>
                    <div className="text-xs text-fg-subtle">{formatDate(event.createdAt, locale, true)}</div>
                    {event.note && (
                      <p className="text-fg-muted" dir="auto">
                        {event.note}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      )}

      {can('channels:transfer') && (
        <ChannelTransfer
          channel={{ id: channel.id, name: channel.name, handle: channel.handle, ownerId: channel.ownerId, videos: channel.videos, playlists: channel.playlists }}
        />
      )}

      {can('channels:transfer') && <ChannelHandleTools channel={{ id: channel.id, handle: channel.handle }} />}

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
            withReason
            reasonHint={t('deleted.reasonHint')}
            onConfirm={(reason) => run('delete', () => deleteChannel(channel.id, reason), { success: t('deleted.movedToBin') })}
          />
        </SectionCard>
      )}
    </div>
  );
}
