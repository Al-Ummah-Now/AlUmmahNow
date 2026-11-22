'use client';

/**
 * My channel invitations (/settings/channel-invites, docs/specs/CHANNEL-ROLES.md §14):
 * each invitation with the channel, who sent it, the role and what it allows,
 * and Accept / Decline. Reached from the invitation notification and the
 * account menu's invitation count. Logical properties only, so Arabic mirrors.
 */

import { useCallback, useEffect, useState } from 'react';
import type { MyChannelInvite } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { acceptInvite, daysUntil, declineInvite, loadMyInvites } from '@/lib/channels/team';
import { teamErrorMessage } from '@/lib/channels/team-errors';
import { CHANNEL_INVITES_CHANGED } from '@/lib/channels/invites-count';
import { pluralText } from '@/lib/notifications/toast-queue';
import { avatarInitial } from '@/lib/avatar-initial';

const CARD = 'c p-4 sm:p-6';
const BUTTON = 'inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';

export default function ChannelInvites() {
  const { t, lang } = useLanguage();
  const tr = t.channelRoles;
  const { reloadChannels } = useMultiAccount();
  const [invites, setInvites] = useState<MyChannelInvite[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; channelId?: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(false);
    try {
      setInvites(await loadMyInvites());
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const channelName = (invite: MyChannelInvite) => invite.channel.nameLocalized?.[lang] || invite.channel.name;
  const settled = (id: string) => {
    setInvites((prev) => prev && prev.filter((i) => i.id !== id));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANNEL_INVITES_CHANGED));
  };

  const respond = async (invite: MyChannelInvite, action: 'accept' | 'decline') => {
    if (busy) return;
    setBusy(invite.id);
    setMessage(null);
    try {
      if (action === 'accept') {
        const { role } = await acceptInvite(invite.id);
        settled(invite.id);
        setMessage({ kind: 'ok', text: tr.accepted.replace('{channel}', channelName(invite)).replace('{role}', tr.roles[role]), channelId: invite.channel.id });
        // The channel now shows under "Channels you manage"
        void reloadChannels();
      } else {
        await declineInvite(invite.id);
        settled(invite.id);
        setMessage({ kind: 'ok', text: tr.declined });
      }
    } catch (error) {
      setMessage({ kind: 'error', text: teamErrorMessage(t, error) });
      // A closed or expired invitation leaves the list
      void refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen">
      <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6" data-testid="channel-invites">
        <div>
          <h1 className="text-2xl font-bold text-[var(--fanous-color-text-primary)]">{tr.invitationsTitle}</h1>
          <p className="mt-1 text-[var(--fanous-color-text-secondary)]">{tr.invitationsDescription}</p>
        </div>

        {message && (
          <div role={message.kind === 'error' ? 'alert' : 'status'} data-testid="invites-message" data-kind={message.kind}
            className={`flex flex-wrap items-center gap-3 rounded-lg px-4 py-3 text-sm ${message.kind === 'error' ? 'bg-[color-mix(in_srgb,var(--fanous-color-error-fill)_14%,var(--fanous-color-surface))] text-[var(--fanous-color-error-text)]' : 'bg-[color-mix(in_srgb,var(--fanous-color-verified-fill)_16%,var(--fanous-color-surface))] text-[var(--fanous-color-success-text)]'}`}>
            <span className="flex-1">{message.text}</span>
            {message.channelId && (
              <Link href={`/${lang}/channels/${message.channelId}`} className="font-semibold underline" data-testid="invites-open-channel">{tr.openChannel}</Link>
            )}
          </div>
        )}

        {invites === null && !loadError && <p className="text-sm text-[var(--fanous-color-text-secondary)]" role="status">{tr.invitationsLoading}</p>}
        {loadError && (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm text-[var(--fanous-color-error-text)]">{tr.errors.loadFailed}</p>
            <button type="button" onClick={() => void refresh()} className={`${BUTTON} b-primary`}>{t.common.retry}</button>
          </div>
        )}
        {invites && invites.length === 0 && (
          <p className={`${CARD} text-sm text-[var(--fanous-color-text-secondary)]`} data-testid="invites-empty">{tr.noInvitations}</p>
        )}
        {invites && invites.length > 0 && (
          <ul className="space-y-4" data-testid="invites-list">
            {invites.map((invite) => {
              const name = channelName(invite);
              const days = daysUntil(invite.expiresAt);
              return (
                <li key={invite.id} className={CARD} data-testid="channel-invite" data-channel={invite.channel.id} data-role={invite.role}>
                  <div className="flex items-start gap-4">
                    {invite.channel.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={invite.channel.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--fanous-c-button-primary-bg)] text-lg font-semibold text-[var(--fanous-c-button-primary-text)]" aria-hidden="true">
                        {avatarInitial(name, invite.channel.handle)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-lg font-semibold text-[var(--fanous-color-text-primary)]" dir="auto">{name}</h2>
                      {invite.channel.handle && <p className="text-sm text-[var(--fanous-color-text-muted)]" dir="ltr">@{invite.channel.handle}</p>}
                      <p className="mt-2 text-sm text-[var(--fanous-color-text-primary)]">
                        {tr.invitedBy.replace('{inviter}', invite.invitedBy.displayName || tr.someone).replace('{role}', tr.roles[invite.role])}
                      </p>
                      <p className="mt-1 text-sm text-[var(--fanous-color-text-secondary)]">{tr.roleHelp[invite.role]}</p>
                      <p className="mt-1 text-xs text-[var(--fanous-color-text-muted)]">
                        {days > 0 ? pluralText(tr.expiresIn, days, lang) : tr.expiresToday}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2">
                    <button type="button" onClick={() => void respond(invite, 'decline')} disabled={busy === invite.id}
                      className={`${BUTTON} b-secondary`} data-testid="invite-decline">{tr.decline}</button>
                    <button type="button" onClick={() => void respond(invite, 'accept')} disabled={busy === invite.id} aria-busy={busy === invite.id}
                      className={`${BUTTON} bg-brand text-on-brand hover:bg-brand-hover`} data-testid="invite-accept">{tr.accept}</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
