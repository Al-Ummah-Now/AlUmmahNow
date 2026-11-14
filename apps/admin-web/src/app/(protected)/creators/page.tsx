import { permanentRedirect } from 'next/navigation';
import { creatorsToUsersHref } from '@/lib/creator-tiers';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The Creators page folded into Users (a tier is a property of a user): old
 * links land on the Users list with the same search, tier filter and page.
 */
export default async function OldCreatorsPage({ searchParams }: PageProps) {
  permanentRedirect(creatorsToUsersHref(await searchParams));
}
