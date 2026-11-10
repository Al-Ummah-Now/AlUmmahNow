'use client';
/**
 * The "Invite creator" form (docs/admin/INVITES.md). Checks the email as soon
 * as it is entered: an existing account is offered instead (give it the plan
 * or channel from its user page); an open invite links to the list. Channels:
 * new ones (name, optional @handle) and existing ones chosen with the channel
 * picker (moved to the invited user with a transfer job).
 */
import { useId, useState } from 'react';
import Link from 'next/link';
import type { AdminSuggestion } from '@al-ummah/shared-types';
import { createInvite, lookupInviteEmail } from '@/lib/api/invites';
import type { InviteLookup, InviteView } from '@/lib/api/invite-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { fieldClass, linkClass, primaryButtonClass } from '@/components/ui';
import { Autocomplete } from '@/components/search/Autocomplete';
import { ActionFeedback, useContentAction } from '@/components/content/actions';
import { Notice, SectionCard, smallButtonClass } from '@/components/content/parts';

/** One @, something before it, a dotted domain after it, no spaces; linear time (no backtracking regex). */
function isEmailAddress(value: string): boolean {
  if (value.length > 254 || /\s/.test(value)) return false;
  const at = value.indexOf('@');
  if (at < 1 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  return dot > 0 && dot < domain.length - 1;
}

interface Props {
  tiers: Array<{ id: string; name: string }>;
  canPlan: boolean;
  canCreateChannels: boolean;
  canTransfer: boolean;
}

export function InviteForm({ tiers, canPlan, canCreateChannels, canTransfer }: Props) {
  const { t } = useLanguage();
  const ids = useId();
  const { run, busy, error, message } = useContentAction();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'creator' | 'viewer'>('creator');
  const [tierId, setTierId] = useState(tiers[0]?.id ?? '');
  const [scholar, setScholar] = useState(false);
  const [locale, setLocale] = useState<'en' | 'ar'>('en');
  const [note, setNote] = useState('');
  const [days, setDays] = useState(14);
  const [newChannels, setNewChannels] = useState<Array<{ key: number; name: string; handle: string }>>([]);
  const [existing, setExisting] = useState<AdminSuggestion[]>([]);
  const [pickerRound, setPickerRound] = useState(0);
  const [lookup, setLookup] = useState<InviteLookup | null>(null);
  const [done, setDone] = useState<{ invite: InviteView; warnings: Array<{ step: string; code: string; message: string }> } | null>(null);

  async function check(value: string) {
    const normalized = value.trim().toLowerCase();
    setLookup(null);
    if (!isEmailAddress(normalized)) return;
    const result = await lookupInviteEmail(normalized);
    if (result.ok && (result.data.authUser || result.data.profile || result.data.invite)) setLookup(result.data);
  }

  const existingUser = lookup?.authUser ?? (lookup?.profile ? { id: lookup.profile.id, name: lookup.profile.displayName, email } : null);
  const blocked = !!existingUser || !!lookup?.invite;

  if (done) {
    return (
      <SectionCard title={t('invites.newTitle')} testId="invite-done">
        <p className="text-fg mb-3" role="status" data-testid="invite-created" data-user-id={done.invite.userId} data-invite-id={done.invite.id}>
          {t('invites.created')}
        </p>
        {done.warnings.length > 0 && (
          <Notice tone="warn" testId="invite-warnings">
            <p>{t('invites.warnings')}</p>
            <ul className="list-disc ps-5 text-sm">
              {done.warnings.map((w) => (
                <li key={w.step} dir="auto">{w.step}: {translateDynamic(t, 'content.errors', w.code) === w.code ? w.message : translateDynamic(t, 'content.errors', w.code)}</li>
              ))}
            </ul>
          </Notice>
        )}
        <div className="flex flex-wrap gap-4">
          <Link href={`/users/${encodeURIComponent(done.invite.userId)}`} className={linkClass} data-testid="invite-open-user">{t('invites.openUser')}</Link>
          <Link href="/users/invites" className={linkClass}>{t('invites.openInvite')}</Link>
        </div>
      </SectionCard>
    );
  }

  return (
    <form
      className="space-y-6"
      data-testid="invite-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (blocked) return;
        const data = await run(
          'invite',
          () =>
            createInvite({
              email: email.trim(),
              name: name.trim() || undefined,
              role,
              tierId: role === 'creator' && canPlan && tierId ? tierId : null,
              authRoles: scholar ? ['Scholar'] : [],
              locale,
              note: note.trim() || undefined,
              expiresInDays: days,
              channels: {
                create: newChannels.filter((ch) => ch.name.trim()).map((ch) => ({ name: ch.name.trim(), ...(ch.handle.trim() ? { handle: ch.handle.trim().replace(/^@/, '') } : {}) })),
                transfer: existing.map((ch) => ch.id),
              },
            }),
          { refresh: false }
        );
        if (data) setDone(data);
        else await check(email);
      }}
    >
      <SectionCard title={t('invites.newTitle')}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1 md:col-span-2">
            <label htmlFor={`${ids}-email`} className="text-sm text-fg-muted">{t('invites.email')}</label>
            <input
              id={`${ids}-email`}
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setLookup(null);
              }}
              onBlur={(e) => check(e.target.value)}
              dir="ltr"
              autoComplete="off"
              maxLength={254}
              aria-describedby={`${ids}-email-hint`}
              className={fieldClass}
              data-testid="invite-email"
            />
            <span id={`${ids}-email-hint`} className="text-xs text-fg-subtle">{t('invites.emailHint')}</span>
          </div>
          {existingUser && (
            <div className="md:col-span-2">
              <Notice tone="warn" testId="invite-existing-user">
                <p>{t('invites.exists', { name: existingUser.name || existingUser.email })}</p>
                <Link href={`/users/${encodeURIComponent(existingUser.id)}`} className={linkClass} data-testid="invite-existing-user-link">
                  {t('invites.existsAction')}
                </Link>
              </Notice>
            </div>
          )}
          {!existingUser && lookup?.invite && (
            <div className="md:col-span-2">
              <Notice tone="warn" testId="invite-existing-invite">
                <p>{t('invites.alreadyInvited')}</p>
                <Link href={`/users/invites?q=${encodeURIComponent(lookup.invite.id)}`} className={linkClass}>{t('invites.openInvite')}</Link>
              </Notice>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-name`} className="text-sm text-fg-muted">{t('invites.name')}</label>
            <input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} dir="auto" maxLength={100} className={fieldClass} data-testid="invite-name" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-locale`} className="text-sm text-fg-muted">{t('invites.language')}</label>
            <select id={`${ids}-locale`} value={locale} onChange={(e) => setLocale(e.target.value === 'ar' ? 'ar' : 'en')} className={fieldClass} data-testid="invite-locale">
              <option value="en">{t('invites.langEn')}</option>
              <option value="ar">{t('invites.langAr')}</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-role`} className="text-sm text-fg-muted">{t('invites.role')}</label>
            <select id={`${ids}-role`} value={role} onChange={(e) => setRole(e.target.value === 'viewer' ? 'viewer' : 'creator')} className={fieldClass} data-testid="invite-role">
              <option value="creator">{t('invites.roleCreator')}</option>
              <option value="viewer">{t('invites.roleViewer')}</option>
            </select>
          </div>
          {role === 'creator' && canPlan && (
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-plan`} className="text-sm text-fg-muted">{t('invites.plan')}</label>
              <select id={`${ids}-plan`} value={tierId} onChange={(e) => setTierId(e.target.value)} aria-describedby={`${ids}-plan-hint`} className={fieldClass} data-testid="invite-plan">
                <option value="">{t('invites.planNone')}</option>
                {tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>{tier.name}</option>
                ))}
              </select>
              <span id={`${ids}-plan-hint`} className="text-xs text-fg-subtle">{t('invites.planHint')}</span>
            </div>
          )}
          <div className="flex items-center gap-2 md:col-span-2">
            <input id={`${ids}-scholar`} type="checkbox" checked={scholar} onChange={(e) => setScholar(e.target.checked)} className="h-4 w-4" data-testid="invite-scholar" />
            <label htmlFor={`${ids}-scholar`} className="text-sm text-fg">{t('invites.scholar')}</label>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-days`} className="text-sm text-fg-muted">{t('invites.expires')}</label>
            <input id={`${ids}-days`} type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 14)))} className={fieldClass} aria-describedby={`${ids}-days-hint`} data-testid="invite-days" />
            <span id={`${ids}-days-hint`} className="text-xs text-fg-subtle">{t('invites.expiresHint')}</span>
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <label htmlFor={`${ids}-note`} className="text-sm text-fg-muted">{t('invites.note')}</label>
            <textarea id={`${ids}-note`} value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={1000} dir="auto" className={fieldClass} data-testid="invite-note" />
          </div>
        </div>
      </SectionCard>

      {(canCreateChannels || canTransfer) && (
        <SectionCard title={t('invites.channelsTitle')} testId="invite-channels">
          <div className="space-y-4">
            {newChannels.map((ch, index) => (
              <div key={ch.key} className="flex flex-col sm:flex-row sm:items-end gap-2" data-testid="invite-new-channel">
                <div className="flex flex-col gap-1 flex-1">
                  <label htmlFor={`${ids}-ch-${ch.key}`} className="text-sm text-fg-muted">{t('invites.channelName')}</label>
                  <input
                    id={`${ids}-ch-${ch.key}`}
                    value={ch.name}
                    onChange={(e) => setNewChannels((list) => list.map((c, i) => (i === index ? { ...c, name: e.target.value } : c)))}
                    dir="auto"
                    maxLength={100}
                    className={fieldClass}
                    data-testid="invite-channel-name"
                  />
                </div>
                <div className="flex flex-col gap-1 sm:w-56">
                  <label htmlFor={`${ids}-h-${ch.key}`} className="text-sm text-fg-muted">{t('invites.channelHandle')}</label>
                  <input
                    id={`${ids}-h-${ch.key}`}
                    value={ch.handle}
                    onChange={(e) => setNewChannels((list) => list.map((c, i) => (i === index ? { ...c, handle: e.target.value } : c)))}
                    dir="ltr"
                    maxLength={31}
                    className={fieldClass}
                    data-testid="invite-channel-handle"
                  />
                </div>
                <button type="button" className={smallButtonClass} onClick={() => setNewChannels((list) => list.filter((_, i) => i !== index))}>
                  {t('invites.removeChannel')}
                </button>
              </div>
            ))}
            {canCreateChannels && newChannels.length + existing.length < 10 && (
              <button type="button" className={smallButtonClass} onClick={() => setNewChannels((list) => [...list, { key: Date.now(), name: '', handle: '' }])} data-testid="invite-add-channel">
                {t('invites.addChannel')}
              </button>
            )}
            {canTransfer && (
              <div className="space-y-2">
                {existing.length > 0 && (
                  <ul className="space-y-1" data-testid="invite-existing-channels">
                    {existing.map((ch) => (
                      <li key={ch.id} className="flex items-center gap-2 text-sm" data-channel-id={ch.id}>
                        <span dir="auto" className="text-fg">{ch.label}</span>
                        {ch.secondary && <span dir="auto" className="text-fg-muted">{ch.secondary}</span>}
                        <button type="button" className={smallButtonClass} onClick={() => setExisting((list) => list.filter((c) => c.id !== ch.id))}>
                          {t('invites.removeChannel')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {newChannels.length + existing.length < 10 && (
                  <Autocomplete
                    key={pickerRound}
                    kind="channel"
                    mode="pick"
                    label={t('invites.existingChannel')}
                    hint={t('invites.transferHint')}
                    onChange={(id, item) => {
                      if (!id) return;
                      setExisting((list) => (list.some((c) => c.id === id) ? list : [...list, item ?? { kind: 'channel', id, label: id, secondary: null, imageUrl: null }]));
                      setPickerRound((n) => n + 1);
                    }}
                    testId="invite-existing-channel"
                  />
                )}
              </div>
            )}
          </div>
        </SectionCard>
      )}

      <ActionFeedback error={error} message={message} />
      <button type="submit" className={primaryButtonClass} disabled={!!busy || blocked || !isEmailAddress(email.trim().toLowerCase())} data-testid="invite-submit">
        {busy ? t('content.working') : t('invites.submit')}
      </button>
    </form>
  );
}
