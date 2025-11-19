"use client";
import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Profile } from '@/interfaces';
import { fetchProfile, updateCoverPhoto, updateProfile, updateProfilePhoto } from "@/lib/api/profiles-client";
import { useAuth } from '@/components/AuthProvider/authContext';
import { useI18n } from '@/lib/i18n';

const ProfileEditPage = () => {
  const params = useParams();
  const locale = params.locale as string;
  const { t } = useI18n(locale as 'en' | 'ar');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');
  const [displayNameEn, setDisplayNameEn] = useState('');
  const [displayNameAr, setDisplayNameAr] = useState('');
  const [bioEn, setBioEn] = useState('');
  const [bioAr, setBioAr] = useState('');
  const auth = useAuth();

  useEffect(() => {
    if (auth?.user) {
      fetchProfile(auth.user, setProfile);
    }
  }, [auth]);

  useEffect(() => {
    if (profile) {
      setDisplayNameEn(profile.displayNameLocalized?.en || profile.displayName || '');
      setDisplayNameAr(profile.displayNameLocalized?.ar || '');
      setBioEn(profile.bioLocalized?.en || profile.bio || '');
      setBioAr(profile.bioLocalized?.ar || '');
    }
  }, [profile]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // Handle form submission logic here
    const formData = new FormData(event.target as HTMLFormElement);

    const newProfile = {
      id: auth.user!.id,
      email: auth.user!.email,
      firstName: formData.get('firstName') as string,
      lastName: formData.get('lastName') as string,
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
    };
    updateProfile(newProfile, setProfile);
  };

  const handlePhotoUpdate = (type: 'profilePhoto' | 'coverPhoto', file: File) => {
    // Logic to handle photo update
    if (!profile) return;

    if (type === 'profilePhoto') {
      updateProfilePhoto(profile, file, setProfile);
    }
    if (type === 'coverPhoto') {
      updateCoverPhoto(profile, file, setProfile);
    }
  };

  return (
    <div className="profile-edit-page flex flex-col flex-1 bg-gray-100 dark:bg-gray-900">
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">
        {/* Name Section */}
        <section id="name" className="section mb-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
          <div className="relative group">
            {/* Cover Photo */}
            <div
              className="cover-photo h-48 bg-gray-300 dark:bg-gray-700 rounded-md overflow-hidden cursor-pointer relative"
              onClick={() => document.getElementById('coverPhotoInput')?.click()}
              style={{
                backgroundImage: profile?.coverUrl ? `url(${profile.coverUrl})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {/* Edit indicator - always visible */}
              <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-sm px-4 py-2 rounded-lg flex items-center gap-2 text-white pointer-events-none">
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
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) handlePhotoUpdate('coverPhoto', e.target.files[0]);
                }}
              />
            </div>

            {/* Profile Photo */}
            <div
              className="profile-photo w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-700 border-4 border-gray-50 dark:border-gray-900 absolute bottom-[-24px] left-4 cursor-pointer overflow-hidden relative group/avatar"
              onClick={() => document.getElementById('profilePhotoInput')?.click()}
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
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.[0]) handlePhotoUpdate('profilePhoto', e.target.files[0]);
                }}
              />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mt-12">{t.profile.welcomeUser?.replace('{name}', `${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`) || `${t.common.welcome} ${profile?.firstName ?? ""} ${profile?.lastName ?? ""}!`}</h1>
          <p className="text-gray-600 dark:text-gray-400">{t.profile.editProfileDescription || 'Edit your profile information below.'}</p>
        </section>

        {/* Edit Profile Section */}
        <section id="edit-profile" className="section mb-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-white mb-6">{t.profile.editProfile}</h2>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">{t.profile.firstName}</span>
                <input
                  type="text"
                  name="firstName"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={t.profile.yourFirstName}
                  defaultValue={profile?.firstName || ''}
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">{t.profile.lastName}</span>
                <input
                  type="text"
                  name="lastName"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={t.profile.yourLastName}
                  defaultValue={profile?.lastName || ''}
                />
              </label>
            </div>

            {/* Display Name with Language Tabs */}
            <div className="block">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t.profile.displayName}</span>
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
                  name="displayNameEn"
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors"
                  placeholder={t.profile.displayNameOptional}
                  value={displayNameEn}
                  onChange={(e) => setDisplayNameEn(e.target.value)}
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  name="displayNameAr"
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
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">{t.profile.bio}</span>
              {activeTab === 'en' && (
                <textarea
                  name="bioEn"
                  rows={4}
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors resize-y"
                  placeholder={t.profile.bioOptional}
                  value={bioEn}
                  onChange={(e) => setBioEn(e.target.value)}
                />
              )}
              {activeTab === 'ar' && (
                <textarea
                  name="bioAr"
                  rows={4}
                  className="mt-1 block w-full px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:focus:ring-blue-800 transition-colors resize-y"
                  placeholder={t.profile.bioArabic}
                  value={bioAr}
                  onChange={(e) => setBioAr(e.target.value)}
                  dir="rtl"
                />
              )}
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
            <button
              type="submit"
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 font-medium transition-colors shadow-md hover:shadow-lg"
            >
              {t.common.save}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
};

export default ProfileEditPage;
