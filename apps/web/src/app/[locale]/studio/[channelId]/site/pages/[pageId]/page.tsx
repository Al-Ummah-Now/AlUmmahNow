import { notFound } from 'next/navigation';
import type { SitePage } from '@al-ummah/shared-types';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { SitePageEditor } from '@/components/studio/site/SitePageEditor';
import { apiRequestServerResult, buildApiUrl } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { requireStudioPage } from '@/lib/studio/server';
import { getStudioSite } from '@/lib/studio/site';

/** Studio → Site → a page's block editor (wiki AUN-SCHOLAR-SITES §7.1 Pages, SS16). */
export default async function StudioSitePageEditorPage({ params }: { params: Promise<{ locale: string; channelId: string; pageId: string }> }) {
  const { locale, channelId, pageId } = await params;
  const access = await requireStudioPage(channelId, ['site']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const site = await getStudioSite(channelId);
  if (!site) notFound();
  const result = await apiRequestServerResult<{ page: SitePage; etag: string }>(
    { method: 'GET', url: buildApiUrl(`/api/sites/channel/${encodeURIComponent(channelId)}/pages/${encodeURIComponent(pageId)}`), functionName: 'getStudioSitePage' },
    getServerAuthContext,
    true,
  );
  if (result.status !== 200 || !result.data?.page) notFound();
  return <SitePageEditor locale={locale} channelId={channelId} siteLocales={site.site.locales} initial={result.data} />;
}
