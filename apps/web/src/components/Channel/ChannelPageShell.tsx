import type { Channel } from '@al-ummah/shared-types';
import { ChannelHeader as ChannelHeaderLTR } from '@/components/Channel/ChannelHeader';
import { ChannelHeader as ChannelHeaderRTL } from '@/components/Channel/rtl/ChannelHeader';
import { ChannelTabBar } from '@/components/ChannelTabs';
import { getTextDirection } from '@/lib/i18n/utils';
import { ChannelViewerProvider } from '@/components/Channel/ChannelViewerContext';
import { getTranslations } from '@/lib/i18n';
import { scholarSlugForChannel } from '@/lib/scholars/lookup';
import { deriveWwwUrl, scholarPageUrl } from '@/lib/scholars/sites';

interface ChannelPageShellProps {
  channel: Channel;
  locale: string;
  isOwner: boolean;
  children: React.ReactNode;
}

/**
 * Channel page chrome shared by /[locale]/channels/[id] and the @handle route
 * (/[locale]/@{handle}, served by /[locale]/c/[handle]): header (banner,
 * avatar, name, @handle, subscribe or owner actions), tab bar and content.
 */
export async function ChannelPageShell({ channel, locale, isOwner, children }: ChannelPageShellProps) {
  const isRTL = getTextDirection(locale) === 'rtl';
  const ChannelHeader = isRTL ? ChannelHeaderRTL : ChannelHeaderLTR;
  // A scholar's channel links to their page on www (articles + videos, AlUmmahNowCMS docs/SCHOLARS.md)
  const www = deriveWwwUrl(process.env.OPENAUTH_ISSUER || process.env.Issuer, process.env.WWW_URL);
  const scholarSlug = www ? await scholarSlugForChannel(channel.id) : null;
  const t = getTranslations(locale as 'en' | 'ar');

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Channel Header (banner, avatar, name, subscribe / owner actions) */}
      <ChannelHeader channel={channel} locale={locale} isOwner={isOwner} />
      {scholarSlug ? (
        <div className="container mx-auto px-4 pt-3">
          <a
            href={scholarPageUrl(www, locale, scholarSlug)}
            data-testid="channel-scholar-page"
            className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fanous-color-link)] hover:underline"
          >
            {t.navigation.scholarPage}
            <span aria-hidden="true" className="rtl:rotate-180">→</span>
          </a>
        </div>
      ) : null}

      {/* Channel Tabs - Query param-based with database config */}
      <ChannelTabBar channelId={channel.id} isOwner={isOwner} />

      {/* Tab Content */}
      <div className="container mx-auto px-4 py-6">
        <ChannelViewerProvider channelId={channel.id} isOwner={isOwner}>{children}</ChannelViewerProvider>
      </div>
    </div>
  );
}
