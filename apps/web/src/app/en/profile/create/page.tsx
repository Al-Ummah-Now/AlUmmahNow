"use client";
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Profile } from '@/interfaces';
import { createProfile } from "@/lib/api/profiles";
import { useAuth } from '@/components/AuthProvider/authContext';
import { useI18n } from '@/lib/i18n';

const ProfileCreatePage = () => {
  const { t } = useI18n('en');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Initialize default profile for creation
    if (auth?.user) {
      setProfile({
        id: auth.user.id,
        email: auth.user.email,
        firstName: '',
        lastName: '',
        displayName: '',
        avatarUrl: '/avatar.png',
        coverUrl: undefined
      });
    }
  }, [auth]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!profile || !auth?.user) return;

    setLoading(true);
    setError(null);

    const formData = new FormData(event.target as HTMLFormElement);
    const firstName = formData.get('firstName') as string;
    const lastName = formData.get('lastName') as string;
    const displayNameEn = formData.get('displayNameEn') as string;
    const displayNameAr = formData.get('displayNameAr') as string;
    const bioEn = formData.get('bioEn') as string;
    const bioAr = formData.get('bioAr') as string;

    // Validation
    if (!firstName.trim()) {
      setError(t.validation.required);
      setLoading(false);
      return;
    }

    try {
      const result = await createProfile({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
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
        avatarUrl: profile.avatarUrl,
        coverUrl: profile.coverUrl,
        email: profile.email,
      });

      console.log('Profile created successfully:', result);
      // Redirect to home page after successful profile creation
      router.push('/en/');
    } catch (error) {
      console.error('Profile creation failed:', error);
      setError(error instanceof Error ? error.message : t.errors.genericError);
    } finally {
      setLoading(false);
    }
  };

  if (!auth?.user) {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">{t.errors.unauthorized}</p>
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
            <p className="text-gray-600 dark:text-gray-400">Welcome to {t.common.appName}! Let&apos;s set up your profile to get started.</p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                {t.profile.email}
              </label>
              <input
                type="email"
                value={auth.user?.email || ''}
                disabled
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-400"
              />
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Your email address cannot be changed</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                  First Name <span className="text-red-500 dark:text-red-400">*</span>
                </label>
                <input
                  type="text"
                  name="firstName"
                  required
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder="Your first name"
                />
              </div>

              <div>
                <label className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                  Last Name
                </label>
                <input
                  type="text"
                  name="lastName"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder="Your last name"
                />
              </div>
            </div>

            {/* Display Name with Language Tabs */}
            <div>
              <label className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                {t.profile.displayName}
              </label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('en')}
                  className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                    activeTab === 'en'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  English
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
                  العربية
                </button>
              </div>
              {activeTab === 'en' && (
                <input
                  type="text"
                  name="displayNameEn"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder="How others will see your name (optional)"
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  name="displayNameAr"
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder="كيف سيرى الآخرون اسمك (اختياري)"
                  dir="rtl"
                />
              )}
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">If left empty, we&apos;ll use your first and last name</p>
            </div>

            {/* Bio with Language Tabs */}
            <div>
              <label className="block text-gray-700 dark:text-gray-300 font-medium mb-2">
                Bio
              </label>
              {activeTab === 'en' && (
                <textarea
                  name="bioEn"
                  rows={3}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder="Tell us about yourself (optional)"
                />
              )}
              {activeTab === 'ar' && (
                <textarea
                  name="bioAr"
                  rows={3}
                  className="w-full px-4 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-blue-500 dark:focus:border-blue-400"
                  placeholder="أخبرنا عن نفسك (اختياري)"
                  dir="rtl"
                />
              )}
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-md p-4">
              <h3 className="font-medium text-blue-900 dark:text-blue-300 mb-2">Privacy Notice</h3>
              <p className="text-sm text-blue-800 dark:text-blue-400">
                Your profile information will be used to personalize your experience on {t.common.appName}.
                You can update your profile information at any time in your profile settings.
              </p>
            </div>

            <div className="flex gap-4 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 dark:bg-blue-500 text-white py-3 px-6 rounded-md font-medium hover:bg-blue-700 dark:hover:bg-blue-600 focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? `${t.common.create}...` : t.profile.createProfile}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ProfileCreatePage;