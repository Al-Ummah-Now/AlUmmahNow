'use client';

import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  MEDIA_PROVIDER_IDS,
  normaliseMediaSettings,
  settingsProblems,
  type MediaHealthSnapshot,
  type MediaOverride,
  type MediaProviderId,
  type MediaSettings,
  type PlaybackAssign,
  type PlaybackStrategy,
  type ProviderHealthSettings,
} from '@al-ummah/shared-types';
import { checkMediaProviderHealth, saveMediaProviders } from '@/lib/api/admin';
import type { MediaProvidersView } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { useConfirm } from '@/components/content/actions';
import { Chip } from '@/components/content/parts';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { OverrideEditor, ProviderChecklist, ProviderOrderEditor, checkClass } from '@/components/media/ProviderOrderEditor';
import {
  CHANNEL_ID_PATTERN,
  PROBLEM_LABEL,
  PROVIDER_LABEL,
  draftOf,
  formWeights,
  overrideOf,
  parseWhole,
  riskyChanges,
  type OverrideDraft,
} from '@/lib/media/providers-form';
import { logger } from '@/lib/logger-client';

type HealthKey = Exclude<keyof ProviderHealthSettings, 'enabled'>;
const HEALTH_FIELDS: { key: HealthKey; label: MessageKey; hint?: MessageKey; min: number; max: number }[] = [
  { key: 'failureThreshold', label: 'mediaProviders.failureThreshold', hint: 'mediaProviders.failureThresholdHint', min: 1, max: 10_000 },
  { key: 'windowMinutes', label: 'mediaProviders.windowMinutes', min: 1, max: 60 },
  { key: 'probeFailures', label: 'mediaProviders.probeFailures', hint: 'mediaProviders.probeFailuresHint', min: 1, max: 60 },
  { key: 'cooldownMinutes', label: 'mediaProviders.cooldownMinutes', min: 1, max: 1440 },
];

const STRATEGIES: { value: PlaybackStrategy; label: MessageKey; hint: MessageKey }[] = [
  { value: 'priority', label: 'mediaProviders.strategyPriority', hint: 'mediaProviders.strategyPriorityHint' },
  { value: 'weighted', label: 'mediaProviders.strategyWeighted', hint: 'mediaProviders.strategyWeightedHint' },
];

const ASSIGNS: { value: PlaybackAssign; label: MessageKey; hint: MessageKey }[] = [
  { value: 'video', label: 'mediaProviders.assignVideo', hint: 'mediaProviders.assignVideoHint' },
  { value: 'view', label: 'mediaProviders.assignView', hint: 'mediaProviders.assignViewHint' },
];

interface FormState {
  providers: Record<MediaProviderId, boolean>;
  ingest: MediaProviderId[];
  strategy: PlaybackStrategy;
  order: MediaProviderId[];
  weights: Partial<Record<MediaProviderId, string>>;
  assign: PlaybackAssign;
  healthEnabled: boolean;
  health: Record<HealthKey, string>;
  thumbnails: MediaProviderId;
  channels: Record<string, MediaOverride>;
}

function formOf(s: MediaSettings): FormState {
  return {
    providers: Object.fromEntries(MEDIA_PROVIDER_IDS.map((p) => [p, s.providers[p].enabled])) as FormState['providers'],
    ingest: [...s.ingest],
    strategy: s.playback.strategy,
    order: [...s.playback.order],
    weights: Object.fromEntries(MEDIA_PROVIDER_IDS.map((p) => [p, String(s.playback.weights[p] ?? 0)])),
    assign: s.playback.assign,
    healthEnabled: s.health.enabled,
    health: Object.fromEntries(HEALTH_FIELDS.map((f) => [f.key, String(s.health[f.key])])) as FormState['health'],
    thumbnails: s.thumbnails.store,
    channels: { ...s.channels },
  };
}

