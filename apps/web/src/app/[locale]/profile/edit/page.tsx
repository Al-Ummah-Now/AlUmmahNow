"use client";

/**
 * Profile settings: the profile header, edited in place.
 *
 * Cover and photo upload as soon as a crop is applied. First name, last name,
 * display name and bio are drafts (English and Arabic versions, picked with
 * the language switch) saved together from the unsaved-changes bar. The
 * timezone and email are private and sit under Preferences.
 */

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Profile } from '@/interfaces';
import { fetchProfile, updateCoverPhoto, updateProfile, updateProfilePhoto } from '@/lib/api/profiles-client';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { getBrowserTimezone, COMMON_TIMEZONES, localizedTimezoneLabel, localizedTimezoneRegion, getTimezoneDisplayName, isListedTimezone } from '@/utils/timezoneUtils';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import { ProfileHeader, type ProfileHeaderField } from '@/components/profile/ProfileHeader';
import { AccountSettingsHeader } from '@/components/settings/AccountSettingsHeader';
import { EditModeToggle } from '@/components/inlineEdit/EditModeToggle';
import { UnsavedChangesBar } from '@/components/inlineEdit/UnsavedChangesBar';
import { logger } from '@/lib/logger-client';
import { cn } from '@/lib/utils';
import { changedProfileFields, profileDraftFrom, type ProfileDraft } from './draft';

type EditLang = 'en' | 'ar';

