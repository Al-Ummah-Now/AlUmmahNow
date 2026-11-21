import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { LayoutTab } from '@/components/studio/customisation/LayoutTab';
import { parseLayoutView } from '@/lib/studio/params';
import { getTranslations } from '@/lib/i18n';
import { requireStudioPage } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}

/** Customisation → Layout (spec §4.9): ?view=sections|tabs, moved from /settings/channel/{id}/sections and /tabs. */
export default async function StudioLayoutPage({ params, searchParams }: Props) {
  const { locale, channelId } = await params;
  const { view } = await searchParams;
  const access = await requireStudioPage(channelId, ['customisation', 'layout']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const t = getTranslations(locale as 'en' | 'ar');
  const { channel } = access;
  return (
    <>
      <h1 className="sr-only">{t.studio.nav.customisation}</h1>
      <LayoutTab locale={locale} view={parseLayoutView(view)} channel={{ id: channel.id, handle: channel.handle, userId: channel.userId }} />
    </>
  );
}
