/**
 * Channel transfer helpers (ChannelTransfer.tsx), free of React so they are unit tested:
 * a search result as an Autocomplete item, what a user is called, and the typed
 * confirmation. The picker itself is the shared Autocomplete (issue #713).
 */
import type { AdminUserSearchItem } from '@al-ummah/shared-types';
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

/** A transfer search result as the Autocomplete shows it: name, email, facts, banned users not choosable. No @handle: handles belong to channels, never users. */
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

/** Values the admin may type to confirm a transfer: the channel's @handle (with or without "@") or the new owner's email. */
export function transferConfirmValues(handle: string | null, email: string | null): string[] {
  const values: string[] = [];
  if (handle) values.push(`@${handle}`, handle);
  if (email) values.push(email);
  return values;
}

/** Whether `typed` matches one of the confirm values (emails ignore case). */
export function confirmMatches(typed: string, values: readonly string[]): boolean {
  const v = typed.trim();
  if (!v) return false;
  return values.some((value) => (value.includes('@') && !value.startsWith('@') ? value.toLowerCase() === v.toLowerCase() : value === v));
}

/**
 * Wraps a Latin value (name, email, @handle) in Unicode isolates (FSI…PDI) for
 * Arabic text, so it keeps its own order: "@handle" stays "@handle" and a
 * parenthesised email does not split across the sentence. Other locales: as is.
 */
export function bidiIsolate(value: string, locale: string): string {
  return locale === 'ar' && value ? `⁨${value}⁩` : value;
}
