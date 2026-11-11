'use client';

/**
 * The Live streaming page (D3): routing mode and split, each provider's
 * switches, caps and rates with live usage, failover, self-hosted options,
 * channel overrides, active and recent sessions, the provider comparison and
 * the history of changes.
 *
 * Owner rules: reversible changes (mode, split, drain, toggles, limits,
 * overrides, moves) act at once and offer Undo; turning a provider off and
 * ending a session ask first in the in-app dialog (never a browser prompt).
 * Every change goes through admin-api, which checks live:manage and audits it.
 */
import { useCallback, useEffect, useId, useState } from 'react';
import type { LiveComparison, LiveProviderId, LiveRoutingMode, LiveRoutingPatch, LiveRoutingSettings } from '@al-ummah/shared-types';
import { LIVE_ROUTING_MODES } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { useConfirm } from '@/components/content/actions';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { Autocomplete } from '@/components/search/Autocomplete';
import { cardClass, fieldClass, linkClass } from '@/components/ui';
import { ProviderLineChart } from './ProviderLineChart';
import { AdminClientError, contentRequest } from '@/lib/list/api-client';
import { describeActionError } from '@/lib/list/describe-error';
import { reportError } from '@/lib/errors/reporter';
import { logger } from '@/lib/logger-client';
import type { LiveAuditEntry, LiveSettingsView } from '@/lib/api/live';
import {
  COMPARISON_ROWS,
  LIVE_PROVIDERS,
  SESSION_REASONS,
  SPLIT_STEP,
  applyPatch,
  auditTarget,
  betterOf,
  changeLines,
  chartSeries,
  clampSplit,
  isActiveSession,
  isStuck,
  metricFormatter,
  modePatch,
  needsConfirm,
  otherLiveProvider,
  overrideUndo,
  parseAmount,
  parseLimit,
  splitLabel,
  statsFor,
  undoPatchFor,
  type ChartMetric,
  type LiveSessionItem,
  type MetricFormat,
  type OverrideUndo,
} from '@/lib/live-streaming';

interface Initial {
  view: LiveSettingsView | null;
  active: LiveSessionItem[];
  recent: LiveSessionItem[];
  comparison: LiveComparison | null;
  audit: LiveAuditEntry[];
}

const smallButton =
  'rounded border border-border bg-surface-2 px-3 py-1.5 text-sm text-fg hover:bg-surface-hover disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const primarySmall =
  'rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const dangerSmall =
  'rounded border border-danger-border bg-danger-bg px-3 py-1.5 text-sm text-danger-fg hover:opacity-90 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const sectionTitle = 'text-lg font-semibold text-fg';

type Put = { previous: LiveRoutingSettings; current: LiveRoutingSettings };

