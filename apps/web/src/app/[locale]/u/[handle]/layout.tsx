import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { decodeHandleSegment } from '@/lib/channel-loaders';
import { loadPublicProfile } from '@/lib/public-profile-loaders';
import { PROFILE_ROBOTS, buildUserProfileMetadata } from '@/lib/user-profile-metadata';

interface PublicProfileLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string; handle: string }>;
}

/** No public profile: a real 404, never indexed (profiles themselves are never indexed either) */
const NOINDEX: Metadata = { robots: PROFILE_ROBOTS };

export async function generateMetadata({ params }: Pick<PublicProfileLayoutProps, 'params'>): Promise<Metadata> {
  const { locale, handle } = await params;
  if (!isLocaleSupported(locale)) return NOINDEX;
  const profile = await loadPublicProfile(decodeHandleSegment(handle), locale);
  if (!profile) return NOINDEX;
  return buildUserProfileMetadata(profile, locale);
}

/** The 404 is decided here, so the page's metadata above applies to it (one robots tag) */
export default async function PublicProfileLayout({ children, params }: PublicProfileLayoutProps) {
  const { locale, handle } = await params;
  if (!isLocaleSupported(locale)) notFound();
  const profile = await loadPublicProfile(decodeHandleSegment(handle), locale);
  if (!profile) notFound();
  return <>{children}</>;
}
