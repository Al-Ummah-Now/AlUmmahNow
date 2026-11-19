'use client';

/**
 * The `versions` document (issue #413): one entry per app and platform (or every platform of an
 * app) with its minimum version, latest version and store link, each problem under its field.
 */
import { useId } from 'react';
import { APP_CONFIG_APPS, APP_CONFIG_PLATFORMS } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import { dangerButtonClass, smallButtonClass } from '@/components/content/parts';
import { newVersion, problemsFor, type Problem, type VersionDraft } from './app-config-model';
import { FieldProblems } from './RuleList';
import { Select } from '@/components/select/Select';

interface Props {
  drafts: VersionDraft[];
  onChange: (drafts: VersionDraft[]) => void;
  problems: Problem[];
  disabled?: boolean;
}

export function VersionList({ drafts, onChange, problems, disabled }: Props) {
  const { t } = useLanguage();
  const update = (id: string, patch: Partial<VersionDraft>) => onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const add = () => {
    const entry = newVersion();
    onChange([...drafts, entry]);
    window.setTimeout(() => document.getElementById(`${entry.id}-app`)?.focus(), 0);
  };
  return (
    <div className="space-y-3" data-testid="app-config-versions">
      {drafts.length === 0 && <p className="rounded border border-dashed border-border p-4 text-sm text-fg-muted">{t('appConfig.empty.versions')}</p>}
      <ol className="space-y-3">
        {drafts.map((d, i) => (
          <VersionCard key={d.id} draft={d} n={i + 1} onChange={(patch) => update(d.id, patch)} onRemove={() => onChange(drafts.filter((x) => x.id !== d.id))} problems={problems.filter((p) => p.id === d.id)} disabled={disabled} />
        ))}
      </ol>
      <button type="button" className={smallButtonClass} onClick={add} disabled={disabled} data-testid="app-config-add-versions">
        {t('appConfig.addEntry')}
      </button>
    </div>
  );
}

function VersionCard({ draft: d, n, onChange, onRemove, problems, disabled }: { draft: VersionDraft; n: number; onChange: (patch: Partial<VersionDraft>) => void; onRemove: () => void; problems: Problem[]; disabled?: boolean }) {
  const { t } = useLanguage();
  const ids = useId();
  const describedBy = (name: string, hint: boolean) => [hint ? `${ids}-${name}-hint` : '', problemsFor(problems, d.id, name).length ? `${ids}-${name}-problem` : ''].filter(Boolean).join(' ') || undefined;
  const text = (name: 'minimumVersion' | 'latestVersion' | 'storeUrl', hint: MessageKey) => {
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
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('minimumVersion', 'appConfig.minimumHint')}
          {text('latestVersion', 'appConfig.latestHint')}
        </div>
        {text('storeUrl', 'appConfig.storeUrlHint')}
        {problemsFor(problems, d.id, '').length > 0 && <FieldProblems problems={problemsFor(problems, d.id, '')} id={`${ids}-entry-problem`} />}
      </div>
    </li>
  );
}
