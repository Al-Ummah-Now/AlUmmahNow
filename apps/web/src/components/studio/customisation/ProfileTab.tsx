'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { can, type ChannelRole } from '@al-ummah/shared-types';
import { EditableAvatar, EditableCover } from '@/components/media/ProfileImages';
import ImageCropDialog from '@/components/ImageCropDialog';
import { ChannelAboutFields, canSubmitAboutFields, type ChannelAboutValues, type HandleStatus } from '@/components/settings/ChannelAboutFields';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { getChannelForOwner } from '@/lib/api/channels';
import { uploadFileDirect } from '@/lib/api/direct-upload';
import { updateChannelProfile } from '@/lib/api/channel-profile';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useLanguage } from '@/hooks/useLanguage';
import { useLeaveGuard } from '@/hooks/useLeaveGuard';
import { logger } from '@/lib/logger-client';
import ChannelTranslationSettings from '@/components/settings/ChannelTranslationSettings';

interface ChannelData {
  id: string;
  name: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  handle?: string;
  links?: Array<{ title: string; url: string }>;
  contactEmail?: string;
  location?: string;
}

interface TextFields {
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
}

const NAME_MAX = 100;
const DESCRIPTION_MAX = 500;
const EMPTY_ABOUT: ChannelAboutValues = { handle: '', links: [], contactEmail: '', location: '' };

function textFieldsOf(channel: ChannelData): TextFields {
  return {
    nameEn: channel.nameLocalized?.en || channel.name || '',
    nameAr: channel.nameLocalized?.ar || '',
    descriptionEn: channel.descriptionLocalized?.en || channel.description || '',
    descriptionAr: channel.descriptionLocalized?.ar || '',
  };
}

function aboutOf(channel: ChannelData): ChannelAboutValues {
  return { handle: channel.handle || '', links: channel.links || [], contactEmail: channel.contactEmail || '', location: channel.location || '' };
}

const FIELD = 'w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60';

/**
 * Customisation → Profile (spec §4.9): name and description in both
 * languages side by side, avatar and banner, handle (owner only), links,
 * contact email and location. The page guard has checked channel.edit; the
 * API checks every save again, and refuses a handle change from an admin.
 */
