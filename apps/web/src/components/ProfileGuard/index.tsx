"use client";
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { checkProfileExists } from '@/lib/api/profiles-client';
import { useI18n } from '@/lib/i18n';

interface ProfileGuardProps {
  children: React.ReactNode;
  locale?: 'en' | 'ar';
}

const ProfileGuard: React.FC<ProfileGuardProps> = ({ children, locale = 'en' }) => {
  console.log('[ProfileGuard] ========== COMPONENT RENDER ==========');

  const { t } = useI18n(locale);
  const { user, loading: accountLoading } = useMultiAccount();
  const router = useRouter();
  const pathname = usePathname();
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [profileExists, setProfileExists] = useState<boolean | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [lastCheckedUserId, setLastCheckedUserId] = useState<string | null>(null);

  console.log('[ProfileGuard] State:', {
    hasUser: !!user,
    userId: user?.id,
    userEmail: user?.email,
    accountLoading,
    pathname,
    isCheckingProfile,
    profileExists
  });

  const isProfileCreatePage = pathname.includes('/profile/create');

  // Skip check if no user or still loading account
  const shouldSkipCheck = !user || accountLoading;

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
      isProfileCreatePage,
      hasChecked,
      lastCheckedUserId
    });

    if (shouldSkipCheck) {
      console.log('[ProfileGuard] Skipping check (shouldSkipCheck=true)');
      setIsCheckingProfile(false);
      return;
    }

    // Reset check state if user changed
    if (user?.id && user.id !== lastCheckedUserId) {
      console.log('[ProfileGuard] User changed, resetting check state');
      setHasChecked(false);
      setProfileExists(null);
      setLastCheckedUserId(user.id);
      setIsCheckingProfile(true);
    }

    // Only check once per user session
    if (hasChecked && user?.id === lastCheckedUserId) {
      console.log('[ProfileGuard] Already checked for this user, skipping');
      return;
    }

    const checkProfile = async () => {
      console.log('[ProfileGuard] Starting profile check...');
      try {
        const exists = await checkProfileExists(user);
        console.log('[ProfileGuard] checkProfileExists returned:', exists);
        setProfileExists(exists);
        setHasChecked(true);

        if (isProfileCreatePage) {
          // On profile create page - redirect away if profile EXISTS
          if (exists === true) {
            const homePath = `/${locale}/`;
            console.log('[ProfileGuard] 🚨 Profile exists on create page - REDIRECTING to:', homePath);
            router.push(homePath);
          } else {
            console.log('[ProfileGuard] ✅ No profile exists - allowing create page access');
          }
        } else {
          // On regular pages - redirect to create if profile DOESN'T exist
          if (exists === false) {
            const profileCreatePath = `/${locale}/profile/create`;
            console.log('[ProfileGuard] 🚨 No profile on regular page - REDIRECTING to:', profileCreatePath);
            router.push(profileCreatePath);
          } else {
            console.log('[ProfileGuard] ✅ Profile exists - allowing access to regular page');
          }
        }
      } catch (error) {
        console.error('[ProfileGuard] ❌ Exception in checkProfile:', error);
        // On error, assume profile exists (fail-safe)
        setProfileExists(true);
        setHasChecked(true);
      } finally {
        console.log('[ProfileGuard] Check complete, setting isCheckingProfile=false');
        setIsCheckingProfile(false);
      }
    };

    checkProfile();
  }, [user, locale, shouldSkipCheck, isProfileCreatePage, hasChecked, lastCheckedUserId, router]);

  const content = (() => {
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
            <p className="text-gray-600 dark:text-gray-400">{t.profile.checkingProfile}</p>
          </div>
        </div>
      );
    }

    // If on regular page and profile doesn't exist, show redirect message
    if (!isProfileCreatePage && profileExists === false) {
      console.log('[ProfileGuard] Rendering redirect message (regular page, no profile)');
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">{t.profile.redirectingToProfileCreation}</p>
          </div>
        </div>
      );
    }

    // If on create page and profile exists, show redirect message
    if (isProfileCreatePage && profileExists === true) {
      console.log('[ProfileGuard] Rendering redirect message (create page, profile exists)');
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">{t.profile.redirecting}</p>
          </div>
        </div>
      );
    }

    console.log('[ProfileGuard] Rendering children (access allowed)');
    return <>{children}</>;
  })();

  return content;
};

export default ProfileGuard;
