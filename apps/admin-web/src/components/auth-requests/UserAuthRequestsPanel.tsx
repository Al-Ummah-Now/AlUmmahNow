'use client';

/**
 * Self-contained panel for a user's page: "Request action from Auth" and the
 * requests already sent for that user with their live status from auth.
 * Drop it into any user page: <UserAuthRequestsPanel subjectUserId=… canRequest=… />.
 * (docs/admin/AUTH_MODERATION_REQUESTS.md)
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, translateDynamic, type MessageKey } from '@/i18n/translate';
import { answerAuthRequest, getAuthRequestEvidence, loadUserAuthRequests, retryAuthRequest, submitAuthRequest } from '@/lib/api/auth-requests';
import {
  AUTH_REQUEST_ACTIONS,
  AUTH_REQUEST_REASONS,
  authRequestNeedsAttention,
  isOpenAuthRequest,
  type AuthRequestAction,
  type AuthRequestEvidence,
  type AuthRequestReason,
  type AuthRequestView,
} from '@/lib/api/auth-request-types';
import { ErrorAlert, cardClass, fieldClass, linkClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { AuthRequestStatusChip, DeliveryChip } from './AuthRequestStatusChip';

/** While a request is being sent or is open in auth, refresh this often (admin-api queues the status reads). */
const POLL_MS = 10_000;

