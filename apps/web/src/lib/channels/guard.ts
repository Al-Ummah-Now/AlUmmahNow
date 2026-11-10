import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { ChannelRole } from '@al-ummah/shared-types';
import { getChannelRole } from '@/lib/channel-utils';
import { logger } from '@/lib/logger-server';
import { canOpenSettingsPage, type ChannelSettingsPage } from './permissions';

/**
 * Server guard for channel settings pages: returns the caller's channel role,
 * or sends them to the public channel page when it doesn't open `page`. The
 * role comes from the live "my channels" list, so a role granted or revoked a
 * moment ago is honoured without signing in again. The API checks every
 * write again; this only keeps people off pages they can't use.
 */
// One live-list read per request, shared by the nested settings layouts
const roleFor = cache((channelId: string) => getChannelRole(channelId));

export async function requireChannelPage(locale: string, channelId: string, page: ChannelSettingsPage): Promise<ChannelRole> {
  const role = await roleFor(channelId);
  if (!canOpenSettingsPage(role, page)) {
    logger.warn('[ChannelSettings] Redirected: role does not open this page', { channelId, role, page });
    redirect(`/${locale}/channels/${channelId}`);
  }
  return role!;
}

/** The caller's channel role (null: none), read once per request. */
export async function channelRoleForPage(channelId: string): Promise<ChannelRole | null> {
  return roleFor(channelId);
}
