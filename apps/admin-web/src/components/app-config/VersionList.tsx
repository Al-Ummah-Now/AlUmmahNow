'use client';

/**
 * The `versions` document (issue #413): one entry per app and platform (or every platform of an
 * app) with its minimum version, store link, message and notes, each problem under its field. The latest version
 * comes from the releases list; one stored by an older document is shown read-only.
 */
import { useId } from 'react';
import { APP_CONFIG_APPS, APP_CONFIG_PLATFORMS, localizeDigits } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import { dangerButtonClass, smallButtonClass } from '@/components/content/parts';
import { NOTES_OVERRIDES_MAX, newNotesOverride, newVersion, problemsFor, type NotesOverrideDraft, type Problem, type VersionDraft } from './app-config-model';
import { FieldProblems } from './RuleList';
import { Select } from '@/components/select/Select';

interface Props {
  drafts: VersionDraft[];
  onChange: (drafts: VersionDraft[]) => void;
  problems: Problem[];
  disabled?: boolean;
  /** An admin who can only look: no add or remove buttons at all */
  readOnly?: boolean;
}

export function VersionList({ drafts, onChange, problems, disabled, readOnly }: Props) {
  const { t } = useLanguage();
  const update = (id: string, patch: Partial<VersionDraft>) => onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const add = () => {
    const entry = newVersion();
    onChange([...drafts, entry]);
    window.setTimeout(() => document.getElementById(`${entry.id}-app`)?.focus(), 0);
  };
  return (
    <div className="space-y-3" data-testid="app-config-versions">
      <FieldProblems problems={problems.filter((p) => p.id === '')} id="app-config-versions-problem" />
      {drafts.length === 0 && <p className="rounded border border-dashed border-border p-4 text-sm text-fg-muted">{t('appConfig.empty.versions')}</p>}
      <ol className="space-y-3">
        {drafts.map((d, i) => (
          <VersionCard key={d.id} draft={d} n={i + 1} onChange={(patch) => update(d.id, patch)} onRemove={() => onChange(drafts.filter((x) => x.id !== d.id))} problems={problems.filter((p) => p.id === d.id)} disabled={disabled} readOnly={readOnly} />
        ))}
      </ol>
      {!readOnly && (
        <button type="button" className={smallButtonClass} onClick={add} disabled={disabled} data-testid="app-config-add-versions">
          {t('appConfig.addEntry')}
        </button>
      )}
    </div>
  );
}

