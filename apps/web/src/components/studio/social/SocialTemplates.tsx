'use client';

/**
 * Studio → Social → Post text: one template per event and language ({title}, {channel}, {url}, {text}). Placeholders
 * are inserted with chips; under each template a live preview shows what every connected network would receive,
 * composed and cut by the sender's own code (lib/studio/social-preview.ts → shared-types composePostText).
 */
import { useRef, useState } from 'react';
import {
  SOCIAL_EVENTS,
  STUDIO_AR,
  STUDIO_EN,
  defaultTemplate,
  renderTemplate,
  templateProblems,
  type SocialAccountView,
  type SocialEvent,
  type SocialLanguage,
  type SocialNetwork,
  type SocialPreview,
  type SocialTemplate,
  type SocialTemplateField,
} from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/hooks/useLanguage';
import { socialClient } from '@/lib/studio/social-client';
import { previewTargets, previewText, previewValues, type PreviewTarget } from '@/lib/studio/social-preview';
import { cn } from '@/lib/utils';
import { Notice, Section, fill } from './shared';

const LANGS: SocialLanguage[] = ['en', 'ar'];

/** The placeholders each kind of post can use, in the order the chips show them */
const FIELDS: Record<SocialEvent, SocialTemplateField[]> = {
  video: ['title', 'channel', 'url'],
  short: ['title', 'channel', 'url'],
  live: ['title', 'channel', 'url'],
  post: ['text', 'title', 'channel', 'url'],
};

interface Props {
  channelId: string;
  locale: SocialLanguage;
  templates: SocialTemplate[];
  accounts: SocialAccountView[];
  preview: SocialPreview | null | undefined;
  onTemplates: (t: SocialTemplate[]) => void;
}

