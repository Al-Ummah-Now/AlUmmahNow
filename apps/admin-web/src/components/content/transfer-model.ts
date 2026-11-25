/**
 * Channel transfer helpers (ChannelTransfer.tsx), free of React so they are unit tested:
 * a search result as an Autocomplete item, what a user is called, and the typed
 * confirmation. The picker itself is the shared Autocomplete (issue #713).
 */
import { OFFICIAL_CHANNEL_HANDLES, isolateText, stripBidiControls, type AdminUserSearchItem } from '@al-ummah/shared-types';
import type { MessageKey, Translator } from '@/i18n/translate';
import type { AutocompleteItem } from '@/components/search/autocomplete-model';
import { adminUserName } from '@/lib/user-name';

/** What the user is called in the confirm dialog and status lines. */
export const userName = (user: Pick<AdminUserSearchItem, 'displayName' | 'userName' | 'email' | 'id'>) => adminUserName(user);

/** "Owns 2 channels · Channel editor here" (or banned). */
export function userMeta(user: AdminUserSearchItem, t: Translator): string {
  const parts = [
    user.channelCount === 0 ? t('channels.pickerOwnsNone') : user.channelCount === 1 ? t('channels.pickerOwnsOne') : t('channels.pickerOwnsMany', { count: user.channelCount }),
  ];
  if (user.channelRole) {
    const key = `channels.memberRoles.${user.channelRole}` as MessageKey;
    const role = t(key);
    parts.push(t('channels.pickerRole', { role: role === key ? user.channelRole : role }));
  }
  if (user.isBanned) parts.push(t('channels.pickerBanned'));
  return parts.join(t('common.sep'));
}

/** A transfer search result as the Autocomplete shows it: name, account email (the box adds the user id), facts, banned users not choosable. No @handle: handles belong to channels, never users. */
export function transferItem(user: AdminUserSearchItem, t: Translator): AutocompleteItem {
  const name = userName(user);
  const email = user.email || t('channels.pickerNoEmail');
  return {
    kind: 'user',
    id: user.id,
    label: name,
    secondary: email,
    imageUrl: user.avatarUrl ?? null,
    badge: user.invite && user.invite.status !== 'active' && user.invite.status !== 'revoked' ? 'invited' : null,
    meta: userMeta(user, t),
    disabled: !!user.isBanned,
  };
}

/** Whether the channel's handle is one of the site's official names. */
export const isOfficialHandle = (handle: string | null): boolean => !!handle && (OFFICIAL_CHANNEL_HANDLES as readonly string[]).includes(handle.toLowerCase());

/** An official handle goes to someone outside the site team only with a tick of its own (wiki AUN-CHANNEL-CLAIM §3.5). */
export const needsOfficialTick = (handle: string | null, to: Pick<AdminUserSearchItem, 'isStaff'> | null): boolean => isOfficialHandle(handle) && !!to && to.isStaff !== true;

/** Values the admin may type to confirm a transfer: the channel's @handle (with or without "@") or the new owner's user id. */
export function transferConfirmValues(handle: string | null, userId: string): string[] {
  return handle ? [`@${handle}`, handle, userId] : [userId];
}

/** Whether `typed` matches one of the confirm values (exactly, spaces around it aside). */
export function confirmMatches(typed: string, values: readonly string[]): boolean {
  // Pasted from the label, the value brings its isolates
  const v = stripBidiControls(typed).trim();
  return !!v && values.includes(v);
}

/**
 * Wraps a value (name, user id, @handle) in Unicode isolates (FSI…PDI), so either script keeps its own order
 * in the other: "@handle" stays "@handle" and a parenthesised id does not split across the sentence. Direction
 * controls in the value go.
 */
export function bidiIsolate(value: string): string {
  return value ? isolateText(value) : '';
}
