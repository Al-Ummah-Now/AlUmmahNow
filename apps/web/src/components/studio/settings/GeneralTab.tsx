'use client';

import { useEffect, useState } from 'react';
import Link from '@/components/common/AppLink';
import { can, type ChannelRole } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { DeleteChannelDialog, type DeletableChannel } from '@/components/channelManagement/DeleteChannelDialog';
import { useCreatorAccess } from '@/hooks/useCreatorAccess';
import { useLanguage } from '@/hooks/useLanguage';
import { loadTeam } from '@/lib/channels/team';
import { logger } from '@/lib/logger-client';

function Card({ title, children, tone, testId }: { title: string; children: React.ReactNode; tone?: 'danger'; testId: string }) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={tone === 'danger' ? 'rounded-xl border border-destructive/50 bg-card p-4 text-card-foreground md:p-6' : 'rounded-xl border border-border bg-card p-4 text-card-foreground md:p-6'}
    >
      <h3 className={tone === 'danger' ? 'text-base font-semibold text-[var(--fanous-color-error-text)]' : 'text-base font-semibold text-foreground'}>{title}</h3>
      <div className="mt-2 space-y-3 text-sm text-muted-foreground">{children}</div>
    </section>
  );
}

/**
 * Settings → General (spec §4.10): who owns the channel (never transferred
 * here), the upload limits that apply to it, account upload defaults, and the
 * owner-only danger zone. Leave is in the channel switcher.
 */
export function GeneralTab({ locale, role, channel }: { locale: string; role: ChannelRole; channel: DeletableChannel & { userId?: string | null } }) {
  const { t } = useLanguage();
  const text = t.studio.general;
  const isOwner = role === 'owner';
  const creator = useCreatorAccess();
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  // The owner's name for an admin (members.view); the owner needs none
  useEffect(() => {
    if (isOwner || !can(role, 'members.view')) return;
    let cancelled = false;
    loadTeam(channel.id)
      .then((team) => {
        const owner = team.members.find((m) => m.role === 'owner');
        if (!cancelled && owner?.displayName) setOwnerName(owner.displayName);
      })
      .catch((error: unknown) => logger.warn('[Studio] Owner name not loaded for General', { channelId: channel.id, error }));
    return () => {
      cancelled = true;
    };
  }, [channel.id, isOwner, role]);

  let limits: string;
  if (!isOwner) limits = text.limitsOwnerOnly;
  else if (creator.status !== 'ready') limits = '';
  else if (!creator.access.tier) limits = text.limitsNone;
  else if (!creator.access.limits) limits = text.limitsUnlimited;
  else
    limits = text.limitsTier
      .replace('{tier}', creator.access.tier.name)
      .replace('{perHour}', new Intl.NumberFormat(locale).format(creator.access.limits.perHour))
      .replace('{perDay}', new Intl.NumberFormat(locale).format(creator.access.limits.perDay));

  return (
    <div className="max-w-3xl space-y-4" data-testid="studio-settings-general">
      <h2 className="text-lg font-semibold text-foreground">{text.heading}</h2>

      <Card title={text.ownership} testId="studio-general-ownership">
        <p>
          {isOwner
            ? text.ownedByYou
            : ownerName
              ? text.ownedBy.split('{owner}').flatMap((part, i) => (i === 0 ? [part] : [<bdi key="owner" className="font-medium text-foreground">{ownerName}</bdi>, part]))
              : text.ownedBySomeone}
        </p>
        <p>{text.transferNote}</p>
      </Card>

      <Card title={text.limits} testId="studio-general-limits">
        {limits ? <p>{limits}</p> : <div role="status" aria-label={t.common.loading} className="h-5 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />}
      </Card>

      <Card title={text.uploadDefaults} testId="studio-general-upload-defaults">
        <p>{text.uploadDefaultsBody}</p>
        <Button asChild variant="outline" className="min-h-11">
          <Link href={`/${locale}/settings/upload-defaults`}>{text.uploadDefaultsLink}</Link>
        </Button>
      </Card>

      {can(role, 'channel.delete') && (
        <Card title={text.danger} tone="danger" testId="studio-general-danger">
          <p>{text.dangerBody}</p>
          <Button variant="destructive" className="min-h-11" onClick={() => setDeleteOpen(true)} data-testid="studio-delete-channel">
            {text.deleteButton}
          </Button>
          <DeleteChannelDialog channel={channel} open={deleteOpen} onOpenChange={setDeleteOpen} />
        </Card>
      )}
    </div>
  );
}
