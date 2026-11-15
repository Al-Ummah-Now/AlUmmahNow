import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import ChannelTeam from '@/components/ChannelTeam';
import { getTranslations } from '@/lib/i18n';
import { requireStudioPage } from '@/lib/studio/server';

/**
 * Settings → Permissions (spec §4.10): who works on this channel, moved from
 * /settings/channel/{id}/team. Channel roles live on the videos side, never
 * in Auth RBAC. Ownership is never transferred here.
 */
export default async function StudioPermissionsPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['settings', 'permissions']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const t = getTranslations(locale as 'en' | 'ar');
  return (
    <div className="max-w-3xl">
      <h1 className="sr-only">{t.studio.nav.settings}</h1>
      <h2 className="text-lg font-semibold text-foreground">{t.channelRoles.team}</h2>
      <p className="mb-6 mt-1 text-sm text-muted-foreground">{t.channelRoles.teamDescription}</p>
      <ChannelTeam channelId={channelId} role={access.role} locale={locale} />
    </div>
  );
}
