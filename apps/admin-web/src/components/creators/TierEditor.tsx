'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CREATOR_TIER_BOUNDS, CREATOR_TIER_IDS, CREATOR_TIER_TEXT, parseDigits, type CreatorTier } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { isUnexpectedFailure, tierActionMessage, tierEffect, tierFormPayload, tierToForm, validateTierForm, type TierField, type TierFormValues, type TierPayload, tierLabel } from '@/lib/creator-tiers';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import Link from '@/components/AppLink';
import { cardClass, fieldClass, linkClass } from '@/components/ui';
import { Chip, dangerButtonClass } from '@/components/content/parts';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { TierChangeDialog, confirmButtonClass } from './TierChangeDialog';
import { DefaultTierButton, type SetDefaultTierAction } from './DefaultTierButton';

type Message = { kind: 'ok' | 'error'; text: string } | null;

/** Server actions (lib/api/creators saveCreatorTier / deleteCreatorTier), passed down from the page. */
export interface TierActions {
  save: (tier: TierPayload, create: boolean) => Promise<ActionResult<unknown>>;
  remove: (id: string) => Promise<ActionResult<unknown>>;
  /** Makes a tier (or 'none') the default, with Undo */
  setDefault?: SetDefaultTierAction;
  /** Reorders the tiers (rank), with Undo */
  reorder?: (ids: string[], opts?: { undo?: boolean }) => Promise<ActionResult<{ previous: string[]; order: string[] }>>;
}
type Pending = 'save' | 'delete' | null;

const SHIPPED = new Set<string>(Object.values(CREATOR_TIER_IDS));


type NumberField = 'perHour' | 'perDay' | 'maxConcurrent' | 'captionMinutesMonth' | 'liveHoursMonth' | 'liveMaxConcurrent' | 'liveMaxStreamMinutes' | 'audioTracksPerVideo';

const HELP: Record<NumberField | 'maxChannels', MessageKey> = {
  perHour: 'creators.helpPerHour',
  perDay: 'creators.helpPerDay',
  maxConcurrent: 'creators.helpConcurrent',
  maxChannels: 'creators.helpChannels',
  captionMinutesMonth: 'creators.helpCaptions',
  audioTracksPerVideo: 'creators.helpAudioTracks',
  liveHoursMonth: 'creators.helpLiveHours',
  liveMaxConcurrent: 'creators.helpLiveConcurrent',
  liveMaxStreamMinutes: 'creators.helpLiveMaxMinutes',
};