export function ProfileTab({ channelId, role }: { channelId: string; role: ChannelRole }) {
  const { t } = useLanguage();
  const text = t.studio.profile;
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { reloadChannels } = useMultiAccount();
  const handleLocked = !can(role, 'channel.handle');

  const [channel, setChannel] = useState<ChannelData | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [fields, setFields] = useState<TextFields>({ nameEn: '', nameAr: '', descriptionEn: '', descriptionAr: '' });
  const [about, setAbout] = useState<ChannelAboutValues>(EMPTY_ABOUT);
  const [handleStatus, setHandleStatus] = useState<HandleStatus>({ state: 'idle' });
  const [images, setImages] = useState({ avatarUrl: '', coverUrl: '' });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [cropping, setCropping] = useState<{ type: 'avatar' | 'cover'; file: File } | null>(null);
  const [photoBusy, setPhotoBusy] = useState<'avatar' | 'cover' | null>(null);
  // What was last loaded or saved: the form is dirty when it differs
  const baseline = useRef<{ fields: TextFields; about: ChannelAboutValues } | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = (await getChannelForOwner(channelId)) as ChannelData | null;
      if (!data) {
        setState('error');
        return;
      }
      setChannel(data);
      const loadedFields = textFieldsOf(data);
      const loadedAbout = aboutOf(data);
      setFields(loadedFields);
      setAbout(loadedAbout);
      setImages({ avatarUrl: data.avatarUrl || '', coverUrl: data.coverUrl || '' });
      baseline.current = { fields: loadedFields, about: loadedAbout };
      setState('ready');
    } catch (error) {
      logger.error('[Studio] Channel profile not loaded', { channelId, error });
      setState('error');
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => !!baseline.current && JSON.stringify({ fields, about }) !== JSON.stringify(baseline.current),
    [fields, about],
  );
  const leaveDialog = useLeaveGuard(dirty && !saving, text.unsaved);

  const setField = (key: keyof TextFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setNotice(null);
    setFields((f) => ({ ...f, [key]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channel || !canSubmitAboutFields(about, handleStatus)) return;
    setSaving(true);
    setNotice(null);
    try {
      const handle = about.handle.trim();
      const result = await updateChannelProfile(channelId, {
        name: fields.nameEn,
        nameLocalized: { en: fields.nameEn, ar: fields.nameAr },
        description: fields.descriptionEn,
        descriptionLocalized: { en: fields.descriptionEn, ar: fields.descriptionAr },
        // Only a changed handle is sent (an empty field keeps the current one); admins never send one
        ...(!handleLocked && handle && handle.replace(/^@+/, '') !== (channel.handle || '') ? { handle } : {}),
        links: about.links.filter((l) => l.title.trim() || l.url.trim()).map((l) => ({ title: l.title.trim(), url: l.url.trim() })),
        contactEmail: about.contactEmail.trim(),
        location: about.location.trim(),
      });
      if (result.ok === false) {
        logger.warn('[Studio] Channel profile save refused', { channelId, status: result.status, reason: result.reason });
        if (result.reason) setHandleStatus({ state: 'unavailable', reason: result.reason });
        setNotice({ kind: 'error', text: result.reason === 'taken' ? t.channel.handleTaken : t.channel.saveFailed });
        return;
      }
      const saved = { ...channel, ...result.channel } as ChannelData;
      setChannel(saved);
      const savedAbout = { ...about, handle: saved.handle || about.handle };
      setAbout(savedAbout);
      baseline.current = { fields, about: savedAbout };
      setNotice({ kind: 'ok', text: text.saved });
      void reloadChannels();
    } catch (error) {
      logger.error('[Studio] Channel profile save failed', { channelId, error });
      setNotice({ kind: 'error', text: t.channel.saveFailed });
    } finally {
      setSaving(false);
    }
  };

  const imageKey = (type: 'avatar' | 'cover') => (type === 'avatar' ? 'avatarUrl' : 'coverUrl');

  const uploadImage = async (type: 'avatar' | 'cover', file: File) => {
    const key = imageKey(type);
    const previous = images[key];
    const previewUrl = URL.createObjectURL(file);
    setPhotoBusy(type);
    setNotice(null);
    setImages((i) => ({ ...i, [key]: previewUrl }));
    try {
      // Straight from the browser: Cloudflare's WAF rule for CVE-2025-55183 blocks some image bodies sent through Server Actions
      const updated = await uploadFileDirect<ChannelData>(`/api/channels/${channelId}/${type}`, file, { channelId });
      if (!updated) throw new Error('upload returned nothing');
      setImages((i) => ({ ...i, [key]: updated[key] || '' }));
      void reloadChannels();
    } catch (error) {
      logger.error('[Studio] Channel image upload failed', { channelId, type, error });
      setNotice({ kind: 'error', text: t.errors.uploadFailed || t.errors.genericError });
      setImages((i) => ({ ...i, [key]: previous }));
    } finally {
      URL.revokeObjectURL(previewUrl);
      setPhotoBusy(null);
    }
  };

  const removeImage = async (type: 'avatar' | 'cover') => {
    const ok = await confirm({
      title: t.confirmDialog.removeImageTitle,
      description: t.confirmDialog.removeImageBody,
      confirmLabel: t.confirmDialog.remove,
      testId: 'channel-image-remove-dialog',
    });
    if (!ok) return;
    const key = imageKey(type);
    setPhotoBusy(type);
    setNotice(null);
    try {
      const result = await updateChannelProfile(channelId, { [key]: '' });
      if (result.ok === false) throw new Error(result.error);
      setImages((i) => ({ ...i, [key]: '' }));
      void reloadChannels();
    } catch (error) {
      logger.error('[Studio] Channel image not removed', { channelId, type, error });
      setNotice({ kind: 'error', text: t.channel.saveFailed });
    } finally {
      setPhotoBusy(null);
    }
  };

  if (state === 'loading') {
    return (
      <div role="status" aria-label={t.common.loading} className="max-w-4xl space-y-4" data-testid="studio-profile-loading">
        <div className="h-40 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />)}
        </div>
      </div>
    );
  }

  if (state === 'error' || !channel) {
    return (
      <div role="alert" className="max-w-4xl rounded-lg border border-destructive/40 bg-card p-4 text-card-foreground" data-testid="studio-profile-error">
        <p className="text-sm">{text.loadFailed}</p>
        <Button variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>{t.common.retry}</Button>
      </div>
    );
  }

  const initial = (fields.nameEn || channel.name || '?').charAt(0).toUpperCase();
  const counter = (n: number, max: number) => text.count.replace('{n}', String(n)).replace('{max}', String(max));

  return (
    <section aria-labelledby="studio-profile-heading" className="max-w-4xl" data-testid="studio-profile">
      {confirmDialog}
      {leaveDialog}
      <h2 id="studio-profile-heading" className="text-lg font-semibold text-foreground">{text.heading}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{text.intro}</p>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card text-card-foreground">
        <EditableCover
          url={images.coverUrl}
          alt={t.channel.channelBanner || t.channel.currentCover}
          onPick={() => document.getElementById('studio-cover-input')?.click()}
          onRemove={() => void removeImage('cover')}
          labels={{ pick: t.channel.clickToChangeCover, change: t.channel.changeCover, remove: t.channel.removeCover }}
          testId="channel-cover-upload"
          imageTestId="channel-cover-image"
          busy={photoBusy === 'cover'}
          className="h-40 bg-muted md:h-52"
        />
        <div className="px-4 pb-4 md:px-6">
          <EditableAvatar
            url={images.avatarUrl}
            alt={fields.nameEn || channel.name || t.channel.currentAvatar}
            onPick={() => document.getElementById('studio-avatar-input')?.click()}
            onRemove={() => void removeImage('avatar')}
            labels={{ pick: t.channel.clickToChangeAvatar, change: t.channel.changeAvatar, remove: t.channel.removeAvatar }}
            testId="channel-avatar-upload"
            imageTestId="channel-avatar-image"
            busy={photoBusy === 'avatar'}
            placeholder={
              <div className="flex h-full w-full items-center justify-center bg-primary">
                <span className="text-3xl font-bold text-primary-foreground">{initial}</span>
              </div>
            }
            className="relative z-[3] -mt-12"
          />
        </div>
      </div>
      {/* Pickers live outside the clickable areas so their click does not bubble back */}
      {(['cover', 'avatar'] as const).map((type) => (
        <input
          key={type}
          type="file"
          id={`studio-${type}-input`}
          aria-label={type === 'cover' ? t.channel.clickToChangeCover : t.channel.clickToChangeAvatar}
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (picked) setCropping({ type, file: picked });
          }}
        />
      ))}
      <ImageCropDialog
        file={cropping?.file ?? null}
        kind={cropping?.type ?? 'avatar'}
        onCancel={() => setCropping(null)}
        onApply={(cropped) => {
          const type = cropping?.type;
          setCropping(null);
          if (type) void uploadImage(type, cropped);
        }}
      />

      <form onSubmit={handleSubmit} className="mt-6 space-y-6" noValidate>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="channel-name-en" className="mb-1.5 block text-sm font-medium text-foreground">
              {text.nameEn} <span aria-hidden="true" className="text-destructive">*</span>
            </label>
            <input id="channel-name-en" dir="ltr" required maxLength={NAME_MAX} value={fields.nameEn} onChange={setField('nameEn')} className={FIELD} disabled={saving} />
          </div>
          <div>
            <label htmlFor="channel-name-ar" className="mb-1.5 block text-sm font-medium text-foreground">{text.nameAr}</label>
            <input id="channel-name-ar" dir="rtl" lang="ar" maxLength={NAME_MAX} value={fields.nameAr} onChange={setField('nameAr')} className={FIELD} disabled={saving} />
          </div>
          <div>
            <label htmlFor="channel-description-en" className="mb-1.5 block text-sm font-medium text-foreground">{text.descriptionEn}</label>
            <textarea id="channel-description-en" dir="ltr" rows={4} maxLength={DESCRIPTION_MAX} value={fields.descriptionEn} onChange={setField('descriptionEn')} className={FIELD} disabled={saving} aria-describedby="channel-description-en-count" />
            <p id="channel-description-en-count" className="mt-1 text-xs text-muted-foreground">{counter(fields.descriptionEn.length, DESCRIPTION_MAX)}</p>
          </div>
          <div>
            <label htmlFor="channel-description-ar" className="mb-1.5 block text-sm font-medium text-foreground">{text.descriptionAr}</label>
            <textarea id="channel-description-ar" dir="rtl" lang="ar" rows={4} maxLength={DESCRIPTION_MAX} value={fields.descriptionAr} onChange={setField('descriptionAr')} className={FIELD} disabled={saving} aria-describedby="channel-description-ar-count" />
            <p id="channel-description-ar-count" className="mt-1 text-xs text-muted-foreground">{counter(fields.descriptionAr.length, DESCRIPTION_MAX)}</p>
          </div>
        </div>

        <ChannelAboutFields
          channelId={channelId}
          currentHandle={channel.handle}
          value={about}
          onChange={(value) => {
            setNotice(null);
            setAbout(value);
          }}
          onHandleStatusChange={setHandleStatus}
          disabled={saving}
          handleLocked={handleLocked}
        />

        {/* Sticky on a phone so Save stays in reach (spec §4.9) */}
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 md:static md:mx-0 md:border-0 md:bg-transparent md:px-0">
          <Button
            type="submit"
            className="min-h-11"
            disabled={saving || !fields.nameEn.trim() || !canSubmitAboutFields(about, handleStatus)}
            data-testid="channel-edit-save"
          >
            {saving && <Loader2 aria-hidden="true" className="me-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}
            {saving ? text.saving : text.save}
          </Button>
          <p role="status" aria-live="polite" data-testid="channel-edit-status" className={notice?.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
            {notice?.text}
          </p>
        </div>
      </form>

      {/* Quran translation in translated captions, and machine-translated titles for viewers (moved from the old channel edit page) */}
      <div className="mt-6">
        <ChannelTranslationSettings channelId={channelId} />
      </div>
    </section>
  );
}
