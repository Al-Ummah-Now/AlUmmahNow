'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addContactNote, bulkContactMessages, replyToContactMessage, restoreContactMessages, updateContactMessage } from '@/lib/api/admin';
import type { ActionResult } from '@/lib/api/errors';
import type { ContactStatus } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { EmailLanguageChoice, type EmailLanguage } from '@/components/EmailLanguageChoice';
import { translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { CONTACT_STATUSES } from '../filters';
import { AssigneePicker } from '../AssigneePicker';
import { Select } from '@/components/select/Select';

interface Props {
  id: string;
  name: string;
  status: ContactStatus;
  /** An admin has read it (opening it reads it) */
  read: boolean;
  locale: 'en' | 'ar';
  assignedToMe: boolean;
  hasAssignee: boolean;
}

const smallButton =
  'px-3 py-2 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';
const textareaClass = `${fieldClass} w-full resize-y`;

/**
 * Read/unread, status, assignee, spam (with Undo), delete (with Undo), internal note and email reply
 * for one contact message.
 *
 * Only the control that was used shows it is working, and it keeps doing so until the refreshed page
 * shows the change (a transition around the change and router.refresh). Before (owner bug
 * 2026-11-19), one shared busy flag disabled every button and was cleared as soon as admin-api
 * answered, so all buttons flickered, the old label came back while the page was still refreshing,
 * and a second click undid the first.
 */
export function ContactActions({ id, name, status, read, locale, assignedToMe, hasAssignee }: Props) {
  const router = useRouter();
  const undoable = useUndoableAction();
  const [pickerKey, setPickerKey] = useState(0);
  const { t } = useLanguage();
  const ids = useId();
  // The control whose change is saving; `refreshing` covers the change and the page's refresh
  const [pending, setPending] = useState<string | null>(null);
  const [refreshing, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const working = (control: string) => (control === 'delete' ? deleting : refreshing && pending === control);
  // What to do once the page shows the change (the Undo toast appears with the new status, not before it)
  const whenShown = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (refreshing || !whenShown.current) return;
    const next = whenShown.current;
    whenShown.current = null;
    next();
  }, [refreshing]);
  const [error, setError] = useState<string | null>(null);
  const [nextStatus, setNextStatus] = useState<ContactStatus>(status);
  // The status changes under the panel (queue delivery, refresh): follow it
  useEffect(() => setNextStatus(status), [status]);
  const [note, setNote] = useState('');
  const [reply, setReply] = useState('');
  // The reply email's one language: the sender's (the language they wrote in) until changed
  const [replyLocale, setReplyLocale] = useState<EmailLanguage>(locale);

  /** One change; resolves true once admin-api took it (the page then refreshes), false after showing the error. */
  function run<T>(name: string, action: () => Promise<ActionResult<T>>, after?: (data: T) => void): Promise<boolean> {
    setPending(name);
    setError(null);
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        let result: ActionResult<T>;
        try {
          result = await action();
        } catch (e) {
          logger.error('[contact] Action request failed', { id, name, error: e instanceof Error ? e.message : String(e) });
          result = { ok: false, status: 0, error: 'request failed' };
        }
        if (!result.ok) {
          logger.warn('[contact] Action failed', { id, name, status: result.status });
          if (result.status === 0 || result.status >= 500) reportError(new Error(`contact ${name} failed (${result.status})`), { shown: true, status: result.status, extra: { where: 'contact-actions', action: name } });
          setError(result.status === 401 ? t('errors.notAuthenticated') : result.status === 400 && name === 'assign' ? t('contact.notStaff') : t('contact.failed'));
          resolve(false);
          return;
        }
        const data = result.data;
        // Part of the same transition: this control stays "working" until the page shows the change
        startTransition(() => {
          after?.(data);
          router.refresh();
        });
        resolve(true);
      });
    });
  }

  const isSpam = status === 'spam';

  /** Spam and Not spam at once, with Undo back to the status it had (admin UX: undo, not confirm). */
  async function toggleSpam() {
    const from = status;
    const to: ContactStatus = isSpam ? 'open' : 'spam';
    const offerUndo = () =>
      void undoable.run({
        action: async () => to,
        undo: async () => {
          const result = await updateContactMessage(id, { status: from });
          if (!result.ok) throw new Error(`undo spam ${result.status}`);
          setNextStatus(from);
          startTransition(() => router.refresh());
        },
        message: t(to === 'spam' ? 'contact.markedSpam' : 'contact.markedNotSpam'),
      });
    whenShown.current = null;
    if (await run('spam', () => updateContactMessage(id, { status: to }), () => setNextStatus(to))) whenShown.current = offerUndo;
  }

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
            <Select
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
            </Select>
          </div>
          <button
            type="button"
            className={smallButton}
            disabled={working('status') || nextStatus === status}
            aria-busy={working('status') || undefined}
            onClick={() => run('status', () => updateContactMessage(id, { status: nextStatus }))}
            data-testid="contact-save-status"
          >
            {working('status') ? t('contact.working') : t('contact.saveStatus')}
          </button>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          <button
            type="button"
            className={smallButton}
            disabled={working('read')}
            aria-busy={working('read') || undefined}
            onClick={() => run('read', () => updateContactMessage(id, { read: !read }))}
            data-testid={read ? 'contact-mark-unread' : 'contact-mark-read'}
          >
            {working('read') ? t('contact.working') : read ? t('contact.markUnread') : t('contact.markRead')}
          </button>
        </div>

        <div className="mb-4 min-w-0">
          <AssigneePicker
            key={pickerKey}
            testId="contact-assignee-picker"
            disabled={working('assign')}
            onPick={async (assignee) => {
              if (await run('assign', () => updateContactMessage(id, { assignee }))) setPickerKey((k) => k + 1);
            }}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {assignedToMe ? (
            <button type="button" className={smallButton} disabled={working('assign')} aria-busy={working('assign') || undefined} onClick={() => run('assign', () => updateContactMessage(id, { assignee: null }))} data-testid="contact-unassign">
              {working('assign') ? t('contact.working') : t('contact.unassign')}
            </button>
          ) : (
            <button type="button" className={smallButton} disabled={working('assign')} aria-busy={working('assign') || undefined} onClick={() => run('assign', () => updateContactMessage(id, { assignee: 'me' }))} data-testid="contact-assign-me">
              {working('assign') ? t('contact.working') : t('contact.assignToMe')}
            </button>
          )}
          {hasAssignee && !assignedToMe && (
            <button type="button" className={smallButton} disabled={working('assign')} onClick={() => run('assign', () => updateContactMessage(id, { assignee: null }))}>
              {t('contact.unassign')}
            </button>
          )}
          <button
            type="button"
            className={smallButton}
            disabled={working('spam')}
            aria-busy={working('spam') || undefined}
            onClick={toggleSpam}
            data-testid="contact-spam"
          >
            {working('spam') ? t('contact.working') : isSpam ? t('contact.notSpam') : t('contact.markSpam')}
          </button>
          <button
            type="button"
            className={`${smallButton} text-danger-fg`}
            disabled={deleting}
            aria-busy={deleting || undefined}
            data-testid="contact-delete"
            onClick={async () => {
              // At once, with Undo (owner 2026-11-15); it also stays in Recently deleted for 30 days
              setDeleting(true);
              setError(null);
              try {
                await undoable.run({
                  action: async () => {
                    const result = await bulkContactMessages([id], { delete: true });
                    if (!result.ok || !result.data.ok.length) throw new Error('delete failed');
                    return result.data.ok;
                  },
                  undo: async (done) => {
                    await restoreContactMessages(done);
                    router.refresh();
                  },
                  message: t('contact.deletedNamed', { name }),
                  undoneMessage: t('contact.restored'),
                });
                router.push('/contact');
              } catch (e) {
                logger.warn('[contact] Delete failed', { id, error: e instanceof Error ? e.message : String(e) });
                setError(t('contact.failed'));
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? t('contact.working') : t('contact.delete')}
          </button>
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
            <EmailLanguageChoice value={replyLocale} onChange={setReplyLocale} disabled={isSpam || working('reply')} testId="contact-reply-locale" />
            <button type="submit" className={`${primaryButtonClass} w-full disabled:bg-surface-2 disabled:text-fg-muted disabled:border disabled:border-border disabled:cursor-not-allowed`} disabled={isSpam || working('reply') || !reply.trim()} aria-busy={working('reply') || undefined} data-testid="contact-reply-send">
              {working('reply') ? t('contact.working') : t('contact.replySend')}
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
          <button type="submit" className={`${secondaryButtonClass} w-full mt-3 disabled:text-fg-muted disabled:cursor-not-allowed`} disabled={working('note') || !note.trim()} aria-busy={working('note') || undefined} data-testid="contact-note-add">
            {working('note') ? t('contact.working') : t('contact.noteAdd')}
          </button>
        </form>
      </section>
    </div>
  );
}
