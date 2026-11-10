'use client';
/**
 * One invite's actions: Resend, Copy invite link (shown once in an in-app
 * dialog), Revoke (soft delete, with a reason), Restore, Delete permanently
 * now (type the email), Retry. Every destructive step confirms in an in-app
 * <dialog>; nothing uses the browser's prompts.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { InviteView } from '@/lib/api/invite-types';
import { copyInviteLink, purgeInvite, resendInvite, restoreInvite, retryInvite, revokeInvite } from '@/lib/api/invites';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { smallButtonClass } from '@/components/content/parts';

function LinkDialog({ url, onClose }: { url: string | null; onClose: () => void }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (url && !dialog.open) dialog.showModal();
    if (!url && dialog.open) dialog.close();
    setCopied(false);
  }, [url]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby={`${ids}-title`}
      aria-describedby={`${ids}-body`}
      className="bg-surface text-fg border border-border rounded-lg p-0 w-[min(36rem,calc(100vw-2rem))] backdrop:bg-fg/50"
      data-testid="invite-link-dialog"
    >
      <div className="p-6 space-y-4">
        <h2 id={`${ids}-title`} className="text-lg font-semibold">{t('invites.linkTitle')}</h2>
        <p id={`${ids}-body`} className="text-sm text-fg-muted">{t('invites.linkBody')}</p>
        <label htmlFor={`${ids}-url`} className="sr-only">{t('invites.linkTitle')}</label>
        <input id={`${ids}-url`} readOnly value={url ?? ''} dir="ltr" className={`${fieldClass} w-full font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} data-testid="invite-link-url" />
        <div className="flex flex-wrap justify-end gap-2" aria-live="polite">
          {copied && <span className="text-success-fg text-sm self-center">{t('invites.copied')}</span>}
          <button
            type="button"
            className={smallButtonClass}
            onClick={async () => {
              if (!url) return;
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                // Clipboard refused (permissions): the field is selected so the admin can copy it by hand
                document.getElementById(`${ids}-url`)?.focus();
              }
            }}
            data-testid="invite-link-copy"
          >
            {t('invites.copy')}
          </button>
          <button type="button" className={smallButtonClass} onClick={onClose}>{t('invites.close')}</button>
        </div>
      </div>
    </dialog>
  );
}

export function InviteActions({ invite, canManage }: { invite: InviteView; canManage: boolean }) {
  const { t } = useLanguage();
  const { run, busy, error, message } = useContentAction();
  const [link, setLink] = useState<string | null>(null);
  if (!canManage) return null;
  const open = invite.status === 'invited' || invite.status === 'expired';
  const revoked = !!invite.deletedAt;
  return (
    <div className="flex flex-col gap-2" data-testid="invite-actions" data-invite-id={invite.id}>
      <div className="flex flex-wrap gap-2">
        {open && (
          <>
            <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => run('resend', () => resendInvite(invite.id), { success: t('invites.resent') })} data-testid="invite-resend">
              {busy === 'resend' ? t('content.working') : t('invites.resend')}
            </button>
            <button
              type="button"
              className={smallButtonClass}
              disabled={!!busy}
              onClick={async () => {
                const data = await run('link', () => copyInviteLink(invite.id), { refresh: false });
                if (data) setLink(data.url);
              }}
              data-testid="invite-copy-link"
            >
              {busy === 'link' ? t('content.working') : t('invites.copyLink')}
            </button>
          </>
        )}
        {(invite.status === 'failed' || invite.opError) && !revoked && (
          <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => run('retry', () => retryInvite(invite.id))} data-testid="invite-retry">
            {t('invites.retry')}
          </button>
        )}
        {!revoked && invite.status !== 'active' && (
          <ConfirmButton
            label={t('invites.revoke')}
            title={t('invites.revokeTitle')}
            body={t('invites.revokeBody')}
            confirmLabel={t('invites.revoke')}
            withReason
            danger
            busy={busy === 'revoke'}
            testId="invite-revoke"
            onConfirm={(reason) => run('revoke', () => revokeInvite(invite.id, reason))}
          />
        )}
        {revoked && (
          <>
            <ConfirmButton
              label={t('invites.restore')}
              title={t('invites.restoreTitle')}
              body={t('invites.restoreBody')}
              confirmLabel={t('invites.restore')}
              busy={busy === 'restore'}
              testId="invite-restore"
              onConfirm={() => run('restore', () => restoreInvite(invite.id))}
            />
            {!invite.purgeRequestedAt && (
              <ConfirmButton
                label={t('invites.purge')}
                title={t('invites.purgeTitle')}
                body={t('invites.purgeBody')}
                confirmLabel={t('invites.purge')}
                typeToConfirm={invite.email}
                danger
                busy={busy === 'purge'}
                testId="invite-purge"
                onConfirm={() => run('purge', () => purgeInvite(invite.id, invite.email))}
              />
            )}
          </>
        )}
      </div>
      <ActionFeedback error={error} message={message} />
      <LinkDialog url={link} onClose={() => setLink(null)} />
    </div>
  );
}
