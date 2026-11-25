'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteVideo, moveVideo, updateVideo, uploadVideoThumbnail, videoAction } from '@/lib/api/content';
import type { AdminContentPermission } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { primaryButtonClass } from '@/components/ui';
import { Autocomplete } from '@/components/search/Autocomplete';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { Notice, SectionCard, smallButtonClass } from '@/components/content/parts';
import { LocalizedFieldPair } from '@/components/localized/LocalizedFieldPair';
import { hasBoth, hasLanguages, samePair, userTextEdit, userTextErrors, userTextPair, type LocalizedPair } from '@/lib/localized';
import type { VideoFailure } from '@al-ummah/shared-types';
import { VideoActionsSlot } from '../extensions';
import { ThumbnailCropDialog, loadImageFile } from '@/components/content/ThumbnailCropDialog';
import { shapesMatch, type ThumbnailCropSize } from '@al-ummah/shared-types';
import { FileButton } from '@/components/FileButton';

interface Props {
  video: {
    id: string;
    title: string;
    titleLocalized?: Record<string, string>;
    description: string;
    descriptionLocalized?: Record<string, string>;
    isPublic: boolean;
    isDeleted: boolean;
    unpublished: boolean;
    status: string | null;
    processing: { status: string; encodeProgress: number | null; resolutions: string[] } | null;
    /** Encoded size: a picked thumbnail is cropped to this shape */
    width?: number | null;
    height?: number | null;
  };
  permissions: AdminContentPermission[];
  /** Why it failed, when it did */
  failure?: VideoFailure | null;
}