export function UserAuthRequestsPanel({
  subjectUserId,
  canRequest,
  initialRequests,
}: {
  subjectUserId: string;
  canRequest: boolean;
  initialRequests?: AuthRequestView[];
}) {
  const { t, locale } = useLanguage();
  const [requests, setRequests] = useState<AuthRequestView[] | null>(initialRequests ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await loadUserAuthRequests(subjectUserId);
    if (res.ok) {
      setRequests(res.data.requests);
      setLoadError(null);
    } else {
      setLoadError(res.error);
    }
  }, [subjectUserId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const hasOpen = !!requests?.some(isOpenAuthRequest);
  useEffect(() => {
    if (!hasOpen) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasOpen, reload]);

  return (
    <section className={cardClass} aria-labelledby="auth-requests-title" data-testid="auth-requests-panel" data-user-id={subjectUserId}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 id="auth-requests-title" className="text-lg font-semibold text-fg">{t('authRequests.userTitle')}</h2>
          <p className="text-sm text-fg-muted mt-1 max-w-prose">{t('authRequests.requestHint')}</p>
        </div>
        {canRequest ? (
          <button type="button" className={primaryButtonClass} onClick={() => { setNotice(null); setOpen(true); }} data-testid="auth-request-open">
            {t('authRequests.request')}
          </button>
        ) : (
          <p className="text-sm text-fg-muted">{t('authRequests.adminOnly')}</p>
        )}
      </div>

      {notice && <p role="status" className="mb-4 text-sm text-fg" data-testid="auth-request-notice">{notice}</p>}
      {loadError && <ErrorAlert testId="auth-requests-load-error">{t('authRequests.loadFailed')}: {loadError}</ErrorAlert>}

      {open && (
        <RequestDialog
          subjectUserId={subjectUserId}
          onClose={() => setOpen(false)}
          onSent={async () => {
            setOpen(false);
            setNotice(t('authRequests.sent'));
            await reload();
          }}
        />
      )}

      <h3 className="font-medium text-fg mb-2">{t('authRequests.history')}</h3>
      {requests === null && !loadError && <p className="text-fg-muted">{t('common.loading')}</p>}
      {requests?.length === 0 && <p className="text-fg-muted" data-testid="auth-requests-empty">{t('authRequests.historyEmpty')}</p>}
      {!!requests?.length && (
        <ul className="space-y-3" data-testid="auth-requests-history">
          {requests.map((r) => (
            <li
              key={r.id}
              className={`border rounded p-3 ${authRequestNeedsAttention(r) ? 'border-danger-border' : 'border-border'}`}
              data-testid="auth-request-row"
              data-request-id={r.id}
              data-auth-request-id={r.authRequestId ?? ''}
              data-delivery={r.delivery.status}
              data-status={r.status ?? ''}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-fg">{translateDynamic(t, 'authRequests.actions', r.action)}</span>
                {r.delivery.status === 'sent' && r.status ? (
                  <AuthRequestStatusChip status={r.status} label={translateDynamic(t, 'authRequests.status', r.status)} />
                ) : (
                  <DeliveryChip status={r.delivery.status} label={translateDynamic(t, 'authRequests.delivery', r.delivery.status)} />
                )}
                <span className="text-sm text-fg-muted">{translateDynamic(t, 'authRequests.reasons', r.reasonCategory)}</span>
              </div>
              <p className="text-sm text-fg-muted mt-1">{t('authRequests.requestedBy', { name: r.requestedBy.name, date: formatDate(r.createdAt, locale, true) })}</p>
              <p className="text-sm text-fg mt-1 whitespace-pre-wrap">{r.reason}</p>
              {r.delivery.status === 'sending' && r.delivery.attempts > 0 && (
                <p className="text-sm text-fg-muted mt-2" data-testid="auth-request-retrying">{t('authRequests.retrying', { attempts: r.delivery.attempts, error: r.delivery.error ?? '' })}</p>
              )}
              {r.decisionNote && (
                <p className="text-sm text-fg mt-2" data-testid="auth-request-decision">
                  <span className="font-medium">{t('authRequests.decisionNote')}:</span> {r.decisionNote}
                </p>
              )}
              {r.answerPending && <p className="text-sm text-fg-muted mt-2">{t('authRequests.answerQueued')}</p>}
              {authRequestNeedsAttention(r) && (
                <div className="mt-2 text-sm text-danger-fg" role="alert" data-testid="auth-request-failed">
                  <p>{r.delivery.status === 'failed' ? t('authRequests.deliveryFailed', { error: r.delivery.error ?? '' }) : t('authRequests.syncFailed', { error: r.syncError ?? '' })}</p>
                  {canRequest && <RetryButton id={r.id} onDone={reload} />}
                </div>
              )}
              {r.status === 'info_requested' && !r.answerPending && canRequest && <AnswerForm id={r.id} onAnswered={reload} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RequestDialog({ subjectUserId, onClose, onSent }: { subjectUserId: string; onClose: () => void; onSent: () => Promise<void> }) {
  const { t } = useLanguage();
  const [action, setAction] = useState<AuthRequestAction>('revoke_sessions');
  const [reasonCategory, setReasonCategory] = useState<AuthRequestReason>('spam');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [evidence, setEvidence] = useState<AuthRequestEvidence | null>(null);
  const [evidenceError, setEvidenceError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per dialog: a retry after a timeout cannot file the request twice
  const key = useRef(crypto.randomUUID());
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    let cancelled = false;
    void getAuthRequestEvidence(subjectUserId).then((res) => {
      if (cancelled) return;
      if (res.ok) setEvidence(res.data);
      else setEvidenceError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [subjectUserId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await submitAuthRequest({
      subject_user_id: subjectUserId,
      action,
      reason_category: reasonCategory,
      reason: reason.trim(),
      note: note.trim() || undefined,
      report_ids: evidence?.reports.map((r) => r.id),
      idempotency_key: key.current,
    });
    setBusy(false);
    if (res.ok) await onSent();
    else setError(t('authRequests.failed', { error: res.error }));
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={onClose}
      aria-labelledby="auth-request-dialog-title"
      className="bg-surface text-fg border border-border rounded-lg p-0 w-full max-w-lg backdrop:bg-fg/40"
      data-testid="auth-request-dialog"
    >
      <form onSubmit={submit} className="p-6 space-y-4">
        <h2 id="auth-request-dialog-title" className="text-lg font-semibold">{t('authRequests.dialogTitle')}</h2>
        {error && <ErrorAlert testId="auth-request-error">{error}</ErrorAlert>}
        <label className="block">
          <span className="block text-sm font-medium mb-1">{t('authRequests.action')}</span>
          <select className={`${fieldClass} w-full`} value={action} onChange={(e) => setAction(e.target.value as AuthRequestAction)} name="action" data-testid="auth-request-action">
            {AUTH_REQUEST_ACTIONS.map((a) => (
              <option key={a} value={a}>{t(`authRequests.actions.${a}` as MessageKey)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1">{t('authRequests.reason')}</span>
          <select className={`${fieldClass} w-full`} value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value as AuthRequestReason)} name="reason_category" data-testid="auth-request-reason-category">
            {AUTH_REQUEST_REASONS.map((r) => (
              <option key={r} value={r}>{t(`authRequests.reasons.${r}` as MessageKey)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1">{t('authRequests.reasonText')}</span>
          <textarea className={`${fieldClass} w-full`} rows={3} required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} name="reason" data-testid="auth-request-reason" />
        </label>
        <label className="block">
          <span className="block text-sm font-medium mb-1">{t('authRequests.note')}</span>
          <textarea className={`${fieldClass} w-full`} rows={2} maxLength={1800} value={note} onChange={(e) => setNote(e.target.value)} name="note" data-testid="auth-request-note" />
        </label>
        <div>
          <span className="block text-sm font-medium mb-1">{t('authRequests.evidence')}</span>
          {!evidence && !evidenceError && <p className="text-sm text-fg-muted">{t('authRequests.evidenceLoading')}</p>}
          {evidenceError && <p className="text-sm text-fg-muted">{t('authRequests.evidenceNone')}</p>}
          {evidence && (
            <ul className="text-sm space-y-1 max-h-40 overflow-y-auto" data-testid="auth-request-evidence">
              {evidence.evidence.map((e) => (
                <li key={e.url}><a href={e.url} target="_blank" rel="noreferrer noopener" className={linkClass} dir="ltr">{e.label || e.url}</a></li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
          <button type="submit" className={primaryButtonClass} disabled={busy || !reason.trim()} data-testid="auth-request-submit">
            {busy ? t('authRequests.sending') : t('authRequests.send')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function RetryButton({ id, onDone }: { id: string; onDone: () => Promise<void> }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={secondaryButtonClass}
        disabled={busy}
        data-testid="auth-request-retry"
        onClick={async () => {
          setBusy(true);
          const res = await retryAuthRequest(id);
          setBusy(false);
          if (res.ok) await onDone();
          else setError(res.error);
        }}
      >
        {t('authRequests.retry')}
      </button>
      {error && <span>{error}</span>}
    </div>
  );
}

function AnswerForm({ id, onAnswered }: { id: string; onAnswered: () => Promise<void> }) {
  const { t } = useLanguage();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="mt-3 space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        const res = await answerAuthRequest(id, note.trim());
        setBusy(false);
        if (res.ok) {
          setNote('');
          await onAnswered();
        } else setError(res.error);
      }}
    >
      <label className="block">
        <span className="block text-sm font-medium mb-1">{t('authRequests.answer')}</span>
        <textarea className={`${fieldClass} w-full`} rows={2} required value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <button type="submit" className={secondaryButtonClass} disabled={busy || !note.trim()}>{t('authRequests.answerSend')}</button>
    </form>
  );
}
