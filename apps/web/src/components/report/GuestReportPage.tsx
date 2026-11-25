/**
 * The content report page (/[locale]/report), also what the apps open for people who are not signed in.
 * Signed out: POST /api/report (nothing about the person is kept). Signed in: an ordinary report of the
 * account, as the report buttons file it (lib/api/moderation.ts). Either way it is in the Reports queue.
 */
'use client';

import '@/theme/contact.css';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from '@/components/common/AppLink';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Copyright,
  Flag,
  Info,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserX,
  type LucideIcon,
} from 'lucide-react';
import { formatNumber } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useHumanCheck } from '@/hooks/useHumanCheck';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import { logger } from '@/lib/logger-client';
import { getWwwUrl } from '@/lib/runtime-config';
import { createReport, type ReportCreateErrorCode } from '@/lib/api/moderation';
import { fill } from '@/lib/contact/form';
import {
  GUEST_REPORT_COPY,
  GUEST_REPORT_REASONS,
  GUEST_REPORT_TYPES,
  REPORT_REASON_OF,
  hasGuestReportTarget,
  parseGuestReportParams,
  resolveManualReportTarget,
  resolveReportSubmissionTarget,
  type GuestReportReason,
  type GuestReportType,
  type ManualTargetResolution,
} from '@/lib/report/guest-report';

const REASON_ICONS: Record<GuestReportReason, LucideIcon> = {
  child_safety: ShieldAlert,
  harassment: UserX,
  spam: Sparkles,
  violence: TriangleAlert,
  copyright: Copyright,
  other: Flag,
};

const DETAILS_MAX = 4000;

type FieldKey = 'target' | 'reason' | 'details';
type FieldErrors = Partial<Record<FieldKey, string>>;
type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; code: ErrorCode };
type ErrorCode = 'rate_limited' | 'human_check' | 'duplicate' | 'sign_in' | 'unavailable' | 'network' | 'failed';

const TARGET_ERRORS = { required: 'targetRequired', unsupportedUrl: 'unsupportedUrl', invalidId: 'invalidId' } as const satisfies Record<Extract<ManualTargetResolution, { ok: false }>['error'], string>;

/** What a refused report of an account says (lib/api/moderation.ts). */
const ACCOUNT_ERRORS: Record<ReportCreateErrorCode, ErrorCode> = { auth: 'sign_in', duplicate: 'duplicate', invalid: 'failed', failed: 'failed', human_check: 'human_check', rate_limited: 'rate_limited' };

