// Simple global set to track which user IDs are currently being fetched
const currentlyFetching = new Set<string>();

export const resetProfileFetch = (userId?: string) => {
  if (userId) {
    currentlyFetching.delete(userId);
    console.log('profileFetchLock: Reset lock for user:', userId);
  } else {
    currentlyFetching.clear();
    console.log('profileFetchLock: Reset all locks');
  }
};

export const canFetchProfile = (userId: string): boolean => {
  const canFetch = !currentlyFetching.has(userId);
  console.log('profileFetchLock: Can fetch for user', userId, '?', canFetch);
  return canFetch;
};

export const setProfileFetching = (userId: string) => {
  currentlyFetching.add(userId);
  console.log('profileFetchLock: Set fetching for user:', userId);
};

export const isCurrentlyFetching = (userId?: string): boolean => {
  if (userId) {
    return currentlyFetching.has(userId);
  }
  return currentlyFetching.size > 0;
};

export const getCurrentFetchingUserIds = (): string[] => {
  return Array.from(currentlyFetching);
};