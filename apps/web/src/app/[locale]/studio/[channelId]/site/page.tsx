import { notFound } from 'next/navigation';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { SiteSettingsEditor } from '@/components/studio/site/SiteSettingsEditor';
import { SiteDomains } from '@/components/studio/site/SiteDomains';
import { requireStudioPage } from '@/lib/studio/server';
import { getStudioSite } from '@/lib/studio/site';

/** Studio → Site (wiki AUN-SCHOLAR-SITES §7.1): theme, name, logo, favicon, languages, menu, About, preview, and own domains (#1212). */
export default async function StudioSitePage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['site']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const site = await getStudioSite(channelId);
  if (!site) notFound();
  return (
    <>
      <SiteSettingsEditor locale={locale} channelId={channelId} initial={site} channelName={access.channel.nameLocalized?.[locale] || access.channel.name} />
      <div className="mt-10">
        <SiteDomains channelId={channelId} locale={locale} />
      </div>
    </>
  );
}
