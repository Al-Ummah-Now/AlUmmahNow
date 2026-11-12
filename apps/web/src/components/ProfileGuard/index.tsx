'use client';
import { logger } from '@/lib/logger-client';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { checkProfileExists } from '@/lib/api/profiles-client';
import { getVideosBanStatus } from '@/lib/api/profiles';
import { VideosBannedNotice } from '@/components/VideosNotices';
import { useLanguage } from '@/hooks/useLanguage';

// Whether a user has a profile almost never changes once it exists, so it is
// remembered per user. Pages then render immediately and the check re-runs in
// the background instead of hiding the page behind a ~1s Server Action.
const PROFILE_KNOWN_KEY = (userId: string) => `aun_profile_exists_${userId}`;

function isProfileKnown(userId: string): boolean {
  try {
    return localStorage.getItem(PROFILE_KNOWN_KEY(userId)) === '1';
  } catch {
    return false;
  }
}

function rememberProfile(userId: string, exists: boolean): void {
  try {
    if (exists) localStorage.setItem(PROFILE_KNOWN_KEY(userId), '1');
    else localStorage.removeItem(PROFILE_KNOWN_KEY(userId));
  } catch {
    // Storage unavailable: the check simply runs blocking next time
  }
}

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
  const childrenShownRef = useRef(false);
  // Banned on videos (admin): no profile flow, a notice instead (Auth is not affected)
  const [ban, setBan] = useState<{ reason: string | null } | null>(null);

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

    // Re-check when the user changes. The first check shows the loading
    // state; later re-checks run in the background so the page below is not
    // unmounted (which discarded in-progress form state, e.g. after a server
    // action refreshed the session).
    if (user?.id && user.id !== lastCheckedUserId) {
      logger.debug('[ProfileGuard] User changed, resetting check state');
      setHasChecked(false);
      setLastCheckedUserId(user.id);
      if (profileExists !== true) {
        if (isProfileKnown(user.id)) {
          // Known to exist: show the page now, re-check in the background
          setProfileExists(true);
          setIsCheckingProfile(false);
        } else {
          setProfileExists(null);
          setIsCheckingProfile(true);
        }
      }
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
        if (!exists) {
          // GET /api/profile also answers "no profile" for a banned user: tell them apart
          const status = await getVideosBanStatus();
          if (status.banned) {
            logger.debug('[ProfileGuard] User is banned on videos; showing the notice instead of the profile flow');
            setBan({ reason: status.reason });
            setProfileExists(true);
            setHasChecked(true);
            return;
          }
        }
        setBan(null);
        if (user?.id) rememberProfile(user.id, exists);
        logger.debug('[ProfileGuard] checkProfileExists returned:', exists);
        setProfileExists(exists);
        setHasChecked(true);

        if (isProfileCreatePage) {
          // On profile create page with a profile: the effect below sends the user home
          logger.debug('[ProfileGuard] Profile on create page?', exists);
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

  // On the create page with a profile: home. Whenever that is the state, not only
  // right after the check: the URL can come back to /profile/create after the
  // check sent the user home (a server action from the page being left, e.g.
  // around an account switch, lets Next write the old URL back), and the page
  // then sat on "Redirecting..." for good.
  // The answer must be this user's: right after an account switch the state still holds the last one's
  const sendHome = !shouldSkipCheck && hasChecked && user?.id === lastCheckedUserId && !ban && isProfileCreatePage && profileExists === true;
  useEffect(() => {
    if (!sendHome) return;
    const homePath = `/${locale}/`;
    logger.debug('[ProfileGuard] Profile exists on create page - redirecting to:', homePath);
    router.push(homePath);
  }, [sendHome, pathname, locale, router]);

  const content = (() => {
    if (shouldSkipCheck) {
      logger.debug('[ProfileGuard] Rendering children (shouldSkipCheck)');
      childrenShownRef.current = true;
      return <>{children}</>;
    }

    // While the session loads the page is already rendered (above); keep it
    // mounted during the profile check instead of swapping in the spinner,
    // which unmounted it and discarded anything the user had started (e.g. a
    // selected upload file). A missing profile still redirects below.
    if (isCheckingProfile && !childrenShownRef.current) {
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

    // Banned on videos: the notice, and no profile form (creating one would be refused)
    if (ban) {
      return (
        <>
          <VideosBannedNotice reason={ban.reason} />
          {!isProfileCreatePage && children}
        </>
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
    return (
      <>{children}</>
    );
  })();

  return content;
};

export default ProfileGuard;
