import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { decodeHandleSegment } from '@/lib/channel-loaders';
import { loadPublicProfile } from '@/lib/public-profile-loaders';
import { buildUserProfileMetadata } from '@/lib/user-profile-metadata';
import { notFoundMetadata } from '@/lib/seo/not-found-metadata';

interface PublicProfileLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string; handle: string }>;
}

export async function generateMetadata({ params }: Pick<PublicProfileLayoutProps, 'params'>): Promise<Metadata> {
  const { locale, handle } = await params;
  if (!isLocaleSupported(locale)) return notFoundMetadata();
  const profile = await loadPublicProfile(decodeHandleSegment(handle), locale);
  // The layout answers 404: the error page's title and its one robots meta (Next's own on a 404)
  if (!profile) return notFoundMetadata();
  return buildUserProfileMetadata(profile, locale);
}

/** The 404 is decided here, so the metadata above (notFoundMetadata for a missing profile) applies to it */
export default async function PublicProfileLayout({ children, params }: PublicProfileLayoutProps) {
  const { locale, handle } = await params;
  if (!isLocaleSupported(locale)) notFound();
  const profile = await loadPublicProfile(decodeHandleSegment(handle), locale);
  if (!profile) notFound();
  return <>{children}</>;
}
