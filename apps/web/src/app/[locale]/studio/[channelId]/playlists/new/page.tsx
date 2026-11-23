import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { StudioBackLink } from '@/components/studio/StudioBackLink';
import NewPlaylistPage from '@/components/playlists/NewPlaylistPage';
import { getTranslations } from '@/lib/i18n';
import { requireStudioPage } from '@/lib/studio/server';

/** Playlists → New playlist, moved from /settings/channel/{id}/playlists/new. */
export default async function StudioNewPlaylistPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['playlists', 'new']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const t = getTranslations(locale as 'en' | 'ar');
  return (
    <div className="max-w-5xl">
      <StudioBackLink href={`/${locale}/studio/${encodeURIComponent(channelId)}/playlists`} label={t.studio.playlistsPage.back} />
      <NewPlaylistPage channelId={channelId} />
    </div>
  );
}
