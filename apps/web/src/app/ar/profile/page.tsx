"use client";
import React from 'react';
import { useProfile } from '@/hooks/useProfile';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useRouter } from 'next/navigation';
import { ChannelManagementSection } from '@/components/channelManagement/rtl';

const ProfilePage = () => {
  const auth = useAuth();
  const router = useRouter();
  const { profile, isLoading, error } = useProfile(auth?.user || null);

  return (
    <div className="profile-page flex flex-col min-h-screen bg-gray-100 dark:bg-gray-900" dir="rtl">
      {/* Main Content */}
      <main className="main-content flex-1 p-6">
        {isLoading ? (
          <div className="flex justify-center items-center min-h-screen">
            <div className="text-center">
              <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
              <p className="text-gray-600 dark:text-gray-400">جاري تحميل الملف الشخصي...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center min-h-screen">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto mb-4 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-600 dark:text-red-400 text-lg font-semibold">{error}</p>
            </div>
          </div>
        ) : (
          <>
            {/* Name Section */}
            <section id="name" className="section mb-8">
              <div className="relative">
                {/* Cover Photo */}
                <div
                  className="cover-photo h-48 bg-gray-300 dark:bg-gray-600 rounded-md overflow-hidden group"
                  style={{
                    backgroundImage: `url(${profile?.coverUrl || '/default-cover.jpg'})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  {/* Edit Icon */}
                  <div
                    className="edit-icon w-full h-full bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-50 transition-opacity cursor-pointer"
                    onClick={() => router.push('/ar/profile/edit')}
                      >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-6 w-6 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.232 5.232l3.536 3.536M9 11l6.536-6.536a2 2 0 112.828 2.828L11.828 13.828a2 2 0 01-.828.536l-4 1a1 1 0 01-1.264-1.264l1-4a2 2 0 01.536-.828z"
                      />
                    </svg>
                  </div>
                </div>

                {/* Profile Photo */}
                <div
                  className="profile-photo w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-600 border-4 border-white dark:border-gray-800 absolute bottom-[-24px] right-4 overflow-hidden group"
                  style={{
                    backgroundImage: `url(${profile?.avatarUrl || '/default-profile.jpg'})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  {/* Edit Icon */}
                  <div
                    className="edit-icon w-full h-full bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-50 transition-opacity cursor-pointer"
                    onClick={() => router.push('/ar/profile/edit')}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-6 w-6 text-white"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15.232 5.232l3.536 3.536M9 11l6.536-6.536a2 2 0 112.828 2.828L11.828 13.828a2 2 0 01-.828.536l-4 1a1 1 0 01-1.264-1.264l1-4a2 2 0 01.536-.828z"
                      />
                    </svg>
                  </div>
                </div>
              </div>
              <h1 className="text-3xl font-bold text-gray-800 dark:text-white mt-12">{`${profile?.firstName ?? ""} ${profile?.lastName ?? ""}`}</h1>
            </section>

            {/* Channel Management Section */}
            <ChannelManagementSection />

            {/* Videos Section */}
            <section id="videos" className="section mb-8">
              <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">مقاطع الفيديو</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Example video thumbnails */}
                <div className="video-thumbnail bg-gray-200 dark:bg-gray-700 h-40 rounded-md flex items-center justify-center">
                  <span className="text-gray-500 dark:text-gray-300">فيديو 1</span>
                </div>
                <div className="video-thumbnail bg-gray-200 dark:bg-gray-700 h-40 rounded-md flex items-center justify-center">
                  <span className="text-gray-500 dark:text-gray-300">فيديو 2</span>
                </div>
                <div className="video-thumbnail bg-gray-200 dark:bg-gray-700 h-40 rounded-md flex items-center justify-center">
                  <span className="text-gray-500 dark:text-gray-300">فيديو 3</span>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default ProfilePage;
