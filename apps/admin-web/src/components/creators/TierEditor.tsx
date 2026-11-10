'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CREATOR_TIER_BOUNDS, CREATOR_TIER_IDS, type CreatorTier } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { isUnexpectedFailure, tierActionMessage, tierEffect, validateTierForm, type TierField, type TierFormValues } from '@/lib/creator-tiers';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import { cardClass, fieldClass } from '@/components/ui';
import { Chip, dangerButtonClass } from '@/components/content/parts';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { TierChangeDialog, confirmButtonClass } from './TierChangeDialog';

type Message = { kind: 'ok' | 'error'; text: string } | null;

/** Server actions (lib/api/creators saveCreatorTier / deleteCreatorTier), passed down from the page. */
export interface TierActions {
  save: (tier: TierFormValues, create: boolean) => Promise<ActionResult<unknown>>;
  remove: (id: string) => Promise<ActionResult<unknown>>;
}
type Pending = 'save' | 'delete' | null;

const SHIPPED = new Set<string>(Object.values(CREATOR_TIER_IDS));

function toForm(tier?: CreatorTier): TierFormValues {
  return {
    id: tier?.id ?? '',
    name: tier?.name ?? '',
    unlimited: tier?.unlimited ?? false,
    perHour: tier?.perHour || 300,
    perDay: tier?.perDay || 2000,
    maxConcurrent: tier?.maxConcurrent || 20,
    maxChannels: tier ? tier.maxChannels : 3,
  };
}

const HELP: Record<'perHour' | 'perDay' | 'maxConcurrent' | 'maxChannels', MessageKey> = {
  perHour: 'creators.helpPerHour',
  perDay: 'creators.helpPerDay',
  maxConcurrent: 'creators.helpConcurrent',
  maxChannels: 'creators.helpChannels',
};

