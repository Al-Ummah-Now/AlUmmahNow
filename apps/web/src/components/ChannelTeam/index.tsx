'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  can,
  canManageRole,
  CHANNEL_MEMBER_ROLES,
  type ChannelMemberRole,
  type ChannelRole,
} from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  addTeamMember, changeTeamRole, loadTeam, removeTeamMember,
  TeamError, type TeamErrorCode, type TeamMember, type TeamState,
} from '@/lib/channels/team';
import type { AppTranslations } from '@/lib/i18n';

interface ChannelTeamProps {
  channelId: string;
  /** The viewer's role on this channel (from the server guard) */
  role: ChannelRole;
  locale: string;
}

/** Friendly copy for a team failure; the raw error is never shown. */
export function teamErrorMessage(t: AppTranslations, error: unknown): string {
  const code: TeamErrorCode = error instanceof TeamError ? error.code : 'unknown';
  const e = t.channelRoles.errors;
  switch (code) {
    case 'person_not_found': return e.personNotFound;
    case 'already_member': return e.alreadyMember;
    case 'cannot_invite_owner': return e.cannotInviteOwner;
    case 'member_limit': return e.memberLimit;
    case 'forbidden': return e.forbidden;
    default: return e.generic;
  }
}

// `c` is the theme's card material (theme/system.css).
const CARD = 'c p-4 sm:p-6';
const FIELD = 'w-full rounded-lg border border-[var(--fanous-c-form-input-border)] bg-[var(--fanous-c-form-input-bg)] px-3 py-2 text-sm text-[var(--fanous-c-form-input-text)] focus:outline-none focus:ring-2 focus:ring-brand';
const BUTTON = 'inline-flex min-h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60';

