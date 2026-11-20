'use client';

/**
 * The editor of one system email (Settings › Emails; shared-types email-templates.ts):
 *
 * - every copy field in English and Arabic (LocalizedFieldPair: both required, Translate fills one
 *   from the other), with the field's placeholders as chips that insert at the caret of the
 *   language last focused; the shared checks run as the admin types and block Save;
 * - default invite video per language (live search pickers, may be empty);
 * - live preview of the real layout (admin-api renders it) in either language, light or dark mail
 *   app, desktop or phone width, with a few made-up examples; "Send test to me";
 * - Save makes a new version and offers Undo; History restores any earlier version (also with
 *   Undo). A stale editor is told someone else saved, never overwrites.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  EMAIL_TEMPLATES,
  EMAIL_TEST_SENDS_PER_HOUR,
  checkEmailTemplate,
  formatNumber,
  type EmailPlaceholder,
  type EmailTemplateContent,
  type EmailTemplateFieldDef,
  type EmailTemplateIssue,
  type EmailTemplateLang,
  type EmailTemplateState,
  type EmailTemplateVersion,
} from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { LocalizedFieldPair } from '@/components/localized/LocalizedFieldPair';
import { Autocomplete } from '@/components/search/Autocomplete';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { cardClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { reportError } from '@/lib/errors/reporter';
import {
  listEmailTemplateVersions,
  previewEmailTemplate,
  restoreEmailTemplate,
  saveEmailTemplate,
  sendEmailTemplateTest,
  type EmailPreview,
  type PreviewSample,
  type TemplateResult,
} from '@/lib/api/email-templates';
import { getNames } from '@/lib/api/audit';
import { insertAt, issueText, previewDocument, type Mode } from '@/lib/email-template-model';

const PREVIEW_DEBOUNCE_MS = 400;
/** Fields with a line of help under them (emailTemplates.fieldHelp) */
const FIELD_HELP = new Set(['preheader', 'account', 'noteLabel', 'videoIntro']);
const LANGS: EmailTemplateLang[] = ['en', 'ar'];
type Width = 'desktop' | 'phone';
type SampleKind = NonNullable<PreviewSample['channels']>;

class TemplateActionError extends Error {
  constructor(public result: Extract<TemplateResult<unknown>, { ok: false }>) {
    super(result.code ?? `status ${result.status}`);
  }
}

const unwrap = async <T,>(p: Promise<TemplateResult<T>>): Promise<T> => {
  const r = await p;
  if (!r.ok) throw new TemplateActionError(r);
  return r.data;
};

interface Props {
  initial: EmailTemplateState;
  initialUpdatedByName: string | null;
  adminEmail: string;
}