/** One tier's limits, editable by admins (creators:manage); saved through admin-api with an audit row. */
function TierCard({ tier, users, canManage, actions, create = false }: { tier?: CreatorTier; users: number; canManage: boolean; actions: TierActions; create?: boolean }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const ids = useId();
  const [form, setForm] = useState<TierFormValues>(toForm(tier));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [message, setMessage] = useState<Message>(null);
  const key = create ? 'new' : tier?.id ?? '';
  const fixedUnlimited = tier?.id === CREATOR_TIER_IDS.unlimited;
  const errors = validateTierForm(form, { create });
  const shown = touched ? errors : {};
  const n = (value: number) => formatNumber(value, locale);
  const set = <K extends keyof TierFormValues>(field: K, value: TierFormValues[K]) => setForm((f) => ({ ...f, [field]: value }));

  async function run(action: () => Promise<ActionResult<unknown>>, ok: string) {
    setPending(null);
    setBusy(true);
    setMessage(null);
    let result: ActionResult<unknown>;
    try {
      result = await action();
    } catch (error) {
      result = { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
    setBusy(false);
    if (!result.ok) {
      logger.warn('[creators] Tier action failed', { id: key, status: result.status, code: result.code });
      if (isUnexpectedFailure(result)) reportError(new Error(`Creator tier action failed: ${result.status} ${result.code ?? ''}`.trim()), { kind: 'fetch', status: result.status, shown: true });
      setMessage({ kind: 'error', text: t(tierActionMessage(result)) });
      return;
    }
    setMessage({ kind: 'ok', text: ok });
    if (create) {
      setForm(toForm());
      setTouched(false);
    }
    router.refresh();
  }

  const help = (field: TierField) => `${ids}-${field}-help`;
  const errorOf = (field: TierField) =>
    shown[field] ? (
      <span id={`${ids}-${field}-error`} className="text-xs text-danger-fg" data-testid={`tier-${key}-${field}-error`}>
        {t(shown[field]!.key, shown[field]!.params)}
      </span>
    ) : null;
  const described = (field: TierField) => [help(field), shown[field] ? `${ids}-${field}-error` : ''].filter(Boolean).join(' ');

  const number = (field: 'perHour' | 'perDay' | 'maxConcurrent', label: string) => {
    const { min, max } = CREATOR_TIER_BOUNDS[field];
    return (
      <label className="flex flex-col gap-1 text-sm text-fg-muted">
        <span className="text-fg font-medium">{label}</span>
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          required
          value={Number.isFinite(form[field]) ? form[field] : ''}
          disabled={!canManage}
          aria-invalid={shown[field] ? true : undefined}
          aria-describedby={described(field)}
          onChange={(e) => set(field, e.target.value === '' ? NaN : Number(e.target.value))}
          className={fieldClass}
          dir="ltr"
          data-testid={`tier-${key}-${field}`}
        />
        <span id={help(field)} className="text-xs">{t(HELP[field], { min: n(min), max: n(max) })}</span>
        {errorOf(field)}
      </label>
    );
  };

  const saved = tier ?? null;
  const valid = Object.keys(errors).length === 0;

  return (
    <form
      noValidate
      className={`${cardClass} flex flex-col gap-4`}
      data-testid={`tier-card-${key}`}
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (!valid) return;
        if (create) void run(() => actions.save(form, true), t('creators.tierSaved'));
        else setPending('save');
      }}
    >
      {!create && saved && (
        <p className="text-sm text-fg-muted" data-testid={`tier-${key}-effect`}>{tierEffect(saved, t, locale)}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {create && (
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            <span className="text-fg font-medium">{t('creators.tierId')}</span>
            <input
              required
              value={form.id}
              disabled={!canManage}
              aria-invalid={shown.id ? true : undefined}
              aria-describedby={described('id')}
              onChange={(e) => set('id', e.target.value.trim().toLowerCase())}
              className={fieldClass}
              dir="ltr"
              data-testid="tier-new-id"
            />
            <span id={help('id')} className="text-xs">{t('creators.helpId')}</span>
            {errorOf('id')}
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          <span className="text-fg font-medium">{t('creators.tierName')}</span>
          <input
            required
            maxLength={60}
            value={form.name}
            disabled={!canManage}
            aria-invalid={shown.name ? true : undefined}
            aria-describedby={described('name')}
            onChange={(e) => set('name', e.target.value)}
            className={fieldClass}
            dir="auto"
            data-testid={`tier-${key}-name`}
          />
          <span id={help('name')} className="text-xs">{t('creators.helpName')}</span>
          {errorOf('name')}
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <label className="flex items-center gap-2 text-fg pt-6">
            <input
              type="checkbox"
              checked={form.unlimited}
              disabled={!canManage || fixedUnlimited}
              aria-describedby={`${ids}-unlimited-help`}
              onChange={(e) => set('unlimited', e.target.checked)}
              className="h-4 w-4 accent-accent"
              data-testid={`tier-${key}-unlimited`}
            />
            {t('creators.tierUnlimited')}
          </label>
          <span id={`${ids}-unlimited-help`} className="text-xs text-fg-muted">
            {fixedUnlimited ? t('creators.helpUnlimitedFixed') : t('creators.helpUnlimited')}
          </span>
        </div>
      </div>
      {!form.unlimited && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {number('perHour', t('creators.tierPerHour'))}
          {number('perDay', t('creators.tierPerDay'))}
          {number('maxConcurrent', t('creators.tierConcurrent'))}
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            <span className="text-fg font-medium">{t('creators.tierChannels')}</span>
            <input
              type="number"
              inputMode="numeric"
              min={CREATOR_TIER_BOUNDS.maxChannels.min}
              max={CREATOR_TIER_BOUNDS.maxChannels.max}
              step={1}
              value={form.maxChannels ?? ''}
              placeholder={t('creators.tierChannelsHint')}
              disabled={!canManage}
              aria-invalid={shown.maxChannels ? true : undefined}
              aria-describedby={described('maxChannels')}
              onChange={(e) => set('maxChannels', e.target.value === '' ? null : Number(e.target.value))}
              className={fieldClass}
              dir="ltr"
              data-testid={`tier-${key}-maxChannels`}
            />
            <span id={help('maxChannels')} className="text-xs">
              {t(HELP.maxChannels, { min: n(CREATOR_TIER_BOUNDS.maxChannels.min), max: n(CREATOR_TIER_BOUNDS.maxChannels.max) })}
            </span>
            {errorOf('maxChannels')}
          </label>
        </div>
      )}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={confirmButtonClass} disabled={busy} data-testid={`tier-${key}-save`}>
            {busy ? t('creators.saving') : create ? t('creators.tierCreate') : t('creators.tierSave')}
          </button>
          {!create && tier && !SHIPPED.has(tier.id) && (
            <button type="button" className={dangerButtonClass} disabled={busy || users > 0} onClick={() => setPending('delete')} data-testid={`tier-${key}-delete`}>
              {t('creators.tierDelete')}
            </button>
          )}
          {!create && tier && !SHIPPED.has(tier.id) && users > 0 && <span className="text-xs text-fg-muted">{t('creators.tierInUse')}</span>}
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm min-h-5" data-testid={`tier-${key}-status`}>
        {message && <span className={message.kind === 'ok' ? 'text-success-fg' : 'text-danger-fg'}>{message.text}</span>}
      </p>
      {!create && tier && (
        <TierChangeDialog
          open={pending !== null}
          title={pending === 'delete' ? t('creators.tierDeleteTitle', { name: tier.name }) : t('creators.tierSaveTitle', { name: form.name.trim() || tier.name })}
          body={pending === 'delete' ? t('creators.tierDeleteBody') : `${t('creators.tierSaveBody', { count: n(users) })} ${tierEffect(form, t, locale)}`}
          confirmLabel={pending === 'delete' ? t('creators.tierDelete') : t('creators.tierSave')}
          danger={pending === 'delete'}
          testId={`tier-${key}-confirm`}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            void (pending === 'delete'
              ? run(() => actions.remove(tier.id), t('creators.tierDeleted'))
              : run(() => actions.save(form, false), t('creators.tierSaved')))
          }
        />
      )}
    </form>
  );
}

export function TierEditor({ tiers, counts, canManage, actions }: { tiers: CreatorTier[]; counts: Record<string, number>; canManage: boolean; actions: TierActions }) {
  const { t, locale } = useLanguage();
  return (
    <div className="flex flex-col gap-6">
      {tiers.map((tier) => (
        <section key={tier.id} id={`tier-${tier.id}`} aria-labelledby={`tier-${tier.id}-title`} className="scroll-mt-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 id={`tier-${tier.id}-title`} className="text-lg font-semibold text-fg">{tier.name}</h2>
            <Chip tone={tier.unlimited ? 'info' : 'good'} testId={`tier-${tier.id}-users`}>
              {t('creators.tierUsers', { count: formatNumber(counts[tier.id] ?? 0, locale) })}
            </Chip>
          </div>
          <TierCard tier={tier} users={counts[tier.id] ?? 0} canManage={canManage} actions={actions} />
        </section>
      ))}
      {canManage && (
        <section aria-labelledby="tier-add">
          <h2 id="tier-add" className="mb-2 text-lg font-semibold text-fg">{t('creators.tierAdd')}</h2>
          <TierCard users={0} canManage={canManage} actions={actions} create />
        </section>
      )}
    </div>
  );
}

