'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminSuggestion, ReviewAlertSettings, ReviewRotaShift } from '@al-ummah/shared-types';
import {
  listStaffDevices,
  saveReviewAlertSettings,
  signOutStaffDevice,
  type ReviewAlertsView,
  type ReviewTimingDayView,
  type StaffDeviceView,
} from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { Autocomplete } from '@/components/search/Autocomplete';
import { ARABIC_INITIAL_STYLE, avatarInitial, isArabicInitial, resolveUrl } from '@/components/search/autocomplete-model';
import { TimeField, TimeZoneField } from './fields';
import { ConfirmButton } from '@/components/content/actions';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import {
  DEFAULT_SHIFT,
  addOwner,
  addReviewer,
  canSave,
  crossesMidnight,
  formatSeconds,
  removeOwner,
  removeReviewer,
  timeZones,
  toMinutes,
  toSeconds,
  toggleDay,
  updateReviewer,
} from './model';

const check = 'mt-1 h-4 w-4 shrink-0 accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
// A checkbox row tall enough to tap (44 px)
const checkRow = 'flex min-h-11 items-start gap-2 py-1';
// A day of a shift: a 44 px toggle that shows its state by its border too
const dayToggle =
  'inline-flex min-h-11 items-center gap-2 rounded border border-border bg-surface px-3 text-sm text-fg has-[:checked]:border-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus';
const dayCheck = 'h-4 w-4 shrink-0 accent-accent focus:outline-none';

/** The chosen staff member's name and email (the autocomplete's lookup); undefined while loading, null when unknown. */
function useStaffMember(userId: string | null): AdminSuggestion | null | undefined {
  const [item, setItem] = useState<{ id: string; item: AdminSuggestion | null } | null>(null);
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    fetch(resolveUrl('user', userId), { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Lookup answered ${res.status}`))))
      .then((body: { result?: { item?: AdminSuggestion | null } }) => setItem({ id: userId, item: body.result?.item ?? null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        logger.warn('[review-alerts] Staff member lookup failed', { error: error instanceof Error ? error.message : String(error) });
        setItem({ id: userId, item: null });
      });
    return () => controller.abort();
  }, [userId]);
  return item && item.id === userId ? item.item : undefined;
}

/** A staff member on the rota or an owner: name and email, read-only (removing is its own button). */
function StaffChip({ userId, role }: { userId: string; role: string }) {
  const { t } = useLanguage();
  const item = useStaffMember(userId);
  const name = item?.label ?? (item === null ? t('reviewAlerts.unknownUser') : t('autocomplete.lookingUp'));
  const initial = item?.label ? avatarInitial(item.label) : '';
  return (
    <div className="flex min-h-11 min-w-0 items-center gap-3" data-testid="review-alerts-staff" data-user-id={userId}>
      <span
        aria-hidden="true"
        style={isArabicInitial(initial) ? ARABIC_INITIAL_STYLE : undefined}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 font-medium text-fg-muted ${isArabicInitial(initial) ? 'text-xl leading-none' : ''}`}
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="sr-only">{role}: </span>
        <span className="truncate font-medium text-fg" dir="auto">{name}</span>
        {item?.secondary && <span className="truncate text-xs text-fg-muted" dir="auto">{item.secondary}</span>}
      </span>
    </div>
  );
}

export function ReviewAlertsAdmin({ view, timings }: { view: ReviewAlertsView; timings: ReviewTimingDayView[] | null }) {
  return (
    <div className="space-y-6">
      <RotaSettings view={view} />
      <Timings timings={timings} />
      <StaffDevices />
    </div>
  );
}

