import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { CommentsTab } from '@/components/studio/comments/CommentsTab';
import { parseCommentTab, parseCommentTarget } from '@/lib/studio/params';
import { getTranslations } from '@/lib/i18n';
import { requireStudioPage } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string }>;
  searchParams: Promise<{ tab?: string | string[]; target?: string | string[] }>;
}

/** Comments (spec §4.7): Inbox, Held for review and Removed across the channel's videos and posts. */
export default async function StudioCommentsPage({ params, searchParams }: Props) {
  const { locale, channelId } = await params;
  const { tab, target } = await searchParams;
  const access = await requireStudioPage(channelId, ['comments']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const t = getTranslations(locale as 'en' | 'ar');
  const name = access.channel.nameLocalized?.[locale as 'en' | 'ar'] || access.channel.name;
  return (
    <>
      <h1 className="sr-only">{t.studio.commentsPage.heading}</h1>
      <CommentsTab
        locale={locale}
        channel={{ id: channelId, name }}
        role={access.role}
        tab={parseCommentTab(tab)}
        target={parseCommentTarget(target)}
      />
    </>
  );
}