/** The settings a form stands for, or null while a number field is not a valid number. */
function settingsOf(f: FormState, base: MediaSettings): MediaSettings | null {
  const weights = formWeights(f.weights, base.playback.weights, f.strategy, f.order);
  if (!weights) return null;
  const health = { ...base.health, enabled: f.healthEnabled };
  for (const field of HEALTH_FIELDS) {
    const n = parseWhole(f.health[field.key], field.min, field.max);
    if (n === null) return null;
    health[field.key] = n;
  }
  return {
    ...base,
    providers: Object.fromEntries(MEDIA_PROVIDER_IDS.map((p) => [p, { enabled: f.providers[p] }])) as MediaSettings['providers'],
    ingest: [...f.ingest],
    playback: { strategy: f.strategy, order: [...f.order], weights, assign: f.assign },
    health,
    thumbnails: { store: f.thumbnails },
    channels: { ...f.channels },
  };
}

function enabledOf(f: FormState): MediaProviderId[] {
  return MEDIA_PROVIDER_IDS.filter((p) => f.providers[p]);
}

/**
 * Provider settings (docs/media-delivery/PROVIDERS.md): providers on/off with their health, where
 * new uploads go, the playback strategy, order and weights, the health fallback, where custom
 * thumbnails are stored, and channel overrides. The same checks as the server run as the admin
 * edits (shared-types settingsProblems), so an unsafe change cannot be saved; changes that move
 * live traffic ask first in the in-app dialog. Saving goes through admin-api (media:manage, audited).
 */