function RotaSettings({ view }: { view: ReviewAlertsView }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const { run } = useUndoableAction();
  const [saved, setSaved] = useState<ReviewAlertSettings>(view.settings);
  const [draft, setDraft] = useState<ReviewAlertSettings>(view.settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const editable = view.canManage && !busy;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const days = t('reviewAlerts.dayNames').split(',');
  const zones = useMemo(() => timeZones(), []);
  const actor = useStaffMember(view.updatedBy);

  const put = useCallback(
    async (settings: ReviewAlertSettings) => {
      const result = await saveReviewAlertSettings(settings);
      if (!result.ok) throw Object.assign(new Error(result.error), { status: result.status });
      return result.data;
    },
    [],
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!view.canManage || !dirty) return;
    if (!canSave(draft)) {
      setError(t('reviewAlerts.invalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Takes effect at once; Undo puts the previous settings back
      await run({
        action: () => put(draft),
        undo: async (res) => {
          await put(res.previous);
          setSaved(res.previous);
          setDraft(res.previous);
          router.refresh();
        },
        message: t('reviewAlerts.saved'),
        undoneMessage: t('reviewAlerts.undone'),
      });
      setSaved(draft);
      router.refresh();
    } catch (e) {
      logger.warn('[review-alerts] Save failed', { error: e instanceof Error ? e.message : String(e) });
      setError((e as { status?: number }).status === 401 ? t('errors.notAuthenticated') : t('reviewAlerts.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const setShift = (userId: string, index: number, shift: ReviewRotaShift | null) => {
    const entry = draft.rota.find((e) => e.userId === userId);
    if (!entry) return;
    const shifts = shift ? entry.shifts.map((s, i) => (i === index ? shift : s)) : entry.shifts.filter((_, i) => i !== index);
    setDraft(updateReviewer(draft, userId, { shifts }));
  };

  return (
    <section className={cardClass} aria-labelledby={`${ids}-title`} data-testid="review-alerts-settings">
      <h2 id={`${ids}-title`} className="sr-only">{t('reviewAlerts.title')}</h2>
      <form onSubmit={save} className="space-y-6" noValidate>
        <fieldset disabled={!editable} className="min-w-0 space-y-6">
          <label className={checkRow}>
            <input type="checkbox" className={check} checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} aria-describedby={`${ids}-enabled-hint`} data-testid="review-alerts-enabled" />
            <span>
              <span className="block font-medium text-fg">{t('reviewAlerts.enabled')}</span>
              <span id={`${ids}-enabled-hint`} className="block text-sm text-fg-muted">{t('reviewAlerts.enabledHint')}</span>
            </span>
          </label>

          <div>
            <h3 className="text-lg font-semibold text-fg mb-3">{t('reviewAlerts.escalationTitle')}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <MinutesField id={`${ids}-all`} label={t('reviewAlerts.escalateAll')} hint={t('reviewAlerts.escalateAllHint')} seconds={draft.escalateAllAfterSeconds} onChange={(s) => setDraft({ ...draft, escalateAllAfterSeconds: s })} testId="review-alerts-escalate-all" />
              <MinutesField id={`${ids}-seniors`} label={t('reviewAlerts.escalateSeniors')} hint={t('reviewAlerts.escalateSeniorsHint')} seconds={draft.escalateSeniorsAfterSeconds} onChange={(s) => setDraft({ ...draft, escalateSeniorsAfterSeconds: s })} testId="review-alerts-escalate-seniors" />
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-fg">{t('reviewAlerts.ownersTitle')}</h3>
            <p className="text-sm text-fg-muted mb-2">{t('reviewAlerts.ownersHint')}</p>
            <ul className="space-y-2 mb-3" data-testid="review-alerts-owners">
              {draft.owners.map((userId) => (
                <li key={userId} className="flex flex-wrap items-center justify-between gap-3 rounded border border-border p-3" data-user-id={userId}>
                  <StaffChip userId={userId} role={t('reviewAlerts.owner')} />
                  <button type="button" className={secondaryButtonClass} onClick={() => setDraft(removeOwner(draft, userId))} data-testid="review-alerts-owner-remove">
                    {t('reviewAlerts.removeOwner')}
                  </button>
                </li>
              ))}
            </ul>
            {editable && (
              <Autocomplete
                key={`owner-${pickerKey}`}
                kind="user"
                mode="pick"
                showIds={false}
                label={t('reviewAlerts.addOwner')}
                onChange={(id) => {
                  if (!id) return;
                  setDraft((d) => addOwner(d, id));
                  setPickerKey((k) => k + 1);
                }}
                testId="review-alerts-owner-add"
              />
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold text-fg">{t('reviewAlerts.rotaTitle')}</h3>
            <p className="text-sm text-fg-muted mb-3">{t('reviewAlerts.rotaHint')}</p>
            {draft.rota.length === 0 && <p className="text-sm text-fg-muted mb-3" data-testid="review-alerts-rota-empty">{t('reviewAlerts.rotaEmpty')}</p>}
            <ul className="space-y-4" data-testid="review-alerts-rota">
              {draft.rota.map((entry) => (
                <li key={entry.userId} className="rounded border border-border p-4 space-y-3" data-testid="review-alerts-rota-entry" data-user-id={entry.userId}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <StaffChip userId={entry.userId} role={t('reviewAlerts.reviewer')} />
                    <button type="button" className={secondaryButtonClass} onClick={() => setDraft(removeReviewer(draft, entry.userId))} data-testid="review-alerts-remove">
                      {t('reviewAlerts.remove')}
                    </button>
                  </div>
                  <TimeZoneField value={entry.timeZone} zones={zones} onChange={(timeZone) => setDraft(updateReviewer(draft, entry.userId, { timeZone }))} testId="review-alerts-time-zone" />
                  <div className="flex flex-wrap gap-4">
                    <label className={checkRow}>
                      <input type="checkbox" className={check} checked={entry.senior} onChange={(e) => setDraft(updateReviewer(draft, entry.userId, { senior: e.target.checked }))} data-testid="review-alerts-senior" />
                      <span>
                        <span className="block text-fg">{t('reviewAlerts.senior')}</span>
                        <span className="block text-sm text-fg-muted">{t('reviewAlerts.seniorHint')}</span>
                      </span>
                    </label>
                    <label className={checkRow}>
                      <input type="checkbox" className={check} checked={!!entry.paused} onChange={(e) => setDraft(updateReviewer(draft, entry.userId, { paused: e.target.checked || undefined }))} data-testid="review-alerts-paused" />
                      <span className="text-fg">{t('reviewAlerts.paused')}</span>
                    </label>
                  </div>
                  <fieldset className="min-w-0 space-y-2">
                    <legend className="text-sm font-medium text-fg">{t('reviewAlerts.shifts')}</legend>
                    {entry.shifts.length === 0 && <p className="text-sm text-fg-muted">{t('reviewAlerts.noShifts')}</p>}
                    {entry.shifts.map((shift, i) => (
                      <div key={i} className="flex flex-wrap items-end gap-3 rounded bg-surface-2 p-3" data-testid="review-alerts-shift">
                        <fieldset className="min-w-0">
                          <legend className="text-xs text-fg-muted mb-1">{t('reviewAlerts.shiftDays')}</legend>
                          <div className="flex flex-wrap gap-2">
                            {days.map((name, d) => (
                              <label key={d} className={dayToggle}>
                                <input type="checkbox" className={dayCheck} checked={shift.days.includes(d)} onChange={() => setShift(entry.userId, i, toggleDay(shift, d))} />
                                {name}
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        <TimeField label={t('reviewAlerts.shiftStart')} value={shift.start} onChange={(start) => setShift(entry.userId, i, { ...shift, start })} />
                        {/* "24:00" (end of day) shows as 00:00, and 00:00 is stored as 24:00 */}
                        <TimeField label={t('reviewAlerts.shiftEnd')} value={shift.end === '24:00' ? '00:00' : shift.end} onChange={(end) => setShift(entry.userId, i, { ...shift, end: end === '00:00' ? '24:00' : end })} />
                        {crossesMidnight(shift) && <span className="text-xs text-fg-muted">{t('reviewAlerts.crossesMidnight')}</span>}
                        <button type="button" className={secondaryButtonClass} onClick={() => setShift(entry.userId, i, null)}>{t('reviewAlerts.removeShift')}</button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className={secondaryButtonClass}
                      onClick={() => setDraft(updateReviewer(draft, entry.userId, { shifts: [...entry.shifts, { ...DEFAULT_SHIFT, days: [...DEFAULT_SHIFT.days] }] }))}
                      data-testid="review-alerts-add-shift"
                    >
                      {t('reviewAlerts.addShift')}
                    </button>
                  </fieldset>
                </li>
              ))}
            </ul>
            {editable && (
              <div className="mt-3">
                <Autocomplete
                  key={`reviewer-${pickerKey}`}
                  kind="user"
                  mode="pick"
                  showIds={false}
                  label={t('reviewAlerts.addReviewer')}
                  onChange={(id) => {
                    if (!id) return;
                    setDraft((d) => addReviewer(d, id));
                    setPickerKey((k) => k + 1);
                  }}
                  testId="review-alerts-reviewer-add"
                />
              </div>
            )}
          </div>
        </fieldset>

        <p className="text-sm text-fg-muted" data-testid="review-alerts-last-changed">
          {view.updatedAt ? t('reviewAlerts.lastChanged', { date: formatDate(view.updatedAt, locale, true), actor: actor?.label ?? (actor === null ? t('reviewAlerts.unknownUser') : '…') }) : t('reviewAlerts.neverChanged')}
        </p>
        {view.canManage ? (
          <button type="submit" className={primaryButtonClass} disabled={busy || !dirty} data-testid="review-alerts-save">
            {busy ? t('reviewAlerts.saving') : t('reviewAlerts.save')}
          </button>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="review-alerts-read-only">{t('reviewAlerts.readOnly')}</p>
        )}
        {error && <ErrorAlert testId="review-alerts-save-error">{error}</ErrorAlert>}
      </form>
    </section>
  );
}

function MinutesField({ id, label, hint, seconds, onChange, testId }: { id: string; label: string; hint: string; seconds: number; onChange: (seconds: number) => void; testId: string }) {
  return (
    <label htmlFor={id} className="flex flex-col text-sm">
      <span className="text-fg font-medium mb-1">{label}</span>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={0.5}
        max={60}
        step={0.5}
        className={`${fieldClass} min-h-11`}
        value={toMinutes(seconds)}
        onChange={(e) => onChange(toSeconds(Number(e.target.value) || 0))}
        aria-describedby={`${id}-hint`}
        data-testid={testId}
      />
      <span id={`${id}-hint`} className="text-fg-muted mt-1">{hint}</span>
    </label>
  );
}

function Timings({ timings }: { timings: ReviewTimingDayView[] | null }) {
  const { t, locale } = useLanguage();
  const ids = useId();
  const units = { s: (n: number) => t('reviewAlerts.seconds', { n }) };
  // Median / 90th percentile, each kept whole in a right-to-left row
  const fmt = (v: { p50: number | null; p90: number | null }) => (
    <>
      <bdi>{formatSeconds(v.p50, units)}</bdi> / <bdi>{formatSeconds(v.p90, units)}</bdi>
    </>
  );
  const cols: { key: 'toAlert' | 'toOpen' | 'toClaim' | 'toDecision'; label: MessageKey }[] = [
    { key: 'toAlert', label: 'reviewAlerts.toAlert' },
    { key: 'toOpen', label: 'reviewAlerts.toOpen' },
    { key: 'toClaim', label: 'reviewAlerts.toClaim' },
    { key: 'toDecision', label: 'reviewAlerts.toDecision' },
  ];
  return (
    <section className={cardClass} aria-labelledby={`${ids}-title`} data-testid="review-alerts-timings">
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg">{t('reviewAlerts.timingsTitle')}</h2>
      <p className="text-sm text-fg-muted mb-3">{t('reviewAlerts.timingsHint')}</p>
      {timings === null ? (
        <ErrorAlert testId="review-alerts-timings-error">{t('reviewAlerts.timingsFailed')}</ErrorAlert>
      ) : timings.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('reviewAlerts.timingsEmpty')}</p>
      ) : (
        <div className="overflow-x-auto rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" tabIndex={0} role="region" aria-labelledby={`${ids}-title`}>
          <table className="min-w-full whitespace-nowrap text-sm">
            <thead>
              <tr className="text-start text-fg-muted">
                <th scope="col" className="text-start p-2">{t('reviewAlerts.day')}</th>
                <th scope="col" className="text-end p-2">{t('reviewAlerts.held')}</th>
                <th scope="col" className="text-end p-2">{t('reviewAlerts.decided')}</th>
                {cols.map((c) => (
                  <th key={c.key} scope="col" className="text-end p-2">{t(c.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {timings.map((d) => (
                <tr key={d.day} className="border-t border-border">
                  <th scope="row" className="text-start p-2 font-normal">{formatDate(d.day, locale)}</th>
                  <td className="text-end p-2">{d.held}</td>
                  <td className="text-end p-2">{d.decided}</td>
                  {cols.map((c) => (
                    <td key={c.key} className="text-end p-2">{fmt(d[c.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const APP_LABEL: Record<StaffDeviceView['app'], MessageKey> = { viewer: 'reviewAlerts.appViewer', studio: 'reviewAlerts.appStudio', admin: 'reviewAlerts.appAdmin' };

function StaffDevices() {
  const { t, locale } = useLanguage();
  const ids = useId();
  const [userId, setUserId] = useState('');
  const [devices, setDevices] = useState<StaffDeviceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (id: string) => {
      setUserId(id);
      setDevices(null);
      setError(null);
      setNotice(null);
      if (!id) return;
      const result = await listStaffDevices(id);
      if (result.ok) setDevices(result.data.devices);
      else {
        logger.warn('[review-alerts] Devices not loaded', { status: result.status });
        setError(t('reviewAlerts.devicesFailed'));
      }
    },
    [t],
  );

  async function signOut(installId: string) {
    setBusy(installId);
    setError(null);
    setNotice(null);
    const result = await signOutStaffDevice(userId, installId);
    setBusy(null);
    if (!result.ok) {
      logger.warn('[review-alerts] Device sign-out failed', { status: result.status });
      setError(t('reviewAlerts.signOutFailed'));
      return;
    }
    setDevices((list) => (list ?? []).filter((d) => d.installId !== installId));
    setNotice(t('reviewAlerts.signedOut'));
  }

  return (
    <section className={cardClass} aria-labelledby={`${ids}-title`} data-testid="review-alerts-devices">
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg">{t('reviewAlerts.devicesTitle')}</h2>
      <p className="text-sm text-fg-muted mb-3">{t('reviewAlerts.devicesHint')}</p>
      <Autocomplete kind="user" mode="pick" showIds={false} label={t('reviewAlerts.devicesPick')} onChange={(id) => void load(id)} testId="review-alerts-devices-user" />
      {error && <ErrorAlert testId="review-alerts-devices-error">{error}</ErrorAlert>}
      <p role="status" className="text-sm text-fg mt-2" data-testid="review-alerts-devices-status">{notice}</p>
      {devices && devices.length === 0 && <p className="text-sm text-fg-muted mt-2">{t('reviewAlerts.devicesEmpty')}</p>}
      {devices && devices.length > 0 && (
        <ul className="mt-3 space-y-3 sm:hidden" data-testid="review-alerts-device-cards">
          {devices.map((d) => (
            <li key={d.installId} className="space-y-3 rounded border border-border bg-surface-2 p-4" data-install-id={d.installId}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-fg">{t(APP_LABEL[d.app] ?? 'reviewAlerts.appViewer')}</span>
                <span className="text-sm text-fg" dir="ltr">{d.platform}{d.appVersion ? ` · ${d.appVersion}` : ''}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-fg-muted">{t('reviewAlerts.deviceUpdated')}</dt>
                <dd className="text-fg">{formatDate(new Date(d.updatedAt), locale, true)}</dd>
                <dt className="text-fg-muted">{t('reviewAlerts.deviceToken')}</dt>
                <dd className="font-mono text-fg"><bdi dir="ltr">{d.tokenHint}</bdi></dd>
              </dl>
              {/* Wrapped: the button's <dialog> sibling would otherwise take the card's spacing */}
              <div>
                <ConfirmButton
                  label={t('reviewAlerts.signOut')}
                  busy={busy === d.installId}
                  title={t('reviewAlerts.signOutTitle')}
                  body={t('reviewAlerts.signOutBody')}
                  confirmLabel={t('reviewAlerts.signOut')}
                  danger
                  buttonClassName="min-h-11 w-full"
                  testId="review-alerts-device-sign-out-card"
                  onConfirm={() => signOut(d.installId)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {devices && devices.length > 0 && (
        <div className="mt-3 hidden overflow-x-auto sm:block">
          <table className="min-w-full text-sm" data-testid="review-alerts-device-list">
            <thead>
              <tr className="text-fg-muted">
                <th scope="col" className="text-start p-2">{t('reviewAlerts.deviceApp')}</th>
                <th scope="col" className="text-start p-2">{t('reviewAlerts.devicePlatform')}</th>
                <th scope="col" className="text-start p-2">{t('reviewAlerts.deviceToken')}</th>
                <th scope="col" className="text-start p-2">{t('reviewAlerts.deviceUpdated')}</th>
                <th scope="col" className="text-start p-2">{t('reviewAlerts.deviceActions')}</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.installId} className="border-t border-border" data-install-id={d.installId}>
                  <td className="p-2">{t(APP_LABEL[d.app] ?? 'reviewAlerts.appViewer')}</td>
                  <td className="p-2" dir="ltr">{d.platform}{d.appVersion ? ` · ${d.appVersion}` : ''}</td>
                  <td className="p-2 font-mono" dir="ltr">{d.tokenHint}</td>
                  <td className="p-2">{formatDate(new Date(d.updatedAt), locale, true)}</td>
                  <td className="p-2">
                    <ConfirmButton
                      label={t('reviewAlerts.signOut')}
                      busy={busy === d.installId}
                      title={t('reviewAlerts.signOutTitle')}
                      body={t('reviewAlerts.signOutBody')}
                      confirmLabel={t('reviewAlerts.signOut')}
                      danger
                      testId="review-alerts-device-sign-out"
                      onConfirm={() => signOut(d.installId)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
