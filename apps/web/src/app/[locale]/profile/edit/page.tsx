"use client";
import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Profile } from '@/interfaces';
import { fetchProfile, removeProfileImage, updateCoverPhoto, updateProfile, updateProfilePhoto } from "@/lib/api/profiles-client";
import { EditableAvatar, EditableCover } from "@/components/media/ProfileImages";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useMultiAccount } from "@/hooks/useMultiAccount";
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { getBrowserTimezone, COMMON_TIMEZONES, localizedTimezoneLabel, localizedTimezoneRegion, getTimezoneDisplayName, isListedTimezone } from '@/utils/timezoneUtils';
import SaveButton, { SaveButtonState } from '@/components/SaveButton';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import { userDisplayName } from '@/lib/display-name';

const ProfileEditPage = () => {
  const { t, lang: locale } = useLanguage();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');
  const [firstNameEn, setFirstNameEn] = useState('');
  const [firstNameAr, setFirstNameAr] = useState('');
  const [lastNameEn, setLastNameEn] = useState('');
  const [lastNameAr, setLastNameAr] = useState('');
  const [displayNameEn, setDisplayNameEn] = useState('');
  const [displayNameAr, setDisplayNameAr] = useState('');
  const [bioEn, setBioEn] = useState('');
  const [bioAr, setBioAr] = useState('');
  const [timezone, setTimezone] = useState<string>('');
  const [saveState, setSaveState] = useState<SaveButtonState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (auth?.user) {
      fetchProfile(auth.user, setProfile);
    }
  }, [auth]);

  useEffect(() => {
    if (profile) {
      setFirstNameEn(profile.firstNameLocalized?.en || profile.firstName || '');
      setFirstNameAr(profile.firstNameLocalized?.ar || '');
      setLastNameEn(profile.lastNameLocalized?.en || profile.lastName || '');
      setLastNameAr(profile.lastNameLocalized?.ar || '');
      setDisplayNameEn(profile.displayNameLocalized?.en || profile.displayName || '');
      setDisplayNameAr(profile.displayNameLocalized?.ar || '');
      setBioEn(profile.bioLocalized?.en || profile.bio || '');
      setBioAr(profile.bioLocalized?.ar || '');
      setTimezone(profile.timezone || getBrowserTimezone());
    }
  }, [profile]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaveState('saving');
    setErrorMessage('');

    try {
      const newProfile = {
        id: auth.user!.id,
        email: auth.user!.email,
        firstName: firstNameEn || '',
        firstNameLocalized: {
          en: firstNameEn || '',
          ar: firstNameAr || ''
        },
        lastName: lastNameEn || '',
        lastNameLocalized: {
          en: lastNameEn || '',
          ar: lastNameAr || ''
        },
        displayName: displayNameEn || '',
        displayNameLocalized: {
          en: displayNameEn || '',
          ar: displayNameAr || ''
        },
        bio: bioEn || '',
        bioLocalized: {
          en: bioEn || '',
          ar: bioAr || ''
        },
        avatarUrl: profile?.avatarUrl,
        coverUrl: profile?.coverUrl,
        timezone: timezone || getBrowserTimezone(),
      };

      const success = await updateProfile(newProfile, setProfile);

      if (success) {
        setSaveState('success');
      } else {
        setSaveState('error');
        setErrorMessage(t.profile.saveFailed);
      }
    } catch (error) {
      setSaveState('error');
      setErrorMessage(error instanceof Error ? error.message : t.profile.unexpectedError);
    }
  };

  // Session profile feeds the navigation avatar; refresh it after a new photo
  const { reloadProfile } = useMultiAccount();
  // Picked image waiting to be positioned/zoomed before upload
  const [cropping, setCropping] = useState<{ type: 'profilePhoto' | 'coverPhoto'; file: File } | null>(null);

  // Which photo is uploading or being removed (disables its buttons meanwhile)
  const [photoBusy, setPhotoBusy] = useState<'profilePhoto' | 'coverPhoto' | null>(null);
  const [photoError, setPhotoError] = useState('');

  const handlePhotoUpdate = async (type: 'profilePhoto' | 'coverPhoto', file: File) => {
    if (!profile) return;
    setPhotoBusy(type);
    setPhotoError('');
    try {
      const ok = type === 'profilePhoto'
        ? await updateProfilePhoto(profile, file, setProfile)
        : await updateCoverPhoto(profile, file, setProfile);
      if (!ok) setPhotoError(t.errors.uploadFailed || t.profile.saveFailed);
      else if (type === 'profilePhoto') void reloadProfile();
    } finally {
      setPhotoBusy(null);
    }
  };

  const removePhoto = async (type: 'profilePhoto' | 'coverPhoto') => {
    if (!profile) return;
    const confirmed = await confirm({
      title: t.confirmDialog.removeImageTitle,
      description: t.confirmDialog.removeImageBody,
      confirmLabel: t.confirmDialog.remove,
      testId: 'profile-image-remove-dialog',
    });
    if (!confirmed) return;
    setPhotoBusy(type);
    setPhotoError('');
    try {
      const ok = await removeProfileImage(type === 'profilePhoto' ? 'avatar' : 'cover', setProfile);
      if (!ok) setPhotoError(t.profile.saveFailed);
      else if (type === 'profilePhoto') void reloadProfile();
    } finally {
      setPhotoBusy(null);
    }
  };

  const handleBack = () => {
    router.back();
  };

  const handleCancel = () => {
    router.push(`/${locale}/`);
  };

  // Display name, else first + last; the email only as the last resort
  const welcomeName = userDisplayName(profile, locale, profile?.email);

  // An empty display name field shows what others will see instead (first + last, per language)
  const formNames = {
    displayName: displayNameEn,
    firstName: firstNameEn,
    lastName: lastNameEn,
    firstNameLocalized: { en: firstNameEn, ar: firstNameAr },
    lastNameLocalized: { en: lastNameEn, ar: lastNameAr },
  };
  const displayNameHintEn = displayNameEn.trim() ? '' : userDisplayName(formNames, 'en');
  const displayNameHintAr = displayNameAr.trim() ? '' : userDisplayName({ ...formNames, displayNameLocalized: { en: displayNameEn } }, 'ar');

  if (!auth?.user) {
    return <SignInPrompt title={t.profile.signInTitle} message={t.profile.signInMessage} />;
  }

  return (
    <div className="profile-edit-page flex flex-col flex-1 bg-gray-100 dark:bg-gray-900">
      {confirmDialog}
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {/* Name Section */}
        <section id="name" className="section mb-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
          <EditableCover
            url={profile?.coverUrl}
            alt={t.channel.currentCover}
            onPick={() => document.getElementById('coverPhotoInput')?.click()}
            onRemove={() => void removePhoto('coverPhoto')}
            labels={{ pick: t.channel.clickToChangeCover, change: t.channel.changeCover, remove: t.channel.removeCover }}
            testId="profile-cover-upload"
            imageTestId="profile-cover-image"
            busy={photoBusy === 'coverPhoto'}
            className="cover-photo h-48 rounded-md bg-gray-300 dark:bg-gray-700"
          />
          <EditableAvatar
            url={profile?.avatarUrl}
            alt={t.channel.currentAvatar}
            onPick={() => document.getElementById('profilePhotoInput')?.click()}
            onRemove={() => void removePhoto('profilePhoto')}
            labels={{ pick: t.channel.clickToChangeAvatar, change: t.channel.changeAvatar, remove: t.channel.removeAvatar }}
            testId="profile-avatar-upload"
            imageTestId="profile-avatar-image"
            busy={photoBusy === 'profilePhoto'}
            // eslint-disable-next-line @next/next/no-img-element -- static default avatar
            placeholder={<img src="/avatar.png" alt="" className="h-full w-full object-cover" />}
            className="profile-photo relative z-[3] -mt-12 ps-4"
          />
          {photoError && (
            <p role="alert" data-testid="profile-photo-error" className="mt-2 text-sm text-red-600 dark:text-red-400">{photoError}</p>
          )}
          {/* Pickers live outside the clickable areas so their click does not bubble back */}
          <input
            type="file"
            id="coverPhotoInput"
            aria-label={t.channel.clickToChangeCover}
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (picked) setCropping({ type: 'coverPhoto', file: picked });
            }}
          />
          <input
            type="file"
            id="profilePhotoInput"
            aria-label={t.channel.clickToChangeAvatar}
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (picked) setCropping({ type: 'profilePhoto', file: picked });
            }}
          />
          <ImageCropDialog
            file={cropping?.file ?? null}
            kind={cropping?.type === 'coverPhoto' ? 'cover' : 'avatar'}
            onCancel={() => setCropping(null)}
            onApply={(cropped) => {
              const type = cropping?.type;
              setCropping(null);
              if (type) void handlePhotoUpdate(type, cropped);
            }}
          />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-4">{t.profile.welcomeUser?.replace('{name}', welcomeName) || `${t.common.welcome} ${welcomeName}!`}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t.profile.editProfileDescription || 'Edit your profile information below.'}</p>
        </section>

        {/* Edit Profile Section */}
        <section id="edit-profile" className="section mb-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">{t.profile.editProfile}</h2>
          <form className="space-y-6" onSubmit={handleSubmit}>
            {/* First Name with Language Tabs */}
            <div className="block">
              <label htmlFor="profile-firstName" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t.profile.firstName}</label>
              <div className="flex gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setActiveTab('en')}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'en'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {t.languages.english}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('ar')}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeTab === 'ar'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {t.languages.arabic}
                </button>
              </div>
              {activeTab === 'en' && (
                <input
                  type="text"
                  id="profile-firstName" name="firstNameEn"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={t.profile.yourFirstName}
                  value={firstNameEn}
                  onChange={(e) => setFirstNameEn(e.target.value)}
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  id="profile-firstName" name="firstNameAr"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={t.profile.firstNameArabic || 'الاسم الأول'}
                  value={firstNameAr}
                  onChange={(e) => setFirstNameAr(e.target.value)}
                  dir="rtl"
                />
              )}
            </div>

            {/* Last Name with Language Tabs */}
            <div className="block">
              <label htmlFor="profile-lastName" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t.profile.lastName}</label>
              {activeTab === 'en' && (
                <input
                  type="text"
                  id="profile-lastName" name="lastNameEn"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={t.profile.yourLastName}
                  value={lastNameEn}
                  onChange={(e) => setLastNameEn(e.target.value)}
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  id="profile-lastName" name="lastNameAr"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={t.profile.lastNameArabic || 'اسم العائلة'}
                  value={lastNameAr}
                  onChange={(e) => setLastNameAr(e.target.value)}
                  dir="rtl"
                />
              )}
            </div>

            {/* Display Name */}
            <div className="block">
              <label htmlFor="profile-displayName" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t.profile.displayName}</label>
              {activeTab === 'en' && (
                <input
                  type="text"
                  id="profile-displayName" name="displayNameEn"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={displayNameHintEn || t.profile.displayNameOptional}
                  data-testid="profile-display-name-en"
                  value={displayNameEn}
                  onChange={(e) => setDisplayNameEn(e.target.value)}
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  id="profile-displayName" name="displayNameAr"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={displayNameHintAr || t.profile.displayNameArabic}
                  data-testid="profile-display-name-ar"
                  value={displayNameAr}
                  onChange={(e) => setDisplayNameAr(e.target.value)}
                  dir="rtl"
                />
              )}
              {(activeTab === 'en' ? !displayNameEn.trim() : !displayNameAr.trim()) && (
                <p className="text-sm text-[var(--fanous-color-text-secondary)] mt-1">{t.profile.displayNameEmpty}</p>
              )}
            </div>

            {/* Bio with Language Tabs */}
            <div className="block">
              <label htmlFor="profile-bio" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t.profile.bio}</label>
              {activeTab === 'en' && (
                <textarea
                  id="profile-bio" name="bioEn"
                  rows={4}
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors resize-y"
                  placeholder={t.profile.bioOptional}
                  value={bioEn}
                  onChange={(e) => setBioEn(e.target.value)}
                />
              )}
              {activeTab === 'ar' && (
                <textarea
                  id="profile-bio" name="bioAr"
                  rows={4}
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors resize-y"
                  placeholder={t.profile.bioArabic}
                  value={bioAr}
                  onChange={(e) => setBioAr(e.target.value)}
                  dir="rtl"
                />
              )}
            </div>

            {/* Timezone Selector */}
            <div className="block">
              <label htmlFor="profile-timezone" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                {t.profile?.timezone || 'Timezone'}
              </label>
              <ThemedSelectField
                id="profile-timezone"
                name="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
              >
                {timezone && !isListedTimezone(timezone) && (
                  <option value={timezone}>{getTimezoneDisplayName(timezone, locale)}</option>
                )}
                {Object.entries(COMMON_TIMEZONES).map(([region, timezones]) => (
                  <optgroup key={region} label={localizedTimezoneRegion(region, locale)}>
                    {timezones.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {localizedTimezoneLabel(tz, locale)} ({tz.offset})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </ThemedSelectField>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t.profile?.currentTimezone || 'Current timezone'}: {getTimezoneDisplayName(timezone, locale)}
              </p>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">{t.profile.email}</span>
              <input
                type="email"
                name="email"
                className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 shadow-sm cursor-not-allowed"
                value={profile?.email ?? auth.user?.email ?? ""}
                readOnly
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.profile.emailCannotBeChanged}</p>
            </label>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleBack}
                className="px-6 py-3 rounded-lg font-semibold transition-all duration-300 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                {t.common.back || 'Back'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="px-6 py-3 rounded-lg font-semibold transition-all duration-300 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300"
              >
                {t.common.cancel || 'Cancel'}
              </button>
              <div className="flex-1">
                <SaveButton
                  state={saveState}
                  type="submit"
                  idleText={t.common.save}
                  savingText={t.common.saving || 'Saving...'}
                  successText={t.common.saved || 'Saved!'}
                  errorText={t.common.saveFailed || 'Save Failed'}
                  errorMessage={errorMessage}
                  fullWidth={true}
                />
              </div>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
};

export default ProfileEditPage;
