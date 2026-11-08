"use client";
import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Profile } from '@/interfaces';
import { fetchProfile, updateCoverPhoto, updateProfile, updateProfilePhoto } from "@/lib/api/profiles-client";
import ImageCropDialog from "@/components/ImageCropDialog";
import { useMultiAccount } from "@/hooks/useMultiAccount";
import { useAuth } from '@/components/AuthProvider/authContext';
import { useLanguage } from '@/hooks/useLanguage';
import { getBrowserTimezone, COMMON_TIMEZONES, getTimezoneDisplayName, isListedTimezone } from '@/utils/timezoneUtils';
import SaveButton, { SaveButtonState } from '@/components/SaveButton';
import { SignInPrompt } from '@/components/common/SignInPrompt';

const ProfileEditPage = () => {
  const { t, lang: locale } = useLanguage();
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

  const handlePhotoUpdate = (type: 'profilePhoto' | 'coverPhoto', file: File) => {
    // Logic to handle photo update
    if (!profile) return;

    if (type === 'profilePhoto') {
      void updateProfilePhoto(profile, file, setProfile).then((ok) => {
        if (ok) void reloadProfile();
      });
    }
    if (type === 'coverPhoto') {
      updateCoverPhoto(profile, file, setProfile);
    }
  };

  const handleBack = () => {
    router.back();
  };

  const handleCancel = () => {
    router.push(`/${locale}/`);
  };

  // Get localized name or fall back to default
  const getLocalizedName = (
    defaultValue: string | undefined,
    localizedValues: Record<string, string> | undefined
  ): string => {
    if (localizedValues && localizedValues[locale]) {
      return localizedValues[locale];
    }
    return defaultValue || '';
  };

  const displayFirstName = getLocalizedName(profile?.firstName, profile?.firstNameLocalized);
  const displayLastName = getLocalizedName(profile?.lastName, profile?.lastNameLocalized);

  if (!auth?.user) {
    return <SignInPrompt title={t.profile.signInTitle} message={t.profile.signInMessage} />;
  }

  return (
    <div className="profile-edit-page flex flex-col flex-1 bg-gray-100 dark:bg-gray-900">
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {/* Name Section */}
        <section id="name" className="section mb-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
          <div className="relative group">
            {/* Cover Photo */}
            <div
              className="cover-photo h-48 bg-gray-300 dark:bg-gray-700 rounded-md overflow-hidden cursor-pointer relative"
              role="button"
              tabIndex={0}
              aria-label={t.channel.clickToChangeCover}
              data-testid="profile-cover-upload"
              onClick={() => document.getElementById('coverPhotoInput')?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  document.getElementById('coverPhotoInput')?.click();
                }
              }}
              style={{
                backgroundImage: profile?.coverUrl ? `url(${profile.coverUrl})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {/* Edit indicator - always visible */}
              <div className="absolute top-4 end-4 bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg flex items-center gap-2 text-white pointer-events-none">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm font-medium">{t.channel.clickToChangeCover || 'Click to change cover'}</span>
              </div>
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity"></div>
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
            </div>

            {/* Profile Photo */}
            <div
              className="profile-photo w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-700 border-4 border-gray-50 dark:border-gray-900 absolute bottom-[-24px] start-4 cursor-pointer overflow-hidden relative group/avatar"
              role="button"
              tabIndex={0}
              aria-label={t.channel.clickToChangeAvatar}
              data-testid="profile-avatar-upload"
              onClick={() => document.getElementById('profilePhotoInput')?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  document.getElementById('profilePhotoInput')?.click();
                }
              }}
              style={{
                backgroundImage: profile?.avatarUrl ? `url(${profile.avatarUrl})` : `url(/avatar.png)`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {/* Avatar edit indicator - always visible */}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
                <div className="bg-white/90 dark:bg-gray-800/90 rounded-full p-2">
                  <svg className="w-6 h-6 text-gray-800 dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </div>
              </div>
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/20 opacity-0 group-hover/avatar:opacity-100 transition-opacity"></div>
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
            </div>
          </div>
          <ImageCropDialog
            file={cropping?.file ?? null}
            kind={cropping?.type === 'coverPhoto' ? 'cover' : 'avatar'}
            onCancel={() => setCropping(null)}
            onApply={(cropped) => {
              const type = cropping?.type;
              setCropping(null);
              if (type) handlePhotoUpdate(type, cropped);
            }}
          />
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-12">{t.profile.welcomeUser?.replace('{name}', `${displayFirstName} ${displayLastName}`) || `${t.common.welcome} ${displayFirstName} ${displayLastName}!`}</h1>
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
                  placeholder={t.profile.displayNameOptional}
                  value={displayNameEn}
                  onChange={(e) => setDisplayNameEn(e.target.value)}
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  id="profile-displayName" name="displayNameAr"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={t.profile.displayNameArabic}
                  value={displayNameAr}
                  onChange={(e) => setDisplayNameAr(e.target.value)}
                  dir="rtl"
                />
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
              <select
                id="profile-timezone"
                name="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
              >
                {timezone && !isListedTimezone(timezone) && (
                  <option value={timezone}>{getTimezoneDisplayName(timezone)}</option>
                )}
                {Object.entries(COMMON_TIMEZONES).map(([region, timezones]) => (
                  <optgroup key={region} label={region}>
                    {timezones.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label} ({tz.offset})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t.profile?.currentTimezone || 'Current timezone'}: {getTimezoneDisplayName(timezone)}
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
