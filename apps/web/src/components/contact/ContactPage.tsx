/**
 * Contact us (/[locale]/contact). Signed in, the email is the account's and
 * cannot be edited (admin-api uses the account email anyway) and the name
 * starts as the account's name. The page the
 * visitor came from is attached and can be removed. Spam protection: a hidden
 * honeypot field and the time taken to fill the form (checked by admin-api),
 * plus per-IP and per-account rate limits there.
 */
'use client';

import '@/theme/contact.css';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from '@/components/common/AppLink';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  Copyright,
  Handshake,
  Link2,
  Lock,
  Mail,
  MessageCircle,
  ShieldCheck,
  UserRound,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { ContactTopicKey } from '@al-ummah/shared-types';
import { errorScreenStrings, parseErrorRef } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import { SettingsBreadcrumb } from '@/components/settings/SettingsBreadcrumb';
import { logger } from '@/lib/logger-client';
import { fetchProfile } from '@/lib/api/profiles-client';
import { userDisplayName } from '@/lib/display-name';
import {
  CONTACT_LIMITS,
  CONTACT_TOPICS,
  capturePageUrl,
  fill,
  topicFromParam,
  validateContactForm,
  type ContactErrors,
  type ContactField,
  type ContactFormValues,
} from '@/lib/contact/form';

const TOPIC_ICONS: Record<ContactTopicKey, LucideIcon> = {
  general: MessageCircle,
  account: UserRound,
  problem: Wrench,
  content: Copyright,
  partnership: Handshake,
};

const FIELD_ORDER: ContactField[] = ['name', 'email', 'topic', 'message'];

type Status = { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string };

