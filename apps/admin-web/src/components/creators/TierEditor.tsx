'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CreatorTier } from '@al-ummah/shared-types';
import { deleteCreatorTier, saveCreatorTier, type TierForm } from '@/lib/api/creators';
import { useLanguage } from '@/i18n/I18nProvider';
import { cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

type Message = { kind: 'ok' | 'error'; text: string } | null;

const SHIPPED = new Set(['creator', 'unlimited']);

function toForm(tier?: CreatorTier): TierForm {
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

/** One tier's limits, editable by admins (creators:manage); saved through admin-api with an audit row. */
function TierCard({ tier, canManage, create = false }: { tier?: CreatorTier; canManage: boolean; create?: boolean }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [form, setForm] = useState<TierForm>(toForm(tier));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const id = create ? 'new' : tier?.id ?? '';
  const fixedUnlimited = tier?.id === 'unlimited';
  const set = <K extends keyof TierForm>(key: K, value: TierForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function run(action: () => ReturnType<typeof saveCreatorTier>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (!result.ok) {
        const text = result.status === 409 && /hold/.test(result.error) ? t('creators.tierInUse') : t('creators.tierInvalid', { error: result.error });
        setMessage({ kind: 'error', text });
        return;
      }
      setMessage({ kind: 'ok', text: ok });
      if (create) setForm(toForm());
      router.refresh();
    } catch (error) {
      logger.error('[creators] Tier action failed', { id, error: error instanceof Error ? error.message : String(error) });
      setMessage({ kind: 'error', text: t('creators.saveFailed') });
    } finally {
      setBusy(false);
    }
  }

  const number = (key: 'perHour' | 'perDay' | 'maxConcurrent', label: string) => (
    <label className="flex flex-col gap-1 text-sm text-fg-muted">
      {label}
      <input
        type="number"
        min={1}
        required
        value={form[key]}
        disabled={!canManage || form.unlimited}
        onChange={(e) => set(key, Number(e.target.value))}
        className={fieldClass}
        data-testid={`tier-${id}-${key}`}
      />
    </label>
  );

  return (
    <form
      className={`${cardClass} flex flex-col gap-4`}
      data-testid={`tier-card-${id}`}
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => saveCreatorTier(form, create), t('creators.tierSaved'));
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {create && (
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            {t('creators.tierId')}
            <input required pattern="[a-z0-9][a-z0-9-]{1,39}" value={form.id} disabled={!canManage} onChange={(e) => set('id', e.target.value)} className={fieldClass} dir="ltr" data-testid="tier-new-id" />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm text-fg-muted">
          {t('creators.tierName')}
          <input required maxLength={60} value={form.name} disabled={!canManage} onChange={(e) => set('name', e.target.value)} className={fieldClass} data-testid={`tier-${id}-name`} />
        </label>
        <label className="flex items-center gap-2 text-sm text-fg self-end pb-2">
          <input type="checkbox" checked={form.unlimited} disabled={!canManage || fixedUnlimited} onChange={(e) => set('unlimited', e.target.checked)} data-testid={`tier-${id}-unlimited`} />
          {t('creators.tierUnlimited')}
        </label>
      </div>
      {!form.unlimited && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {number('perHour', t('creators.tierPerHour'))}
          {number('perDay', t('creators.tierPerDay'))}
          {number('maxConcurrent', t('creators.tierConcurrent'))}
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            {t('creators.tierChannels')}
            <input
              type="number"
              min={1}
              value={form.maxChannels ?? ''}
              placeholder={t('creators.tierChannelsHint')}
              disabled={!canManage}
              onChange={(e) => set('maxChannels', e.target.value === '' ? null : Number(e.target.value))}
              className={fieldClass}
              data-testid={`tier-${id}-maxChannels`}
            />
          </label>
        </div>
      )}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={primaryButtonClass} disabled={busy} data-testid={`tier-${id}-save`}>
            {create ? t('creators.tierCreate') : t('creators.tierSave')}
          </button>
          {!create && tier && !SHIPPED.has(tier.id) && (
            <button
              type="button"
              className={secondaryButtonClass}
              disabled={busy}
              onClick={() => {
                if (window.confirm(t('creators.tierDeleteConfirm', { name: tier.name }))) void run(() => deleteCreatorTier(tier.id), t('creators.tierDeleted'));
              }}
            >
              {t('creators.tierDelete')}
            </button>
          )}
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm min-h-5" data-testid={`tier-${id}-status`}>
        {message && <span className={message.kind === 'ok' ? 'text-success-fg' : 'text-danger-fg'}>{message.text}</span>}
      </p>
    </form>
  );
}

export function TierEditor({ tiers, canManage }: { tiers: CreatorTier[]; canManage: boolean }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-6">
      {tiers.map((tier) => (
        <section key={tier.id} aria-label={tier.name}>
          <h2 className="mb-2 text-lg font-semibold text-fg">{tier.name}</h2>
          <TierCard tier={tier} canManage={canManage} />
        </section>
      ))}
      {canManage && (
        <section aria-labelledby="tier-add">
          <h2 id="tier-add" className="mb-2 text-lg font-semibold text-fg">{t('creators.tierAdd')}</h2>
          <TierCard canManage={canManage} create />
        </section>
      )}
    </div>
  );
}
