import { notFound } from 'next/navigation';
import { requireChannelPage } from '@/lib/channels/guard';
import { getChannelById } from '@/lib/api/channels';
import { getTranslations } from '@/lib/i18n';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import ChannelTeam from '@/components/ChannelTeam';

interface ChannelTeamPageProps {
  params: Promise<{ locale: string; id: string }>;
}

/**
 * Channel team: who holds a channel role. The owner and channel admins see
 * and manage the team; editors and moderators see their own role and can
 * leave. Channel roles are not site roles (docs/specs/CHANNEL-ROLES.md).
 */
export default async function ChannelTeamPage({ params }: ChannelTeamPageProps) {
  const { locale, id } = await params;
  const role = await requireChannelPage(locale, id, 'team');
  const channel = await getChannelById(id);
  if (!channel) notFound();

  const t = getTranslations(locale as 'en' | 'ar');
  const displayName = channel.nameLocalized?.[locale] || channel.name;

  return (
    <div className="min-h-screen">
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <ChannelSettingsBreadcrumb channelId={id} channelName={displayName} channelHandle={channel.handle} locale={locale} currentPage="team" className="mb-6" />
        <h1 className="text-2xl font-bold text-[var(--fanous-color-text-primary)]">{t.channelRoles.team}</h1>
        <p className="mt-1 mb-6 text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">{t.channelRoles.teamDescription}</p>
        <ChannelTeam channelId={id} role={role} locale={locale} />
      </div>
    </div>
  );
}
