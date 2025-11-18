"use client";
import React, { useEffect } from 'react';
import { Profile } from '@/interfaces';
import { fetchProfile, updateCoverPhoto, updateProfile, updateProfilePhoto } from "@/lib/api/profiles-client";
import { useAuth } from '@/components/AuthProvider/authContext';
import { useI18n } from '@/lib/i18n';

const ProfilePage = () => {
  const { t } = useI18n('ar');
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [activeTab, setActiveTab] = React.useState<'en' | 'ar'>('ar');
  const auth = useAuth();

  useEffect(() => {
    if (auth?.user) {
      fetchProfile(auth.user, setProfile);
    }
  }, [auth]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    // Handle form submission logic here
    const formData = new FormData(event.target as HTMLFormElement);
    const displayNameEn = formData.get('displayNameEn') as string;
    const displayNameAr = formData.get('displayNameAr') as string;
    const bioEn = formData.get('bioEn') as string;
    const bioAr = formData.get('bioAr') as string;

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
    <div className="profile-page flex flex-col md:flex-row min-h-screen bg-gray-100" dir="rtl">
      {/* Sidebar */}
      <aside className="sidebar w-full md:w-1/6 bg-white shadow-md p-4">
        <ul className="space-y-4">
          <li>
            <a href="#dashboard" className="text-black hover:underline">
              لوحة القيادة
            </a>
          </li>
          <li>
            <a href="#edit-profile" className="text-black hover:underline">
              {t.profile.editProfile}
            </a>
          </li>
          <li>
            <a href="#manage-content" className="text-black hover:underline">
              إدارة المحتوى
            </a>
          </li>
        </ul>
      </aside>

      {/* Main Content */}
      <main className="main-content flex-1 p-6" >
        {/* Name Section */}
        <section id="name" className="section mb-8">
          <div className="relative">
            {/* Cover Photo */}
            <div
              className="cover-photo h-48 bg-gray-300 rounded-md overflow-hidden cursor-pointer"
              onClick={() => document.getElementById('coverPhotoInput')?.click()}
              style={{
                backgroundImage: `url(${profile?.coverUrl || '/default-cover.jpg'})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
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
              className="profile-photo w-24 h-24 rounded-full bg-gray-300 border-4 border-white absolute bottom-[-24px] right-4 cursor-pointer overflow-hidden"
              onClick={() => document.getElementById('profilePhotoInput')?.click()}
              style={{
                backgroundImage: `url(${profile?.avatarUrl || '/default-profile.jpg'})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
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
          <h1 className="text-3xl font-bold text-gray-800 mt-12">{`مرحبًا ${profile?.firstName ?? ""} ${profile?.lastName ?? ""}!`}</h1>
          <p className="text-gray-600">مرحبًا بك في صفحة ملفك الشخصي!</p>
        </section>

        {/* Dashboard Section */}
        <section id="dashboard" className="section mb-8">
          <h2 className="text-2xl font-semibold text-gray-800">لوحة القيادة</h2>
          <p className="text-gray-600">نظرة عامة على أنشطتك وإحصائياتك.</p>
          {/* ...add dashboard components here... */}
        </section>

        {/* Edit Profile Section */}
        <section id="edit-profile" className="section mb-8">
          <h2 className="text-2xl font-semibold text-gray-800">{t.profile.editProfile}</h2>
          <form className="space-y-4" onSubmit={handleSubmit}>

            <label className="block">
              <span className="text-gray-700">الاسم:</span>
              <div className="flex space-x-2 space-x-reverse">
                <input
                  type="text"
                  name="firstName"
                  className="mt-1 block w-1/2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                  placeholder={profile?.firstName ? profile.firstName : "اسمك الأول"}
                />
                <input
                  type="text"
                  name="lastName"
                  className="mt-1 block w-1/2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                  placeholder={profile?.lastName ? profile.lastName : "اسمك الأخير"}
                />
              </div>
            </label>

            {/* Display Name with Language Tabs */}
            <label className="block">
              <span className="text-gray-700">{t.profile.displayName}:</span>
              <div className="flex gap-2 mt-2 mb-2 flex-row-reverse">
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
              </div>
              {activeTab === 'en' && (
                <input
                  type="text"
                  name="displayNameEn"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                  placeholder="Display name in English"
                  defaultValue={profile?.displayNameLocalized?.en || profile?.displayName || ''}
                />
              )}
              {activeTab === 'ar' && (
                <input
                  type="text"
                  name="displayNameAr"
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                  placeholder="الاسم المعروض بالعربية"
                  defaultValue={profile?.displayNameLocalized?.ar || ''}
                  dir="rtl"
                />
              )}
            </label>

            {/* Bio with Language Tabs */}
            <label className="block">
              <span className="text-gray-700">السيرة الذاتية:</span>
              {activeTab === 'en' && (
                <textarea
                  name="bioEn"
                  rows={3}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                  placeholder="Tell us about yourself"
                  defaultValue={profile?.bioLocalized?.en || profile?.bio || ''}
                />
              )}
              {activeTab === 'ar' && (
                <textarea
                  name="bioAr"
                  rows={3}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                  placeholder="أخبرنا عن نفسك"
                  defaultValue={profile?.bioLocalized?.ar || ''}
                  dir="rtl"
                />
              )}
            </label>

            <label className="block">
              <span className="text-gray-700">{t.profile.email}:</span>
              <input
                type="email"
                name="email"
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring focus:ring-blue-200"
                value={profile?.email ?? auth.user?.email ?? ""}
                readOnly
              />
            </label>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {t.common.save}
            </button>
          </form>
        </section>

        {/* Manage Content Section */}
        <section id="manage-content" className="section">
          <h2 className="text-2xl font-semibold text-gray-800">إدارة المحتوى</h2>
          <p className="text-gray-600">عرض وإدارة المحتوى الذي قمت بتحميله.</p>
          {/* ...add content management components here... */}
        </section>
      </main>
    </div>
  );
};

export default ProfilePage;
