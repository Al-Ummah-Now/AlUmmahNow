'use client';

/**
 * The rules of the `flags` or `config` document (issue #413), in order: the first rule that
 * matches a build decides its key. Each rule folds to one line saying where it applies; open, it
 * edits key, on/off, platforms, apps, version range, languages, rollout, value and note, with each
 * problem under its field. Rules move up and down with buttons (announced), never by dragging only.
 */
import { formatNumber } from '@/i18n/translate';
import { useId, useState } from 'react';
import { APP_CONFIG_APPS, APP_CONFIG_PLATFORMS } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { fieldClass } from '@/components/ui';
import { dangerButtonClass, smallButtonClass } from '@/components/content/parts';
import { moveItem, newRule, problemsFor, ruleScope, type Problem, type RuleDraft, type RulesKind } from './app-config-model';

interface Props {
  kind: RulesKind;
  drafts: RuleDraft[];
  onChange: (drafts: RuleDraft[]) => void;
  problems: Problem[];
  disabled?: boolean;
}

export function FieldProblems({ problems, id }: { problems: Problem[]; id: string }) {
  const { t } = useLanguage();
  if (!problems.length) return null;
  return (
    <span id={id} className="block text-xs text-danger-fg" data-testid="app-config-problem">
      {problems.map((p) => (p.code === 'server' ? t('appConfig.problems.server', { detail: p.detail ?? '' }) : t(`appConfig.problems.${p.code}` as MessageKey))).join(' ')}
    </span>
  );
}

