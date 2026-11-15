'use client';

/** Studio → Social → Post text: one template per event and language ({title}, {channel}, {url}, {text}). */
import { useState } from 'react';
import { SOCIAL_EVENTS, defaultTemplate, templateProblems, type SocialEvent, type SocialLanguage, type SocialTemplate } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useLanguage } from '@/hooks/useLanguage';
import { socialClient } from '@/lib/studio/social-client';
import { Notice, Section } from './shared';

const LANGS: SocialLanguage[] = ['en', 'ar'];

export function SocialTemplates({ channelId, templates, onTemplates }: { channelId: string; templates: SocialTemplate[]; onTemplates: (t: SocialTemplate[]) => void }) {
  const { t } = useLanguage();
  const s = t.studio.social;
  const p = s.templates;
  const [draft, setDraft] = useState<SocialTemplate[]>(templates);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const body = (event: SocialEvent, lang: SocialLanguage) => draft.find((x) => x.event === event && x.lang === lang)?.body ?? defaultTemplate(event);
  const set = (event: SocialEvent, lang: SocialLanguage, value: string) =>
    setDraft((d) => [...d.filter((x) => !(x.event === event && x.lang === lang)), { event, lang, body: value }]);
  const problemText = (codes: string[]) => codes.map((c) => (p.problems as Record<string, string>)[c] ?? s.errors.generic).join(' ');
  const dirty = JSON.stringify([...draft].sort((a, b) => `${a.event}${a.lang}`.localeCompare(`${b.event}${b.lang}`))) !== JSON.stringify([...templates].sort((a, b) => `${a.event}${a.lang}`.localeCompare(`${b.event}${b.lang}`)));
  const invalid = SOCIAL_EVENTS.some((e) => LANGS.some((l) => templateProblems(e, body(e, l)).length > 0));

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
      <div className="space-y-5">
        {SOCIAL_EVENTS.map((event) => (
          <fieldset key={event} className="space-y-2" data-testid={`social-template-${event}`}>
            <legend className="text-sm font-medium">{s.events[event]}</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {LANGS.map((lang) => {
                const id = `tpl-${event}-${lang}`;
                const value = body(event, lang);
                const problems = templateProblems(event, value);
                return (
                  <div key={lang} className="space-y-1">
                    <label htmlFor={id} className="text-xs text-[var(--fanous-color-text-secondary)]">{s.languages[lang]}</label>
                    <Textarea
                      id={id}
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
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {message ? <div className="mt-4"><Notice tone={message.tone}>{message.text}</Notice></div> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" className="min-h-11" disabled={!dirty || invalid || busy} onClick={() => void save()} data-testid="social-templates-save">{p.save}</Button>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          onClick={() => setDraft(SOCIAL_EVENTS.flatMap((event) => LANGS.map((lang) => ({ event, lang, body: defaultTemplate(event) }))))}
        >
          {p.reset}
        </Button>
      </div>
    </Section>
  );
}
