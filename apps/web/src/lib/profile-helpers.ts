import { User } from '@/interfaces';
import { checkProfileExists } from '@/lib/api/profiles-client';
import { logger } from '@/lib/logger-server';


export async function shouldRedirectToProfileCreation(user: User | null): Promise<{ shouldRedirect: boolean; redirectPath: string | null }> {
  if (!user) {
    return { shouldRedirect: false, redirectPath: null };
  }

  try {
    const profileExists = await checkProfileExists(user);
    
    // If profile doesn't exist, redirect to profile creation
    if (!profileExists) {
      return { shouldRedirect: true, redirectPath: '/ar/profile/create' };
    }
    
    return { shouldRedirect: false, redirectPath: null };
  } catch (error) {
    logger.error('Error checking profile status:', error);
    // On error, don't redirect to avoid breaking the flow
    return { shouldRedirect: false, redirectPath: null };
  }
}

export function getProfileCreationPath(locale: 'en' | 'ar' = 'ar'): string {
  return `/${locale}/profile/create`;
}