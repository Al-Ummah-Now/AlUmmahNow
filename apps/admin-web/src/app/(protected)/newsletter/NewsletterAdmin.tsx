'use client';

/**
 * Newsletter forms: write an issue in English and Arabic (saved as a draft), send it to every
 * confirmed subscriber (asks first, with the count), delete a draft, and erase a subscriber.
 * Every change goes through admin-api /api/newsletter (newsletter:manage) and is audited there.
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/I18nProvider';
import { ActionFeedback, ConfirmButton, useContentAction } from '@/components/content/actions';
import { cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { createNewsletterIssue, deleteNewsletterIssue, deleteNewsletterSubscriber, saveNewsletterIssue, sendNewsletterIssue } from '@/lib/api/newsletter';
import type { NewsletterIssueContent } from '@/lib/api/newsletter-types';

/** The same limits as admin-api lib/newsletter.ts NEWSLETTER_LIMITS. */
const SUBJECT_MAX = 150;
const BODY_MAX = 20000;
const labelClass = 'block text-sm font-medium text-fg mb-1';
const FIELDS = ['subject_en', 'subject_ar', 'body_en', 'body_ar'] as const;

export function IssueEditor({ issue, confirmed }: { issue: (NewsletterIssueContent & { id: string }) | null; confirmed: number }) {
  const { t } = useLanguage();
  const router = useRouter();
  const id = useId();
  const { run, busy, error, message } = useContentAction();
  const [values, setValues] = useState<NewsletterIssueContent>({
    subject_en: issue?.subject_en ?? '',
    subject_ar: issue?.subject_ar ?? '',
    body_en: issue?.body_en ?? '',
    body_ar: issue?.body_ar ?? '',
  });
  const [saved, setSaved] = useState<NewsletterIssueContent | null>(issue ? { ...values } : null);
  const dirty = !saved || FIELDS.some((f) => saved[f] !== values[f]);
  const complete = FIELDS.every((f) => values[f].trim());

  async function save(): Promise<string | null> {
    if (issue) {
      const done = await run('save', () => saveNewsletterIssue(issue.id, values), { success: t('newsletter.saved') });
      if (done) setSaved({ ...values });
      return done ? issue.id : null;
    }
    const created = await run('save', () => createNewsletterIssue(values), { refresh: false, success: t('newsletter.saved') });
    if (created) router.push(`/newsletter?issue=${encodeURIComponent(created.id)}`);
    return created?.id ?? null;
  }

  async function send() {
    const target = dirty ? await save() : issue?.id ?? null;
    if (!target) return;
    await run('send', () => sendNewsletterIssue(target), { success: t('newsletter.sending') });
  }

  const field = (f: (typeof FIELDS)[number]) => {
    const lang = f.endsWith('_ar') ? 'ar' : 'en';
    const isBody = f.startsWith('body');
    const props = {
      id: `${id}-${f}`,
      value: values[f],
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [f]: e.target.value })),
      maxLength: isBody ? BODY_MAX : SUBJECT_MAX,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      lang,
      className: `${fieldClass} w-full`,
      'data-testid': `newsletter-${f}`,
    } as const;
    return (
      <div key={f}>
        <label htmlFor={props.id} className={labelClass}>{t(`newsletter.fields.${f}`)}</label>
        {isBody ? <textarea {...props} rows={10} aria-describedby={`${id}-body-hint`} /> : <input {...props} type="text" />}
      </div>
    );
  };

  return (
    <section className={`${cardClass} mb-6`} aria-labelledby={`${id}-title`} data-testid="newsletter-editor">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-fg mb-1">{issue ? t('newsletter.editTitle') : t('newsletter.newTitle')}</h2>
      <p id={`${id}-body-hint`} className="text-sm text-fg-muted mb-4">{t('newsletter.bodyHint')}</p>
      {/* The action row sits outside the form: ConfirmButton's dialog is a form of its own */}
      <form
        id={`${id}-form`}
        className="space-y-4 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{field('subject_en')}{field('subject_ar')}</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{field('body_en')}{field('body_ar')}</div>
      </form>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" form={`${id}-form`} className={secondaryButtonClass} disabled={busy !== null || !dirty} data-testid="newsletter-save">
            {busy === 'save' ? t('content.working') : t('newsletter.saveDraft')}
          </button>
          <ConfirmButton
            label={t('newsletter.send')}
            title={t('newsletter.sendTitle')}
            body={t('newsletter.sendBody', { count: confirmed })}
            confirmLabel={t('newsletter.sendConfirm', { count: confirmed })}
            buttonClassName={`${primaryButtonClass} !py-3`}
            busy={busy === 'send'}
            disabled={busy !== null || !complete || confirmed === 0}
            onConfirm={send}
            testId="newsletter-send"
          />
          {issue && (
            <ConfirmButton
              label={t('newsletter.deleteDraft')}
              title={t('newsletter.deleteDraftTitle')}
              body={t('newsletter.deleteDraftBody')}
              confirmLabel={t('newsletter.deleteDraft')}
              danger
              busy={busy === 'delete'}
              disabled={busy !== null}
              onConfirm={async () => {
                // DELETE answers no data: success is anything but run()'s null
                if ((await run('delete', () => deleteNewsletterIssue(issue.id), { refresh: false })) !== null) router.push('/newsletter');
              }}
              testId="newsletter-delete"
            />
          )}
        </div>
        {!complete && <p className="text-sm text-fg-muted" data-testid="newsletter-incomplete">{t('newsletter.bothLanguages')}</p>}
        {complete && confirmed === 0 && <p className="text-sm text-fg-muted" data-testid="newsletter-no-subscribers">{t('newsletter.noConfirmed')}</p>}
        <ActionFeedback error={error} message={message} testId="newsletter-feedback" />
      </div>
    </section>
  );
}

export function EraseSubscriberButton({ id, email }: { id: string; email: string }) {
  const { t } = useLanguage();
  const { run, busy, error } = useContentAction();
  return (
    <>
      <ConfirmButton
        label={t('newsletter.erase')}
        title={t('newsletter.eraseTitle')}
        body={t('newsletter.eraseBody', { email })}
        confirmLabel={t('newsletter.erase')}
        danger
        busy={busy === 'erase'}
        disabled={busy !== null}
        onConfirm={() => run('erase', () => deleteNewsletterSubscriber(id))}
        testId={`newsletter-erase-${id}`}
      />
      {error && <ActionFeedback error={error} message={null} />}
    </>
  );
}