export function SocialTemplates({ channelId, locale, templates, accounts, preview, onTemplates }: Props) {
  const { t } = useLanguage();
  const s = t.studio.social;
  const p = s.templates;
  const [draft, setDraft] = useState<SocialTemplate[]>(templates);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const areas = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const body = (event: SocialEvent, lang: SocialLanguage) => draft.find((x) => x.event === event && x.lang === lang)?.body ?? defaultTemplate(event);
  const set = (event: SocialEvent, lang: SocialLanguage, value: string) =>
    setDraft((d) => [...d.filter((x) => !(x.event === event && x.lang === lang)), { event, lang, body: value }]);
  const problemText = (codes: string[]) => codes.map((c) => (p.problems as Record<string, string>)[c] ?? s.errors.generic).join(' ');
  const sorted = (list: SocialTemplate[]) => JSON.stringify([...list].sort((a, b) => `${a.event}${a.lang}`.localeCompare(`${b.event}${b.lang}`)));
  const dirty = sorted(draft) !== sorted(templates);
  const invalid = SOCIAL_EVENTS.some((e) => LANGS.some((l) => templateProblems(e, body(e, l)).length > 0));

  /** Puts `{field}` where the cursor is (or replaces the selection) and keeps typing there. */
  function insert(event: SocialEvent, lang: SocialLanguage, field: SocialTemplateField) {
    const id = `tpl-${event}-${lang}`;
    const el = areas.current[id];
    const value = body(event, lang);
    const token = `{${field}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    set(event, lang, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      const area = areas.current[id];
      if (!area) return;
      area.focus();
      area.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const list = SOCIAL_EVENTS.flatMap((event) => LANGS.map((lang) => ({ event, lang, body: body(event, lang) })));
    const r = await socialClient.saveTemplates(channelId, list);
    setBusy(false);
    if (!r.ok) return setMessage({ tone: 'error', text: s.errors.generic });
    onTemplates(r.data.templates);
    setDraft(r.data.templates);
    setMessage({ tone: 'ok', text: p.saved });
  }

  return (
    <Section id="social-templates" title={p.heading} intro={p.intro} testId="social-templates">
      <p className="mb-4 max-w-prose text-sm text-[var(--fanous-color-text-secondary)]" data-testid="social-templates-hint">{p.hint}</p>
      <div className="space-y-6">
        {SOCIAL_EVENTS.map((event) => (
          <fieldset key={event} className="space-y-2" data-testid={`social-template-${event}`}>
            <legend className="text-sm font-medium">{s.events[event]}</legend>
            <div className="grid gap-4 md:grid-cols-2">
              {LANGS.map((lang) => {
                const id = `tpl-${event}-${lang}`;
                const value = body(event, lang);
                const problems = templateProblems(event, value);
                return (
                  <div key={lang} className="min-w-0 space-y-2">
                    <label htmlFor={id} className="block text-start text-xs text-[var(--fanous-color-text-secondary)]">{s.languages[lang]}</label>
                    <div className="flex flex-wrap gap-2" role="group" aria-label={`${s.events[event]}, ${s.languages[lang]}`} data-testid={`social-template-${event}-${lang}-chips`}>
                      {FIELDS[event].map((field) => (
                        <button
                          key={field}
                          type="button"
                          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium hover:bg-[var(--fanous-color-surface-raised)] focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={fill(p.insert, { field: p.fields[field] })}
                          onClick={() => insert(event, lang, field)}
                          data-testid={`social-chip-${event}-${lang}-${field}`}
                        >
                          <span aria-hidden="true">+</span>
                          {p.fields[field]}
                        </button>
                      ))}
                    </div>
                    <Textarea
                      id={id}
                      ref={(el: HTMLTextAreaElement | null) => {
                        areas.current[id] = el;
                      }}
                      dir={lang === 'ar' ? 'rtl' : 'ltr'}
                      lang={lang}
                      rows={3}
                      value={value}
                      onChange={(e) => set(event, lang, e.target.value)}
                      aria-invalid={problems.length > 0}
                      aria-describedby={problems.length ? `${id}-err` : undefined}
                      data-testid={`social-template-${event}-${lang}`}
                    />
                    {problems.length ? <p id={`${id}-err`} className="text-xs text-[var(--fanous-color-error-text)]">{problemText(problems)}</p> : null}
                    {problems.length ? null : (
                      // The sample is in the template's language, whatever the page's language
                      <PostPreview event={event} lang={lang} locale={locale} template={value} accounts={accounts} preview={preview} sampleTitle={(lang === 'ar' ? STUDIO_AR : STUDIO_EN).social.templates.sample[event]} />
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {message ? <div className="mt-4"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <footer className="mt-4 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={() => setDraft(SOCIAL_EVENTS.flatMap((event) => LANGS.map((lang) => ({ event, lang, body: defaultTemplate(event) }))))}
        >
          {p.reset}
        </Button>
        <Button type="button" className="min-h-11" disabled={!dirty || invalid || busy} onClick={() => void save()} data-testid="social-templates-save">{p.save}</Button>
      </footer>
    </Section>
  );
}

/** What the post will look like: per connected network (tabs), cut as the sender cuts it, with its length. */
function PostPreview({ event, lang, locale, template, accounts, preview, sampleTitle }: {
  event: SocialEvent;
  lang: SocialLanguage;
  locale: SocialLanguage;
  template: string;
  accounts: SocialAccountView[];
  preview: SocialPreview | null | undefined;
  sampleTitle: string;
}) {
  const { t } = useLanguage();
  const s = t.studio.social;
  const p = s.templates;
  const targets = previewTargets(accounts, event);
  const [picked, setPicked] = useState<SocialNetwork | null>(null);
  const target: PreviewTarget | undefined = targets.find((x) => x.network === picked) ?? targets[0];
  const { values, fromSample } = previewValues(event, lang, preview, sampleTitle);
  const composed = target ? previewText(template, event, target, values) : null;
  const text = composed ? composed.text : renderTemplate(template, values);
  const id = `pv-${event}-${lang}`;

  return (
    <div className="rounded-lg border border-border bg-[var(--fanous-color-surface-raised)] p-3" data-testid={`social-preview-${event}-${lang}`} data-network={target?.network ?? ''}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-h`} className="text-xs font-medium">{p.preview}</p>
        {targets.length > 1 ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label={p.previewFor}>
            {targets.map((x) => (
              <button
                key={x.network}
                type="button"
                aria-pressed={x.network === target?.network}
                className={cn(
                  'min-h-9 rounded-full border px-3 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  x.network === target?.network ? 'border-current text-[var(--fanous-color-text-primary)]' : 'border-border text-[var(--fanous-color-text-secondary)]',
                )}
                onClick={() => setPicked(x.network)}
                data-testid={`social-preview-tab-${x.network}`}
              >
                {s.networks[x.network]}
              </button>
            ))}
          </div>
        ) : target ? (
          <span className="text-xs text-[var(--fanous-color-text-secondary)]">{s.networks[target.network]}</span>
        ) : null}
      </div>
      <p
        dir={lang === 'ar' ? 'rtl' : 'ltr'}
        lang={lang}
        // Each paragraph takes its own direction (an English post in the Arabic column still reads left to right)
        className="whitespace-pre-wrap break-words text-start text-sm [unicode-bidi:plaintext]"
        aria-labelledby={`${id}-h`}
        aria-live="polite"
        data-testid={`social-preview-text-${event}-${lang}`}
      >
        {text}
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 text-xs text-[var(--fanous-color-text-secondary)]">
        <span>{fromSample ? p.fromSample : p.fromLatest}</span>
        {composed ? (
          <span dir="ltr" className={composed.cut ? 'text-[var(--fanous-color-error-text)]' : undefined} data-testid={`social-preview-count-${event}-${lang}`}>
            {fill(p.count, { length: composed.length, limit: composed.limit }, locale)}
          </span>
        ) : null}
      </div>
      {composed?.cut && target ? (
        <p className="mt-1 text-xs text-[var(--fanous-color-error-text)]" data-testid={`social-preview-cut-${event}-${lang}`}>
          <bdi>{fill(p.cut, { network: s.networks[target.network], full: composed.fullLength, limit: composed.limit }, locale)}</bdi>
        </p>
      ) : null}
    </div>
  );
}