export function EmailTemplateEditor({ initial, initialUpdatedByName, adminEmail }: Props) {
  const { t, locale } = useLanguage();
  const def = EMAIL_TEMPLATES[initial.key];
  const undoable = useUndoableAction();
  const [saved, setSaved] = useState<EmailTemplateState>(initial);
  const [draft, setDraft] = useState<EmailTemplateContent>(initial.content);
  const [savedByName, setSavedByName] = useState<string | null>(initialUpdatedByName);
  const [serverFields, setServerFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string; conflict?: boolean } | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const langName = useCallback((l: EmailTemplateLang) => t(l === 'en' ? 'localized.langEnglish' : 'localized.langArabic'), [t]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved.content), [draft, saved]);
  const issues = useMemo(() => checkEmailTemplate(def, draft), [def, draft]);
  const fieldErrors = useMemo(() => {
    const out: Record<string, Partial<Record<EmailTemplateLang, string>>> = {};
    for (const i of issues) {
      out[i.field] ??= {};
      out[i.field]![i.lang] ??= issueText(t, i, langName);
    }
    for (const [k, code] of Object.entries(serverFields)) {
      const [lang, field] = k.split('.') as [EmailTemplateLang, string];
      out[field] ??= {};
      out[field]![lang] ??= issueText(t, { field, lang, code: code as EmailTemplateIssue['code'] }, langName);
    }
    return out;
  }, [issues, serverFields, t, langName]);
  const blocking = issues.length + Object.keys(serverFields).length;

  const adopt = useCallback((state: EmailTemplateState, byName: string | null) => {
    setSaved(state);
    setDraft(state.content);
    setSavedByName(byName);
    setServerFields({});
    setHistoryKey((k) => k + 1);
  }, []);

  const setCopy = (field: string, pair: { en: string; ar: string }) => {
    setServerFields((f) => {
      const { [`en.${field}`]: _en, [`ar.${field}`]: _ar, ...rest } = f;
      return rest;
    });
    setDraft((d) => ({ ...d, copy: { en: { ...d.copy.en, [field]: pair.en }, ar: { ...d.copy.ar, [field]: pair.ar } } }));
  };

  const failText = (error: unknown, fallback: MessageKey): { text: string; conflict?: boolean } => {
    if (error instanceof TemplateActionError) {
      if (error.result.code === 'conflict') return { text: t('emailTemplates.conflict'), conflict: true };
      if (error.result.code === 'invalid_template' && error.result.fields) {
        const fields = error.result.fields;
        setServerFields(fields);
        const n = Object.keys(fields).length;
        return { text: n === 1 ? t('emailTemplates.issueCountOne') : t('emailTemplates.issueCount', { count: formatNumber(locale, n) }) };
      }
    }
    reportError(error, { shown: true, extra: { action: 'email-template', key: saved.key } });
    return { text: t(fallback) };
  };

  async function save() {
    if (!dirty || blocking || saving) return;
    setSaving(true);
    setMessage(null);
    const before = saved;
    const beforeName = savedByName;
    try {
      const next = await undoable.run({
        action: () => unwrap(saveEmailTemplate(saved.key, saved.version, draft)),
        undo: async (result: EmailTemplateState) => {
          const back = await unwrap(restoreEmailTemplate(saved.key, before.version, result.version, true));
          adopt(back, beforeName);
          setMessage({ tone: 'ok', text: t('emailTemplates.undone', { version: formatNumber(locale, before.version) }) });
        },
        message: (result) => t('emailTemplates.saved', { version: formatNumber(locale, result.version) }),
      });
      adopt(next, adminEmail || null);
    } catch (error) {
      setMessage({ tone: 'error', ...failText(error, 'emailTemplates.saveFailed') });
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    const previous = draft;
    setDraft(saved.content);
    setServerFields({});
    void undoable.run({ action: async () => null, undo: async () => setDraft(previous), message: t('emailTemplates.discarded') });
  }

  async function restore(version: EmailTemplateVersion) {
    setMessage(null);
    const before = saved;
    const beforeName = savedByName;
    try {
      const next = await undoable.run({
        action: () => unwrap(restoreEmailTemplate(saved.key, version.version, saved.version)),
        undo: async (result: EmailTemplateState) => {
          const back = await unwrap(restoreEmailTemplate(saved.key, before.version, result.version, true));
          adopt(back, beforeName);
        },
        message: t('emailTemplates.restored', { version: formatNumber(locale, version.version) }),
      });
      adopt(next, adminEmail || null);
    } catch (error) {
      setMessage({ tone: 'error', ...failText(error, 'emailTemplates.restoreFailed') });
    }
  }

  const groups = useMemo(() => {
    const out: { id: string; fields: EmailTemplateFieldDef[] }[] = [];
    for (const field of def.fields) {
      const g = out.find((x) => x.id === field.group);
      if (g) g.fields.push(field);
      else out.push({ id: field.group, fields: [field] });
    }
    return out;
  }, [def]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start" data-testid="email-template-editor">
      <div className="flex flex-col gap-6 min-w-0">
        <section className={`${cardClass} flex flex-col gap-4`} aria-labelledby="email-wording-heading">
          <div className="flex flex-col gap-1">
            <h2 id="email-wording-heading" className="text-lg font-semibold text-fg">
              {t('emailTemplates.editorHeading')}
            </h2>
            <p className="text-sm text-fg-muted">{t('emailTemplates.editorIntro')}</p>
            <p className="text-sm text-fg-muted" data-testid="email-template-version">
              {t('emailTemplates.version', { version: formatNumber(locale, saved.version) })}
              {' • '}
              {saved.updatedBy === 'system' ? t('emailTemplates.savedBySystem') : t('emailTemplates.savedBy', { date: formatDate(saved.updatedAt, locale, true), name: savedByName || t('emailTemplates.unknownPerson') })}
            </p>
          </div>
          {groups.map((group) => (
            <fieldset key={group.id} className="flex flex-col gap-5 border-t border-border pt-4 min-w-0">
              <legend className="text-base font-semibold text-fg px-1">{t(`emailTemplates.groups.${group.id}` as MessageKey)}</legend>
              {group.fields.map((field) => (
                <CopyField
                  key={`${field.id}-${saved.version}`}
                  field={field}
                  value={{ en: draft.copy.en[field.id] ?? '', ar: draft.copy.ar[field.id] ?? '' }}
                  errors={fieldErrors[field.id]}
                  onChange={(pair) => setCopy(field.id, pair)}
                  templateKey={saved.key}
                />
              ))}
            </fieldset>
          ))}
        </section>

        {def.defaultVideos ? (
          <section className={`${cardClass} flex flex-col gap-4`} aria-labelledby="email-videos-heading" data-testid="email-template-videos">
            <div className="flex flex-col gap-1">
              <h2 id="email-videos-heading" className="text-lg font-semibold text-fg">
                {t('emailTemplates.videosHeading')}
              </h2>
              <p className="text-sm text-fg-muted">{t('emailTemplates.videosIntro')}</p>
            </div>
            <div className="flex flex-col gap-4">
              {LANGS.map((lang) => (
                <div key={`${lang}-${saved.version}`} className="flex flex-col gap-1 min-w-0">
                  <Autocomplete
                    kind="video"
                    mode="pick"
                    showIds={false}
                    allowIds={false}
                    label={t(lang === 'en' ? 'emailTemplates.videoEn' : 'emailTemplates.videoAr')}
                    placeholder={t('emailTemplates.videoPick')}
                    defaultValue={draft.defaultVideos?.[lang] ?? ''}
                    onChange={(id) => {
                      setServerFields((f) => {
                        const { [`${lang}.defaultVideo`]: _v, ...rest } = f;
                        return rest;
                      });
                      setDraft((d) => ({ ...d, defaultVideos: { en: d.defaultVideos?.en ?? null, ar: d.defaultVideos?.ar ?? null, [lang]: id || null } }));
                    }}
                    testId={`email-template-video-${lang}`}
                  />
                  {fieldErrors.defaultVideo?.[lang] ? (
                    <p className="text-sm text-danger-fg" data-testid={`email-template-video-${lang}-error`}>
                      {fieldErrors.defaultVideo[lang]}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className={`${cardClass} md:sticky md:bottom-0 z-10 flex flex-col sm:flex-row sm:items-center gap-3`} data-testid="email-template-savebar">
          <div className="flex-1 min-w-0 text-sm" role="status" aria-live="polite">
            {message ? (
              <span className={message.tone === 'error' ? 'text-danger-fg' : 'text-success-fg'} data-testid="email-template-message">
                {message.text}
                {message.conflict ? (
                  <>
                    {' '}
                    <button type="button" className="underline" onClick={() => window.location.reload()} data-testid="email-template-reload">
                      {t('emailTemplates.reload')}
                    </button>
                  </>
                ) : null}
              </span>
            ) : blocking ? (
              <span className="text-danger-fg" data-testid="email-template-issues">
                {blocking === 1 ? t('emailTemplates.issueCountOne') : t('emailTemplates.issueCount', { count: formatNumber(locale, blocking) })}
              </span>
            ) : dirty ? (
              <span className="text-fg-muted">{t('emailTemplates.unsaved')}</span>
            ) : null}
          </div>
          <div className="flex gap-3 justify-end">
            <button type="button" className={secondaryButtonClass} onClick={discard} disabled={!dirty || saving} data-testid="email-template-discard">
              {t('emailTemplates.discard')}
            </button>
            <button type="button" className={`${primaryButtonClass} disabled:opacity-50 disabled:cursor-not-allowed`} onClick={() => void save()} disabled={!dirty || blocking > 0 || saving} data-testid="email-template-save">
              {saving ? t('emailTemplates.saving') : t('emailTemplates.save')}
            </button>
          </div>
        </div>

        <History templateKey={saved.key} current={saved.version} refresh={historyKey} dirty={dirty} onRestore={(v) => void restore(v)} />
      </div>

      <Preview templateKey={saved.key} content={draft} adminEmail={adminEmail} hasIssues={(lang) => issues.some((i) => i.lang === lang)} />
    </div>
  );
}

function CopyField({ field, value, errors, onChange, templateKey }: { field: EmailTemplateFieldDef; value: { en: string; ar: string }; errors?: Partial<Record<EmailTemplateLang, string>>; onChange: (v: { en: string; ar: string }) => void; templateKey: string }) {
  const { t } = useLanguage();
  const base = `etf-${field.id}`;
  const last = useRef<{ lang: EmailTemplateLang; start: number | null; end: number | null }>({ lang: 'en', start: null, end: null });
  const label = t(`emailTemplates.fields.${field.id}` as MessageKey);
  const help = FIELD_HELP.has(field.id) ? t(`emailTemplates.fieldHelp.${field.id}` as MessageKey) : undefined;

  const remember = (e: React.SyntheticEvent) => {
    const el = e.target as HTMLInputElement | HTMLTextAreaElement;
    const lang = el.getAttribute('lang');
    if (lang !== 'en' && lang !== 'ar') return;
    last.current = { lang, start: el.selectionStart, end: el.selectionEnd };
  };

  function insert(p: EmailPlaceholder) {
    const { lang, start, end } = last.current;
    const r = insertAt(value[lang], `{${p}}`, start, end);
    onChange({ ...value, [lang]: r.value.slice(0, field.maxLength) });
    last.current = { lang, start: r.caret, end: r.caret };
    requestAnimationFrame(() => {
      const el = document.getElementById(`${base}-${lang}`) as HTMLInputElement | HTMLTextAreaElement | null;
      el?.focus();
      el?.setSelectionRange(r.caret, r.caret);
    });
  }

  return (
    <div className="flex flex-col gap-2 min-w-0" onFocusCapture={remember} onSelectCapture={remember} onKeyUpCapture={remember} onClickCapture={remember} data-testid={`email-field-${field.id}`}>
      <LocalizedFieldPair
        id={base}
        testId={`email-field-${field.id}`}
        label={label}
        field={`emails.${templateKey}.${field.id.toLowerCase()}`}
        value={value}
        onChange={onChange}
        errors={errors}
        multiline={field.multiline}
        rows={field.multiline ? 3 : undefined}
        maxLength={field.maxLength}
        help={help}
      />
      {field.allowed.length ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`${t('emailTemplates.insert')}: ${label}`}>
          <span className="text-xs text-fg-muted">{t('emailTemplates.insert')}</span>
          {field.allowed.map((p) => (
            <button
              key={p}
              type="button"
              className="inline-flex items-center gap-1 min-h-9 px-2 rounded-full border border-border bg-surface-2 hover:bg-surface-hover text-fg text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(p)}
              data-testid={`email-field-${field.id}-chip-${p}`}
            >
              <span dir="ltr" className="font-mono">{`{${p}}`}</span>
              <span>{t(`emailTemplates.placeholders.${p}` as MessageKey)}</span>
              {/* The field's name for screen readers; the visible words stay first in the name (WCAG 2.5.3) */}
              <span className="sr-only"> ({label})</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; testId: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 min-w-0" role="group" aria-labelledby={id} data-testid={testId}>
      <span id={id} className="text-xs font-medium text-fg-muted">
        {label}
      </span>
      <div className="inline-flex flex-wrap gap-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={o.id === value}
            onClick={() => onChange(o.id)}
            className={`min-h-9 px-3 rounded border text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${o.id === value ? 'bg-accent text-on-accent border-accent' : 'bg-surface-2 text-fg border-border hover:bg-surface-hover'}`}
            data-testid={`${testId}-${o.id}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Preview({ templateKey, content, adminEmail, hasIssues }: { templateKey: EmailTemplateState['key']; content: EmailTemplateContent; adminEmail: string; hasIssues: (lang: EmailTemplateLang) => boolean }) {
  const { t, locale } = useLanguage();
  const [lang, setLang] = useState<EmailTemplateLang>(locale === 'ar' ? 'ar' : 'en');
  const [mode, setMode] = useState<Mode>('light');
  const [width, setWidth] = useState<Width>('desktop');
  const [sample, setSample] = useState<SampleKind>('one');
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [height, setHeight] = useState(600);
  const [test, setTest] = useState<{ busy: boolean; tone?: 'ok' | 'error'; text?: string }>({ busy: false });
  const frame = useRef<HTMLIFrameElement>(null);
  const langName = (l: EmailTemplateLang) => t(l === 'en' ? 'localized.langEnglish' : 'localized.langArabic');
  const body = JSON.stringify(content);

  useEffect(() => {
    let live = true;
    setState('loading');
    const timer = setTimeout(async () => {
      try {
        const r = await previewEmailTemplate(templateKey, JSON.parse(body) as EmailTemplateContent, lang, { channels: sample, withNote: true });
        if (!live) return;
        if (!r.ok) throw new TemplateActionError(r);
        setPreview(r.data);
        setState('ready');
      } catch (error) {
        if (!live) return;
        reportError(error, { shown: true, extra: { action: 'email-template-preview', key: templateKey } });
        setState('failed');
      }
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [templateKey, body, lang, sample]);

  const fit = () => {
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement) setHeight(Math.max(300, doc.documentElement.scrollHeight));
  };

  async function sendTest() {
    setTest({ busy: true });
    const r = await sendEmailTemplateTest(templateKey, content, lang).catch((error: unknown) => {
      reportError(error, { shown: true, extra: { action: 'email-template-test', key: templateKey } });
      return { ok: false as const, status: 500 };
    });
    if (r.ok) {
      setTest({ busy: false, tone: 'ok', text: r.data.remaining > 0 ? t('emailTemplates.testSentRemaining', { email: r.data.to, count: formatNumber(locale, r.data.remaining) }) : t('emailTemplates.testSent', { email: r.data.to }) });
      return;
    }
    const code = 'code' in r ? r.code : undefined;
    const text =
      code === 'rate_limited'
        ? t('emailTemplates.testLimited', { count: formatNumber(locale, EMAIL_TEST_SENDS_PER_HOUR) })
        : code === 'no_email'
          ? t('emailTemplates.testNoEmail')
          : code === 'invalid_template'
            ? t('emailTemplates.testInvalid', { lang: langName(lang) })
            : t('emailTemplates.testFailed');
    setTest({ busy: false, tone: 'error', text });
  }

  const doc = preview ? previewDocument(preview.html, mode) : '';
  return (
    <section className={`${cardClass} flex flex-col gap-4 xl:sticky xl:top-4 min-w-0`} aria-labelledby="email-preview-heading" data-testid="email-template-preview">
      <div className="flex flex-col gap-1">
        <h2 id="email-preview-heading" className="text-lg font-semibold text-fg">
          {t('emailTemplates.previewHeading')}
        </h2>
        <p className="text-sm text-fg-muted">{t('emailTemplates.previewIntro')}</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <Segmented label={t('emailTemplates.previewLanguage')} value={lang} onChange={setLang} options={LANGS.map((l) => ({ id: l, label: t(l === 'en' ? 'localized.english' : 'localized.arabic') }))} testId="email-preview-lang" />
        <Segmented label={t('emailTemplates.previewMode')} value={mode} onChange={setMode} options={[{ id: 'light', label: t('emailTemplates.modeLight') }, { id: 'dark', label: t('emailTemplates.modeDark') }]} testId="email-preview-mode" />
        <Segmented label={t('emailTemplates.previewWidth')} value={width} onChange={setWidth} options={[{ id: 'desktop', label: t('emailTemplates.widthDesktop') }, { id: 'phone', label: t('emailTemplates.widthPhone') }]} testId="email-preview-width" />
        <Segmented
          label={t('emailTemplates.previewSample')}
          value={sample}
          onChange={setSample}
          options={[
            { id: 'none', label: t('emailTemplates.sampleNone') },
            { id: 'one', label: t('emailTemplates.sampleOne') },
            { id: 'many', label: t('emailTemplates.sampleMany') },
            { id: 'transferred', label: t('emailTemplates.sampleTransferred') },
          ]}
          testId="email-preview-sample"
        />
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm" lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <dt className="text-fg-muted">{t('emailTemplates.previewSubject')}</dt>
        <dd className="text-fg font-medium break-words" data-testid="email-preview-subject">
          {preview?.subject ?? ''}
        </dd>
      </dl>
      <div className="text-sm text-fg-muted min-h-5" role="status" aria-live="polite">
        {state === 'loading' ? t('emailTemplates.previewLoading') : state === 'failed' ? <span className="text-danger-fg">{t('emailTemplates.previewFailed')}</span> : null}
      </div>
      <div className="overflow-x-auto rounded border border-border bg-surface-2 p-2" data-testid="email-preview-frame-wrap">
        <iframe
          ref={frame}
          title={t('emailTemplates.previewFrame', { lang: langName(lang) })}
          srcDoc={doc}
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          onLoad={fit}
          className="block mx-auto bg-surface border-0"
          style={{ width: width === 'phone' ? 375 : '100%', maxWidth: '100%', height }}
          data-testid="email-preview-frame"
          data-mode={mode}
          data-width={width}
          data-lang={lang}
        />
      </div>
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-sm text-fg-muted [overflow-wrap:anywhere]">{t('emailTemplates.testHelp', { lang: langName(lang), email: adminEmail })}</p>
        {/* The result has a line of its own: a long address wraps anywhere instead of running under the button */}
        <div className="flex justify-end">
          <button type="button" className={`${secondaryButtonClass} disabled:opacity-50 disabled:cursor-not-allowed`} onClick={() => void sendTest()} disabled={test.busy || hasIssues(lang) || !adminEmail} data-testid="email-test-send">
            {test.busy ? t('emailTemplates.testSending') : t('emailTemplates.testSend')}
          </button>
        </div>
        <p className="text-sm [overflow-wrap:anywhere]" role="status" aria-live="polite" data-testid="email-test-status">
          {test.text ? <span className={test.tone === 'error' ? 'text-danger-fg' : 'text-success-fg'}>{test.text}</span> : null}
        </p>
      </div>
    </section>
  );
}

function History({ templateKey, current, refresh, dirty, onRestore }: { templateKey: EmailTemplateState['key']; current: number; refresh: number; dirty: boolean; onRestore: (v: EmailTemplateVersion) => void }) {
  const { t, locale } = useLanguage();
  const [items, setItems] = useState<EmailTemplateVersion[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (before?: number) => {
      const r = await listEmailTemplateVersions(templateKey, before).catch(() => null);
      if (!r || !r.ok) {
        setFailed(true);
        return;
      }
      setFailed(false);
      setItems((prev) => (before ? [...prev, ...r.data.items] : r.data.items));
      setNext(r.data.next);
      const ids = [...new Set(r.data.items.map((v) => v.createdBy).filter((id) => id !== 'system'))];
      if (ids.length) {
        const found = await getNames({ users: ids }).catch(() => null);
        if (found) setNames((n) => ({ ...n, ...Object.fromEntries(ids.map((id) => [id, found.users[id]?.name || found.users[id]?.email || ''])) }));
      }
    },
    [templateKey],
  );

  useEffect(() => {
    void load();
  }, [load, refresh]);

  const actionText = (v: EmailTemplateVersion) => t(`emailTemplates.actions.${v.action}` as MessageKey, { version: formatNumber(locale, v.sourceVersion ?? 0) });

  return (
    <section className={`${cardClass} flex flex-col gap-3`} aria-labelledby="email-history-heading" data-testid="email-template-history">
      <div className="flex flex-col gap-1">
        <h2 id="email-history-heading" className="text-lg font-semibold text-fg">
          {t('emailTemplates.historyHeading')}
        </h2>
        <p className="text-sm text-fg-muted">{t('emailTemplates.historyIntro')}</p>
        {dirty ? <p className="text-sm text-fg-muted">{t('emailTemplates.restoreDirty')}</p> : null}
      </div>
      {failed ? <p className="text-sm text-danger-fg">{t('emailTemplates.historyFailed')}</p> : null}
      {!failed && items.length <= 1 ? <p className="text-sm text-fg-muted">{t('emailTemplates.historyEmpty')}</p> : null}
      <ol className="flex flex-col divide-y divide-border">
        {items.map((v) => (
          <li key={v.version} className="flex flex-col sm:flex-row sm:items-center gap-2 py-3" data-testid={`email-history-${v.version}`}>
            <div className="flex-1 min-w-0 text-sm">
              <p className="text-fg font-medium">
                {t('emailTemplates.version', { version: formatNumber(locale, v.version) })}
                {' • '}
                {actionText(v)}
                {v.version === current ? <span className="ms-2 inline-block rounded-full border border-border px-2 text-xs text-fg-muted">{t('emailTemplates.historyCurrent')}</span> : null}
              </p>
              {v.createdBy === 'system' ? null : (
                <p className="text-fg-muted">{t('emailTemplates.savedBy', { date: formatDate(v.createdAt, locale, true), name: names[v.createdBy] || t('emailTemplates.unknownPerson') })}</p>
              )}
            </div>
            {v.version !== current ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  className={`${secondaryButtonClass} !py-2 disabled:opacity-50 disabled:cursor-not-allowed`}
                  onClick={() => onRestore(v)}
                  disabled={dirty}
                  aria-label={t('emailTemplates.restoreLabel', { version: formatNumber(locale, v.version) })}
                  data-testid={`email-history-restore-${v.version}`}
                >
                  {t('emailTemplates.restore')}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {next ? (
        <div className="flex justify-end">
          <button type="button" className={secondaryButtonClass} onClick={() => void load(next)} data-testid="email-history-more">
            {t('emailTemplates.historyMore')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
