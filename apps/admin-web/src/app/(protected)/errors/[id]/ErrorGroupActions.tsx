'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ErrorStatus } from '@al-ummah/shared-types';
import { addErrorGroupNote, deleteTestErrorGroup, updateErrorGroup } from '@/lib/api/admin';
import type { ActionResult } from '@/lib/api/errors';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import type { GroupAction } from '../permissions';

const smallButton =
  'px-3 py-2 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

const STATUS_ACTIONS: { action: GroupAction; status: ErrorStatus; label: MessageKey }[] = [
  { action: 'acknowledge', status: 'acknowledged', label: 'errorsPage.acknowledge' },
  { action: 'resolve', status: 'resolved', label: 'errorsPage.resolve' },
  { action: 'ignore', status: 'ignored', label: 'errorsPage.ignore' },
  { action: 'reopen', status: 'new', label: 'errorsPage.reopen' },
];

/** Status, assignment and notes for one error group. Only rendered with errors:manage (admin-api enforces it too). */
export function ErrorGroupActions({ id, actions, testRef = null }: { id: string; actions: GroupAction[]; /** A reference of a test group: offers Delete test group */ testRef?: string | null }) {
  const router = useRouter();
  const { t } = useLanguage();
  const ids = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function run(name: string, action: () => Promise<ActionResult<unknown>>): Promise<boolean> {
    setBusy(name);
    setError(null);
    let result: ActionResult<unknown>;
    try {
      result = await action();
    } catch (e) {
      logger.error('[errors] Action request failed', { id, name, error: e instanceof Error ? e.message : String(e) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(null);
    if (!result.ok) {
      logger.warn('[errors] Action failed', { id, name, status: result.status });
      setError(result.status === 401 ? t('errors.notAuthenticated') : t('errorsPage.failed'));
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <section className={cardClass} aria-labelledby={`${ids}-manage`} data-testid="error-group-actions">
      <h2 id={`${ids}-manage`} className="text-lg font-semibold text-fg mb-4">
        {t('errorsPage.manage')}
      </h2>
      {error && <ErrorAlert testId="error-action-error">{error}</ErrorAlert>}
      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_ACTIONS.filter((s) => actions.includes(s.action)).map((s) => (
          <button
            key={s.action}
            type="button"
            className={smallButton}
            disabled={!!busy}
            onClick={() => run(s.action, () => updateErrorGroup(id, { status: s.status }))}
            data-testid={`error-action-${s.action}`}
          >
            {busy === s.action ? t('errorsPage.working') : t(s.label)}
          </button>
        ))}
        {actions.includes('assignMe') && (
          <button type="button" className={smallButton} disabled={!!busy} onClick={() => run('assign', () => updateErrorGroup(id, { assignee: 'me' }))} data-testid="error-action-assign">
            {t('errorsPage.assignToMe')}
          </button>
        )}
        {actions.includes('unassign') && (
          <button type="button" className={smallButton} disabled={!!busy} onClick={() => run('assign', () => updateErrorGroup(id, { assignee: null }))} data-testid="error-action-unassign">
            {t('errorsPage.unassign')}
          </button>
        )}
        {testRef && (
          <button
            type="button"
            className={smallButton}
            disabled={!!busy}
            onClick={async () => {
              setBusy('delete');
              setError(null);
              const result = await deleteTestErrorGroup(testRef).catch((): ActionResult<unknown> => ({ ok: false, status: 0, error: 'request failed' }));
              setBusy(null);
              if (!result.ok) {
                logger.warn('[errors] Test group delete failed', { id, status: result.status });
                setError(t('errorsPage.failed'));
                return;
              }
              router.push('/errors');
              router.refresh();
            }}
            data-testid="error-delete-test-group"
          >
            {busy === 'delete' ? t('errorsPage.working') : t('errorsPage.deleteTestGroup')}
          </button>
        )}
      </div>
      {actions.includes('note') && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const body = note.trim();
            if (!body) return;
            if (await run('note', () => addErrorGroupNote(id, body))) setNote('');
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={`${ids}-note`} className="text-sm text-fg-muted">
            {t('errorsPage.noteLabel')}
          </label>
          <textarea
            id={`${ids}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={t('errorsPage.notePlaceholder')}
            className={`${fieldClass} w-full resize-y`}
            dir="auto"
            data-testid="error-note-input"
          />
          <div>
            <button type="submit" className={primaryButtonClass} disabled={!!busy || !note.trim()} data-testid="error-note-submit">
              {busy === 'note' ? t('errorsPage.working') : t('errorsPage.addNote')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
