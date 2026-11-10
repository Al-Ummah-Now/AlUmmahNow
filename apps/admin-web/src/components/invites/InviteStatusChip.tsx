import type { InviteListStatus } from '@/lib/api/invite-types';
import type { Translator } from '@/i18n/translate';
import { Chip, type ChipTone } from '@/components/content/parts';

const TONE: Record<InviteListStatus, ChipTone> = {
  sending: 'info',
  failed: 'bad',
  invited: 'warn',
  active: 'good',
  expired: 'neutral',
  revoked: 'neutral',
};

/** An invite's status: invited, signed in (active), link expired, revoked, or the account still being made / failed. */
export function InviteStatusChip({ status, t, large }: { status: InviteListStatus; t: Translator; large?: boolean }) {
  return (
    <Chip tone={TONE[status]} large={large} testId={`invite-status-${status}`}>
      {t(`invites.status.${status}`)}
    </Chip>
  );
}