export default function ChannelTeam({ channelId, role, locale }: ChannelTeamProps) {
  const { t } = useLanguage();
  const tr = t.channelRoles;
  const router = useRouter();
  const { user, reloadChannels } = useMultiAccount();
  const ids = { handle: useId(), role: useId(), status: useId() };

  const canView = can(role, 'members.view');
  const grantable = CHANNEL_MEMBER_ROLES.filter((r) => canManageRole(role, r));

  const [team, setTeam] = useState<TeamState | null>(null);
  const [loading, setLoading] = useState(canView);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [newRole, setNewRole] = useState<ChannelMemberRole>(grantable.includes('editor') ? 'editor' : grantable[0] ?? 'moderator');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'leave'; member: TeamMember } | null>(null);

  const nameOf = (m: TeamMember) => (m.isYou ? tr.you : m.displayName || tr.roles[m.role]);

  const refresh = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setLoadError(null);
    try {
      setTeam(await loadTeam(channelId));
    } catch (error) {
      setLoadError(error instanceof TeamError && error.code === 'forbidden' ? tr.noAccess : tr.errors.loadFailed);
    } finally {
      setLoading(false);
    }
  }, [canView, channelId, tr]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle.trim() || busy) return;
    setBusy('add');
    setMessage(null);
    try {
      const next = await addTeamMember(channelId, handle, newRole);
      setTeam(next);
      const added = next.members.find((m) => !m.isYou && m.role === newRole);
      setMessage({ kind: 'ok', text: tr.added.replace('{name}', added?.displayName || `@${handle.trim().replace(/^@+/, '')}`) });
      setHandle('');
      void reloadChannels();
    } catch (error) {
      setMessage({ kind: 'error', text: teamErrorMessage(t, error) });
    } finally {
      setBusy(null);
    }
  };

  const onChangeRole = async (member: TeamMember, next: ChannelMemberRole) => {
    if (busy || next === member.role) return;
    setBusy(member.userId);
    setMessage(null);
    try {
      setTeam(await changeTeamRole(channelId, member.userId, next));
      setMessage({ kind: 'ok', text: tr.roleSaved });
      void reloadChannels();
    } catch (error) {
      setMessage({ kind: 'error', text: teamErrorMessage(t, error) });
    } finally {
      setBusy(null);
    }
  };

  const onConfirm = async () => {
    if (!confirm) return;
    const { kind, member } = confirm;
    setConfirm(null);
    setBusy(member.userId);
    setMessage(null);
    try {
      await removeTeamMember(channelId, member.userId);
      if (kind === 'leave') {
        // The channel leaves this account's menu right away, and the page closes
        await reloadChannels();
        router.push(`/${locale}/channels/${channelId}`);
        return;
      }
      setTeam((prev) => prev && { ...prev, members: prev.members.filter((m) => m.userId !== member.userId) });
      setMessage({ kind: 'ok', text: tr.removed });
      void reloadChannels();
    } catch (error) {
      setMessage({ kind: 'error', text: teamErrorMessage(t, error) });
    } finally {
      setBusy(null);
    }
  };

  const me: TeamMember | null = user ? { userId: user.id, role, isYou: true } : null;
  const roleBadge = (r: ChannelRole) => (
    <span data-testid="team-member-role" className="c rounded-full px-2.5 py-0.5 text-xs font-medium text-[var(--fanous-color-text-secondary)]">
      {tr.roles[r]}
    </span>
  );

  return (
    <div className="space-y-6" data-testid="channel-team">
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} id={ids.status} data-testid="team-message" data-kind={message.kind}
          className={`rounded-lg px-4 py-3 text-sm ${message.kind === 'error' ? 'bg-[color-mix(in_srgb,var(--fanous-color-error-fill)_14%,var(--fanous-color-surface))] text-[var(--fanous-color-error-text)]' : 'bg-[color-mix(in_srgb,var(--fanous-color-verified-fill)_16%,var(--fanous-color-surface))] text-[var(--fanous-color-success-text)]'}`}>
          {message.text}
        </p>
      )}

      {can(role, 'members.manage') && (
        <form onSubmit={onAdd} className={CARD} data-testid="team-add-form" aria-describedby={message ? ids.status : undefined}>
          <h2 className="mb-4 text-lg font-semibold text-[var(--fanous-color-text-primary)]">{tr.addTitle}</h2>
          <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div>
              <label htmlFor={ids.handle} className="mb-1 block text-sm font-medium text-[var(--fanous-color-text-secondary)]">{tr.handleLabel}</label>
              <input id={ids.handle} dir="ltr" value={handle} onChange={(e) => setHandle(e.target.value.replace(/\s/g, ''))}
                placeholder={tr.handlePlaceholder} autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={64}
                disabled={busy === 'add'} className={FIELD} data-testid="team-add-handle" />
            </div>
            <div>
              <label htmlFor={ids.role} className="mb-1 block text-sm font-medium text-[var(--fanous-color-text-secondary)]">{tr.roleLabel}</label>
              <select id={ids.role} value={newRole} onChange={(e) => setNewRole(e.target.value as ChannelMemberRole)}
                disabled={busy === 'add'} className={FIELD} data-testid="team-add-role">
                {grantable.map((r) => <option key={r} value={r}>{tr.roles[r]}</option>)}
              </select>
            </div>
            <button type="submit" disabled={!handle.trim() || busy === 'add'} aria-busy={busy === 'add'}
              className={`${BUTTON} bg-brand text-on-brand hover:bg-brand-hover`} data-testid="team-add-submit">
              {busy === 'add' ? tr.adding : tr.add}
            </button>
          </div>
          <p className="mt-3 text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">{tr.roleHelp[newRole]}</p>
          {team && <p className="mt-1 text-xs text-[var(--fanous-color-text-muted)]">{tr.limit.replace('{count}', String(team.maxMembers))}</p>}
        </form>
      )}

      <section className={CARD} aria-labelledby="team-list-title">
        <h2 id="team-list-title" className="mb-4 text-lg font-semibold text-[var(--fanous-color-text-primary)]">{tr.team}</h2>
        {!canView && me && (
          <ul className="divide-y divide-[var(--fanous-color-divider)]">
            <li className="flex items-center gap-3 py-3" data-testid="team-member" data-role={role}>
              <span className="flex-1 text-sm font-medium text-[var(--fanous-color-text-primary)]">{tr.you}</span>
              {roleBadge(role)}
            </li>
          </ul>
        )}
        {canView && loading && <p className="text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]" role="status">{tr.teamLoading}</p>}
        {canView && loadError && (
          <div className="flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm text-[var(--fanous-color-error-text)]">{loadError}</p>
            <button type="button" onClick={() => void refresh()} className={`${BUTTON} b-primary`}>
              {t.common.retry}
            </button>
          </div>
        )}
        {canView && team && (
          <>
            <ul className="divide-y divide-[var(--fanous-color-divider)]" data-testid="team-list">
              {team.members.map((m) => {
                const manageable = m.role !== 'owner' && !m.isYou && canManageRole(role, m.role as ChannelMemberRole);
                return (
                  <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3" data-testid="team-member" data-role={m.role} data-you={m.isYou || undefined}>
                    {m.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--fanous-c-button-primary-bg)] text-sm font-semibold text-[var(--fanous-c-button-primary-text)]" aria-hidden="true">
                        {nameOf(m).charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--fanous-color-text-primary)]">
                      {nameOf(m)}{m.isYou && m.displayName ? <span className="text-[var(--fanous-color-text-muted)]"> ({m.displayName})</span> : null}
                    </span>
                    {manageable ? (
                      <select aria-label={tr.changeRole.replace('{name}', nameOf(m))} value={m.role}
                        onChange={(e) => void onChangeRole(m, e.target.value as ChannelMemberRole)}
                        disabled={busy === m.userId} className={`${FIELD} w-auto`} data-testid="team-member-role-select">
                        {CHANNEL_MEMBER_ROLES.filter((r) => canManageRole(role, r)).map((r) => <option key={r} value={r}>{tr.roles[r]}</option>)}
                      </select>
                    ) : roleBadge(m.role)}
                    {manageable && (
                      <button type="button" onClick={() => setConfirm({ kind: 'remove', member: m })} disabled={busy === m.userId}
                        className={`${BUTTON} b-danger`} data-testid="team-member-remove">
                        {tr.remove}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {team.members.length === 1 && <p className="mt-2 text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">{tr.noMembers}</p>}
          </>
        )}
      </section>

      {role !== 'owner' && me && (
        <button type="button" onClick={() => setConfirm({ kind: 'leave', member: me })} disabled={busy === me.userId}
          className={`${BUTTON} b-danger`} data-testid="team-leave">
          {tr.leave}
        </button>
      )}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[var(--fanous-c-dialog-text)]">{confirm?.kind === 'leave' ? tr.leave : tr.remove}</AlertDialogTitle>
            <AlertDialogDescription className="text-[var(--fanous-c-dialog-muted)]">
              {confirm?.kind === 'leave' ? tr.leaveConfirm : tr.removeConfirm.replace('{name}', confirm ? nameOf(confirm.member) : '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <AlertDialogCancel className="w-full sm:w-auto">{t.common.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onConfirm()} data-testid="team-confirm" className="b-danger w-full sm:w-auto">
              {confirm?.kind === 'leave' ? tr.leave : tr.remove}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
