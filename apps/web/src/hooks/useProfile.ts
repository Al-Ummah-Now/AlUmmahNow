import { useState, useEffect, useRef } from 'react';
import { Profile, User } from '@/interfaces';
import { fetchProfile } from '@/lib/api/profiles-client';

export const useProfile = (user: User | null) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Track the last user we fetched for to prevent duplicates
  const lastFetchedUserId = useRef<string | null>(null);
  const isFetching = useRef<boolean>(false);

  useEffect(() => {
    // Clear state if no user
    if (!user || !user.id) {
      setProfile(null);
      setError(null);
      setIsLoading(false);
      lastFetchedUserId.current = null;
      isFetching.current = false;
      return;
    }

    // Skip if already fetched for this user or currently fetching
    if (lastFetchedUserId.current === user.id || isFetching.current) {
      return;
    }

    // Mark as fetching and set the user ID
    lastFetchedUserId.current = user.id;
    isFetching.current = true;
    setIsLoading(true);
    setError(null);

    // Call the actual API
    fetchProfile(user, (newProfile) => {
      console.log('useProfile: ✅ Profile received from API');
      setProfile(newProfile);
    }).then(success => {
      if (!success) {
        console.log('useProfile: ⚠️ API call failed, creating fallback profile');
        // Create fallback profile if API fails
        setProfile({
          id: user.id,
          email: user.email,
          firstName: user.email?.split('@')[0] || 'User',
          lastName: '',
          avatarUrl: '/avatar.png',
          coverUrl: undefined
        });
        setError(null); // Don't show error, just use fallback
      }
    }).catch(err => {
      console.error('useProfile: ❌ Error calling API:', err);
      // Create fallback profile on error
      setProfile({
        id: user.id,
        email: user.email,
        firstName: user.email?.split('@')[0] || 'User',
        lastName: '',
        avatarUrl: '/avatar.png',
        coverUrl: undefined
      });
      setError(null); // Don't show error, just use fallback
    }).finally(() => {
      setIsLoading(false);
      isFetching.current = false;
    });

  }, [user]);

  return { profile, isLoading, error };
};