'use client';

import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addContactNote, deleteContactMessage, replyToContactMessage, updateContactMessage } from '@/lib/api/admin';
import type { ActionResult } from '@/lib/api/errors';
import type { ContactStatus } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { EmailLanguageChoice, type EmailLanguage } from '@/components/EmailLanguageChoice';
import { translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { ConfirmButton } from '@/components/content/actions';
import { CONTACT_STATUSES } from '../filters';

interface Props {
  id: string;
  status: ContactStatus;
  locale: 'en' | 'ar';
  assignedToMe: boolean;
  hasAssignee: boolean;
}

const smallButton =
  'px-3 py-2 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';
const textareaClass = `${fieldClass} w-full resize-y`;

/** Status, assignee, spam, delete, internal note and email reply for one contact message. */
export function ContactActions({ id, status, locale, assignedToMe, hasAssignee }: Props) {
  const router = useRouter();
  const { t } = useLanguage();
  const ids = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<ContactStatus>(status);
  // The status changes under the panel (queue delivery, refresh): follow it
  useEffect(() => setNextStatus(status), [status]);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  // The reply email's one language: the sender's (the language they wrote in) until changed
  const [replyLocale, setReplyLocale] = useState<EmailLanguage>(locale);

  async function run<T>(name: string, action: () => Promise<ActionResult<T>>, after?: (data: T) => void): Promise<boolean> {
    setBusy(name);
    setError(null);
    let result: ActionResult<T>;
    try {
      result = await action();
    } catch (e) {
      logger.error('[contact] Action request failed', { id, name, error: e instanceof Error ? e.message : String(e) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(null);
    if (!result.ok) {
      logger.warn('[contact] Action failed', { id, name, status: result.status });
      setError(result.status === 401 ? t('errors.notAuthenticated') : t('contact.failed'));
      return false;
    }
    after?.(result.data);
    router.refresh();
    return true;
  }

  const isSpam = status === 'spam';

  return (
    <div className="space-y-6">
      <section className={cardClass} aria-labelledby={`${ids}-manage`} data-testid="contact-actions">
        <h2 id={`${ids}-manage`} className="text-lg font-semibold text-fg mb-4">
          {t('contact.manage')}
        </h2>
        {error && <ErrorAlert testId="contact-action-error">{error}</ErrorAlert>}

        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${ids}-status`} className="text-sm text-fg-muted">
              {t('contact.changeStatus')}
            </label>
            <select
              id={`${ids}-status`}
              value={nextStatus}
              onChange={(e) => setNextStatus(e.target.value as ContactStatus)}
              className={fieldClass}
              data-testid="contact-status-select"
            >
              {CONTACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {translateDynamic(t, 'contactStatus', s)}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={smallButton}
            disabled={!!busy || nextStatus === status}
            onClick={() => run('status', () => updateContactMessage(id, { status: nextStatus }))}
            data-testid="contact-save-status"
          >
            {busy === 'status' ? t('contact.working') : t('contact.saveStatus')}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {assignedToMe ? (
            <button type="button" className={smallButton} disabled={!!busy} onClick={() => run('assign', () => updateContactMessage(id, { assignee: null }))} data-testid="contact-unassign">
              {t('contact.unassign')}
            </button>
          ) : (
            <button type="button" className={smallButton} disabled={!!busy} onClick={() => run('assign', () => updateContactMessage(id, { assignee: 'me' }))} data-testid="contact-assign-me">
              {t('contact.assignToMe')}
            </button>
          )}
          {hasAssignee && !assignedToMe && (
            <button type="button" className={smallButton} disabled={!!busy} onClick={() => run('assign', () => updateContactMessage(id, { assignee: null }))}>
              {t('contact.unassign')}
            </button>
          )}
          <button
            type="button"
            className={smallButton}
            disabled={!!busy}
            onClick={() => run('spam', () => updateContactMessage(id, { status: isSpam ? 'open' : 'spam' }), () => setNextStatus(isSpam ? 'open' : 'spam'))}
            data-testid="contact-spam"
          >
            {isSpam ? t('contact.notSpam') : t('contact.markSpam')}
          </button>
          <ConfirmButton
            label={t('contact.delete')}
            title={t('confirmDialog.contactDeleteTitle')}
            body={t('contact.deleteConfirm')}
            confirmLabel={t('contact.delete')}
            withReason
            danger
            disabled={!!busy}
            busy={busy === 'delete'}
            testId="contact-delete"
            // The dialog keeps the ids it had before the soft delete (release spec contact.spec.ts)
            dialogTestId="contact-delete-confirm"
            onConfirm={async (reason) => {
              setBusy('delete');
              const result = await deleteContactMessage(id, reason).catch(() => ({ ok: false as const, status: 0, error: 'request failed' }));
              setBusy(null);
              if (result.ok) router.push('/contact');
              else setError(t('contact.failed'));
            }}
          />
        </div>
      </section>

      <section className={cardClass} aria-labelledby={`${ids}-reply`} data-testid="contact-reply">
        <h2 id={`${ids}-reply`} className="text-lg font-semibold text-fg mb-1">
          {t('contact.replyTitle')}
        </h2>
        <p className="text-sm text-fg-muted mb-3" id={`${ids}-reply-hint`}>
          {isSpam ? t('contact.replySpam') : t('contact.replyHint', { language: translateDynamic(t, 'contactLocale', locale) })}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const body = reply.trim();
            if (!body) return;
            await run('reply', () => replyToContactMessage(id, body, replyLocale), (data) => {
              setReply('');
              // The email is sent by the mail queue; only a failure to queue it shows here
              if (data.note.email_status === 'failed') setError(t('contact.replyNotDelivered'));
            });
          }}
        >
          <label htmlFor={`${ids}-reply-body`} className="sr-only">
            {t('contact.replyLabel')}
          </label>
          <textarea
            id={`${ids}-reply-body`}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={6}
            maxLength={10000}
            dir={replyLocale === 'ar' ? 'rtl' : 'auto'}
            disabled={isSpam}
            aria-describedby={`${ids}-reply-hint`}
            className={textareaClass}
            data-testid="contact-reply-body"
          />
          <div className="mt-3 flex flex-col gap-2">
            <EmailLanguageChoice value={replyLocale} onChange={setReplyLocale} disabled={isSpam || !!busy} testId="contact-reply-locale" />
            <button type="submit" className={`${primaryButtonClass} w-full disabled:opacity-60`} disabled={isSpam || !!busy || !reply.trim()} data-testid="contact-reply-send">
              {busy === 'reply' ? t('contact.working') : t('contact.replySend')}
            </button>
          </div>
        </form>
      </section>

      <section className={cardClass} aria-labelledby={`${ids}-note`}>
        <h2 id={`${ids}-note`} className="text-lg font-semibold text-fg mb-3">
          {t('contact.noteTitle')}
        </h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const body = note.trim();
            if (!body) return;
            await run('note', () => addContactNote(id, body), () => setNote(''));
          }}
        >
          <label htmlFor={`${ids}-note-body`} className="block text-sm text-fg-muted mb-1">
            {t('contact.noteLabel')}
          </label>
          <textarea
            id={`${ids}-note-body`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={5000}
            dir="auto"
            className={textareaClass}
            data-testid="contact-note-body"
          />
          <button type="submit" className={`${secondaryButtonClass} w-full mt-3 disabled:opacity-60`} disabled={!!busy || !note.trim()} data-testid="contact-note-add">
            {busy === 'note' ? t('contact.working') : t('contact.noteAdd')}
          </button>
        </form>
      </section>
    </div>
  );
}