export function ProviderSettings({ view }: { view: MediaProvidersView }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const { confirm, dialog } = useConfirm();
  const saved = useMemo(() => normaliseMediaSettings(view.settings), [view.settings]);
  const [form, setForm] = useState<FormState>(() => formOf(saved));
  const [health, setHealth] = useState<MediaHealthSnapshot | null>(view.health);
  const [busy, setBusy] = useState<'save' | 'check' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<OverrideDraft>(() => draftOf(null));
  const [newChannel, setNewChannel] = useState('');
  const [channelError, setChannelError] = useState<string | null>(null);

  const next = settingsOf(form, saved);
  const problems = next ? settingsProblems(next) : [];
  const enabled = enabledOf(form);
  const dirty = !!next && JSON.stringify(next) !== JSON.stringify(saved);
  const name = (p: MediaProviderId | null) => (p ? t(PROVIDER_LABEL[p]) : t('mediaProviders.none'));
  const problemText = (p: { problem: string; detail?: string }) => {
    const key = PROBLEM_LABEL[p.problem as keyof typeof PROBLEM_LABEL];
    const detail = p.detail && (MEDIA_PROVIDER_IDS as readonly string[]).includes(p.detail) ? name(p.detail as MediaProviderId) : (p.detail ?? '');
    return key ? t(key, { detail }) : p.problem;
  };
  const update = (patch: Partial<FormState>) => {
    setNotice(null);
    setRefused([]);
    setForm((f) => ({ ...f, ...patch }));
  };

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!next || problems.length || editing) return;
    setError(null);
    setNotice(null);
    setRefused([]);
    const risky = riskyChanges(saved, next);
    if (risky.length) {
      const lines = risky.map((r) =>
        r.kind === 'provider_off'
          ? t('mediaProviders.confirmProviderOff', { provider: name(r.provider) })
          : r.kind === 'first_changed'
            ? t('mediaProviders.confirmFirstChanged', { from: name(r.from), to: name(r.to) })
            : t('mediaProviders.confirmIngestDropped', { provider: name(r.provider) }),
      );
      const ok = await confirm({ title: t('mediaProviders.confirmTitle'), body: [t('mediaProviders.confirmIntro'), ...lines].join(' '), confirmLabel: t('mediaProviders.confirmSave'), testId: 'providers-confirm' });
      if (!ok) return;
    }
    setBusy('save');
    try {
      const result = await saveMediaProviders(next);
      if (!result.ok) {
        logger.warn('[delivery] Provider settings save failed', { status: result.status, problems: result.problems?.map((p) => p.problem) });
        if (result.problems?.length) setRefused(result.problems.map(problemText));
        setError(result.status === 401 ? t('errors.notAuthenticated') : t('mediaProviders.saveFailed'));
        return;
      }
      setNotice(t('mediaProviders.saved'));
      router.refresh();
    } catch (e) {
      logger.error('[delivery] Provider settings save request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('mediaProviders.saveFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function checkNow() {
    setError(null);
    setNotice(null);
    setBusy('check');
    try {
      const result = await checkMediaProviderHealth();
      if (!result.ok) {
        logger.warn('[delivery] Provider health check failed', { status: result.status });
        setError(t('mediaProviders.checkFailed'));
        return;
      }
      setHealth(result.data);
      setNotice(t('mediaProviders.checked'));
    } catch (e) {
      logger.error('[delivery] Provider health check request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('mediaProviders.checkFailed'));
    } finally {
      setBusy(null);
    }
  }

  function startEdit(channelId: string) {
    setEditing(channelId);
    setDraft(draftOf(form.channels[channelId]));
  }

  function addChannel() {
    const id = newChannel.trim();
    if (!CHANNEL_ID_PATTERN.test(id)) return setChannelError(t('mediaProviders.channelIdInvalid'));
    if (form.channels[id]) return setChannelError(t('mediaProviders.channelDuplicate'));
    setChannelError(null);
    setNewChannel('');
    setEditing(id);
    setDraft({ ...draftOf(null), order: [...form.order] });
  }

  function finishEdit() {
    if (!editing) return;
    const override = overrideOf(draft, { ingest: true });
    const channels = { ...form.channels };
    if (override) channels[editing] = override;
    else delete channels[editing];
    update({ channels });
    setEditing(null);
  }

  function removeChannel(channelId: string) {
    const channels = { ...form.channels };
    delete channels[channelId];
    update({ channels });
    if (editing === channelId) setEditing(null);
  }

  const radio = checkClass;
  const listText = (list: MediaProviderId[] | undefined) => (list?.length ? list.map((p) => name(p)).join(' → ') : t('mediaProviders.followsSettings'));
  const channelIds = Object.keys(form.channels).sort();

  return (
    <section className={`${cardClass} mb-6`} aria-labelledby={`${ids}-title`} data-testid="providers-settings">
      {dialog}
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg mb-1">{t('mediaProviders.title')}</h2>
      <p className="text-fg-muted text-sm mb-5 max-w-3xl">{t('mediaProviders.intro')}</p>
      <form onSubmit={save} className="space-y-7" noValidate>
        {/* Providers: on/off and health */}
        <fieldset>
          <legend className="text-base font-semibold text-fg mb-1">{t('mediaProviders.providersLegend')}</legend>
          <p className="text-sm text-fg-muted mb-3">{t('mediaProviders.providersHint')}</p>
          <ul className="grid gap-3 md:grid-cols-2">
            {MEDIA_PROVIDER_IDS.map((p) => {
              const h = health?.providers[p];
              return (
                <li key={p} className={`rounded-lg border p-4 ${form.providers[p] ? 'border-accent bg-surface-2' : 'border-border'}`} data-testid={`providers-${p}`} data-enabled={form.providers[p]}>
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={form.providers[p]}
                        onChange={(e) => update({ providers: { ...form.providers, [p]: e.target.checked } })}
                        className={radio}
                        aria-label={t('mediaProviders.toggleLabel', { provider: name(p) })}
                        data-testid={`providers-${p}-enabled`}
                      />
                      <span>
                        <span className="block font-semibold text-fg">{name(p)}</span>
                        <span className="block text-sm text-fg-muted">{form.providers[p] ? t('mediaProviders.enabled') : t('mediaProviders.disabled')}</span>
                      </span>
                    </label>
                    <Chip tone={!h ? 'neutral' : h.state === 'healthy' ? 'good' : 'bad'} testId={`providers-${p}-health`}>
                      {!h ? t('mediaProviders.healthUnknown') : h.state === 'healthy' ? t('mediaProviders.healthHealthy') : t('mediaProviders.healthUnhealthy')}
                    </Chip>
                  </div>
                  {h && (
                    <div className="mt-2 space-y-0.5 text-sm text-fg-muted">
                      {h.state === 'unhealthy' && (
                        <p className="text-danger-fg" data-testid={`providers-${p}-reason`}>
                          {h.consecutiveProbeFailures >= saved.health.probeFailures
                            ? t('mediaProviders.healthReasonProbes', { count: String(h.consecutiveProbeFailures) })
                            : t('mediaProviders.healthReasonFallbacks', { count: String(h.recentFailures), minutes: String(saved.health.windowMinutes) })}
                        </p>
                      )}
                      {h.state === 'unhealthy' && h.until && <p>{t('mediaProviders.healthUntil', { time: formatDate(h.until, locale, true) })}</p>}
                      {h.lastProbeAt && (
                        <p>
                          {t('mediaProviders.healthProbe', {
                            time: formatDate(h.lastProbeAt, locale, true),
                            result: h.lastProbeOk ? t('mediaProviders.healthProbeOk', { ms: String(h.lastProbeMs ?? 0) }) : t('mediaProviders.healthProbeFailed'),
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={checkNow} disabled={!!busy} aria-busy={busy === 'check'} className={`${secondaryButtonClass} mt-3 !py-2 !px-4 text-sm disabled:opacity-60`} data-testid="providers-check">
            {busy === 'check' ? t('mediaProviders.checking') : t('mediaProviders.checkNow')}
          </button>
        </fieldset>

        {/* Ingest */}
        <div>
          <h3 className="text-base font-semibold text-fg mb-1" id={`${ids}-ingest`}>{t('mediaProviders.ingestLegend')}</h3>
          <p className="text-sm text-fg-muted mb-3">{t('mediaProviders.ingestHint')}</p>
          <ProviderChecklist value={form.ingest} onChange={(ingest) => update({ ingest })} enabled={enabled} testId="providers-ingest" legend={t('mediaProviders.ingestLegend')} />
        </div>

        {/* Playback */}
        <fieldset>
          <legend className="text-base font-semibold text-fg mb-3">{t('mediaProviders.playbackLegend')}</legend>
          <div className="grid gap-2 sm:grid-cols-2 mb-4">
            {STRATEGIES.map((s) => (
              <label key={s.value} className="flex items-start gap-2 rounded border border-border p-3 cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-surface-2">
                <input type="radio" name={`${ids}-strategy`} checked={form.strategy === s.value} onChange={() => update({ strategy: s.value })} className={radio} aria-describedby={`${ids}-${s.value}-hint`} data-testid={`providers-strategy-${s.value}`} />
                <span>
                  <span className="block font-medium text-fg">{t(s.label)}</span>
                  <span id={`${ids}-${s.value}-hint`} className="block text-sm text-fg-muted">{t(s.hint)}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="text-sm font-medium text-fg">{t('mediaProviders.orderLegend')}</p>
          <p className="text-sm text-fg-muted mb-2">{t('mediaProviders.orderHint')}</p>
          <ProviderOrderEditor
            idPrefix={`${ids}-play`}
            order={form.order}
            onOrder={(order) => update({ order })}
            strategy={form.strategy}
            weights={form.weights}
            onWeight={(p, v) => update({ weights: { ...form.weights, [p]: v } })}
            enabled={enabled}
            testId="providers-order"
          />
          {form.strategy === 'weighted' && (
            <fieldset className="mt-4">
              <legend className="text-sm font-medium text-fg mb-2">{t('mediaProviders.assignLegend')}</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {ASSIGNS.map((a) => (
                  <label key={a.value} className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" name={`${ids}-assign`} checked={form.assign === a.value} onChange={() => update({ assign: a.value })} className={radio} aria-describedby={`${ids}-${a.value}-ahint`} data-testid={`providers-assign-${a.value}`} />
                    <span>
                      <span className="block text-fg">{t(a.label)}</span>
                      <span id={`${ids}-${a.value}-ahint`} className="block text-sm text-fg-muted">{t(a.hint)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </fieldset>

        {/* Health fallback */}
        <fieldset>
          <legend className="text-base font-semibold text-fg mb-2">{t('mediaProviders.healthLegend')}</legend>
          <label className="flex items-start gap-2 cursor-pointer mb-3">
            <input type="checkbox" role="switch" checked={form.healthEnabled} onChange={(e) => update({ healthEnabled: e.target.checked })} className={radio} aria-describedby={`${ids}-health-hint`} data-testid="providers-health-enabled" />
            <span>
              <span className="block text-fg">{t('mediaProviders.healthEnabled')}</span>
              <span id={`${ids}-health-hint`} className="block text-sm text-fg-muted">{t('mediaProviders.healthEnabledHint')}</span>
            </span>
          </label>
          {form.healthEnabled && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {HEALTH_FIELDS.map((f) => {
                const invalid = parseWhole(form.health[f.key], f.min, f.max) === null;
                return (
                  <div key={f.key} className="flex flex-col gap-1">
                    <label htmlFor={`${ids}-${f.key}`} className="text-sm font-medium text-fg">{t(f.label)}</label>
                    <input
                      id={`${ids}-${f.key}`}
                      type="number"
                      inputMode="numeric"
                      min={f.min}
                      max={f.max}
                      step={1}
                      value={form.health[f.key]}
                      onChange={(e) => update({ health: { ...form.health, [f.key]: e.target.value } })}
                      aria-invalid={invalid || undefined}
                      aria-describedby={`${ids}-${f.key}-hint`}
                      className={`${fieldClass} w-full`}
                      data-testid={`providers-health-${f.key}`}
                    />
                    <span id={`${ids}-${f.key}-hint`} className={`text-sm ${invalid ? 'text-danger-fg' : 'text-fg-muted'}`}>
                      {f.hint ? `${t(f.hint)}. ` : ''}
                      {t('mediaProviders.numberHint', { min: String(f.min), max: String(f.max) })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </fieldset>

        {/* Thumbnails */}
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-thumbs`} className="text-base font-semibold text-fg">{t('mediaProviders.thumbnailsLegend')}</label>
          <span id={`${ids}-thumbs-hint`} className="text-sm text-fg-muted">{t('mediaProviders.thumbnailsHint')}</span>
          <select id={`${ids}-thumbs`} value={form.thumbnails} onChange={(e) => update({ thumbnails: e.target.value as MediaProviderId })} aria-describedby={`${ids}-thumbs-hint`} className={`${fieldClass} mt-1 w-full sm:w-64`} data-testid="providers-thumbnails">
            {MEDIA_PROVIDER_IDS.map((p) => (
              <option key={p} value={p}>{name(p)}</option>
            ))}
          </select>
        </div>

        {/* Channel overrides */}
        <div data-testid="providers-channels">
          <h3 className="text-base font-semibold text-fg mb-1">{t('mediaProviders.channelsLegend')}</h3>
          <p className="text-sm text-fg-muted mb-3">{t('mediaProviders.channelsHint')}</p>
          {channelIds.length === 0 && !editing && <p className="text-sm text-fg-muted mb-3" data-testid="providers-channels-empty">{t('mediaProviders.channelsEmpty')}</p>}
          {channelIds.length > 0 && (
            <ul className="divide-y divide-border rounded border border-border mb-3">
              {channelIds.map((id) => {
                const o = form.channels[id]!;
                return (
                  <li key={id} className="flex flex-wrap items-start justify-between gap-3 p-3" data-testid={`providers-channel-${id}`}>
                    <dl className="grid min-w-0 flex-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                      <dt className="text-fg-muted">{t('mediaProviders.colChannel')}</dt>
                      <dd className="font-mono text-fg break-all">{id}</dd>
                      <dt className="text-fg-muted">{t('mediaProviders.colIngest')}</dt>
                      <dd className="text-fg">{listText(o.ingest)}</dd>
                      <dt className="text-fg-muted">{t('mediaProviders.colPlayback')}</dt>
                      <dd className="text-fg">
                        {o.strategy ? `${t(o.strategy === 'weighted' ? 'mediaProviders.strategyWeighted' : 'mediaProviders.strategyPriority')}: ` : ''}
                        {listText(o.order)}
                      </dd>
                      {o.note && (
                        <>
                          <dt className="text-fg-muted">{t('mediaProviders.colNote')}</dt>
                          <dd className="text-fg break-words">{o.note}</dd>
                        </>
                      )}
                    </dl>
                    <span className="flex gap-2">
                      <button type="button" className={`${secondaryButtonClass} !py-2 !px-3 text-sm`} onClick={() => startEdit(id)} disabled={!!editing} data-testid={`providers-channel-${id}-edit`}>{t('mediaProviders.editChannel')}</button>
                      <button type="button" className={`${secondaryButtonClass} !py-2 !px-3 text-sm`} onClick={() => removeChannel(id)} aria-label={t('mediaProviders.removeChannelLabel', { channel: id })} data-testid={`providers-channel-${id}-remove`}>{t('mediaProviders.removeChannel')}</button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {editing && (
            <div className="rounded-lg border border-accent bg-surface-2 p-4 mb-3" data-testid="providers-channel-editor">
              <p className="mb-3 text-sm text-fg">
                {t('mediaProviders.colChannel')}: <span className="font-mono">{editing}</span>
              </p>
              <OverrideEditor
                idPrefix={`${ids}-ch`}
                draft={draft}
                onDraft={setDraft}
                enabled={enabled}
                withIngest
                testId="providers-channel-override"
                inherited={{ ingest: form.ingest, order: form.order, strategy: form.strategy }}
              />
              <button type="button" className={`${primaryButtonClass} mt-4 !py-2 !px-4 text-sm`} onClick={finishEdit} data-testid="providers-channel-done">{t('mediaProviders.doneChannel')}</button>
            </div>
          )}
          {!editing && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor={`${ids}-new-channel`} className="text-sm font-medium text-fg">{t('mediaProviders.channelId')}</label>
                <input
                  id={`${ids}-new-channel`}
                  type="text"
                  value={newChannel}
                  onChange={(e) => setNewChannel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addChannel();
                    }
                  }}
                  aria-invalid={!!channelError || undefined}
                  aria-describedby={`${ids}-new-channel-hint`}
                  className={`${fieldClass} w-full sm:w-72 font-mono`}
                  data-testid="providers-channel-id"
                />
              </div>
              <button type="button" className={`${secondaryButtonClass} !py-2 !px-4 text-sm`} onClick={addChannel} data-testid="providers-channel-add">{t('mediaProviders.addChannel')}</button>
              <p id={`${ids}-new-channel-hint`} className={`basis-full text-sm ${channelError ? 'text-danger-fg' : 'text-fg-muted'}`}>{channelError ?? t('mediaProviders.channelIdHint')}</p>
            </div>
          )}
        </div>

        {problems.length > 0 && (
          <div role="alert" className="rounded border border-danger-border bg-danger-bg p-4 text-danger-fg" data-testid="providers-problems">
            <p className="font-medium mb-1">{t('mediaProviders.problemsTitle')}</p>
            <ul className="list-disc ps-5 space-y-1">
              {problems.map((p, i) => (
                <li key={`${p.problem}-${p.detail ?? i}`} data-problem={p.problem}>{problemText(p)}</li>
              ))}
            </ul>
          </div>
        )}
        {error && (
          <ErrorAlert testId="providers-save-error">
            {error}
            {refused.length > 0 && (
              <>
                {' '}
                {t('mediaProviders.refused')} {refused.join(' ')}
              </>
            )}
          </ErrorAlert>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={`${primaryButtonClass} disabled:opacity-60 disabled:cursor-not-allowed`} disabled={!!busy || !dirty || !next || problems.length > 0 || !!editing} data-testid="providers-save">
            {busy === 'save' ? t('mediaProviders.saving') : t('mediaProviders.save')}
          </button>
          {dirty && (
            <button type="button" className={`${secondaryButtonClass} disabled:opacity-60`} disabled={!!busy} onClick={() => { setForm(formOf(saved)); setEditing(null); setRefused([]); setError(null); }} data-testid="providers-reset">
              {t('mediaProviders.reset')}
            </button>
          )}
          <p role="status" className="text-sm text-fg" data-testid="providers-saved">{notice ?? (dirty ? t('mediaProviders.unsaved') : '')}</p>
        </div>
        <p className="text-sm text-fg-muted" data-testid="providers-updated">
          {saved.updatedAt ? t('mediaProviders.updated', { date: formatDate(saved.updatedAt, locale, true), user: saved.updatedBy ?? '—' }) : t('mediaProviders.neverChanged')}
        </p>
      </form>
    </section>
  );
}
