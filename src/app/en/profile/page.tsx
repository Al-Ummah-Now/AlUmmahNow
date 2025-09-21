"use client";
import React, { useEffect } from 'react';
import { Profile } from '@/interfaces';
import { fetchProfile } from "@/lib/clients/profiles";
import { useAuth } from '@/components/AuthProvider/authContext';
import { useRouter } from 'next/navigation';

const ProfilePage = () => {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const auth = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!auth) return;
    fetchProfile(auth.user, setProfile);
  }, [auth]);

  return (
    <div className="profile-page flex flex-col min-h-screen bg-gray-100 dark:bg-gray-900">
      {/* Main Content */}
      <main className="main-content flex-1 p-6">
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
                onClick={() => router.push('/profile/edit')}
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
              className="profile-photo w-24 h-24 rounded-full bg-gray-300 dark:bg-gray-600 border-4 border-white dark:border-gray-800 absolute bottom-[-24px] left-4 overflow-hidden group"
              style={{
                backgroundImage: `url(${profile?.avatarUrl || '/default-profile.jpg'})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {/* Edit Icon */}
              <div
                className="edit-icon w-full h-full bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-50 transition-opacity cursor-pointer"
                onClick={() => router.push('/profile/edit')}
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

        {/* Videos Section */}
        <section id="videos" className="section mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">Videos</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Example video thumbnails */}
            <div className="video-thumbnail bg-gray-200 dark:bg-gray-700 h-40 rounded-md flex items-center justify-center">
              <span className="text-gray-500 dark:text-gray-300">Video 1</span>
            </div>
            <div className="video-thumbnail bg-gray-200 dark:bg-gray-700 h-40 rounded-md flex items-center justify-center">
              <span className="text-gray-500 dark:text-gray-300">Video 2</span>
            </div>
            <div className="video-thumbnail bg-gray-200 dark:bg-gray-700 h-40 rounded-md flex items-center justify-center">
              <span className="text-gray-500 dark:text-gray-300">Video 3</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default ProfilePage;
