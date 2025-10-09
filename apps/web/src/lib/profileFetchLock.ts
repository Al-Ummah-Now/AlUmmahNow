// Simple global set to track which user IDs are currently being fetched
const currentlyFetching = new Set<string>();

export const resetProfileFetch = (userId?: string) => {
  if (userId) {
    currentlyFetching.delete(userId);
  } else {
    currentlyFetching.clear();
  }
};

export const canFetchProfile = (userId: string): boolean => {
  const canFetch = !currentlyFetching.has(userId);
  return canFetch;
};

export const setProfileFetching = (userId: string) => {
  currentlyFetching.add(userId);
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