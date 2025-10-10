import { User } from '@/interfaces';
import { checkProfileExists } from '@/lib/clients/profiles';

export async function shouldRedirectToProfileCreation(user: User | null): Promise<{ shouldRedirect: boolean; redirectPath: string | null }> {
  if (!user) {
    return { shouldRedirect: false, redirectPath: null };
  }

  try {
    const profileExists = await checkProfileExists(user);
    
    // If profile doesn't exist, redirect to profile creation
    if (!profileExists) {
      return { shouldRedirect: true, redirectPath: '/en/profile/create' };
    }
    
    return { shouldRedirect: false, redirectPath: null };
  } catch (error) {
    console.error('Error checking profile status:', error);
    // On error, don't redirect to avoid breaking the flow
    return { shouldRedirect: false, redirectPath: null };
  }
}

export function getProfileCreationPath(locale: 'en' | 'ar' = 'en'): string {
  return `/${locale}/profile/create`;
}