export function LiveStreamingView({ initial, loadFailed, range, canManage }: { initial: Initial; loadFailed: boolean; range: { from: string; to: string; tests: boolean }; canManage: boolean }) {
  const { t, locale } = useLanguage();
  const undoable = useUndoableAction();
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<LiveSettingsView | null>(initial.view);
  const [active, setActive] = useState(initial.active);
  const [recent, setRecent] = useState(initial.recent);
  const [audit, setAudit] = useState(initial.audit);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const providerName = (p: LiveProviderId) => t(`live.providerShort.${p}` as MessageKey);

  const fail = useCallback(
    (e: unknown) => {
      const status = e instanceof AdminClientError ? e.status : 0;
      if (status === 0 || status >= 500) reportError(e, { shown: true, status, extra: { where: 'live-streaming' } });
      else logger.debug('[live-streaming] Change refused', { status });
      setError(describeActionError(t, e));
    },
    [t],
  );

  const refreshAudit = useCallback(async () => {
    try {
      setAudit((await contentRequest<{ items: LiveAuditEntry[] }>('GET', 'live/audit', { query: { limit: 50 } })).items);
    } catch (e) {
      logger.warn('[live-streaming] History refresh failed', { error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  const refreshView = useCallback(async () => {
    setView(await contentRequest<LiveSettingsView>('GET', 'live/settings'));
  }, []);

  const refreshSessions = useCallback(async () => {
    const [a, r] = await Promise.all([
      contentRequest<{ items: LiveSessionItem[] }>('GET', 'live/sessions', { query: { status: 'active', limit: 50 } }),
      contentRequest<{ items: LiveSessionItem[] }>('GET', 'live/sessions', { query: { status: 'recent', limit: 50 } }),
    ]);
    setActive(a.items);
    setRecent(r.items);
  }, []);

  /** Runs one change: one at a time, its error shown in the admin's words, the history refreshed after. */
  const run = useCallback(
    async (key: string, change: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        await change();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(null);
        void refreshAudit();
      }
    },
    [fail, refreshAudit],
  );

  const putSettings = useCallback(async (patch: LiveRoutingPatch) => {
    const out = await contentRequest<Put>('PUT', 'live/settings', { body: patch });
    setView((v) => (v ? { ...v, settings: out.current } : v));
    return out;
  }, []);

  /**
   * A settings change. Turning a provider off asks first and has no Undo
   * (turning it on again is the way back); everything else acts at once and
   * offers Undo, which sends back the values it replaced.
   */
  const change = useCallback(
    async (key: string, patch: LiveRoutingPatch, message: string) => {
      if (!view) return;
      const before = view.settings;
      const off = needsConfirm(before, patch);
      if (off) {
        const name = t(`live.providers.${off}` as MessageKey);
        const ok = await confirm({
          title: t('live.provider.disableTitle', { provider: name }),
          body: t('live.provider.disableBody', { provider: name }),
          confirmLabel: t('live.provider.disableConfirm'),
          danger: true,
          testId: 'live-disable',
        });
        if (!ok) return;
        await run(key, async () => {
          await putSettings(patch);
          setNotice(message);
        });
        return;
      }
      setView((v) => (v ? { ...v, settings: applyPatch(v.settings, patch) } : v));
      await run(key, async () => {
        try {
          await undoable.run({
            action: async () => {
              await putSettings(patch);
              return undoPatchFor(before, patch);
            },
            undo: async (previous) => {
              await putSettings(previous);
              void refreshAudit();
            },
            message,
          });
        } catch (e) {
          setView((v) => (v ? { ...v, settings: before } : v));
          throw e;
        }
      });
    },
    [view, t, confirm, run, putSettings, undoable, refreshAudit],
  );

  if (!view) {
    return (
      <div className={cardClass} data-testid="live-load-failed">
        <p role="alert" className="text-danger-fg">{t('live.loadFailed')}</p>
        <button type="button" className={`${smallButton} mt-3`} onClick={() => window.location.reload()}>{t('live.reload')}</button>
      </div>
    );
  }

  const { settings, usage, overrides } = view;

  return (
    <div className="space-y-6" data-testid="live-streaming" data-mode={settings.mode}>
      <p className="text-fg-muted">{t('live.intro')}</p>
      <p className="rounded border border-border bg-surface-2 px-4 py-2 text-sm text-fg" data-testid="live-applies-note">{t('live.appliesNote')}</p>
      {!canManage && <p className="text-sm text-fg-muted" data-testid="live-read-only">{t('live.readOnly')}</p>}
      {loadFailed && (
        <p role="alert" className="rounded border border-danger-border bg-danger-bg px-4 py-2 text-sm text-danger-fg">
          {t('live.loadFailed')}
        </p>
      )}
      <div aria-live="polite" className="space-y-2">
        {error && <p role="alert" className="rounded border border-danger-border bg-danger-bg px-4 py-2 text-sm text-danger-fg" data-testid="live-error">{error}</p>}
        {notice && <p className="rounded border border-border bg-surface-2 px-4 py-2 text-sm text-success-fg" data-testid="live-notice">{notice}</p>}
      </div>

      <ModeSection settings={settings} canManage={canManage} busy={busy} onChange={change} />

      <div className="grid gap-6 lg:grid-cols-2">
        {LIVE_PROVIDERS.map((p) => (
          <ProviderCard key={p} provider={p} settings={settings} usage={usage[p]} canManage={canManage} busy={busy} onChange={change} onInvalid={setError} />
        ))}
      </div>

      <section className={cardClass} aria-labelledby="live-failover-heading">
        <h2 id="live-failover-heading" className={sectionTitle}>{t('live.failover.heading')}</h2>
        <div className="mt-3">
          <Switch
            label={t('live.failover.label')}
            help={t('live.failover.help')}
            checked={settings.fallback}
            disabled={!canManage || busy !== null}
            testId="live-fallback"
            onChange={(on) => change('fallback', { fallback: on }, t(on ? 'live.failover.changedOn' : 'live.failover.changedOff'))}
          />
        </div>
      </section>

      <SelfHostedSection settings={settings} canManage={canManage} busy={busy} onChange={change} onInvalid={setError} />

      <OverridesSection
        overrides={overrides}
        canManage={canManage}
        busy={busy}
        providerName={providerName}
        run={run}
        refreshView={refreshView}
        undoable={undoable}
        refreshAudit={refreshAudit}
        onInvalid={setError}
      />

      <SessionsSection
        active={active}
        recent={recent}
        idleTimeoutSec={settings.selfhosted.idleTimeoutSec}
        canManage={canManage}
        busy={busy}
        providerName={providerName}
        run={run}
        refreshSessions={refreshSessions}
        confirm={confirm}
        undoable={undoable}
        refreshAudit={refreshAudit}
        setNotice={setNotice}
        onError={fail}
      />

      <ComparisonSection initial={initial.comparison} range={range} providerName={providerName} />

      <HistorySection audit={audit} locale={locale} />

      {dialog}
    </div>
  );
}

type ChangeFn = (key: string, patch: LiveRoutingPatch, message: string) => Promise<void>;
type RunFn = (key: string, change: () => Promise<unknown>) => Promise<void>;
type Undoable = ReturnType<typeof useUndoableAction>;
type Confirm = ReturnType<typeof useConfirm>['confirm'];

function Switch({ label, help, checked, disabled, onChange, testId }: { label: string; help?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void; testId: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={help ? `${id}-help` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60 ${checked ? 'bg-accent' : 'bg-surface-2'}`}
        data-testid={testId}
        data-checked={checked ? 'true' : 'false'}
      >
        <span aria-hidden="true" className={`absolute top-0.5 size-[1.125rem] rounded-full bg-surface shadow transition-all ${checked ? 'start-[1.375rem]' : 'start-0.5'}`} />
      </button>
      <div>
        <span id={`${id}-label`} className="text-sm font-medium text-fg">{label}</span>
        {help && <p id={`${id}-help`} className="text-xs text-fg-muted">{help}</p>}
      </div>
    </div>
  );
}

function ModeSection({ settings, canManage, busy, onChange }: { settings: LiveRoutingSettings; canManage: boolean; busy: string | null; onChange: ChangeFn }) {
  const { t } = useLanguage();
  const [split, setSplit] = useState(settings.bunnyPercent);
  // An Undo or another admin's change moves the stored split: follow it
  useEffect(() => setSplit(settings.bunnyPercent), [settings.bunnyPercent]);
  const id = useId();
  const modeName = (m: LiveRoutingMode) => t(`live.mode.${m}` as MessageKey);
  const choose = (m: LiveRoutingMode) => {
    if (m === settings.mode) return;
    void onChange('mode', modePatch(m, m === 'weighted' ? split : undefined), t('live.mode.changed', { mode: modeName(m) }));
  };
  const splitDirty = clampSplit(split) !== settings.bunnyPercent;
  return (
    <section className={cardClass} aria-labelledby={`${id}-heading`} data-testid="live-mode">
      <h2 id={`${id}-heading`} className={sectionTitle}>{t('live.mode.heading')}</h2>
      <fieldset className="mt-3" disabled={!canManage || busy !== null}>
        <legend className="text-sm text-fg-muted">{t('live.mode.legend')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {LIVE_ROUTING_MODES.map((m) => (
            <label key={m} className={`flex cursor-pointer items-start gap-2 rounded border p-3 ${settings.mode === m ? 'border-accent bg-surface-2' : 'border-border'}`}>
              <input type="radio" name={`${id}-mode`} value={m} checked={settings.mode === m} onChange={() => choose(m)} className="mt-1 accent-accent" data-testid={`live-mode-${m}`} />
              <span>
                <span className="block text-sm font-medium text-fg">{modeName(m)}</span>
                <span className="block text-xs text-fg-muted">{t(`live.mode.${m}Help` as MessageKey)}</span>
              </span>
            </label>
          ))}
        </div>
        {settings.mode === 'weighted' && (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
              <label htmlFor={`${id}-split`} className="text-sm text-fg-muted">{t('live.mode.split')}</label>
              <input
                id={`${id}-split`}
                type="range"
                min={0}
                max={100}
                step={SPLIT_STEP}
                value={clampSplit(split)}
                onChange={(e) => setSplit(Number(e.target.value))}
                aria-valuetext={t('live.mode.splitValue', { bunny: clampSplit(split), selfhosted: 100 - clampSplit(split) })}
                className="w-full accent-accent"
                data-testid="live-split"
              />
              <span className="text-sm tabular-nums text-fg" dir="ltr" data-testid="live-split-value">{splitLabel(split)}</span>
            </div>
            <button
              type="button"
              className={primarySmall}
              disabled={!splitDirty}
              onClick={() => void onChange('split', { bunnyPercent: clampSplit(split) }, t('live.mode.splitChanged', { split: splitLabel(split) }))}
              data-testid="live-split-save"
            >
              {t('live.mode.saveSplit')}
            </button>
          </div>
        )}
      </fieldset>
    </section>
  );
}

function ProviderCard({
  provider,
  settings,
  usage,
  canManage,
  busy,
  onChange,
  onInvalid,
}: {
  provider: LiveProviderId;
  settings: LiveRoutingSettings;
  usage: { active: number; monthSpendUsd: number; available: boolean };
  canManage: boolean;
  busy: string | null;
  onChange: ChangeFn;
  onInvalid: (message: string) => void;
}) {
  const { t, locale } = useLanguage();
  const id = useId();
  const controls = settings.providers[provider];
  const rates = settings.rates[provider];
  const name = t(`live.providers.${provider}` as MessageKey);
  const [note, setNote] = useState(controls.note ?? '');
  const [maxConcurrent, setMaxConcurrent] = useState(controls.maxConcurrent?.toString() ?? '');
  const [budget, setBudget] = useState(controls.monthlyBudgetUsd?.toString() ?? '');
  const [rateText, setRateText] = useState<Record<string, string>>(Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, String(v)])));
  // Follow the stored values after an Undo (fields keep focus: no remount)
  useEffect(() => setNote(controls.note ?? ''), [controls.note]);
  useEffect(() => setMaxConcurrent(controls.maxConcurrent?.toString() ?? ''), [controls.maxConcurrent]);
  useEffect(() => setBudget(controls.monthlyBudgetUsd?.toString() ?? ''), [controls.monthlyBudgetUsd]);
  const ratesKey = JSON.stringify(rates);
  useEffect(() => setRateText(Object.fromEntries(Object.entries(JSON.parse(ratesKey) as Record<string, number>).map(([k, v]) => [k, String(v)]))), [ratesKey]);
  const usd = metricFormatter(locale, 'usd');
  const count = metricFormatter(locale, 'count');
  const locked = !canManage || busy !== null;
  const noteValue = note.trim() || null;

  const toggle = (field: 'enabled' | 'draining', on: boolean) => {
    const patch: LiveRoutingPatch = { providers: { [provider]: { [field]: on, ...(noteValue !== controls.note ? { note: noteValue } : {}) } } };
    const message =
      field === 'enabled'
        ? t(on ? 'live.provider.enabledMsg' : 'live.provider.disabledMsg', { provider: name })
        : t(on ? 'live.provider.drainingMsg' : 'live.provider.drainStoppedMsg', { provider: name });
    void onChange(`${provider}-${field}`, patch, message);
  };

  const saveLimits = (e: React.FormEvent) => {
    e.preventDefault();
    const max = parseLimit(maxConcurrent);
    const cap = parseLimit(budget);
    if (max === undefined || cap === undefined) return onInvalid(t('live.provider.invalidNumber'));
    void onChange(`${provider}-limits`, { providers: { [provider]: { maxConcurrent: max === null ? null : Math.round(max), monthlyBudgetUsd: cap, note: noteValue } } }, t('live.provider.limitsSaved', { provider: name }));
  };

  const saveRates = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Object.fromEntries(Object.entries(rateText).map(([k, v]) => [k, parseAmount(v)]));
    if (Object.values(parsed).some((v) => v === undefined)) return onInvalid(t('live.provider.invalidNumber'));
    void onChange(`${provider}-rates`, { rates: { [provider]: parsed as Record<string, number> } }, t('live.provider.ratesSaved', { provider: name }));
  };

  const state = !controls.enabled ? t('live.provider.disabledState') : controls.draining ? t('live.provider.draining') : t('live.provider.enabled');

  return (
    <section className={cardClass} aria-labelledby={`${id}-heading`} data-testid={`live-provider-${provider}`} data-enabled={String(controls.enabled)} data-draining={String(controls.draining)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id={`${id}-heading`} className={sectionTitle}>{name}</h2>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${usage.available ? 'border-border text-success-fg' : 'border-border bg-surface-2 text-warning-fg'}`}
          data-testid={`live-available-${provider}`}
          data-available={String(usage.available)}
        >
          {usage.available ? t('live.provider.available') : t(provider === 'bunny' ? 'live.provider.unavailableBunny' : 'live.provider.unavailable')}
        </span>
      </div>
      <p className="mt-1 text-sm text-fg-muted" data-testid={`live-state-${provider}`}>{state}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-fg-muted">{t('live.provider.activeNow')}</dt>
          <dd className="text-lg font-semibold tabular-nums text-fg" data-testid={`live-active-${provider}`}>{count(usage.active)}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">{t('live.provider.monthSpend')}</dt>
          <dd className="text-lg font-semibold tabular-nums text-fg">
            {usd(usage.monthSpendUsd)}
            {controls.monthlyBudgetUsd !== null && <span className="text-sm font-normal text-fg-muted"> / {usd(controls.monthlyBudgetUsd)}</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-4 space-y-3">
        <Switch label={t('live.provider.enabledLabel')} checked={controls.enabled} disabled={locked} testId={`live-enabled-${provider}`} onChange={(on) => toggle('enabled', on)} />
        <Switch label={t('live.provider.drainLabel')} help={t('live.provider.drainHelp')} checked={controls.draining} disabled={locked || !controls.enabled} testId={`live-drain-${provider}`} onChange={(on) => toggle('draining', on)} />
      </div>

      <form className="mt-4 space-y-3" onSubmit={saveLimits}>
        <fieldset disabled={locked} className="space-y-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-note`} className="text-sm text-fg-muted">{t('live.provider.note')}</label>
            <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} dir="auto" placeholder={t('live.provider.notePlaceholder')} className={fieldClass} data-testid={`live-note-${provider}`} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-max`} className="text-sm text-fg-muted">{t('live.provider.maxConcurrent')}</label>
              <input id={`${id}-max`} inputMode="numeric" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} placeholder={t('live.provider.noLimit')} className={fieldClass} dir="ltr" data-testid={`live-max-${provider}`} />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-budget`} className="text-sm text-fg-muted">{t('live.provider.budget')}</label>
              <input id={`${id}-budget`} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder={t('live.provider.noLimit')} className={fieldClass} dir="ltr" data-testid={`live-budget-${provider}`} />
            </div>
          </div>
          <p className="text-xs text-fg-muted">{t('live.provider.limitHelp')}</p>
          <button type="submit" className={smallButton} data-testid={`live-limits-save-${provider}`}>{t('live.provider.saveLimits')}</button>
        </fieldset>
      </form>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-fg">{t('live.provider.rates')}</summary>
        <form className="mt-3 space-y-3" onSubmit={saveRates}>
          <fieldset disabled={locked} className="space-y-3">
            <p className="text-xs text-fg-muted">{t('live.provider.ratesHelp')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.keys(rates).map((k) => (
                <div key={k} className="flex flex-col gap-1">
                  <label htmlFor={`${id}-${k}`} className="text-sm text-fg-muted">{t(`live.provider.${k}` as MessageKey)}</label>
                  <input id={`${id}-${k}`} inputMode="decimal" value={rateText[k] ?? ''} onChange={(e) => setRateText((r) => ({ ...r, [k]: e.target.value }))} className={fieldClass} dir="ltr" data-testid={`live-rate-${provider}-${k}`} />
                </div>
              ))}
            </div>
            <button type="submit" className={smallButton}>{t('live.provider.saveRates')}</button>
          </fieldset>
        </form>
      </details>
    </section>
  );
}

function SelfHostedSection({ settings, canManage, busy, onChange, onInvalid }: { settings: LiveRoutingSettings; canManage: boolean; busy: string | null; onChange: ChangeFn; onInvalid: (m: string) => void }) {
  const { t } = useLanguage();
  const id = useId();
  const [idle, setIdle] = useState(String(settings.selfhosted.idleTimeoutSec));
  const [qoe, setQoe] = useState(String(settings.qoeSampleRate));
  useEffect(() => setIdle(String(settings.selfhosted.idleTimeoutSec)), [settings.selfhosted.idleTimeoutSec]);
  useEffect(() => setQoe(String(settings.qoeSampleRate)), [settings.qoeSampleRate]);
  const locked = !canManage || busy !== null;
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const idleSec = parseAmount(idle, 900);
    const rate = parseAmount(qoe, 1);
    if (idleSec === undefined || idleSec < 15 || rate === undefined) return onInvalid(t('live.selfhosted.invalid'));
    void onChange('selfhosted', { selfhosted: { idleTimeoutSec: Math.round(idleSec) }, qoeSampleRate: rate }, t('live.selfhosted.saved'));
  };
  return (
    <section className={cardClass} aria-labelledby={`${id}-heading`} data-testid="live-selfhosted">
      <h2 id={`${id}-heading`} className={sectionTitle}>{t('live.selfhosted.heading')}</h2>
      <div className="mt-3 space-y-3">
        <Switch label={t('live.selfhosted.lowLatency')} help={t('live.selfhosted.lowLatencyHelp')} checked={settings.selfhosted.lowLatency} disabled={locked} testId="live-low-latency" onChange={(on) => void onChange('lowLatency', { selfhosted: { lowLatency: on } }, t('live.selfhosted.saved'))} />
        <Switch label={t('live.selfhosted.recordVod')} help={t('live.selfhosted.recordVodHelp')} checked={settings.selfhosted.recordVod} disabled={locked} testId="live-record-vod" onChange={(on) => void onChange('recordVod', { selfhosted: { recordVod: on } }, t('live.selfhosted.saved'))} />
      </div>
      <form className="mt-4" onSubmit={save}>
        <fieldset disabled={locked} className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-idle`} className="text-sm text-fg-muted">{t('live.selfhosted.idleTimeout')}</label>
            <input id={`${id}-idle`} inputMode="numeric" value={idle} onChange={(e) => setIdle(e.target.value)} aria-describedby={`${id}-idle-help`} className={fieldClass} dir="ltr" data-testid="live-idle-timeout" />
            <span id={`${id}-idle-help`} className="text-xs text-fg-muted">{t('live.selfhosted.idleTimeoutHelp')}</span>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-qoe`} className="text-sm text-fg-muted">{t('live.selfhosted.qoe')}</label>
            <input id={`${id}-qoe`} inputMode="decimal" value={qoe} onChange={(e) => setQoe(e.target.value)} aria-describedby={`${id}-qoe-help`} className={fieldClass} dir="ltr" data-testid="live-qoe-rate" />
            <span id={`${id}-qoe-help`} className="text-xs text-fg-muted">{t('live.selfhosted.qoeHelp')}</span>
          </div>
          <div>
            <button type="submit" className={smallButton} data-testid="live-selfhosted-save">{t('live.selfhosted.save')}</button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function OverridesSection({
  overrides,
  canManage,
  busy,
  providerName,
  run,
  refreshView,
  undoable,
  refreshAudit,
  onInvalid,
}: {
  overrides: LiveSettingsView['overrides'];
  canManage: boolean;
  busy: string | null;
  providerName: (p: LiveProviderId) => string;
  run: RunFn;
  refreshView: () => Promise<void>;
  undoable: Undoable;
  refreshAudit: () => Promise<void>;
  onInvalid: (m: string) => void;
}) {
  const { t, locale } = useLanguage();
  const id = useId();
  const [channel, setChannel] = useState<{ id: string; label: string } | null>(null);
  const [provider, setProvider] = useState<LiveProviderId>('selfhosted');
  const [note, setNote] = useState('');
  const [pickerKey, setPickerKey] = useState(0);
  const locked = !canManage || busy !== null;

  const applyUndo = async (u: OverrideUndo) => {
    if (u.kind === 'set') await contentRequest('PUT', `live/overrides/${encodeURIComponent(u.channelId)}`, { body: { provider: u.provider, note: u.note } });
    else await contentRequest('DELETE', `live/overrides/${encodeURIComponent(u.channelId)}`, { body: {} });
    await refreshView();
    void refreshAudit();
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!channel) return onInvalid(t('live.overrides.channelRequired'));
    const target = channel;
    const before = overrides.find((o) => o.channelId === target.id);
    void run('override', () =>
      undoable.run({
        action: async () => {
          await contentRequest('PUT', `live/overrides/${encodeURIComponent(target.id)}`, { body: { provider, note: note.trim() || null } });
          await refreshView();
          setChannel(null);
          setNote('');
          setPickerKey((k) => k + 1);
          return overrideUndo(target.id, before ? { provider: before.provider, note: before.note } : null);
        },
        undo: applyUndo,
        message: t('live.overrides.set', { channel: target.label, provider: providerName(provider) }),
      }),
    );
  };

  const remove = (o: LiveSettingsView['overrides'][number]) =>
    void run(`override-${o.channelId}`, () =>
      undoable.run({
        action: async () => {
          await contentRequest('DELETE', `live/overrides/${encodeURIComponent(o.channelId)}`, { body: {} });
          await refreshView();
          return overrideUndo(o.channelId, { provider: o.provider, note: o.note });
        },
        undo: applyUndo,
        message: t('live.overrides.removed', { channel: o.channelName || o.channelId }),
      }),
    );

  return (
    <section className={cardClass} aria-labelledby={`${id}-heading`} data-testid="live-overrides">
      <h2 id={`${id}-heading`} className={sectionTitle}>{t('live.overrides.heading')}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t('live.overrides.help')}</p>
      {canManage && (
        <form className="mt-4 grid items-end gap-3 md:grid-cols-[2fr_1fr_2fr_auto]" onSubmit={add}>
          <Autocomplete
            key={pickerKey}
            kind="channel"
            mode="pick"
            label={t('live.overrides.channel')}
            onChange={(cid, item) => setChannel(cid ? { id: cid, label: item?.label ?? cid } : null)}
            testId="live-override-channel"
            disabled={locked}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-provider`} className="text-sm text-fg-muted">{t('live.overrides.provider')}</label>
            <select id={`${id}-provider`} value={provider} onChange={(e) => setProvider(e.target.value as LiveProviderId)} disabled={locked} className={fieldClass} data-testid="live-override-provider">
              {LIVE_PROVIDERS.map((p) => (
                <option key={p} value={p}>{providerName(p)}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-note`} className="text-sm text-fg-muted">{t('live.overrides.note')}</label>
            <input id={`${id}-note`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} dir="auto" disabled={locked} className={fieldClass} data-testid="live-override-note" />
          </div>
          <button type="submit" className={primarySmall} disabled={locked} data-testid="live-override-add">{t('live.overrides.add')}</button>
        </form>
      )}
      {overrides.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted" data-testid="live-overrides-empty">{t('live.overrides.empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-fg-muted">
                <th scope="col" className="p-2 text-start font-medium">{t('live.overrides.channel')}</th>
                <th scope="col" className="p-2 text-start font-medium">{t('live.overrides.provider')}</th>
                <th scope="col" className="p-2 text-start font-medium">{t('live.overrides.note')}</th>
                <th scope="col" className="p-2 text-start font-medium">{t('live.overrides.updated')}</th>
                {canManage && <th scope="col" className="p-2"><span className="sr-only">{t('live.sessions.actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <tr key={o.channelId} className="border-t border-border" data-testid="live-override-row" data-channel-id={o.channelId} data-provider={o.provider}>
                  <td className="p-2">
                    <a href={`/channels/${encodeURIComponent(o.channelId)}`} className={linkClass} dir="auto">{o.channelName || o.channelId}</a>
                  </td>
                  <td className="p-2">{providerName(o.provider)}</td>
                  <td className="p-2 text-fg-muted" dir="auto">{o.note ?? '—'}</td>
                  <td className="p-2 text-fg-muted">{formatDate(o.updatedAt, locale, true)}</td>
                  {canManage && (
                    <td className="p-2 text-end">
                      <button type="button" className={smallButton} disabled={locked} onClick={() => remove(o)} data-testid="live-override-remove">{t('live.overrides.remove')}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SessionsSection({
  active,
  recent,
  idleTimeoutSec,
  canManage,
  busy,
  providerName,
  run,
  refreshSessions,
  confirm,
  undoable,
  refreshAudit,
  setNotice,
  onError,
}: {
  active: LiveSessionItem[];
  recent: LiveSessionItem[];
  idleTimeoutSec: number;
  canManage: boolean;
  busy: string | null;
  providerName: (p: LiveProviderId) => string;
  run: RunFn;
  refreshSessions: () => Promise<void>;
  confirm: Confirm;
  undoable: Undoable;
  refreshAudit: () => Promise<void>;
  setNotice: (m: string | null) => void;
  onError: (e: unknown) => void;
}) {
  const { t, locale } = useLanguage();
  const id = useId();
  const [show, setShow] = useState<'active' | 'recent'>(active.length ? 'active' : 'recent');
  const rows = show === 'active' ? active : recent;
  const now = Date.now();
  const locked = !canManage || busy !== null;
  const reasonLabel = (r: string) => ((SESSION_REASONS as readonly string[]).includes(r) ? t(`live.sessions.reasons.${r}` as MessageKey) : r);

  const move = (s: LiveSessionItem) => {
    const to = otherLiveProvider(s.provider);
    void run(`move-${s.id}`, () =>
      undoable.run({
        action: async () => (await contentRequest<{ previous: LiveProviderId | null }>('POST', `live/streams/${encodeURIComponent(s.stream_id)}/move`, { body: { provider: to } })).previous ?? null,
        undo: async (previous) => {
          await contentRequest('POST', `live/streams/${encodeURIComponent(s.stream_id)}/move`, { body: { provider: previous } });
          void refreshAudit();
        },
        message: t('live.sessions.moved', { provider: providerName(to) }),
      }),
    );
  };

  const end = async (s: LiveSessionItem) => {
    const ok = await confirm({ title: t('live.sessions.endTitle'), body: t('live.sessions.endBody'), confirmLabel: t('live.sessions.endConfirm'), danger: true, testId: 'live-session-end' });
    if (!ok) return;
    void run(`end-${s.id}`, async () => {
      await contentRequest('POST', `live/sessions/${encodeURIComponent(s.id)}/end`, { body: {} });
      setNotice(t('live.sessions.endedMsg'));
      await refreshSessions();
    });
  };

  const time = (v: number | null | undefined) => (v ? formatDate(v, locale, true) : '—');

  return (
    <section className={cardClass} aria-labelledby={`${id}-heading`} data-testid="live-sessions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-heading`} className={sectionTitle}>{t('live.sessions.heading')}</h2>
        <div className="flex items-center gap-2">
          <div role="group" aria-label={t('live.sessions.filter')} className="inline-flex overflow-hidden rounded border border-border">
            {(['active', 'recent'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)} className={`px-3 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${show === k ? 'bg-accent text-on-accent' : 'bg-surface-2 text-fg'}`} data-testid={`live-sessions-${k}`}>
                {t(`live.sessions.${k}` as MessageKey)} ({(k === 'active' ? active : recent).length})
              </button>
            ))}
          </div>
          <button type="button" className={smallButton} onClick={() => void refreshSessions().catch(onError)}>{t('live.reload')}</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-fg-muted">{t('live.sessions.empty')}</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-fg-muted">
                <th scope="col" className="p-2 text-start font-medium">{t('live.sessions.provider')}</th>
                <th scope="col" className="p-2 text-start font-medium">{t('live.sessions.channel')}</th>
                <th scope="col" className="p-2 text-start font-medium">{t('live.sessions.status')}</th>
                <th scope="col" className="p-2 text-start font-medium">{t('live.sessions.reason')}</th>
                <th scope="col" className="p-2 text-start font-medium">{t('live.sessions.started')}</th>
                <th scope="col" className="p-2 text-start font-medium">{t('live.sessions.ended')}</th>
                {canManage && <th scope="col" className="p-2 text-start font-medium">{t('live.sessions.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const stuck = isStuck(s, now, idleTimeoutSec);
                return (
                  <tr key={s.id} className="border-t border-border align-top" data-testid="live-session-row" data-session-id={s.id} data-provider={s.provider}>
                    <td className="p-2">{providerName(s.provider)}</td>
                    <td className="p-2" dir="auto">
                      {s.channel_id ? <a href={`/channels/${encodeURIComponent(s.channel_id)}`} className={linkClass}>{s.channel_name || s.channel_id}</a> : t('live.sessions.unknownChannel')}
                      {s.is_test ? <span className="ms-2 rounded-full border border-border px-2 text-xs text-fg-muted">{t('live.sessions.test')}</span> : null}
                    </td>
                    <td className="p-2">
                      {t(`live.sessions.statuses.${s.status}` as MessageKey)}
                      {stuck && <span className="ms-2 text-xs text-warning-fg">{t('live.sessions.stuck')}</span>}
                    </td>
                    <td className="p-2 text-fg-muted">{reasonLabel(s.reason)}{s.failover_from ? ` (${providerName(s.failover_from as LiveProviderId)})` : ''}</td>
                    <td className="p-2 text-fg-muted">{time(s.created_at)}</td>
                    <td className="p-2 text-fg-muted">{time(s.ended_at)}</td>
                    {canManage && (
                      <td className="p-2">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={smallButton} disabled={locked} onClick={() => move(s)} data-testid="live-session-move">
                            {t('live.sessions.moveTo', { provider: providerName(otherLiveProvider(s.provider)) })}
                          </button>
                          {isActiveSession(s) && (
                            <button type="button" className={dangerSmall} disabled={locked} onClick={() => void end(s)} data-testid="live-session-end">
                              {t('live.sessions.end')}
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const CHARTS: { metric: ChartMetric; label: MessageKey; format: MetricFormat }[] = [
  { metric: 'latency', label: 'live.compare.charts.latency', format: 'ms' },
  { metric: 'rebuffer', label: 'live.compare.charts.rebuffer', format: 'ratio' },
  { metric: 'costPerViewerHour', label: 'live.compare.charts.costPerViewerHour', format: 'usdSmall' },
];

function ComparisonSection({ initial, range, providerName }: { initial: LiveComparison | null; range: { from: string; to: string; tests: boolean }; providerName: (p: LiveProviderId) => string }) {
  const { t, locale, isRTL } = useLanguage();
  const id = useId();
  const [comparison, setComparison] = useState(initial);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [tests, setTests] = useState(range.tests);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (next: { from: string; to: string; tests: boolean }) => {
    if (next.from > next.to) return setError(t('live.compare.invalidRange'));
    setLoading(true);
    setError(null);
    try {
      setComparison(await contentRequest<LiveComparison>('GET', 'live/compare', { query: { from: next.from, to: next.to, tests: next.tests ? '1' : '0' } }));
      // Keep the period in the URL (a reload or a shared link shows the same view) without a navigation
      const url = new URL(window.location.href);
      url.searchParams.set('from', next.from);
      url.searchParams.set('to', next.to);
      if (next.tests) url.searchParams.set('tests', '1');
      else url.searchParams.delete('tests');
      window.history.replaceState(null, '', url);
    } catch (e) {
      const status = e instanceof AdminClientError ? e.status : 0;
      if (status === 0 || status >= 500) reportError(e, { shown: true, status, extra: { where: 'live-compare' } });
      setError(describeActionError(t, e));
    } finally {
      setLoading(false);
    }
  };

  const bunny = statsFor(comparison, 'bunny');
  const selfhosted = statsFor(comparison, 'selfhosted');
  const empty = !comparison || comparison.providers.every((p) => p.sessions === 0);
  const dayLabel = (day: string) => new Intl.DateTimeFormat(/^ar\b/.test(locale) ? 'ar-u-nu-arab' : locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));

  return (
    <section className={cardClass} aria-labelledby={`${id}-heading`} data-testid="live-compare" aria-busy={loading}>
      <h2 id={`${id}-heading`} className={sectionTitle}>{t('live.compare.heading')}</h2>
      <p className="mt-1 text-sm text-fg-muted">{t('live.compare.help')}</p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load({ from, to, tests });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-from`} className="text-sm text-fg-muted">{t('live.compare.from')}</label>
          <input id={`${id}-from`} type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={fieldClass} data-testid="live-compare-from" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-to`} className="text-sm text-fg-muted">{t('live.compare.to')}</label>
          <input id={`${id}-to`} type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={fieldClass} data-testid="live-compare-to" />
        </div>
        <label className="flex items-center gap-2 py-2 text-sm text-fg">
          <input
            type="checkbox"
            checked={tests}
            onChange={(e) => {
              setTests(e.target.checked);
              void load({ from, to, tests: e.target.checked });
            }}
            className="accent-accent"
            data-testid="live-compare-tests"
          />
          {t('live.compare.includeTests')}
        </label>
        <button type="submit" className={smallButton} disabled={loading}>{t('live.compare.apply')}</button>
      </form>
      {error && <p role="alert" className="mt-3 text-sm text-danger-fg">{error}</p>}
      {empty && <p className="mt-4 text-sm text-fg-muted" data-testid="live-compare-empty">{t('live.compare.empty')}</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm" data-testid="live-compare-table">
          <thead>
            <tr className="text-fg-muted">
              <th scope="col" className="p-2 text-start font-medium">{t('live.compare.metric')}</th>
              {LIVE_PROVIDERS.map((p) => (
                <th key={p} scope="col" className="p-2 text-end font-medium">{providerName(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COMPARISON_ROWS.map((row) => {
              const format = metricFormatter(locale, row.format);
              const better = betterOf(row, bunny, selfhosted);
              return (
                <tr key={row.key} className="border-t border-border" data-testid="live-compare-row" data-metric={row.key}>
                  <th scope="row" className="p-2 text-start font-normal text-fg">{t(`live.compare.rows.${row.key}` as MessageKey)}</th>
                  {[bunny, selfhosted].map((s, i) => {
                    const p = LIVE_PROVIDERS[i];
                    return (
                      <td key={p} className={`p-2 text-end tabular-nums ${better === p ? 'font-semibold text-success-fg' : 'text-fg'}`}>
                        {format(s ? row.value(s) : null)}
                        {better === p && <span className="sr-only"> ({t('live.compare.better')})</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {CHARTS.map((c) => {
          const { days, series } = chartSeries(comparison, c.metric);
          const format = metricFormatter(locale, c.format);
          return (
            <ProviderLineChart
              key={c.metric}
              days={days}
              series={series}
              label={t(c.label)}
              format={(v) => format(v)}
              dayLabel={dayLabel}
              providerLabel={providerName}
              tableLabel={t('live.compare.chartTable')}
              dayHeading={t('live.compare.day')}
              emptyText={t('live.compare.noData')}
              testId={`live-chart-${c.metric}`}
              rtl={isRTL}
            />
          );
        })}
      </div>
    </section>
  );
}

function HistorySection({ audit, locale }: { audit: LiveAuditEntry[]; locale: string }) {
  const { t } = useLanguage();
  const id = useId();
  const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const actionLabel = (a: string) => {
    const key = `live.history.actions.${a}` as MessageKey;
    const text = t(key);
    return text === key ? a : text;
  };
  return (
    <section className={cardClass} aria-labelledby={`${id}-heading`} data-testid="live-history">
      <h2 id={`${id}-heading`} className={sectionTitle}>{t('live.history.heading')}</h2>
      {audit.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">{t('live.history.empty')}</p>
      ) : (
        <ol className="mt-3 divide-y divide-border">
          {audit.map((entry) => {
            const target = auditTarget(entry.key);
            return (
              <li key={entry.id} className="py-2 text-sm" data-testid="live-history-entry" data-kind={target.kind}>
                <div className="flex flex-wrap gap-x-3 text-fg">
                  <span className="font-medium">{actionLabel(entry.action)}</span>
                  {target.id && target.id !== 'routing' && <span className="text-fg-muted" dir="ltr">{target.id}</span>}
                  <span className="text-fg-muted">{formatDate(entry.createdAt, locale as never, true)}</span>
                  <span className="text-fg-muted" dir="ltr">{entry.actorId}</span>
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-fg-muted">
                  {changeLines(entry.details, entry.previous ?? null).map((line) => (
                    <li key={line.field} dir="ltr" className="text-start">
                      <span className="font-mono">{line.field}</span>: {show(line.value)}{' '}
                      <span>({t('live.history.previous')}: {show(line.previous)})</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
