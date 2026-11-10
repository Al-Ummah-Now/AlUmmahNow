'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteVideo, moveVideo, updateVideo, uploadVideoThumbnail, videoAction } from '@/lib/api/content';
import type { AdminContentPermission } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass, primaryButtonClass } from '@/components/ui';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { Notice, SectionCard, smallButtonClass } from '@/components/content/parts';
import { VideoActionsSlot } from '../extensions';

interface Props {
  video: {
    id: string;
    title: string;
    description: string;
    isPublic: boolean;
    isDeleted: boolean;
    unpublished: boolean;
    status: string | null;
    processing: { status: string; encodeProgress: number | null; resolutions: string[] } | null;
  };
  permissions: AdminContentPermission[];
}

/** Edit, thumbnail, move, publishing, reprocess, media repair and delete for one video; each only for roles that may. */
export function VideoActions({ video, permissions }: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const { run, busy, error, message } = useContentAction();
  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description);
  const [isPublic, setIsPublic] = useState(video.isPublic);
  const [target, setTarget] = useState('');

  const can = (p: AdminContentPermission) => permissions.includes(p);
  const canManage = can('videos:manage');
  if (video.isDeleted) return null;
  if (!canManage && !can('content:delete')) return <Notice testId="content-read-only">{t('content.readOnly')}</Notice>;

  const edit: { title?: string; description?: string; isPublic?: boolean } = {};
  if (title.trim() !== video.title) edit.title = title.trim();
  if (description !== video.description) edit.description = description;
  if (isPublic !== video.isPublic) edit.isPublic = isPublic;

  return (
    <div className="space-y-6" data-testid="video-actions">
      <ActionFeedback error={error} message={message} />

      {canManage && (
        <SectionCard title={t('videos.editTitle')} id={`${ids}-edit`} testId="video-edit">
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (Object.keys(edit).length) await run('edit', () => updateVideo(video.id, edit), { success: t('content.saved') });
            }}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-title`} className="text-sm text-fg-muted">{t('videos.titleField')}</label>
              <input id={`${ids}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required dir="auto" className={fieldClass} data-testid="video-edit-title" />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-desc`} className="text-sm text-fg-muted">{t('videos.description')}</label>
              <textarea id={`${ids}-desc`} value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={5000} dir="auto" className={`${fieldClass} w-full`} data-testid="video-edit-description" />
            </div>
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="text-sm text-fg-muted mb-1">{t('videos.visibility')}</legend>
              {[true, false].map((value) => (
                <label key={String(value)} className="inline-flex items-center gap-2 text-fg">
                  <input type="radio" name={`${ids}-visibility`} checked={isPublic === value} onChange={() => setIsPublic(value)} data-testid={`video-edit-${value ? 'public' : 'private'}`} />
                  {value ? t('videos.public') : t('videos.private')}
                </label>
              ))}
            </fieldset>
            <button type="submit" className={`${primaryButtonClass} disabled:opacity-60`} disabled={!!busy || Object.keys(edit).length === 0} data-testid="video-edit-save">
              {busy === 'edit' ? t('content.working') : t('content.save')}
            </button>
          </form>
          <div className="mt-6 flex flex-col gap-1">
            <label htmlFor={`${ids}-thumb`} className="text-sm text-fg-muted">{t('videos.thumbnail')}</label>
            <input
              id={`${ids}-thumb`}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={!!busy}
              className="text-sm text-fg file:me-3 file:rounded file:border file:border-border file:bg-surface-2 file:px-3 file:py-2 file:text-fg"
              data-testid="video-thumbnail-input"
              onChange={async (e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (!file) return;
                const form = new FormData();
                form.set('photo', file);
                await run('thumbnail', () => uploadVideoThumbnail(video.id, form), { success: t('content.saved') });
              }}
            />
            <span className="text-xs text-fg-subtle">{busy === 'thumbnail' ? t('content.working') : t('content.imageHint')}</span>
          </div>
        </SectionCard>
      )}

      {canManage && (
        <SectionCard title={t('videos.publishTitle')} id={`${ids}-publish`}>
          {video.unpublished && <p className="text-sm text-fg-muted mb-3">{t('videos.unpublishedNotice')}</p>}
          <div className="flex flex-wrap gap-2">
            {video.unpublished ? (
              <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => run('republish', () => videoAction(video.id, 'republish'), { success: t('content.done') })} data-testid="video-republish">
                {busy === 'republish' ? t('content.working') : t('videos.republish')}
              </button>
            ) : (
              <ConfirmButton
                label={t('videos.unpublish')}
                title={t('videos.unpublish')}
                body={t('videos.unpublishedNotice')}
                confirmLabel={t('videos.unpublish')}
                busy={busy === 'unpublish'}
                disabled={!!busy}
                testId="video-unpublish"
                onConfirm={() => run('unpublish', () => videoAction(video.id, 'unpublish'), { success: t('content.done') })}
              />
            )}
            <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => run('reprocess', () => videoAction(video.id, 'reprocess'), { success: t('content.done') })} data-testid="video-reprocess" title={t('videos.reprocessHint')}>
              {busy === 'reprocess' ? t('content.working') : t('videos.reprocess')}
            </button>
          </div>
          <div className="mt-4" data-slot="video-actions-extensions">
            <VideoActionsSlot videoId={video.id} status={video.status} processing={video.processing} permissions={permissions} onDone={() => router.refresh()} />
          </div>
        </SectionCard>
      )}

      {canManage && (
        <SectionCard title={t('videos.moveTitle')} id={`${ids}-move`} testId="video-move">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <div className="flex flex-col gap-1 flex-1">
              <label htmlFor={`${ids}-target`} className="text-sm text-fg-muted">{t('videos.targetChannel')}</label>
              <input id={`${ids}-target`} value={target} onChange={(e) => setTarget(e.target.value)} dir="ltr" maxLength={200} className={fieldClass} data-testid="video-move-target" />
            </div>
            <button
              type="button"
              className={smallButtonClass}
              disabled={!!busy || !target.trim()}
              onClick={async () => {
                if (await run('move', () => moveVideo(video.id, target.trim()), { success: t('content.queued') })) setTarget('');
              }}
              data-testid="video-move-submit"
            >
              {busy === 'move' ? t('content.working') : t('videos.move')}
            </button>
          </div>
        </SectionCard>
      )}

      {can('content:delete') && (
        <SectionCard title={t('channels.dangerTitle')} id={`${ids}-delete`}>
          <p className="text-sm text-fg-muted mb-3">{t('videos.deleteBody')}</p>
          <ConfirmButton
            label={t('videos.delete')}
            title={t('videos.deleteTitle')}
            body={t('videos.deleteBody')}
            confirmLabel={t('videos.delete')}
            typeToConfirm={video.id}
            danger
            busy={busy === 'delete'}
            disabled={!!busy}
            testId="video-delete"
            onConfirm={() => run('delete', () => deleteVideo(video.id), { success: t('content.queued') })}
          />
        </SectionCard>
      )}
    </div>
  );
}