/** Edit, thumbnail, move, publishing, reprocess, media repair and delete for one video; each only for roles that may. */
export function VideoActions({ video, permissions, failure = null }: Props) {
  const { t } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const { run, busy, error, message } = useContentAction();
  const initialTitle = userTextPair(video.title, video.titleLocalized);
  const initialDescription = userTextPair(video.description, video.descriptionLocalized);
  const [title, setTitle] = useState<LocalizedPair>(initialTitle);
  const [description, setDescription] = useState<LocalizedPair>(initialDescription);
  const [fieldErrors, setFieldErrors] = useState<{ titleEn?: string; titleAr?: string; descEn?: string; descAr?: string }>({});
  const [isPublic, setIsPublic] = useState(video.isPublic);
  const [target, setTarget] = useState('');
  // Bumped after a move so the channel picker starts empty again
  const [moveRound, setMoveRound] = useState(0);
  const [crop, setCrop] = useState<{ url: string; size: ThumbnailCropSize; name: string } | null>(null);

  const can = (p: AdminContentPermission) => permissions.includes(p);
  const canManage = can('videos:manage');
  if (video.isDeleted) return null;
  if (!canManage && !can('content:delete')) return <Notice testId="content-read-only">{t('content.readOnly')}</Notice>;

  const videoSize: ThumbnailCropSize | null = video.width && video.height ? { width: video.width, height: video.height } : null;
  const closeCrop = () => {
    if (crop) URL.revokeObjectURL(crop.url);
    setCrop(null);
  };
  async function uploadThumbnail(file: File) {
    const form = new FormData();
    form.set('photo', file);
    await run('thumbnail', () => uploadVideoThumbnail(video.id, form), { success: t('content.saved') });
  }

  const titleChanged = !samePair(title, initialTitle);
  const descChanged = !samePair(description, initialDescription);
  const visChanged = isPublic !== video.isPublic;
  const hasChanges = titleChanged || descChanged || visChanged;

  return (
    <div className="space-y-6" data-testid="video-actions">
      <ActionFeedback error={error} message={message} />

      {canManage && (
        <SectionCard title={t('videos.editTitle')} id={`${ids}-edit`} testId="video-edit">
          <form
            className="space-y-4"
            noValidate
            onSubmit={async (e) => {
              e.preventDefault();
              if (!hasChanges) return;
              const nextErrors: typeof fieldErrors = {};
              if (titleChanged) {
                const missing = userTextErrors(initialTitle, title, true);
                if (missing.includes('en')) nextErrors.titleEn = t('localized.required', { lang: t('localized.langEnglish') });
                if (missing.includes('ar')) nextErrors.titleAr = t('localized.required', { lang: t('localized.langArabic') });
              }
              if (descChanged) {
                const missing = userTextErrors(initialDescription, description, false);
                if (missing.includes('en')) nextErrors.descEn = t('localized.required', { lang: t('localized.langEnglish') });
                if (missing.includes('ar')) nextErrors.descAr = t('localized.required', { lang: t('localized.langArabic') });
              }
              setFieldErrors(nextErrors);
              if (Object.keys(nextErrors).length) return;

              const edit: Parameters<typeof updateVideo>[1] = {};
              if (titleChanged) {
                const sent = userTextEdit(initialTitle, title, hasLanguages(video.titleLocalized));
                if ('map' in sent) edit.titleLocalized = sent.map;
                else edit.title = sent.plain;
              }
              if (descChanged) {
                const sent = userTextEdit(initialDescription, description, hasLanguages(video.descriptionLocalized));
                if ('map' in sent) edit.descriptionLocalized = sent.map;
                else edit.description = sent.plain;
              }
              if (visChanged) edit.isPublic = isPublic;
              await run('edit', () => updateVideo(video.id, edit), { success: t('content.saved') });
            }}
          >
            <LocalizedFieldPair
              id={`${ids}-title`}
              label={t('videos.titleField')}
              field="videos.title"
              value={title}
              onChange={(next) => {
                setTitle(next);
                setFieldErrors((prev) => ({ ...prev, titleEn: undefined, titleAr: undefined }));
              }}
              errors={{ en: fieldErrors.titleEn, ar: fieldErrors.titleAr }}
              maxLength={200}
              required={hasBoth(initialTitle)}
              help={hasBoth(initialTitle) ? undefined : t('localized.oneIsEnough')}
              disabled={!!busy}
              testId="video-edit-title"
              inputTestIds={{ en: 'video-edit-title', ar: 'video-edit-title-ar' }}
            />
            <LocalizedFieldPair
              id={`${ids}-desc`}
              label={t('videos.description')}
              field="videos.description"
              value={description}
              onChange={(next) => {
                setDescription(next);
                setFieldErrors((prev) => ({ ...prev, descEn: undefined, descAr: undefined }));
              }}
              errors={{ en: fieldErrors.descEn, ar: fieldErrors.descAr }}
              multiline
              rows={5}
              maxLength={5000}
              required={false}
              help={hasBoth(initialDescription) ? undefined : t('localized.oneIsEnough')}
              disabled={!!busy}
              testId="video-edit-description"
              inputTestIds={{ en: 'video-edit-description', ar: 'video-edit-description-ar' }}
            />
            <fieldset className="flex flex-wrap gap-4 text-sm">
              <legend className="text-sm text-fg-muted mb-1">{t('videos.visibility')}</legend>
              {[true, false].map((value) => (
                <label key={String(value)} className="inline-flex items-center gap-2 text-fg">
                  <input type="radio" name={`${ids}-visibility`} checked={isPublic === value} onChange={() => setIsPublic(value)} data-testid={`video-edit-${value ? 'public' : 'private'}`} />
                  {value ? t('videos.public') : t('videos.private')}
                </label>
              ))}
            </fieldset>
            <button type="submit" className={`${primaryButtonClass} disabled:opacity-60`} disabled={!!busy || !hasChanges} data-testid="video-edit-save">
              {busy === 'edit' ? t('content.working') : t('content.save')}
            </button>
          </form>
          <div className="mt-6 flex flex-col gap-1">
            <label htmlFor={`${ids}-thumb`} className="text-sm text-fg-muted">{t('videos.thumbnail')}</label>
            <FileButton
              id={`${ids}-thumb`}
              accept="image/jpeg,image/png,image/webp"
              disabled={!!busy}
              data-testid="video-thumbnail-input"
              onChange={async (e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = '';
                if (!file) return;
                // Another shape than the video is cropped to it first (never stretched)
                if (videoSize) {
                  const loaded = await loadImageFile(file).catch(() => null);
                  if (loaded && !shapesMatch(loaded.size, videoSize)) {
                    setCrop({ url: loaded.url, size: loaded.size, name: file.name });
                    return;
                  }
                  if (loaded) URL.revokeObjectURL(loaded.url);
                }
                await uploadThumbnail(file);
              }}
            >
              {t('content.chooseImage')}
            </FileButton>
            {crop && videoSize && (
              <ThumbnailCropDialog
                src={crop.url}
                image={crop.size}
                video={videoSize}
                filename={crop.name}
                onCancel={closeCrop}
                onConfirm={(file) => {
                  closeCrop();
                  void uploadThumbnail(file);
                }}
              />
            )}
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
            <VideoActionsSlot videoId={video.id} failure={failure} status={video.status} processing={video.processing} permissions={permissions} onDone={() => router.refresh()} />
          </div>
        </SectionCard>
      )}

      {canManage && (
        <SectionCard title={t('videos.moveTitle')} id={`${ids}-move`} testId="video-move">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2">
            <Autocomplete
              key={moveRound}
              kind="channel"
              mode="pick"
              label={t('videos.targetChannel')}
              onChange={(id) => setTarget(id)}
              disabled={!!busy}
              className="flex-1"
              testId="video-move-target"
            />
            <button
              type="button"
              className={smallButtonClass}
              disabled={!!busy || !target.trim()}
              onClick={async () => {
                if (await run('move', () => moveVideo(video.id, target.trim()), { success: t('content.queued') })) {
                  setTarget('');
                  setMoveRound((n) => n + 1);
                }
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
            withReason
            reasonHint={t('deleted.reasonHint')}
            onConfirm={(reason) => run('delete', () => deleteVideo(video.id, reason), { success: t('deleted.movedToBin') })}
          />
        </SectionCard>
      )}
    </div>
  );
}
