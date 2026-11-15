/**
 * My channel invitations (/en/settings/channel-invites, /ar/settings/channel-invites):
 * Accept or Decline each one (docs/specs/CHANNEL-ROLES.md §14).
 */

'use client';

import { useAuth } from '@/components/AuthProvider/authContext';
import { SignInPrompt } from '@/components/common/SignInPrompt';
import ChannelInvites from '@/components/ChannelInvites';
import { useLanguage } from '@/hooks/useLanguage';

export default function ChannelInvitesPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  if (!user) return <SignInPrompt title={t.channelRoles.invitationsTitle} message={t.settings?.signInMessage || ''} />;
  return <ChannelInvites />;
}