function VersionCard({ draft: d, n, onChange, onRemove, problems, disabled, readOnly }: { draft: VersionDraft; n: number; onChange: (patch: Partial<VersionDraft>) => void; onRemove: () => void; problems: Problem[]; disabled?: boolean; readOnly?: boolean }) {
  const { t } = useLanguage();
  const ids = useId();
  const describedBy = (name: string, hint: boolean) => [hint ? `${ids}-${name}-hint` : '', problemsFor(problems, d.id, name).length ? `${ids}-${name}-problem` : ''].filter(Boolean).join(' ') || undefined;
  const text = (name: 'minimumVersion' | 'storeUrl', hint: MessageKey) => {
    const found = problemsFor(problems, d.id, name);
    return (
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="text-fg-muted">{t(`appConfig.${name}` as MessageKey)}</span>
        <input
          id={`${d.id}-${name}`}
          value={d[name]}
          onChange={(e) => onChange({ [name]: e.target.value })}
          disabled={disabled}
          dir="ltr"
          type={name === 'storeUrl' ? 'url' : 'text'}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={found.length > 0 || undefined}
          aria-describedby={describedBy(name, true)}
          className={`${fieldClass} w-full ${name === 'storeUrl' ? '' : 'font-mono'}`}
          data-testid={`app-config-version-${name}`}
        />
        <span id={`${ids}-${name}-hint`} className="text-xs text-fg-subtle">
          {t(hint)}
        </span>
        <FieldProblems problems={found} id={`${ids}-${name}-problem`} />
      </label>
    );
  };
  const platformProblems = problemsFor(problems, d.id, 'platform');
  if (readOnly) return <VersionSummary draft={d} n={n} />;
  return (
    <li className="rounded-lg border border-border bg-surface p-4" data-testid="app-config-version" data-target={`${d.app}/${d.platform}`}>
      <div role="group" aria-labelledby={`${ids}-title`} className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${ids}-title`} className="text-sm font-medium text-fg">
            {t('appConfig.entry', { n })}
          </h3>
          <button type="button" className={`${dangerButtonClass} min-h-11 min-w-11`} onClick={onRemove} disabled={disabled} aria-label={t('appConfig.removeEntry', { n })} data-testid="app-config-version-remove">
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="text-fg-muted">{t('appConfig.app')}</span>
            <Select id={`${d.id}-app`} value={d.app} disabled={disabled} onChange={(e) => onChange({ app: e.target.value })} className={`${fieldClass} w-full`} data-testid="app-config-version-app">
              {APP_CONFIG_APPS.map((a) => (
                <option key={a} value={a}>
                  {t(`appConfig.appNames.${a}` as MessageKey)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="text-fg-muted">{t('appConfig.platform')}</span>
            <Select
              value={d.platform}
              disabled={disabled}
              onChange={(e) => onChange({ platform: e.target.value })}
              aria-invalid={platformProblems.length > 0 || undefined}
              aria-describedby={describedBy('platform', false)}
              className={`${fieldClass} w-full`}
              data-testid="app-config-version-platform"
            >
              <option value="*">{t('appConfig.allPlatforms')}</option>
              {APP_CONFIG_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {t(`appConfig.platformNames.${p}` as MessageKey)}
                </option>
              ))}
            </Select>
            <FieldProblems problems={platformProblems} id={`${ids}-platform-problem`} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="text-fg-muted">{t('appConfig.channel')}</span>
            <Select value={d.channel} disabled={disabled} onChange={(e) => onChange({ channel: e.target.value === 'beta' ? 'beta' : '' })} className={`${fieldClass} w-full`} data-testid="app-config-version-channel">
              <option value="">{t('appConfig.channelAll')}</option>
              <option value="beta">{t('appConfig.channelBeta')}</option>
            </Select>
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('minimumVersion', 'appConfig.minimumHint')}
          {d.latestVersion && (
            <div className="flex min-w-0 flex-col gap-1 text-sm" data-testid="app-config-version-latest">
              <span className="text-fg-muted">{t('appConfig.latestVersion')}</span>
              <bdi dir="ltr" className="py-2 font-mono text-fg">{d.latestVersion}</bdi>
              <span className="text-xs text-fg-subtle">{t('appConfig.latestHint')}</span>
            </div>
          )}
        </div>
        {text('storeUrl', 'appConfig.storeUrlHint')}
        <div className="grid gap-4 sm:grid-cols-2">
          <LocalizedArea id={`${d.id}-messageEn`} label={t('appConfig.messageEn')} value={d.messageEn} dir="ltr" lang="en" disabled={disabled} problems={problemsFor(problems, d.id, 'messageEn')} onChange={(v) => onChange({ messageEn: v })} testId="app-config-version-message-en" />
          <LocalizedArea id={`${d.id}-messageAr`} label={t('appConfig.messageAr')} value={d.messageAr} dir="rtl" lang="ar" disabled={disabled} problems={problemsFor(problems, d.id, 'messageAr')} onChange={(v) => onChange({ messageAr: v })} testId="app-config-version-message-ar" />
        </div>
        <p className="text-xs text-fg-subtle">{t('appConfig.messageHint')}</p>
        <NotesOverrides
          items={d.notesOverrides}
          disabled={disabled}
          problems={problems.filter((p) => p.id === d.id)}
          onChange={(notesOverrides) => onChange({ notesOverrides })}
        />
        {problemsFor(problems, d.id, '').length > 0 && <FieldProblems problems={problemsFor(problems, d.id, '')} id={`${ids}-entry-problem`} />}
      </div>
    </li>
  );
}

/** An entry for admins who can only look: its values as text, not fields that can't be used. */
function VersionSummary({ draft: d, n }: { draft: VersionDraft; n: number }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const line = (label: MessageKey, value: React.ReactNode) => (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="shrink-0 text-fg-muted sm:w-56">{t(label)}</dt>
      <dd className="min-w-0 break-words text-fg">{value}</dd>
    </div>
  );
  return (
    <li className="rounded-lg border border-border bg-surface p-4 text-sm" data-testid="app-config-version" data-target={`${d.app}/${d.platform}`} aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className="mb-3 font-medium text-fg">
        {t('appConfig.entry', { n })}
      </h3>
      <dl className="space-y-2">
        {line('appConfig.app', t(`appConfig.appNames.${d.app}` as MessageKey))}
        {line('appConfig.platform', d.platform === '*' ? t('appConfig.allPlatforms') : t(`appConfig.platformNames.${d.platform}` as MessageKey))}
        {line('appConfig.channel', t(d.channel === 'beta' ? 'appConfig.channelBeta' : 'appConfig.channelAll'))}
        {line('appConfig.minimumVersion', <bdi dir="ltr">{localizeDigits(locale, d.minimumVersion)}</bdi>)}
        {d.storeUrl && line('appConfig.storeUrl', <bdi dir="ltr">{d.storeUrl}</bdi>)}
        {d.messageEn && line('appConfig.messageEn', <span lang="en" dir="ltr">{d.messageEn}</span>)}
        {d.messageAr && line('appConfig.messageAr', <span lang="ar" dir="rtl">{d.messageAr}</span>)}
        {d.notesOverrides.map((o) => (
          <div key={o.id} className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="shrink-0 text-fg-muted sm:w-56">
              {t('appConfig.notesVersion')} <bdi dir="ltr">{localizeDigits(locale, o.version)}</bdi>
            </dt>
            <dd className="min-w-0 space-y-1 break-words text-fg">
              <p lang="en" dir="ltr">{o.en}</p>
              <p lang="ar" dir="rtl">{o.ar}</p>
            </dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

function LocalizedArea({ id, label, value, dir, lang, disabled, problems, onChange, testId }: { id: string; label: string; value: string; dir: 'ltr' | 'rtl'; lang: string; disabled?: boolean; problems: Problem[]; onChange: (value: string) => void; testId: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-sm">
      <span className="text-fg-muted">{label}</span>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        dir={dir}
        lang={lang}
        rows={2}
        aria-invalid={problems.length > 0 || undefined}
        aria-describedby={problems.length ? `${id}-problem` : undefined}
        className={`${fieldClass} w-full`}
        data-testid={testId}
      />
      <FieldProblems problems={problems} id={`${id}-problem`} />
    </label>
  );
}

/** Release notes for one version only (wiki AUN-APP-UPDATES §3.4): version, English and Arabic, at most five. */
function NotesOverrides({ items, disabled, problems, onChange }: { items: NotesOverrideDraft[]; disabled?: boolean; problems: Problem[]; onChange: (items: NotesOverrideDraft[]) => void }) {
  const { t } = useLanguage();
  const ids = useId();
  const update = (id: string, patch: Partial<NotesOverrideDraft>) => onChange(items.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const at = (o: NotesOverrideDraft, field: string) => problems.filter((p) => p.field === `notes.${o.id}.${field}`);
  return (
    <fieldset className="min-w-0 space-y-3 rounded-md border border-border p-3" aria-describedby={`${ids}-hint`} data-testid="app-config-version-notes">
      <legend className="px-1 text-sm font-medium text-fg">{t('appConfig.notesTitle')}</legend>
      <p id={`${ids}-hint`} className="text-xs text-fg-subtle">
        {t('appConfig.notesHint')}
      </p>
      {items.map((o) => (
        <div key={o.id} className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)_auto]" data-testid="app-config-version-notes-row">
          <label className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="text-fg-muted">{t('appConfig.notesVersion')}</span>
            <input value={o.version} onChange={(e) => update(o.id, { version: e.target.value })} disabled={disabled} dir="ltr" spellCheck={false} autoComplete="off" className={`${fieldClass} w-full font-mono`} aria-invalid={at(o, 'version').length > 0 || undefined} aria-describedby={at(o, 'version').length ? `${o.id}-version-problem` : undefined} data-testid="app-config-version-notes-version" />
            <FieldProblems problems={at(o, 'version')} id={`${o.id}-version-problem`} />
          </label>
          <LocalizedArea id={`${o.id}-en`} label={t('appConfig.notesEn')} value={o.en} dir="ltr" lang="en" disabled={disabled} problems={at(o, 'en')} onChange={(v) => update(o.id, { en: v })} testId="app-config-version-notes-en" />
          <LocalizedArea id={`${o.id}-ar`} label={t('appConfig.notesAr')} value={o.ar} dir="rtl" lang="ar" disabled={disabled} problems={at(o, 'ar')} onChange={(v) => update(o.id, { ar: v })} testId="app-config-version-notes-ar" />
          <button type="button" className={`${dangerButtonClass} min-h-11 min-w-11 self-start justify-self-end sm:mt-6`} onClick={() => onChange(items.filter((x) => x.id !== o.id))} disabled={disabled} aria-label={t('appConfig.removeNotes', { version: o.version || '—' })}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
      <FieldProblems problems={problems.filter((p) => p.field === 'notesOverrides')} id={`${ids}-notes-problem`} />
      <button type="button" className={smallButtonClass} onClick={() => onChange([...items, newNotesOverride()])} disabled={disabled || items.length >= NOTES_OVERRIDES_MAX} data-testid="app-config-version-notes-add">
        {t('appConfig.addNotes')}
      </button>
    </fieldset>
  );
}
