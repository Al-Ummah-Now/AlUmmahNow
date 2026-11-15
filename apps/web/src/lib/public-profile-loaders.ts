import { cache } from 'react';
import { getPublicUserByHandle } from '@/lib/api/public-profile';

/** Per-request memoised profile lookup: the layout, its metadata and the page call the API once. */
export const loadPublicProfile = cache((handle: string, locale: string) => getPublicUserByHandle(handle, locale));
