'use client';

import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { logger } from '@/lib/logger-client';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Profile } from '@/interfaces';
import { createProfile } from "@/lib/api/profiles";
import { useAuth } from '@/components/AuthProvider/authContext';
import { login } from '@/lib/actions';
import { useLanguage } from '@/hooks/useLanguage';
import { getBrowserTimezone, COMMON_TIMEZONES, localizedTimezoneLabel, localizedTimezoneRegion, getTimezoneDisplayName, isListedTimezone } from '@/utils/timezoneUtils';
import SaveButton, { SaveButtonState } from '@/components/SaveButton';

const ProfileCreatePage = () => {
  const { t, lang } = useLanguage();
  const params = useParams();
  const locale = params.locale as string;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saveState, setSaveState] = useState<SaveButtonState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');
  const [timezone, setTimezone] = useState<string>('');
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Auto-detect system timezone
    const detectedTimezone = getBrowserTimezone();
    setTimezone(detectedTimezone);

    // Initialize default profile for creation
    if (auth?.user) {
      setProfile({
        id: auth.user.id,
        email: auth.user.email,
        firstName: '',
        lastName: '',
        displayName: '',
        avatarUrl: '/avatar.png',
        coverUrl: undefined,
        timezone: detectedTimezone
      });
    }
  }, [auth]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !auth?.user) return;

    setSaveState('saving');
    setErrorMessage('');

    const formData = new FormData(event.target as HTMLFormElement);
    const firstNameEn = (formData.get('firstNameEn') as string) || '';
    const firstNameAr = (formData.get('firstNameAr') as string) || '';
    const lastNameEn = (formData.get('lastNameEn') as string) || '';
    const lastNameAr = (formData.get('lastNameAr') as string) || '';
    const displayNameEn = (formData.get('displayNameEn') as string) || '';
    const displayNameAr = (formData.get('displayNameAr') as string) || '';
    const bioEn = (formData.get('bioEn') as string) || '';
    const bioAr = (formData.get('bioAr') as string) || '';

    // Validation
    if (!firstNameEn.trim()) {
      setSaveState('error');
      setErrorMessage(t.validation.required);
      return;
    }

    try {
      const result = await createProfile({
        firstName: firstNameEn.trim(),
        firstNameLocalized: {
          en: firstNameEn.trim() || '',
          ar: firstNameAr.trim() || ''
        },
        lastName: lastNameEn.trim(),
        lastNameLocalized: {
          en: lastNameEn.trim() || '',
          ar: lastNameAr.trim() || ''
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
        timezone: timezone || getBrowserTimezone(),
        avatarUrl: profile.avatarUrl,
        coverUrl: profile.coverUrl,
        email: profile.email,
      });

      // Check if API call failed (returns null on error)
      if (!result) {
        throw new Error(t.errors.failedToCreate || 'Failed to create profile');
      }

      logger.debug('Profile created successfully:', result);
      setSaveState('success');
      // Redirect to home page after successful profile creation with a slight delay
      setTimeout(() => {
        router.push(`/${locale}/`);
      }, 1000);
    } catch (error) {
      logger.error('Profile creation failed:', error);
      setSaveState('error');
      setErrorMessage(error instanceof Error ? error.message : t.errors.genericError);
    }
  };

  if (!auth?.user) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">{t.navigation.signIn}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">{t.errors.unauthorized}</p>
          <button
            type="button"
            onClick={() => { void login(locale); }}
            className="px-4 py-2 rounded-md bg-blue-600 text-white hover:bg-blue-700"
          >
            {t.navigation.signIn}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 py-8">
      <div className="max-w-2xl mx-auto px-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">{t.profile.createProfile}</h1>
            <p className="text-gray-600 dark:text-gray-400">{t.profile.welcomeMessage}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="profile-email" className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                {t.profile.email}
              </label>
              <input
                id="profile-email"
                type="email"
                value={auth.user?.email || ''}
                disabled
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-400"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t.profile.emailCannotBeChanged}</p>
            </div>

            {/* Language Tabs - Controls all localized fields */}
            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setActiveTab('en')}
                className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                  activeTab === 'en'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {t.languages.english}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ar')}
                className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                  activeTab === 'ar'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {t.languages.arabic}
              </button>
            </div>

            {/* First Name with Language Tabs */}
            <div>
              <label htmlFor="profile-firstName" className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                {t.profile.firstName} <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              {activeTab === 'en' && (
                <input
                  type="text"
                  id="profile-firstName" name="firstNameEn"
                  required
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder={t.profile.yourFirstName}
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  id="profile-firstName" name="firstNameAr"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder={t.profile.firstNameArabic || 'الاسم الأول'}
                  dir="rtl"
                />
              )}
            </div>

            {/* Last Name with Language Tabs */}
            <div>
              <label htmlFor="profile-lastName" className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                {t.profile.lastName}
              </label>
              {activeTab === 'en' && (
                <input
                  type="text"
                  id="profile-lastName" name="lastNameEn"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder={t.profile.yourLastName}
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  id="profile-lastName" name="lastNameAr"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder={t.profile.lastNameArabic || 'اسم العائلة'}
                  dir="rtl"
                />
              )}
            </div>

            {/* Display Name */}
            <div>
              <label htmlFor="profile-displayName" className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                {t.profile.displayName}
              </label>
              {activeTab === 'en' && (
                <input
                  type="text"
                  id="profile-displayName" name="displayNameEn"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder={t.profile.displayNameOptional}
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  id="profile-displayName" name="displayNameAr"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder={t.profile.displayNameArabic}
                  dir="rtl"
                />
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t.profile.displayNameEmpty}</p>
            </div>

            {/* Bio */}
            <div>
              <label htmlFor="profile-bio" className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                {t.profile.bio}
              </label>
              {activeTab === 'en' && (
                <textarea
                  id="profile-bio" name="bioEn"
                  rows={3}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder={t.profile.bioOptional}
                />
              )}
              {activeTab === 'ar' && (
                <textarea
                  id="profile-bio" name="bioAr"
                  rows={3}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder={t.profile.bioArabic}
                  dir="rtl"
                />
              )}
            </div>

            {/* Timezone Selector */}
            <div>
              <label htmlFor="profile-timezone" className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                {t.profile?.timezone || 'Timezone'}
              </label>
              <ThemedSelectField
                id="profile-timezone" name="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
              >
                {timezone && !isListedTimezone(timezone) && (
                  <option value={timezone}>{getTimezoneDisplayName(timezone, lang)}</option>
                )}
                {Object.entries(COMMON_TIMEZONES).map(([region, timezones]) => (
                  <optgroup key={region} label={localizedTimezoneRegion(region, lang)}>
                    {timezones.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {localizedTimezoneLabel(tz, lang)} ({tz.offset})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </ThemedSelectField>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {t.profile?.timezoneDetected || 'Detected timezone'}: {getTimezoneDisplayName(timezone, lang)}
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-md p-4">
              <h3 className="font-medium text-blue-900 dark:text-blue-300 mb-2">{t.profile.privacyNotice}</h3>
              <p className="text-sm text-blue-800 dark:text-blue-400">
                {t.profile.privacyNoticeText}
              </p>
            </div>

            <SaveButton
              state={saveState}
              type="submit"
              idleText={t.profile.createProfile}
              savingText={t.common.saving || 'Saving...'}
              successText={t.common.saved || 'Saved!'}
              errorText={t.common.saveFailed || 'Save Failed'}
              errorMessage={errorMessage}
              fullWidth={true}
            />
          </form>
        </div>
      </div>
    </div>
  );
};

export default ProfileCreatePage;
