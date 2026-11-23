import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { ProfileTab } from '@/components/studio/customisation/ProfileTab';
import { getTranslations } from '@/lib/i18n';
import { requireStudioPage } from '@/lib/studio/server';

/** Customisation → Profile (spec §4.9), moved from /settings/channel/{id}/edit. */
export default async function StudioProfilePage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['customisation', 'profile']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const t = getTranslations(locale as 'en' | 'ar');
  return (
    <>
      <h1 className="sr-only">{t.studio.nav.customisation}</h1>
      <ProfileTab channelId={channelId} role={access.role} />
    </>
  );
}