const ProfileEditPage = () => {
  const { t, lang: locale, dir } = useLanguage();
  const auth = useAuth();
  const { reloadProfile } = useMultiAccount();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState<ProfileDraft | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [editMode, setEditMode] = useState(true);
  const [editLang, setEditLang] = useState<EditLang>(locale === 'ar' ? 'ar' : 'en');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'avatar' | 'cover' | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);

  useEffect(() => {
    if (auth?.user) fetchProfile(auth.user, setProfile);
  }, [auth]);

  // Drafts start from the first loaded profile only; later photo uploads
  // refresh `profile` but must not wipe what the owner is typing
  useEffect(() => {
    if (profile && !saved) {
      const d = profileDraftFrom(profile, getBrowserTimezone());
      setSaved(d);
      setDraft(d);
    }
  }, [profile, saved]);

  const changed = useMemo(() => (saved && draft ? changedProfileFields(saved, draft) : []), [saved, draft]);

  const update = (patch: Partial<ProfileDraft>) => {
    setJustSaved(false);
    setSaveError(null);
    setDraft((d) => (d ? { ...d, ...patch } : d));
  };

  const onHeaderChange = (field: ProfileHeaderField, value: string) => {
    const key = `${field}${editLang === 'ar' ? 'Ar' : 'En'}` as keyof ProfileDraft;
    update({ [key]: value } as Partial<ProfileDraft>);
  };

  const save = async () => {
    if (!draft || !auth?.user) return;
    setSaving(true);
    setSaveError(null);
    try {
      const ok = await updateProfile(
        {
          id: auth.user.id,
          email: auth.user.email,
          firstName: draft.firstNameEn,
          firstNameLocalized: { en: draft.firstNameEn, ar: draft.firstNameAr },
          lastName: draft.lastNameEn,
          lastNameLocalized: { en: draft.lastNameEn, ar: draft.lastNameAr },
          displayName: draft.displayNameEn,
          displayNameLocalized: { en: draft.displayNameEn, ar: draft.displayNameAr },
          bio: draft.bioEn,
          bioLocalized: { en: draft.bioEn, ar: draft.bioAr },
          avatarUrl: profile?.avatarUrl,
          coverUrl: profile?.coverUrl,
          timezone: draft.timezone || getBrowserTimezone(),
        } as Profile,
        setProfile
      );
      if (!ok) {
        setSaveError(t.profile.saveFailed || t.inlineEdit.saveFailed);
        return;
      }
      setSaved(draft);
      setJustSaved(true);
      void reloadProfile();
    } catch (error) {
      logger.error('[ProfileEditPage] Save failed', { error });
      setSaveError(t.inlineEdit.saveFailed);
    } finally {
      setSaving(false);
    }
  };

  const uploadImage = async (kind: 'avatar' | 'cover', file: File) => {
    if (!profile) return;
    setUploading(kind);
    setImageError(null);
    const ok = kind === 'avatar' ? await updateProfilePhoto(profile, file, setProfile) : await updateCoverPhoto(profile, file, setProfile);
    setUploading(null);
    if (!ok) setImageError(t.inlineEdit.imageFailed);
    else if (kind === 'avatar') void reloadProfile();
  };

  if (!auth?.user) {
    return <SignInPrompt title={t.profile.signInTitle} message={t.profile.signInMessage} />;
  }

  const isAr = editLang === 'ar';
  const pick = (en: string, ar: string) => (isAr ? ar : en);
  const heading = draft ? `${pick(draft.firstNameEn, draft.firstNameAr)} ${pick(draft.lastNameEn, draft.lastNameAr)}`.trim() || pick(draft.displayNameEn, draft.displayNameAr) : '';

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
            lang={l}
            className={cn('min-h-9 px-3 rounded-full text-sm font-medium', editLang === l ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}
            data-testid={`edit-language-${l}`}
          >
            {l === 'en' ? 'English' : 'العربية'}
          </button>
        ))}
      </div>
      <Link href={`/${locale}/profile`} className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground">
        <ExternalLink className="w-4 h-4 rtl:-scale-x-100" aria-hidden="true" />
        {t.inlineEdit.viewProfile}
      </Link>
      {imageError && <p className="basis-full text-sm text-[var(--inline-edit-error)]" role="alert">{imageError}</p>}
    </div>
  );

  return (
    <div className="profile-edit-page flex flex-col min-h-screen bg-gray-50 dark:bg-gray-950" data-testid="profile-customize">
      <AccountSettingsHeader current="profile" />
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-6" data-edit-mode={editMode ? 'on' : 'off'}>
        {!draft ? (
          <p className="text-muted-foreground py-16 text-center" role="status">{t.common.loading}</p>
        ) : (
          <>
            <ProfileHeader
              className="mb-10"
              heading={heading}
              coverUrl={profile?.coverUrl}
              avatarUrl={profile?.avatarUrl}
              editing={{
                active: editMode,
                firstName: pick(draft.firstNameEn, draft.firstNameAr),
                lastName: pick(draft.lastNameEn, draft.lastNameAr),
                displayName: pick(draft.displayNameEn, draft.displayNameAr),
                bio: pick(draft.bioEn, draft.bioAr),
                textDir: isAr ? 'rtl' : 'ltr',
                fieldSuffix: (locale === 'ar') !== isAr ? (isAr ? t.languages.arabic : t.languages.english) : undefined,
                onChange: onHeaderChange,
                onImage: uploadImage,
                uploading,
                dirty: {
                  firstName: changed.includes(isAr ? 'firstNameAr' : 'firstNameEn'),
                  lastName: changed.includes(isAr ? 'lastNameAr' : 'lastNameEn'),
                  displayName: changed.includes(isAr ? 'displayNameAr' : 'displayNameEn'),
                  bio: changed.includes(isAr ? 'bioAr' : 'bioEn'),
                },
                toolbar,
              }}
            />

            <section aria-labelledby="profile-preferences" className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 space-y-5">
              <div>
                <h2 id="profile-preferences" className="text-lg font-semibold text-gray-900 dark:text-white">{t.inlineEdit.preferences}</h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">{t.inlineEdit.preferencesHelp}</p>
              </div>
              <div className={cn(changed.includes('timezone') && 'ps-3 border-s-2 border-[var(--inline-edit-ring)]')}>
                <label htmlFor="profile-timezone" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                  {t.profile?.timezone || 'Timezone'}
                </label>
                <select
                  id="profile-timezone"
                  name="timezone"
                  value={draft.timezone}
                  onChange={(e) => update({ timezone: e.target.value })}
                  className="block w-full min-h-11 px-3 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-[var(--inline-edit-ring)]"
                >
                  {draft.timezone && !isListedTimezone(draft.timezone) && <option value={draft.timezone}>{getTimezoneDisplayName(draft.timezone, locale)}</option>}
                  {Object.entries(COMMON_TIMEZONES).map(([region, timezones]) => (
                    <optgroup key={region} label={localizedTimezoneRegion(region, locale)}>
                      {timezones.map((tz) => (
                        <option key={tz.value} value={tz.value}>
                          {localizedTimezoneLabel(tz, locale)} ({tz.offset})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t.profile.email}</p>
                <p className="text-gray-900 dark:text-gray-100" dir="ltr">{profile?.email ?? auth.user?.email}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.profile.emailCannotBeChanged}</p>
              </div>
            </section>
          </>
        )}
      </main>

      <UnsavedChangesBar
        count={changed.length}
        onSave={save}
        onDiscard={() => setDraft(saved)}
        saving={saving}
        saved={justSaved}
        error={saveError}
        saveTestId="profile-save"
        savedAction={
          <Link href={`/${locale}/profile`} className="ms-auto inline-flex items-center min-h-11 px-4 rounded-xl text-sm font-semibold border border-border hover:bg-muted">
            {t.inlineEdit.viewProfile}
          </Link>
        }
      />
    </div>
  );
};

export default ProfileEditPage;