/** One tier's limits, editable by admins (creators:manage); saved through admin-api with an audit row. */
function TierCard({ tier, users, invites = 0, canManage, actions, create = false, isDefault = false }: { tier?: CreatorTier; users: number; invites?: number; canManage: boolean; actions: TierActions; create?: boolean; isDefault?: boolean }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const ids = useId();
  const [form, setForm] = useState<TierFormValues>(tierToForm(tier));
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
      setForm(tierToForm());
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

  const number = (field: NumberField, label: string) => {
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
          onChange={(e) => set(field, e.target.value === '' ? NaN : Number(parseDigits(e.target.value)))}
          className={fieldClass}
          dir="ltr"
          data-testid={`tier-${key}-${field}`}
        />
        <span id={help(field)} className="text-xs">{t(HELP[field], { min: n(min), max: n(max) })}</span>
        {errorOf(field)}
      </label>
    );
  };

  const textField = (field: 'nameAr' | 'description' | 'descriptionAr', label: string, helpText: string, max: number, dir: 'rtl' | 'auto') => (
    <label className="flex flex-col gap-1 text-sm text-fg-muted">
      <span className="text-fg font-medium">{label}</span>
      <input
        maxLength={max}
        value={form[field]}
        disabled={!canManage}
        aria-invalid={shown[field] ? true : undefined}
        aria-describedby={described(field)}
        onChange={(e) => set(field, e.target.value)}
        className={fieldClass}
        dir={dir}
        lang={dir === 'rtl' ? 'ar' : undefined}
        data-testid={`tier-${key}-${field}`}
      />
      <span id={help(field)} className="text-xs">{helpText}</span>
      {errorOf(field)}
    </label>
  );

  const flag = (field: 'uploads' | 'channels' | 'requestable', label: string, forcedOn: boolean, describedBy?: string) => (
    <label className="flex items-center gap-2 text-sm text-fg">
      <input
        type="checkbox"
        checked={forcedOn || form[field]}
        disabled={!canManage || forcedOn}
        aria-describedby={describedBy}
        onChange={(e) => set(field, e.target.checked)}
        className="h-4 w-4 accent-accent"
        data-testid={`tier-${key}-${field}`}
      />
      {label}
    </label>
  );

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
        if (create) void run(() => actions.save(tierFormPayload(form), true), t('creators.tierSaved'));
        else setPending('save');
      }}
    >
      {!create && saved && (
        <p className="text-sm text-fg-muted" data-testid={`tier-${key}-effect`}>{tierEffect(saved, t, locale)}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
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
        {textField('nameAr', t('creators.tierNameAr'), t('creators.helpNameAr'), CREATOR_TIER_TEXT.name, 'rtl')}
        {textField('description', t('creators.tierDescription'), t('creators.helpDescription'), CREATOR_TIER_TEXT.description, 'auto')}
        {textField('descriptionAr', t('creators.tierDescriptionAr'), t('creators.helpDescriptionAr'), CREATOR_TIER_TEXT.description, 'rtl')}
      </div>
      <fieldset className="flex flex-col gap-2 rounded border border-border p-4" data-testid={`tier-${key}-access`}>
        <legend className="px-1 text-sm font-medium text-fg">{t('creators.tierAccess')}</legend>
        {/* Each switch says in one line what it allows and what a user without it sees */}
        <div className="flex flex-col gap-3">
          {([
            ['uploads', 'creators.tierUploadsFlag', 'creators.helpUploadsFlag'],
            ['channels', 'creators.tierChannelsFlag', 'creators.helpChannelsFlag'],
          ] as const).map(([field, label, help]) => (
            <div key={field} className="flex flex-col gap-1">
              {flag(field, t(label), form.unlimited, `${ids}-${field}-help`)}
              <span id={`${ids}-${field}-help`} className="ps-6 text-xs text-fg-muted" data-testid={`tier-${key}-${field}-help`}>{t(help)}</span>
            </div>
          ))}
        </div>
        {form.unlimited && <span className="text-xs text-fg-muted">{t('creators.helpFlagsUnlimited')}</span>}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          {flag('requestable', t('creators.tierRequestable'), false, `${ids}-requestable-help`)}
          <span id={`${ids}-requestable-help`} className="ps-6 text-xs text-fg-muted" data-testid={`tier-${key}-requestable-help`}>{t('creators.helpRequestable')}</span>
        </div>
        {/* Rank is set by reordering the Rank list above (drag or move up/down), not typed here */}
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
              onChange={(e) => set('maxChannels', e.target.value === '' ? null : Number(parseDigits(e.target.value)))}
              className={fieldClass}
              dir="ltr"
              data-testid={`tier-${key}-maxChannels`}
            />
            <span id={help('maxChannels')} className="text-xs">
              {t(HELP.maxChannels, { min: n(CREATOR_TIER_BOUNDS.maxChannels.min), max: n(CREATOR_TIER_BOUNDS.maxChannels.max) })}
            </span>
            {errorOf('maxChannels')}
          </label>
          {number('captionMinutesMonth', t('creators.tierCaptions'))}
          {number('audioTracksPerVideo', t('creators.tierAudioTracks'))}
        </div>
      )}
      <fieldset className="flex flex-col gap-3 border-t border-border pt-4" data-testid={`tier-${key}-live`}>
        <legend className="text-fg font-medium text-sm">{t('creators.tierLive')}</legend>
        {form.unlimited ? (
          <p className="text-xs text-fg-muted" data-testid={`tier-${key}-live-unlimited`}>{t('creators.helpLiveUnlimited')}</p>
        ) : (
          <>
            <div className="flex flex-col gap-1 text-sm">
              <label className="flex items-center gap-2 text-fg">
                <input
                  type="checkbox"
                  checked={form.live}
                  disabled={!canManage}
                  aria-describedby={`${ids}-live-help`}
                  onChange={(e) => set('live', e.target.checked)}
                  className="h-4 w-4 accent-accent"
                  data-testid={`tier-${key}-liveAllowed`}
                />
                {t('creators.tierLiveAllowed')}
              </label>
              <span id={`${ids}-live-help`} className="text-xs text-fg-muted">{t('creators.helpLive')}</span>
            </div>
            {form.live && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {number('liveHoursMonth', t('creators.tierLiveHours'))}
                {number('liveMaxConcurrent', t('creators.tierLiveConcurrent'))}
                {number('liveMaxStreamMinutes', t('creators.tierLiveMaxMinutes'))}
              </div>
            )}
          </>
        )}
      </fieldset>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={confirmButtonClass} disabled={busy} data-testid={`tier-${key}-save`}>
            {busy ? t('creators.saving') : create ? t('creators.tierCreate') : t('creators.tierSave')}
          </button>
          {!create && tier && !SHIPPED.has(tier.id) && (
            <button
              type="button"
              className={dangerButtonClass}
              disabled={busy || users > 0 || invites > 0 || isDefault}
              aria-describedby={users > 0 || invites > 0 || isDefault ? `${ids}-delete-blocked` : undefined}
              onClick={() => setPending('delete')}
              data-testid={`tier-${key}-delete`}
            >
              {t('creators.tierDelete')}
            </button>
          )}
          {/* Owner rule: a tier users, pending invites or new sign-ups (the default) depend on cannot be deleted; say why and where to go */}
          {!create && tier && !SHIPPED.has(tier.id) && (users > 0 || invites > 0 || isDefault) && (
            <span id={`${ids}-delete-blocked`} className="flex flex-col gap-0.5 text-xs text-fg-muted" data-testid={`tier-${key}-delete-blocked`}>
              {isDefault && <span data-testid={`tier-${key}-is-default`}>{t('creators.tierIsDefault')}</span>}
              {users > 0 && (
                <span data-testid={`tier-${key}-in-use`}>
                  {users === 1 ? t('creators.tierInUseOne') : t('creators.tierInUseCount', { count: n(users) })}{' '}
                  <Link href={`/users?tier=${encodeURIComponent(tier.id)}`} className={`${linkClass} underline`} data-testid={`tier-${key}-users-link`}>
                    {t('creators.tierShowUsers')}
                  </Link>
                </span>
              )}
              {invites > 0 && (
                <span data-testid={`tier-${key}-invites`}>
                  {invites === 1 ? t('creators.tierInvitesOne') : t('creators.tierInvitesCount', { count: n(invites) })}{' '}
                  <Link href="/users/invites" className={`${linkClass} underline`} data-testid={`tier-${key}-invites-link`}>
                    {t('creators.tierShowInvites')}
                  </Link>
                </span>
              )}
            </span>
          )}
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm min-h-5" data-testid={`tier-${key}-status`}>
        {message && <span className={message.kind === 'ok' ? 'text-success-fg' : 'text-danger-fg'}>{message.text}</span>}
      </p>
      {!create && tier && (
        <TierChangeDialog
          open={pending !== null}
          title={pending === 'delete' ? t('creators.tierDeleteTitle', { name: tierLabel(tier, locale) }) : t('creators.tierSaveTitle', { name: form.name.trim() || tier.name })}
          body={pending === 'delete' ? t('creators.tierDeleteBody') : `${(users === 1 ? t('creators.tierSaveBodyOne') : t('creators.tierSaveBody', { count: n(users) }))} ${tierEffect(form, t, locale)}`}
          confirmLabel={pending === 'delete' ? t('creators.tierDelete') : t('creators.tierSave')}
          danger={pending === 'delete'}
          testId={`tier-${key}-confirm`}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            void (pending === 'delete'
              ? run(() => actions.remove(tier.id), t('creators.tierDeleted'))
              : run(() => actions.save(tierFormPayload(form), false), t('creators.tierSaved')))
          }
        />
      )}
    </form>
  );
}

