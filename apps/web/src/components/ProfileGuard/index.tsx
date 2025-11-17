"use client";
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { checkProfileExists } from '@/lib/api/profiles-client';

interface ProfileGuardProps {
  children: React.ReactNode;
  locale?: 'en' | 'ar';
}

const ProfileGuard: React.FC<ProfileGuardProps> = ({ children, locale = 'en' }) => {
  console.log('[ProfileGuard] ========== COMPONENT RENDER ==========');

  const { user, loading: accountLoading } = useMultiAccount();
  const router = useRouter();
  const pathname = usePathname();
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [profileExists, setProfileExists] = useState<boolean | null>(null);

  console.log('[ProfileGuard] State:', {
    hasUser: !!user,
    userId: user?.id,
    userEmail: user?.email,
    accountLoading,
    pathname,
    isCheckingProfile,
    profileExists
  });

  // Don't run profile check if already on profile creation page or not authenticated
  const isProfileCreatePage = pathname.includes('/profile/create');
  const shouldSkipCheck = !user || isProfileCreatePage || accountLoading;

  console.log('[ProfileGuard] Should skip check?', {
    shouldSkipCheck,
    noUser: !user,
    isProfileCreatePage,
    accountLoading
  });

  useEffect(() => {
    console.log('[ProfileGuard] useEffect triggered');
    console.log('[ProfileGuard] Dependencies:', {
      user: user?.id,
      locale,
      shouldSkipCheck,
      pathname
    });

    if (shouldSkipCheck) {
      console.log('[ProfileGuard] Skipping check (shouldSkipCheck=true)');
      setIsCheckingProfile(false);
      return;
    }

    const checkProfile = async () => {
      console.log('[ProfileGuard] Starting profile check...');
      try {
        const exists = await checkProfileExists(user);
        console.log('[ProfileGuard] checkProfileExists returned:', exists);
        setProfileExists(exists);

        // Only redirect if we're absolutely sure the profile doesn't exist
        if (exists === false) {
          const profileCreatePath = `/${locale}/profile/create`;
          console.log('[ProfileGuard] 🚨 REDIRECTING to:', profileCreatePath);
          router.push(profileCreatePath);
        } else {
          console.log('[ProfileGuard] ✅ Profile exists or error occurred (fail-safe) - allowing access');
        }
      } catch (error) {
        console.error('[ProfileGuard] ❌ Exception in checkProfile:', error);
        setProfileExists(true);
      } finally {
        console.log('[ProfileGuard] Check complete, setting isCheckingProfile=false');
        setIsCheckingProfile(false);
      }
    };

    checkProfile();
  }, [user, router, locale, shouldSkipCheck, pathname]);

  if (shouldSkipCheck) {
    console.log('[ProfileGuard] Rendering children (shouldSkipCheck)');
    return <>{children}</>;
  }

  if (isCheckingProfile) {
    console.log('[ProfileGuard] Rendering loading state');
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
    console.log('[ProfileGuard] Rendering redirect message (profileExists=false)');
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">{locale === 'ar' ? 'إعادة توجيه إلى إنشاء الملف الشخصي...' : 'Redirecting to profile creation...'}</p>
        </div>
      </div>
    );
  }

  console.log('[ProfileGuard] Rendering children (profile exists)');
  return <>{children}</>;
};

export default ProfileGuard;