export function ContactPage() {
  const { t, lang, isRTL } = useLanguage();
  const { user } = useAuth();
  const c = t.contact;
  const params = useSearchParams();
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;
  const startedAt = useRef(Date.now());
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  const accountEmail = user?.email || '';
  const userId = user?.id;
  // The token's name only when it is a name (never the email)
  const tokenName = user?.name?.trim() && user.name.trim() !== accountEmail ? user.name.trim() : '';
  // Set once the visitor types a name; the account's name never overwrites theirs
  const nameEdited = useRef(false);
  const [values, setValues] = useState<ContactFormValues>({
    name: tokenName,
    email: accountEmail,
    topic: topicFromParam(params?.get('topic')),
    // From an error screen: the reference, so support finds what happened
    message: (() => {
      const ref = parseErrorRef(params?.get('ref') ?? '');
      return ref ? `${errorScreenStrings(params?.get('lang') ?? (typeof document !== 'undefined' ? document.documentElement.lang : 'en')).reference}: ${ref}\n\n` : '';
    })(),
  });
  const [errors, setErrors] = useState<ContactErrors>({});
  const [showSummary, setShowSummary] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [pageUrl, setPageUrl] = useState('');
  const [honeypot, setHoneypot] = useState('');

  // The account can change under the page (account switcher)
  useEffect(() => {
    if (accountEmail) setValues((v) => ({ ...v, email: accountEmail }));
  }, [accountEmail]);

  // Signed in: the account's name (display name, else first + last; never the
  // email), still editable. Loaded from the profile, as the header does.
  useEffect(() => {
    if (!userId) return;
    let live = true;
    fetchProfile({ id: userId, email: accountEmail }, (profile) => {
      const name = userDisplayName(profile, lang);
      if (live && name && !nameEdited.current) setValues((v) => ({ ...v, name }));
    }).catch((error: unknown) => {
      logger.warn('[contact] Profile not loaded', { error: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      live = false;
    };
  }, [userId, accountEmail, lang]);

  useEffect(() => {
    setPageUrl(capturePageUrl(params?.get('from'), document.referrer, window.location.origin));
  }, [params]);

  useEffect(() => {
    if (status.kind === 'sent') successRef.current?.focus();
  }, [status.kind]);

  const errorText = (field: ContactField): string => {
    const e = errors[field];
    if (!e) return '';
    const max = { name: CONTACT_LIMITS.nameMax, email: CONTACT_LIMITS.emailMax, topic: 0, message: CONTACT_LIMITS.messageMax }[field];
    const key = {
      name: { required: 'nameRequired', tooLong: 'nameTooLong', invalid: 'nameRequired', tooShort: 'nameRequired' },
      email: { required: 'emailRequired', tooLong: 'emailTooLong', invalid: 'emailInvalid', tooShort: 'emailInvalid' },
      topic: { required: 'topicRequired', tooLong: 'topicRequired', invalid: 'topicRequired', tooShort: 'topicRequired' },
      message: { required: 'messageRequired', tooLong: 'messageTooLong', invalid: 'messageRequired', tooShort: 'messageTooShort' },
    }[field][e] as keyof typeof c.errors;
    return fill(c.errors[key], { min: CONTACT_LIMITS.messageMin, max });
  };

  const set = <K extends keyof ContactFormValues>(field: K, value: ContactFormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }));
    // Once a field has an error, re-check it as the visitor fixes it
    if (errors[field as ContactField]) {
      const next = validateContactForm({ ...values, [field]: value });
      setErrors((prev) => ({ ...prev, [field]: next[field as ContactField] }));
    }
  };

  const messageLength = values.message.trim().length;
  const pageLabel = useMemo(() => {
    if (!pageUrl) return '';
    try {
      const u = new URL(pageUrl);
      return `${u.pathname}${u.search}`;
    } catch {
      return pageUrl;
    }
  }, [pageUrl]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status.kind === 'sending') return;
    const found = validateContactForm(values);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setShowSummary(true);
      setStatus({ kind: 'idle' });
      requestAnimationFrame(() => summaryRef.current?.focus());
      return;
    }
    setShowSummary(false);
    setStatus({ kind: 'sending' });
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          topic: values.topic,
          message: values.message.trim(),
          locale: lang === 'ar' ? 'ar' : 'en',
          pageUrl: pageUrl || null,
          website: honeypot,
          elapsedMs: Date.now() - startedAt.current,
        }),
      });
      if (res.status === 201) {
        setStatus({ kind: 'sent', email: values.email.trim() });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; errors?: ContactErrors };
      if (res.status === 400 && body.errors) {
        setErrors(body.errors);
        setShowSummary(true);
        setStatus({ kind: 'idle' });
        requestAnimationFrame(() => summaryRef.current?.focus());
        return;
      }
      logger.warn('[contact] Message not accepted', { status: res.status, error: body.error });
      setStatus({ kind: 'error', message: res.status === 429 ? c.errors.rateLimited : c.errors.generic });
    } catch (error) {
      logger.warn('[contact] Network error', { error: error instanceof Error ? error.message : String(error) });
      setStatus({ kind: 'error', message: c.errors.network });
    }
  };

  const reset = () => {
    setValues({ name: values.name, email: accountEmail || values.email, topic: '', message: '' });
    setErrors({});
    setShowSummary(false);
    startedAt.current = Date.now();
    setStatus({ kind: 'idle' });
  };

  const describedBy = (field: ContactField, ...extra: string[]) => [...extra, errors[field] ? id(`${field}-error`) : ''].filter(Boolean).join(' ') || undefined;
  const fieldError = (field: ContactField) =>
    errors[field] ? (
      <p className="ct-error" id={id(`${field}-error`)} data-testid={`contact-error-${field}`}>
        <AlertCircle aria-hidden="true" />
        <span>{errorText(field)}</span>
      </p>
    ) : null;
  const errorFields = FIELD_ORDER.filter((f) => errors[f]);

  return (
    <>
    {/* Opened from Settings: "Settings › Contact us" with a way back */}
    <SettingsBreadcrumb />
    <main id={MAIN_CONTENT_ID} className="ct" dir={isRTL ? 'rtl' : 'ltr'} data-testid="contact-page">
      <header className="ct-head">
        <span className="ct-badge" aria-hidden="true">
          <Mail />
        </span>
        <div>
          <h1 className="ct-title">{c.title}</h1>
          <p className="ct-lead">{c.lead}</p>
        </div>
      </header>

      <div className="ct-grid">
        <section className="ct-card" aria-labelledby={status.kind === 'sent' ? id('sent') : undefined} aria-label={status.kind === 'sent' ? undefined : c.formLabel}>
          {status.kind === 'sent' ? (
            <div className="ct-sent" data-testid="contact-success" role="status">
              <span className="ct-sent-icon" aria-hidden="true">
                <CheckCircle2 />
              </span>
              <h2 id={id('sent')} ref={successRef} tabIndex={-1} className="ct-sent-title">
                {c.success.title}
              </h2>
              <p className="ct-sent-body">
                {fill(c.success.body, { email: '\u0000' })
                  .split('\u0000')
                  .flatMap((part, i) => (i === 0 ? [part] : [<bdi key={i} dir="ltr" className="ct-mono">{status.email}</bdi>, part]))}
              </p>
              <div className="ct-actions">
                <button type="button" className="ct-btn ct-btn-quiet" onClick={reset} data-testid="contact-send-another">
                  {c.success.another}
                </button>
                <Link className="ct-btn ct-btn-primary" href={`/${lang}`}>
                  {c.success.home}
                </Link>
              </div>
            </div>
          ) : (
            <form noValidate onSubmit={submit} data-testid="contact-form" aria-busy={status.kind === 'sending'}>
              {showSummary && errorFields.length > 0 && (
                <div className="ct-summary" ref={summaryRef} tabIndex={-1} role="alert" data-testid="contact-error-summary">
                  <AlertCircle aria-hidden="true" />
                  <div>
                    <p className="ct-summary-title">{c.errors.summary}</p>
                    <ul>
                      {errorFields.map((f) => (
                        <li key={f}>
                          <a href={`#${id(f === 'topic' ? `topic-${values.topic || CONTACT_TOPICS[0]}` : f)}`}>{errorText(f)}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {status.kind === 'error' && (
                <div className="ct-summary" role="alert" data-testid="contact-send-error">
                  <AlertCircle aria-hidden="true" />
                  <p className="ct-summary-title">{status.message}</p>
                </div>
              )}

              <div className="ct-row">
                <div className="ct-field">
                  <label className="ct-label" htmlFor={id('name')}>
                    {c.fields.name}
                  </label>
                  <input
                    id={id('name')}
                    name="name"
                    className="ct-input"
                    autoComplete="name"
                    maxLength={CONTACT_LIMITS.nameMax + 20}
                    value={values.name}
                    onChange={(e) => {
                      nameEdited.current = true;
                      set('name', e.target.value);
                    }}
                    aria-invalid={!!errors.name || undefined}
                    aria-describedby={describedBy('name')}
                    required
                    data-testid="contact-name"
                  />
                  {fieldError('name')}
                </div>

                <div className="ct-field">
                  <label className="ct-label" htmlFor={id('email')}>
                    {c.fields.email}
                  </label>
                  {/* The address is LTR in both languages: the wrapper is LTR too, so the
                      lock (inset-inline-end) sits on the side the readonly
                      padding (padding-inline-end) reserves, in en and ar */}
                  <div className="ct-input-wrap" dir="ltr">
                    <input
                      id={id('email')}
                      name="email"
                      type="email"
                      dir="ltr"
                      className="ct-input"
                      autoComplete="email"
                      inputMode="email"
                      maxLength={CONTACT_LIMITS.emailMax + 20}
                      value={values.email}
                      readOnly={!!accountEmail}
                      aria-readonly={!!accountEmail || undefined}
                      onChange={(e) => set('email', e.target.value)}
                      aria-invalid={!!errors.email || undefined}
                      aria-describedby={describedBy('email', id('email-hint'))}
                      required
                      data-testid="contact-email"
                    />
                    {accountEmail && <Lock className="ct-input-icon" aria-hidden="true" />}
                  </div>
                  <p className="ct-hint" id={id('email-hint')}>
                    {accountEmail ? c.fields.emailLocked : c.fields.emailHint}
                  </p>
                  {fieldError('email')}
                </div>
              </div>

              <fieldset className="ct-field ct-topics" aria-describedby={describedBy('topic')} data-invalid={!!errors.topic || undefined}>
                <legend className="ct-label">{c.fields.topic}</legend>
                <div className="ct-topic-grid">
                  {CONTACT_TOPICS.map((topic) => {
                    const Icon = TOPIC_ICONS[topic];
                    return (
                      <label key={topic} className="ct-topic" data-checked={values.topic === topic || undefined}>
                        <input
                          type="radio"
                          name="topic"
                          id={id(`topic-${topic}`)}
                          value={topic}
                          checked={values.topic === topic}
                          onChange={() => set('topic', topic)}
                          required
                          data-testid={`contact-topic-${topic}`}
                        />
                        <span className="ct-topic-icon" aria-hidden="true">
                          <Icon />
                        </span>
                        <span className="ct-topic-text">
                          <span className="ct-topic-label">{c.topics[topic].label}</span>
                          <span className="ct-topic-hint">{c.topics[topic].hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {fieldError('topic')}
              </fieldset>

              <div className="ct-field">
                <div className="ct-label-row">
                  <label className="ct-label" htmlFor={id('message')}>
                    {c.fields.message}
                  </label>
                  <span
                    className="ct-counter"
                    id={id('message-count')}
                    data-over={messageLength > CONTACT_LIMITS.messageMax || undefined}
                    data-testid="contact-counter"
                  >
                    {fill(c.fields.counter, { count: messageLength.toLocaleString(lang), max: CONTACT_LIMITS.messageMax.toLocaleString(lang) })}
                  </span>
                </div>
                <textarea
                  id={id('message')}
                  name="message"
                  className="ct-input ct-textarea"
                  dir="auto"
                  rows={7}
                  value={values.message}
                  onChange={(e) => set('message', e.target.value)}
                  aria-invalid={!!errors.message || undefined}
                  aria-describedby={describedBy('message', id('message-hint'), id('message-count'))}
                  required
                  data-testid="contact-message"
                />
                <p className="ct-hint" id={id('message-hint')}>
                  {fill(c.fields.messageHint, { min: CONTACT_LIMITS.messageMin })}
                </p>
                {fieldError('message')}
              </div>

              {pageUrl && (
                <div className="ct-page" data-testid="contact-page-url">
                  <Link2 aria-hidden="true" />
                  <div className="ct-page-text">
                    <span className="ct-page-label">{c.fields.page}</span>
                    <bdi dir="ltr" className="ct-mono ct-page-url" title={pageUrl}>
                      {pageLabel}
                    </bdi>
                    <span className="ct-hint">{c.fields.pageHint}</span>
                  </div>
                  <button type="button" className="ct-icon-btn" aria-label={c.fields.pageRemove} title={c.fields.pageRemove} onClick={() => setPageUrl('')}>
                    <X aria-hidden="true" />
                  </button>
                </div>
              )}

              {/* People never see or reach this field; bots fill it */}
              <div className="ct-hp" aria-hidden="true">
                <label htmlFor={id('website')}>Website</label>
                <input id={id('website')} name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
              </div>

              <div className="ct-actions ct-actions-end">
                <button type="submit" className="ct-btn ct-btn-primary" disabled={status.kind === 'sending'} data-testid="contact-submit">
                  {status.kind === 'sending' ? c.sending : c.submit}
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className="ct-aside" aria-labelledby={id('aside')}>
          <h2 id={id('aside')} className="ct-aside-title">
            {c.aside.title}
          </h2>
          <ul className="ct-tips">
            <li>
              <Clock aria-hidden="true" />
              <span>{c.aside.reply}</span>
            </li>
            <li>
              <ShieldCheck aria-hidden="true" />
              <span>{c.aside.privacy}</span>
            </li>
            <li>
              <BookOpen aria-hidden="true" />
              <Link href={`/${lang}/community-guidelines`}>{c.aside.guidelines}</Link>
            </li>
          </ul>
        </aside>
      </div>
    </main>
    </>
  );
}

export default ContactPage;
