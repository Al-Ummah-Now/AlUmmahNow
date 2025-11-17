"use client";
import { useAuth } from '@/components/AuthProvider/authContext';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { checkProfileExists } from '@/lib/api/profiles-client';

interface ProfileGuardProps {
  children: React.ReactNode;
  locale?: 'en' | 'ar';
}

const ProfileGuard: React.FC<ProfileGuardProps> = ({ children, locale = 'en' }) => {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [profileExists, setProfileExists] = useState<boolean | null>(null);

  // Don't run profile check if already on profile creation page or not authenticated
  const isProfileCreatePage = pathname.includes('/profile/create');
  const shouldSkipCheck = !auth?.user || isProfileCreatePage;

  useEffect(() => {
    if (shouldSkipCheck) {
      setIsCheckingProfile(false);
      return;
    }

    const checkProfile = async () => {
      try {
        const exists = await checkProfileExists(auth.user);
        setProfileExists(exists);
        
        if (!exists) {
          // Profile doesn't exist, redirect to creation page
          const profileCreatePath = `/${locale}/profile/create`;
          router.push(profileCreatePath);
        }
      } catch (error) {
        console.error('Error checking profile:', error);
        // On error, allow access to avoid breaking the app
        setProfileExists(true);
      } finally {
        setIsCheckingProfile(false);
      }
    };

    checkProfile();
  }, [auth?.user, router, locale, shouldSkipCheck, pathname]);

  if (shouldSkipCheck) {
    return <>{children}</>;
  }

  if (isCheckingProfile) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{locale === 'ar' ? 'جاري التحقق من الملف الشخصي...' : 'Checking profile...'}</p>
        </div>
      </div>
    );
  }

  if (profileExists === false) {
    // This shouldn't normally show because we redirect above, but just in case
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{locale === 'ar' ? 'إعادة توجيه إلى إنشاء الملف الشخصي...' : 'Redirecting to profile creation...'}</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProfileGuard;