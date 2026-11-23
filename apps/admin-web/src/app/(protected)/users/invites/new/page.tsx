import { listCreatorTierChoices } from '@/lib/api/creators';
import { getContentPermissions } from '@/lib/api/content';
import type { AdminContentPermission } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { BackLink, Notice, PageHeader } from '@/components/content/parts';
import { InviteForm } from '@/components/invites/InviteForm';
import type { InviteVideoItems, InviteVideoValue } from '@/components/invites/InviteVideoPickers';
import { getInviteDefaultVideos } from '@/lib/api/invites';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** Invite creator: the account is made at once, with a plan and channels, before the person first signs in. */
export default async function NewInvitePage() {
  const { t, locale } = await getI18n();
  let permissions: AdminContentPermission[] | null = null;
  let tiers: Array<{ id: string; name: string; nameAr: string | null; hidden?: boolean }> = [];
  let defaultTierId = 'member';
  // The default video per language (Settings › Emails › Creator invite): prefilled, editable or clearable per invite
  let defaultVideoItems: InviteVideoItems = { en: null, ar: null };
  try {
    permissions = await getContentPermissions();
    // Every invite gives a tier: the default, or (creators:manage) another one
    const choices = await listCreatorTierChoices();
    // Lowest rank first, like everywhere tiers are listed
    tiers = [...choices.items].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).map((tier) => ({ id: tier.id, name: tier.name, nameAr: tier.nameAr ?? null, hidden: tier.hidden === true }));
    defaultTierId = choices.defaultTierId;
    defaultVideoItems = await getInviteDefaultVideos().catch((e) => {
      logger.warn('[invites] Default videos not loaded', { error: e instanceof Error ? e.message : String(e) });
      return { en: null, ar: null };
    });
  } catch (e) {
    logger.error('[invites] Failed to load the form', { error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <div>
      <BackLink href="/users/invites" label={t('content.back', { section: t('invites.title') })} />
      <PageHeader locale={locale} title={t('invites.newTitle')} subtitle={t('invites.newSubtitle')} t={t} />
      {!permissions && <ErrorAlert testId="invite-form-error">{t('content.loadFailed')}</ErrorAlert>}
      {permissions && !permissions.includes('users:manage') && <Notice tone="warn">{t('content.errors.forbidden')}</Notice>}
      {permissions?.includes('users:manage') && (
        <InviteForm
          tiers={tiers}
          defaultTierId={defaultTierId}
          canPlan={permissions.includes('creators:manage')}
          canCreateChannels={permissions.includes('channels:manage')}
          canTransfer={permissions.includes('channels:transfer')}
          defaultVideos={{ en: defaultVideoItems.en?.id ?? null, ar: defaultVideoItems.ar?.id ?? null } satisfies InviteVideoValue}
          defaultVideoItems={defaultVideoItems}
        />
      )}
    </div>
  );
}