export function GuestReportPage() {
  const { lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const params = useSearchParams();
  const locale: 'en' | 'ar' = lang === 'ar' ? 'ar' : 'en';
  const copy = GUEST_REPORT_COPY[locale];
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  const { ensureHuman, messages: humanMessages } = useHumanCheck();

  const target = useMemo(() => parseGuestReportParams(params), [params]);
  const showPrefilledTarget = hasGuestReportTarget(target) && target.type !== null;

  const isSignedIn = !!user;

  const [manualType, setManualType] = useState<GuestReportType>('video');
  const [manualTarget, setManualTarget] = useState('');
  const [reason, setReason] = useState<GuestReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showSummary, setShowSummary] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    if (status.kind === 'sent') successRef.current?.focus();
  }, [status.kind]);

  const manualPreview = useMemo(() => {
    if (showPrefilledTarget || !manualTarget.trim()) return null;
    const parsed = resolveManualReportTarget(manualType, manualTarget);
    return parsed.ok && parsed.fromUrl ? parsed : null;
  }, [showPrefilledTarget, manualType, manualTarget]);

  const validate = (): FieldErrors => {
    const found: FieldErrors = {};
    const resolvedTarget = resolveReportSubmissionTarget(target, manualType, manualTarget);
    if (!resolvedTarget.ok) found.target = copy.errors[TARGET_ERRORS[resolvedTarget.error]];
    if (!reason) found.reason = copy.errors.reasonRequired;
    if (details.trim().length > DETAILS_MAX) {
      found.details = fill(copy.errors.detailsTooLong, { max: DETAILS_MAX }, locale);
    }
    return found;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status.kind === 'sending') return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setShowSummary(true);
      setStatus({ kind: 'idle' });
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    const resolvedTarget = resolveReportSubmissionTarget(target, manualType, manualTarget);
    if (!resolvedTarget.ok) return;

    setShowSummary(false);
    setStatus({ kind: 'sending' });

    try {
      const code = isSignedIn ? await sendAsAccount(resolvedTarget) : await sendAsGuest(resolvedTarget);
      setStatus(code ? { kind: 'error', code } : { kind: 'sent' });
    } catch (error) {
      logger.warn('[report] Network error', { error: error instanceof Error ? error.message : String(error) });
      setStatus({ kind: 'error', code: 'network' });
    }
  };

  type Target = Extract<ManualTargetResolution, { ok: true }>;

  /** Null when it was sent. */
  const sendAsAccount = async (found: Target): Promise<ErrorCode | null> => {
    const human = await ensureHuman('report');
    if (!human.ok) return 'human_check';
    const result = await createReport(
      { contentType: found.entityType, contentId: found.entityId, reason: REPORT_REASON_OF[reason as GuestReportReason], description: details.trim() || undefined },
      undefined,
      human.token,
    );
    if (result.success) return null;
    logger.warn('[report] Report of an account not accepted', { error: result.error });
    return ACCOUNT_ERRORS[result.error ?? 'failed'];
  };

  const sendAsGuest = async (found: Target): Promise<ErrorCode | null> => {
    const send = (turnstileToken?: string) =>
      fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ...(turnstileToken ? { turnstileToken } : {}),
          entityType: found.entityType,
          entityId: found.entityId,
          ...(found.entityParentId ? { entityParentId: found.entityParentId } : {}),
          reason,
          details: details.trim(),
          website: honeypot,
        }),
      });
    let res = await send();
    if (res.status === 403) {
      const asked = (await res.clone().json().catch(() => ({}))) as { error?: string; siteKey?: string };
      if (asked.error === 'human_check_required' && asked.siteKey) {
        const human = await ensureHuman('report', asked.siteKey);
        if (!human.ok) return 'human_check';
        res = await send(human.token);
        if (res.status === 403) return 'human_check';
      }
    }
    if (res.status === 201) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    logger.warn('[report] Report not accepted', { status: res.status, error: body.error });
    return res.status === 429 ? 'rate_limited' : res.status === 503 ? 'unavailable' : 'failed';
  };

  const errorText: Record<ErrorCode, string> = {
    rate_limited: copy.errors.rateLimited,
    human_check: humanMessages.failed,
    duplicate: copy.errors.duplicate,
    sign_in: copy.errors.signIn,
    unavailable: copy.errors.unavailable,
    network: copy.errors.network,
    failed: copy.errors.generic,
  };

  const reset = () => {
    setManualTarget('');
    setReason('');
    setDetails('');
    setErrors({});
    setShowSummary(false);
    setStatus({ kind: 'idle' });
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const errorFields = (['target', 'reason', 'details'] as FieldKey[]).filter((f) => errors[f]);
  const privacyHref = `${(getWwwUrl() || 'https://www.alummahnow.net').replace(/\/$/, '')}/${locale}/privacy/`;
  const pageDir = isRTL ? 'rtl' : 'ltr';

  const describe = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join(' ') || undefined;

  return (
    <main id={MAIN_CONTENT_ID} className="ct" dir={pageDir} data-testid="guest-report-page">
      <header className="ct-head aun-glass aun-card-pad">
        <span className="ct-badge" aria-hidden="true">
          <Flag />
        </span>
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="ct-title">
            {copy.title}
          </h1>
          <p className="ct-lead">{copy.lead}</p>
        </div>
      </header>

      <div className="ct-grid">
        <section
          className="ct-card pb-glass"
          aria-labelledby={status.kind === 'sent' ? id('sent') : undefined}
          aria-label={status.kind === 'sent' ? undefined : copy.formLabel}
        >
          {status.kind === 'sent' ? (
            <div className="ct-sent" data-testid="guest-report-success" role="status">
              <span className="ct-sent-icon" aria-hidden="true">
                <CheckCircle2 />
              </span>
              <h2 id={id('sent')} ref={successRef} tabIndex={-1} className="ct-sent-title">
                {copy.success.title}
              </h2>
              <p className="ct-sent-body">
                {copy.success.body}
              </p>
              <div className="ct-actions">
                <button type="button" className="ct-btn ct-btn-quiet" onClick={reset} data-testid="guest-report-another">
                  {copy.success.another}
                </button>
                <Link className="ct-btn ct-btn-primary" href={`/${locale}`}>
                  {copy.success.home}
                </Link>
              </div>
            </div>
          ) : (
            <form noValidate onSubmit={submit} data-testid="guest-report-form" aria-busy={status.kind === 'sending'}>
              {showSummary && errorFields.length > 0 && (
                <div className="ct-summary" ref={summaryRef} tabIndex={-1} role="alert" data-testid="guest-report-error-summary">
                  <AlertCircle aria-hidden="true" />
                  <div>
                    <p className="ct-summary-title">{copy.errors.summary}</p>
                    <ul>
                      {errorFields.map((f) => (
                        <li key={f}>
                          <a href={`#${id(f === 'reason' ? `reason-${reason || GUEST_REPORT_REASONS[0]}` : f)}`}>{errors[f]}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {status.kind === 'error' && (
                <div className="ct-summary" role="alert" data-testid="guest-report-send-error" data-error-code={status.code}>
                  <AlertCircle aria-hidden="true" />
                  <div>
                    <p className="ct-summary-title">{errorText[status.code]}</p>
                    {status.code === 'rate_limited' && (
                      <p className="ct-hint" style={{ marginTop: 6 }}>
                        <Link href={`/${locale}/contact`} data-testid="guest-report-rate-limit-contact">
                          {copy.errors.contactLink}
                        </Link>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {target.unknownType && (
                <div className="ct-notice" role="status" data-testid="guest-report-unknown-type">
                  <Info aria-hidden="true" />
                  <p>{copy.unknownTypeNotice}</p>
                </div>
              )}

              {showPrefilledTarget && target.type ? (
                <div className="ct-page" data-testid="guest-report-target">
                  <Flag aria-hidden="true" />
                  <div className="ct-page-text">
                    <span className="ct-page-label">
                      {copy.targetHeading}: {copy.types[target.type]}
                    </span>
                    {target.id && (
                      <span className="ct-page-url ct-page-id">
                        {copy.targetIdLabel}: <bdi dir="ltr" className="ct-mono">{target.id}</bdi>
                      </span>
                    )}
                    {target.stream && (
                      <span className="ct-page-url ct-page-id">
                        {copy.streamIdLabel}: <bdi dir="ltr" className="ct-mono">{target.stream}</bdi>
                      </span>
                    )}
                    {target.message && (
                      <span className="ct-page-url ct-page-id">
                        {copy.messageIdLabel}: <bdi dir="ltr" className="ct-mono">{target.message}</bdi>
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="ct-row" data-testid="guest-report-manual-target">
                  <div className="ct-field">
                    <label className="ct-label" htmlFor={id('entity-type')}>
                      {copy.manualTypeLabel}
                    </label>
                    <select
                      id={id('entity-type')}
                      name="entityType"
                      className="ct-input"
                      value={manualType}
                      onChange={(e) => setManualType(e.target.value as GuestReportType)}
                      data-testid="guest-report-type-select"
                    >
                      {GUEST_REPORT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {copy.types[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="ct-field">
                    <label className="ct-label" htmlFor={id('target')}>
                      {copy.manualTargetLabel}
                    </label>
                    <input
                      id={id('target')}
                      name="target"
                      type="text"
                      dir={manualTarget ? 'auto' : pageDir}
                      className="ct-input"
                      placeholder={copy.manualTargetPlaceholder}
                      value={manualTarget}
                      onChange={(e) => {
                        setManualTarget(e.target.value);
                        if (errors.target) setErrors((prev) => ({ ...prev, target: undefined }));
                      }}
                      aria-invalid={!!errors.target || undefined}
                      aria-describedby={describe(id('target-hint'), !!errors.target && id('target-error'))}
                      required
                      data-testid="guest-report-target-input"
                    />
                    <p className="ct-hint" id={id('target-hint')}>
                      {copy.manualTargetHint}
                    </p>
                    {manualPreview && (
                      <p className="ct-hint" data-testid="guest-report-resolved-target">
                        {copy.resolvedTargetLabel}: <strong>{copy.types[manualPreview.entityType]}</strong>{' '}
                        <bdi dir="ltr" className="ct-mono">{manualPreview.entityId}</bdi>
                      </p>
                    )}
                    {errors.target && (
                      <p className="ct-error" id={id('target-error')} data-testid="guest-report-error-target">
                        <AlertCircle aria-hidden="true" />
                        <span>{errors.target}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              <fieldset
                className="ct-field ct-topics"
                data-invalid={!!errors.reason || undefined}
                aria-describedby={errors.reason ? id('reason-error') : undefined}
              >
                <legend className="ct-label">{copy.reasonLabel}</legend>
                <div className="ct-topic-grid">
                  {GUEST_REPORT_REASONS.map((key) => {
                    const Icon = REASON_ICONS[key];
                    const isPriority = key === 'child_safety';
                    return (
                      <label
                        key={key}
                        className={isPriority ? 'ct-topic ct-topic-priority' : 'ct-topic'}
                        data-checked={reason === key || undefined}
                      >
                        <input
                          type="radio"
                          name="reason"
                          id={id(`reason-${key}`)}
                          value={key}
                          checked={reason === key}
                          onChange={() => {
                            setReason(key);
                            if (errors.reason) setErrors((prev) => ({ ...prev, reason: undefined }));
                          }}
                          required
                          data-testid={`guest-report-reason-${key}`}
                        />
                        <span className="ct-topic-icon" aria-hidden="true">
                          <Icon />
                        </span>
                        <span className="ct-topic-text">
                          <span className="ct-topic-label">
                            {copy.reasons[key].label}
                            {isPriority && <span className="ct-priority-pill">{copy.priorityTag}</span>}
                          </span>
                          <span className="ct-topic-hint">{copy.reasons[key].hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errors.reason && (
                  <p className="ct-error" id={id('reason-error')} data-testid="guest-report-error-reason">
                    <AlertCircle aria-hidden="true" />
                    <span>{errors.reason}</span>
                  </p>
                )}
              </fieldset>

              <div className="ct-field">
                <div className="ct-label-row">
                  <label className="ct-label" htmlFor={id('details')}>
                    {copy.detailsLabel}
                  </label>
                  <span
                    className="ct-counter"
                    id={id('details-count')}
                    data-over={details.trim().length > DETAILS_MAX || undefined}
                  >
                    {fill(copy.counter, {
                      count: formatNumber(locale, details.trim().length),
                      max: formatNumber(locale, DETAILS_MAX),
                    })}
                  </span>
                </div>
                <textarea
                  id={id('details')}
                  name="details"
                  className="ct-input ct-textarea"
                  dir={details ? 'auto' : pageDir}
                  rows={4}
                  value={details}
                  onChange={(e) => {
                    setDetails(e.target.value);
                    if (errors.details) setErrors((prev) => ({ ...prev, details: undefined }));
                  }}
                  aria-invalid={!!errors.details || undefined}
                  aria-describedby={describe(id('details-hint'), id('details-count'), !!errors.details && id('details-error'))}
                  data-testid="guest-report-details"
                />
                <p className="ct-hint" id={id('details-hint')}>
                  {copy.detailsHint}
                </p>
                {errors.details && (
                  <p className="ct-error" id={id('details-error')} data-testid="guest-report-error-details">
                    <AlertCircle aria-hidden="true" />
                    <span>{errors.details}</span>
                  </p>
                )}
              </div>

              {isSignedIn ? (
                <div className="ct-notice" data-testid="guest-report-signed-in-notice">
                  <Lock aria-hidden="true" />
                  <div>
                    <p className="ct-notice-title">{copy.signedInTitle}</p>
                    <p>{copy.signedInBody}</p>
                  </div>
                </div>
              ) : (
              <div className="ct-notice" data-testid="guest-report-privacy-notice">
                <ShieldCheck aria-hidden="true" />
                <div>
                  <p className="ct-notice-title">{copy.privacyTitle}</p>
                  <p>{copy.privacyBody}</p>
                </div>
              </div>
              )}

              <div className="ct-hp" aria-hidden="true">
                <label htmlFor={id('website')}>{copy.honeypotLabel}</label>
                <input
                  id={id('website')}
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={honeypot}
                  onChange={(e) => setHoneypot(e.target.value)}
                />
              </div>

              <div className="ct-actions ct-actions-end">
                <button
                  type="submit"
                  className="ct-btn ct-btn-primary"
                  disabled={status.kind === 'sending'}
                  data-testid="guest-report-submit"
                >
                  {status.kind === 'sending' ? copy.sending : copy.submit}
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className="ct-aside pb-glass" aria-labelledby={id('aside')}>
          <h2 id={id('aside')} className="ct-aside-title">
            {copy.aside.title}
          </h2>
          <ul className="ct-tips">
            <li>
              <ShieldCheck aria-hidden="true" />
              <span>{copy.aside.review}</span>
            </li>
            <li>
              <TriangleAlert aria-hidden="true" />
              <span data-testid="guest-report-danger">{copy.aside.danger}</span>
            </li>
            <li>
              <BookOpen aria-hidden="true" />
              <Link href={`/${locale}/community-guidelines`}>{copy.aside.guidelines}</Link>
            </li>
            <li>
              <ShieldCheck aria-hidden="true" />
              <a href={privacyHref} target="_blank" rel="noopener noreferrer">
                {copy.aside.privacy}
              </a>
            </li>
          </ul>
        </aside>
      </div>
    </main>
  );
}

export default GuestReportPage;
