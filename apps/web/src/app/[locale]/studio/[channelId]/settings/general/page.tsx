import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { GeneralTab } from '@/components/studio/settings/GeneralTab';
import { getTranslations } from '@/lib/i18n';
import { requireStudioPage } from '@/lib/studio/server';

/** Settings → General (spec §4.10). */
export default async function StudioGeneralPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['settings', 'general']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const t = getTranslations(locale as 'en' | 'ar');
  const { channel } = access;
  return (
    <>
      <h1 className="sr-only">{t.studio.nav.settings}</h1>
      <GeneralTab
        locale={locale}
        role={access.role}
        channel={{ id: channel.id, name: channel.name, nameLocalized: channel.nameLocalized, isMain: (channel as { isMain?: boolean }).isMain, userId: channel.userId }}
      />
    </>
  );
}
