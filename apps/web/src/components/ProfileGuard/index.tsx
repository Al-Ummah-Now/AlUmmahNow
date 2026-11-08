'use client';
import { logger } from '@/lib/logger-client';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { checkProfileExists } from '@/lib/api/profiles-client';
import { useLanguage } from '@/hooks/useLanguage';

interface ProfileGuardProps {
  children: React.ReactNode;
}

const ProfileGuard: React.FC<ProfileGuardProps> = ({ children }) => {
  logger.debug('[ProfileGuard] ========== COMPONENT RENDER ==========');

  const { t, lang: locale } = useLanguage();
  const { user, loading: accountLoading } = useMultiAccount();
  const router = useRouter();
  const pathname = usePathname();
  const [isCheckingProfile, setIsCheckingProfile] = useState(true);
  const [profileExists, setProfileExists] = useState<boolean | null>(null);
  const [hasChecked, setHasChecked] = useState(false);
  const [lastCheckedUserId, setLastCheckedUserId] = useState<string | null>(null);

  logger.debug('[ProfileGuard] State:', {
    hasUser: !!user,
    
    userEmail: user?.email,
    accountLoading,
    pathname,
    isCheckingProfile,
    profileExists
  });

  const isProfileCreatePage = pathname.includes('/profile/create');

  // Skip check if no user or still loading account
  const shouldSkipCheck = !user || accountLoading;

  logger.debug('[ProfileGuard] Should skip check?', {
    shouldSkipCheck,
    noUser: !user,
    isProfileCreatePage,
    accountLoading
  });

  useEffect(() => {
    logger.debug('[ProfileGuard] useEffect triggered');
    logger.debug('[ProfileGuard] Dependencies:', {
      user: user?.id,
      locale,
      shouldSkipCheck,
      isProfileCreatePage,
      hasChecked,
      lastCheckedUserId
    });

    if (shouldSkipCheck) {
      logger.debug('[ProfileGuard] Skipping check (shouldSkipCheck=true)');
      setIsCheckingProfile(false);
      return;
    }

    // Reset check state if user changed
    if (user?.id && user.id !== lastCheckedUserId) {
      logger.debug('[ProfileGuard] User changed, resetting check state');
      setHasChecked(false);
      setProfileExists(null);
      setLastCheckedUserId(user.id);
      setIsCheckingProfile(true);
    }

    // Check once per user, but re-check after leaving the create page while the
    // last answer was "no profile": the profile was probably just created, and a
    // stale false would leave the user on "Redirecting to profile creation..."
    if (hasChecked && user?.id === lastCheckedUserId && !(profileExists === false && !isProfileCreatePage)) {
      logger.debug('[ProfileGuard] Already checked for this user, skipping');
      return;
    }

    const checkProfile = async () => {
      logger.debug('[ProfileGuard] Starting profile check...');
      try {
        const exists = await checkProfileExists(user);
        logger.debug('[ProfileGuard] checkProfileExists returned:', exists);
        setProfileExists(exists);
        setHasChecked(true);

        if (isProfileCreatePage) {
          // On profile create page - redirect away if profile EXISTS
          if (exists === true) {
            const homePath = `/${locale}/`;
            logger.debug('[ProfileGuard] 🚨 Profile exists on create page - REDIRECTING to:', homePath);
            router.push(homePath);
          } else {
            logger.debug('[ProfileGuard] ✅ No profile exists - allowing create page access');
          }
        } else {
          // On regular pages - redirect to create if profile DOESN'T exist
          if (exists === false) {
            const profileCreatePath = `/${locale}/profile/create`;
            logger.debug('[ProfileGuard] 🚨 No profile on regular page - REDIRECTING to:', profileCreatePath);
            router.push(profileCreatePath);
          } else {
            logger.debug('[ProfileGuard] ✅ Profile exists - allowing access to regular page');
          }
        }
      } catch (error) {
        logger.error('[ProfileGuard] ❌ Exception in checkProfile:', error);
        // On error, assume profile exists (fail-safe)
        setProfileExists(true);
        setHasChecked(true);
      } finally {
        logger.debug('[ProfileGuard] Check complete, setting isCheckingProfile=false');
        setIsCheckingProfile(false);
      }
    };

    checkProfile();
  }, [user, locale, shouldSkipCheck, isProfileCreatePage, hasChecked, lastCheckedUserId, profileExists, router]);

  const content = (() => {
    if (shouldSkipCheck) {
      logger.debug('[ProfileGuard] Rendering children (shouldSkipCheck)');
      return <>{children}</>;
    }

    if (isCheckingProfile) {
      logger.debug('[ProfileGuard] Rendering loading state');
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
      logger.debug('[ProfileGuard] Rendering redirect message (regular page, no profile)');
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
      logger.debug('[ProfileGuard] Rendering redirect message (create page, profile exists)');
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent mb-4"></div>
            <p className="text-gray-600 dark:text-gray-400">{t.profile.redirecting}</p>
          </div>
        </div>
      );
    }

    logger.debug('[ProfileGuard] Rendering children (access allowed)');
    return <>{children}</>;
  })();

  return content;
};

export default ProfileGuard;