export function TierEditor({ tiers, counts, invites = {}, defaultTierId, canManage, actions }: { tiers: CreatorTier[]; counts: Record<string, number>; invites?: Record<string, number>; defaultTierId?: string; canManage: boolean; actions: TierActions }) {
  const { t, locale } = useLanguage();
  return (
    <div className="flex flex-col gap-6">
      {tiers.map((tier) => (
        <section key={tier.id} id={`tier-${tier.id}`} aria-labelledby={`tier-${tier.id}-title`} className="scroll-mt-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 id={`tier-${tier.id}-title`} className="text-lg font-semibold text-fg">{tierLabel(tier, locale)}</h2>
            <Chip tone={tier.unlimited ? 'info' : 'good'} testId={`tier-${tier.id}-users`}>
              {(counts[tier.id] ?? 0) === 1 ? t('creators.tierUsersOne') : t('creators.tierUsers', { count: formatNumber(counts[tier.id] ?? 0, locale) })}
            </Chip>
            {tier.id === defaultTierId ? (
              <Chip tone="info" testId={`tier-${tier.id}-default`}>{t('creators.tierDefaultChip')}</Chip>
            ) : (
              canManage && actions.setDefault && (
                <DefaultTierButton tierId={tier.id} tierName={tierLabel(tier, locale)} label={t('creators.tierSetDefault')} setDefault={actions.setDefault} testId={`tier-${tier.id}-set-default`} />
              )
            )}
          </div>
          <TierCard tier={tier} users={counts[tier.id] ?? 0} invites={invites[tier.id] ?? 0} canManage={canManage} actions={actions} isDefault={tier.id === defaultTierId} />
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

