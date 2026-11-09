"use client";

/**
 * Customize channel: the channel page itself, edited in place.
 *
 * The header (banner, avatar, name, @handle, description) and the About
 * details are the public ones with edit mode on. Text changes are drafts
 * until "Save changes" in the sticky bar (one PUT /api/channels/:id); the
 * banner and avatar upload as soon as a crop is applied (existing endpoints).
 * Name and description exist in English and Arabic: the language switch
 * picks which version the header shows and edits.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import type { Channel } from '@al-ummah/shared-types';
import { getChannelForOwner } from '@/lib/api/channels';
import { uploadFileDirect } from '@/lib/api/direct-upload';
import { updateChannelProfile } from '@/lib/api/channel-profile';
import { ChannelHeader, type ChannelHeaderField } from '@/components/Channel/ChannelHeader';
import { ChannelSettingsTabs } from '@/components/settings/ChannelSettingsShell';
import { ChannelAboutFields, canSubmitAboutFields, isIncompleteLink } from '@/components/settings/ChannelAboutFields';
import { HandleStatusText, normalizeHandle, useHandleAvailability } from '@/components/settings/useHandleAvailability';
import { EditModeToggle } from '@/components/inlineEdit/EditModeToggle';
import { UnsavedChangesBar } from '@/components/inlineEdit/UnsavedChangesBar';
import { channelPath } from '@/lib/channel-url';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { cn } from '@/lib/utils';
import { channelDraftFrom, changedChannelFields, type ChannelDraft } from './draft';

type EditLang = 'en' | 'ar';

function ChannelEditPage() {
  const { t, dir } = useLanguage();
  const params = useParams();
  const locale = params.locale as string;
  const channelId = params.id as string;

  // Session channels feed the navigation avatar; refresh them after changes
  const { reloadChannels } = useMultiAccount();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saved, setSaved] = useState<ChannelDraft | null>(null);
  const [draft, setDraft] = useState<ChannelDraft | null>(null);
  const [editMode, setEditMode] = useState(true);
  const [editLang, setEditLang] = useState<EditLang>(locale === 'ar' ? 'ar' : 'en');
  const [handleTyping, setHandleTyping] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  // Loaded once per channel: later session refreshes must not overwrite drafts
  const initializedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!channelId || initializedFor.current === channelId) return;
    (async () => {
      setIsLoading(true);
      try {
        const data = await getChannelForOwner(channelId);
        if (data && initializedFor.current !== channelId) {
          initializedFor.current = channelId;
          const d = channelDraftFrom(data);
          setChannel(data);
          setSaved(d);
          setDraft(d);
        }
      } catch (error) {
        logger.error('[ChannelEditPage] Error fetching channel', { error, channelId });
        setLoadError(true);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [channelId]);

  // Availability follows what is typed in the open handle field, else the draft
  const handleToCheck = handleTyping ?? draft?.handle ?? '';
  const handleStatus = useHandleAvailability(handleToCheck, saved?.handle || undefined, channelId);

  const changed = useMemo(() => (saved && draft ? changedChannelFields(saved, draft) : []), [saved, draft]);
  const canSave =
    !!draft &&
    draft.nameEn.trim() !== '' &&
    canSubmitAboutFields(draft, handleStatus) &&
    !draft.links.some(isIncompleteLink);

  const update = useCallback((patch: Partial<ChannelDraft>) => {
    setJustSaved(false);
    setSaveError(null);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }, []);

  const onHeaderChange = (field: ChannelHeaderField, value: string) => {
    if (field === 'handle') {
      setHandleTyping(null);
      update({ handle: value });
    } else if (field === 'name') {
      update(editLang === 'ar' ? { nameAr: value } : { nameEn: value });
    } else {
      update(editLang === 'ar' ? { descriptionAr: value } : { descriptionEn: value });
    }
  };

  const save = async () => {
    if (!draft || !saved || !canSave) return;
    setSaving(true);
    setSaveError(null);
    const handle = normalizeHandle(draft.handle);
    try {
      const result = await updateChannelProfile(channelId, {
        name: draft.nameEn, // Legacy field (English)
        nameLocalized: { en: draft.nameEn, ar: draft.nameAr },
        description: draft.descriptionEn,
        descriptionLocalized: { en: draft.descriptionEn, ar: draft.descriptionAr },
        // Only send the handle when it changed (an empty field keeps the current one)
        ...(handle && handle !== saved.handle ? { handle } : {}),
        links: draft.links.filter((l) => l.title.trim() || l.url.trim()).map((l) => ({ title: l.title.trim(), url: l.url.trim() })),
        contactEmail: draft.contactEmail.trim(),
        location: draft.location.trim(),
      });
      if (result.ok === false) {
        logger.warn('[ChannelEditPage] Channel update rejected', { channelId, status: result.status, reason: result.reason });
        setSaveError(result.reason === 'taken' ? t.channel.handleTaken : t.inlineEdit.saveFailed);
        return;
      }
      const next = channelDraftFrom(result.channel);
      // Keep the cleaned-up values the server accepted
      setChannel((c) => (c ? { ...c, ...result.channel } : result.channel));
      setSaved(next);
      setDraft(next);
      setJustSaved(true);
      logger.info('[ChannelEditPage] Channel saved', { channelId, fields: changed });
      void reloadChannels();
    } catch (error) {
      logger.error('[ChannelEditPage] Error updating channel', { error, channelId });
      setSaveError(t.inlineEdit.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(saved);
    setHandleTyping(null);
    setSaveError(null);
  };

  const uploadImage = async (kind: 'avatar' | 'cover', file: File) => {
    setUploading(kind);
    setImageError(null);
    const preview = URL.createObjectURL(file);
    update(kind === 'avatar' ? { avatarUrl: preview } : { coverUrl: preview });
    try {
      // Straight from the browser: Cloudflare's WAF rule for CVE-2025-55183
      // blocks some image bodies sent through Server Actions (403)
      const updated = await uploadFileDirect<Channel>(`/api/channels/${channelId}/${kind}`, file, { channelId });
      if (!updated) throw new Error('Upload failed');
      const url = (kind === 'avatar' ? updated.avatarUrl : updated.coverUrl) || '';
      setSaved((s) => (s ? { ...s, [kind === 'avatar' ? 'avatarUrl' : 'coverUrl']: url } : s));
      setDraft((d) => (d ? { ...d, [kind === 'avatar' ? 'avatarUrl' : 'coverUrl']: url } : d));
      void reloadChannels();
    } catch (error) {
      logger.error('[ChannelEditPage] Image upload failed', { error, kind, channelId });
      setImageError(t.inlineEdit.imageFailed);
      setDraft((d) => (d && saved ? { ...d, avatarUrl: saved.avatarUrl, coverUrl: saved.coverUrl } : d));
    } finally {
      URL.revokeObjectURL(preview);
      setUploading(null);
    }
  };

  if (!channelId || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" role="status">
        <p className="text-muted-foreground">{t.common.loading}</p>
      </div>
    );
  }

  if (!channel || !draft || !saved) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground mb-2">{loadError ? t.errors.genericError : t.errors.notFound}</h1>
          <p className="text-muted-foreground mb-6">{t.channel.channelNotFoundMessage}</p>
          <Link href={`/${locale}/channels`} className="underline">
            {t.common.backTo?.replace('{page}', t.channel.channels) || `${t.common.back} ${t.channel.channels}`}
          </Link>
        </div>
      </div>
    );
  }

  const isAr = editLang === 'ar';
  const publicHref = channelPath(locale, { id: channelId, handle: saved.handle || undefined });

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2" dir={dir}>
      <EditModeToggle on={editMode} onChange={setEditMode} description={t.inlineEdit.editModeHelp} />
      <div role="radiogroup" aria-label={t.inlineEdit.editingLanguage} className="inline-flex rounded-full border border-border p-0.5">
        {(['en', 'ar'] as const).map((l) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={editLang === l}
            onClick={() => setEditLang(l)}
            className={cn(
              'min-h-9 px-3 rounded-full text-sm font-medium',
              editLang === l ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            )}
            lang={l}
            data-testid={`edit-language-${l}`}
          >
            {l === 'en' ? 'English' : 'العربية'}
          </button>
        ))}
      </div>
      <Link href={publicHref} className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="view-channel-link">
        <ExternalLink className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
        {t.inlineEdit.viewChannel}
      </Link>
      {imageError && (
        <p className="basis-full text-sm text-[var(--inline-edit-error)]" role="alert">
          {imageError}
        </p>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col" data-testid="channel-customize">
      <ChannelHeader
        channel={channel}
        locale={locale}
        settings
        editing={{
          active: editMode,
          name: isAr ? draft.nameAr : draft.nameEn,
          description: isAr ? draft.descriptionAr : draft.descriptionEn,
          handle: draft.handle,
          textDir: isAr ? 'rtl' : 'ltr',
          fieldSuffix: (locale === 'ar') !== isAr ? (isAr ? t.languages.arabic : t.languages.english) : undefined,
          onChange: onHeaderChange,
          onHandleDraft: setHandleTyping,
          handleStatus: <HandleStatusText status={handleStatus} handle={handleToCheck} />,
          handleInvalid: handleStatus.state === 'unavailable',
          avatarUrl: draft.avatarUrl,
          coverUrl: draft.coverUrl,
          onImage: uploadImage,
          uploading,
          dirty: {
            name: changed.includes(isAr ? 'nameAr' : 'nameEn'),
            description: changed.includes(isAr ? 'descriptionAr' : 'descriptionEn'),
            handle: changed.includes('handle'),
          },
          toolbar,
        }}
      />
      <ChannelSettingsTabs channelId={channelId} current="edit" />

      <main className="container mx-auto px-4 py-8 flex-1" data-edit-mode={editMode ? 'on' : 'off'}>
        <div className="max-w-3xl">
          <ChannelAboutFields
            value={draft}
            onChange={update}
            editable={editMode}
            dirty={{ links: changed.includes('links'), contactEmail: changed.includes('contactEmail'), location: changed.includes('location') }}
          />
        </div>
      </main>

      <UnsavedChangesBar
        count={changed.length}
        onSave={save}
        onDiscard={discard}
        saving={saving}
        canSave={canSave}
        saved={justSaved}
        error={saveError}
        saveTestId="channel-edit-save"
        savedAction={
          <Link href={publicHref} className="ms-auto inline-flex items-center min-h-11 px-4 rounded-xl text-sm font-semibold border border-border hover:bg-muted" data-testid="unsaved-changes-view">
            {t.inlineEdit.viewChannel}
          </Link>
        }
      />
    </div>
  );
}

export default ChannelEditPage;