export function RuleList({ kind, drafts, onChange, problems, disabled }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<Set<string>>(() => new Set(drafts.length <= 3 ? drafts.map((d) => d.id) : []));
  const [announce, setAnnounce] = useState('');
  const withProblems = new Set(problems.map((p) => p.id));

  const update = (id: string, patch: Partial<RuleDraft>) => onChange(drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const toggle = (id: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const move = (index: number, by: -1 | 1) => {
    onChange(moveItem(drafts, index, by));
    setAnnounce(t(by === -1 ? 'appConfig.moveUp' : 'appConfig.moveDown', { n: index + 1 }));
    // Keep the focus on the same button of the moved rule
    window.setTimeout(() => document.getElementById(`${drafts[index].id}-${by === -1 ? 'up' : 'down'}`)?.focus(), 0);
  };
  const add = () => {
    const rule = newRule(kind);
    onChange([...drafts, rule]);
    setOpen((s) => new Set(s).add(rule.id));
    window.setTimeout(() => document.getElementById(`${rule.id}-key`)?.focus(), 0);
  };

  return (
    <div className="space-y-3" data-testid={`app-config-rules-${kind}`}>
      {drafts.length === 0 && <p className="rounded border border-dashed border-border p-4 text-sm text-fg-muted">{t(`appConfig.empty.${kind}`)}</p>}
      <ol className="space-y-3">
        {drafts.map((d, i) => (
          <RuleCard
            key={d.id}
            kind={kind}
            draft={d}
            index={i}
            count={drafts.length}
            open={open.has(d.id) || withProblems.has(d.id)}
            onToggle={() => toggle(d.id)}
            onChange={(patch) => update(d.id, patch)}
            onMove={(by) => move(i, by)}
            onRemove={() => onChange(drafts.filter((x) => x.id !== d.id))}
            problems={problems.filter((p) => p.id === d.id)}
            disabled={disabled}
          />
        ))}
      </ol>
      <button type="button" className={smallButtonClass} onClick={add} disabled={disabled} data-testid={`app-config-add-${kind}`}>
        {t('appConfig.addRule')}
      </button>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

function RuleCard({
  kind,
  draft: d,
  index,
  count,
  open,
  onToggle,
  onChange,
  onMove,
  onRemove,
  problems,
  disabled,
}: {
  kind: RulesKind;
  draft: RuleDraft;
  index: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<RuleDraft>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  problems: Problem[];
  disabled?: boolean;
}) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const n = index + 1;
  const scope = ruleScope(d);
  const title = d.key.trim() ? t('appConfig.rule', { n }) : t('appConfig.ruleNoKey', { n });
  const facts = [
    ...scope.platforms.map((p) => t(`appConfig.platformNames.${p}` as MessageKey)),
    ...scope.apps.map((a) => t(`appConfig.appNames.${a}` as MessageKey)),
    scope.versions,
    scope.locales.join(', ') || null,
    scope.rollout,
  ].filter(Boolean) as string[];
  const field = (name: keyof RuleDraft) => ({ id: `${d.id}-${name}`, problems: problemsFor(problems, d.id, name) });
  const describedBy = (name: string, hint = true) => [hint ? `${ids}-${name}-hint` : '', problemsFor(problems, d.id, name).length ? `${ids}-${name}-problem` : ''].filter(Boolean).join(' ') || undefined;

  const text = (name: 'key' | 'minVersion' | 'maxVersion' | 'locales' | 'rollout' | 'note', label: MessageKey, hint: MessageKey, opts: { mono?: boolean; inputMode?: 'decimal' } = {}) => {
    const f = field(name);
    return (
      <label className="flex min-w-0 flex-col gap-1 text-sm">
        <span className="text-fg-muted">{t(label)}</span>
        <input
          id={f.id}
          value={d[name]}
          onChange={(e) => onChange({ [name]: e.target.value })}
          disabled={disabled}
          dir={name === 'note' ? 'auto' : 'ltr'}
          inputMode={opts.inputMode}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={f.problems.length > 0 || undefined}
          aria-describedby={describedBy(name)}
          className={`${fieldClass} w-full ${opts.mono ? 'font-mono' : ''}`}
          data-testid={`app-config-rule-${name}`}
        />
        <span id={`${ids}-${name}-hint`} className="text-xs text-fg-subtle">
          {t(hint)}
        </span>
        <FieldProblems problems={f.problems} id={`${ids}-${name}-problem`} />
      </label>
    );
  };

  const checks = (name: 'platforms' | 'apps', values: readonly string[], label: MessageKey, names: string) => (
    <fieldset className="min-w-0">
      <legend className="text-sm text-fg-muted">{t(label)}</legend>
      <div className={`mt-1 grid gap-x-4 gap-y-0 sm:gap-y-1 ${name === 'platforms' ? 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]'}`}>
        {values.map((v) => (
          <label key={v} className="flex min-h-11 items-center gap-2 text-sm text-fg sm:min-h-6">
            <input
              type="checkbox"
              checked={d[name].includes(v)}
              disabled={disabled}
              onChange={(e) => onChange({ [name]: e.target.checked ? [...d[name], v] : d[name].filter((x) => x !== v) })}
              className="h-6 w-6 sm:h-4 sm:w-4"
              data-testid={`app-config-rule-${name}-${v}`}
            />
            {t(`appConfig.${names}.${v}` as MessageKey)}
          </label>
        ))}
      </div>
      <p className="mt-1 text-xs text-fg-subtle">{t('appConfig.noneTicked')}</p>
    </fieldset>
  );

  const valueField = field('value');
  return (
    <li className="rounded-lg border border-border bg-surface" data-testid="app-config-rule" data-key={d.key}>
      <div className="flex flex-wrap items-center gap-2 p-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${ids}-body`}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded px-1 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          data-testid="app-config-rule-toggle"
        >
          <span aria-hidden="true" className={`text-fg-muted transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : 'rtl:rotate-180'}`}>
            ›
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="text-sm text-fg-muted">{title}</span>
              {d.key.trim() && (
                <bdi dir="ltr" className="font-mono text-sm font-medium text-fg [overflow-wrap:anywhere]">
                  {d.key.trim()}
                </bdi>
              )}
              {!d.enabled && <span className="rounded-full border border-border bg-surface-2 px-2 text-xs text-fg-muted">{t('appConfig.ruleOff')}</span>}
              {problems.length > 0 && <span className="rounded-full border border-danger-border bg-danger-bg px-2 text-xs text-danger-fg">{formatNumber(problems.length, locale)}</span>}
            </span>
            <span className="text-xs text-fg-muted [overflow-wrap:anywhere]">{facts.length ? facts.join(t('common.sep')) : t('appConfig.everywhere')}</span>
          </span>
        </button>
        <div className="flex shrink-0 gap-1">
          <button type="button" id={`${d.id}-up`} className={`${smallButtonClass} min-h-11 min-w-11`} onClick={() => onMove(-1)} disabled={disabled || index === 0} aria-label={t('appConfig.moveUp', { n })} data-testid="app-config-rule-up">
            <span aria-hidden="true">↑</span>
          </button>
          <button type="button" id={`${d.id}-down`} className={`${smallButtonClass} min-h-11 min-w-11`} onClick={() => onMove(1)} disabled={disabled || index === count - 1} aria-label={t('appConfig.moveDown', { n })} data-testid="app-config-rule-down">
            <span aria-hidden="true">↓</span>
          </button>
          <button type="button" className={`${dangerButtonClass} min-h-11 min-w-11`} onClick={onRemove} disabled={disabled} aria-label={t('appConfig.removeRule', { n })} data-testid="app-config-rule-remove">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </div>
      <div id={`${ids}-body`} hidden={!open} className="space-y-4 border-t border-border p-4">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          {text('key', 'appConfig.key', 'appConfig.keyHint', { mono: true })}
          <label className="flex min-h-11 items-center gap-2 text-sm text-fg sm:mt-6">
            <input type="checkbox" checked={d.enabled} disabled={disabled} onChange={(e) => onChange({ enabled: e.target.checked })} aria-describedby={`${ids}-enabled-hint`} className="h-6 w-6 sm:h-4 sm:w-4" data-testid="app-config-rule-enabled" />
            {t('appConfig.enabled')}
          </label>
        </div>
        <p id={`${ids}-enabled-hint`} className="-mt-3 text-xs text-fg-subtle">
          {t(`appConfig.enabledHint.${kind}`)}
        </p>
        {checks('platforms', APP_CONFIG_PLATFORMS, 'appConfig.platforms', 'platformNames')}
        {checks('apps', APP_CONFIG_APPS, 'appConfig.apps', 'appNames')}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {text('minVersion', 'appConfig.minVersion', 'appConfig.versionHint', { mono: true })}
          {text('maxVersion', 'appConfig.maxVersion', 'appConfig.versionHint', { mono: true })}
          {text('locales', 'appConfig.locales', 'appConfig.localesHint')}
          {text('rollout', 'appConfig.rollout', 'appConfig.rolloutHint', { inputMode: 'decimal' })}
        </div>
        <label className="flex min-w-0 flex-col gap-1 text-sm">
          <span className="text-fg-muted">{t('appConfig.value')}</span>
          <textarea
            id={valueField.id}
            value={d.value}
            rows={2}
            onChange={(e) => onChange({ value: e.target.value })}
            disabled={disabled}
            dir="ltr"
            spellCheck={false}
            aria-invalid={valueField.problems.length > 0 || undefined}
            aria-describedby={describedBy('value')}
            className={`${fieldClass} w-full font-mono`}
            data-testid="app-config-rule-value"
          />
          <span id={`${ids}-value-hint`} className="text-xs text-fg-subtle">
            {t(`appConfig.valueHint.${kind}`)}
          </span>
          <FieldProblems problems={valueField.problems} id={`${ids}-value-problem`} />
        </label>
        {text('note', 'appConfig.note', 'appConfig.noteHint')}
        {problemsFor(problems, d.id, '').length > 0 && <FieldProblems problems={problemsFor(problems, d.id, '')} id={`${ids}-rule-problem`} />}
      </div>
    </li>
  );
}
