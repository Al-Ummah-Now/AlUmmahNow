import { listCreatorTiers } from '@/lib/api/creators';
import { getContentPermissions } from '@/lib/api/content';
import type { AdminContentPermission } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import { ErrorAlert } from '@/components/ui';
import { BackLink, Notice, PageHeader } from '@/components/content/parts';
import { InviteForm } from '@/components/invites/InviteForm';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** Invite creator: the account is made at once, with a plan and channels, before the person first signs in. */
export default async function NewInvitePage() {
  const { t } = await getI18n();
  let permissions: AdminContentPermission[] | null = null;
  let tiers: Array<{ id: string; name: string }> = [];
  try {
    permissions = await getContentPermissions();
    if (permissions.includes('creators:manage')) tiers = (await listCreatorTiers()).items.map((tier) => ({ id: tier.id, name: tier.name }));
  } catch (e) {
    logger.error('[invites] Failed to load the form', { error: e instanceof Error ? e.message : String(e) });
  }
  return (
    <div>
      <BackLink href="/users/invites" label={t('content.back', { section: t('invites.title') })} />
      <PageHeader title={t('invites.newTitle')} subtitle={t('invites.newSubtitle')} t={t} />
      {!permissions && <ErrorAlert testId="invite-form-error">{t('content.loadFailed')}</ErrorAlert>}
      {permissions && !permissions.includes('users:manage') && <Notice tone="warn">{t('content.errors.forbidden')}</Notice>}
      {permissions?.includes('users:manage') && (
        <InviteForm
          tiers={tiers}
          canPlan={permissions.includes('creators:manage')}
          canCreateChannels={permissions.includes('channels:manage')}
          canTransfer={permissions.includes('channels:transfer')}
        />
      )}
    </div>
  );
}
