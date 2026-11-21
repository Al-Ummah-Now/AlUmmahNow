'use client';

/**
 * The Discovery page: what each ranked list shows now (and, with no viewer signal yet, what it
 * shows instead), Rank now, the home page's rail order (move up/down, Alt+↑/↓, show/hide), pins and
 * exclusions with an Undo toast for removals (owner decision: undo, not confirm, for reversible
 * changes), a preview of any list with why each video is there, and the latest changes. Read-only
 * without discovery:manage. Videos and channels are chosen with the live search picker (#1609).
 */
import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  DISCOVERY_MAX_PIN_POSITION,
  DISCOVERY_NOTE_MAX,
  DISCOVERY_PIN_RAILS,
  type DiscoveryAdminState,
  type DiscoveryExclusionView,
  type DiscoveryHomeRailView,
  type DiscoveryPinKind,
  type DiscoveryPinView,
  type DiscoveryPreviewItem,
} from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, formatNumber, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { Autocomplete } from '@/components/search/Autocomplete';
import { DateTimeField } from '@/components/DateField';
import { Select } from '@/components/select/Select';
import { NumberField } from '@/components/forms/NumberField';
import { UserName } from '@/components/audit/UserName';
import { reportError } from '@/lib/errors/reporter';
import {
  addDiscoveryExclusion,
  addDiscoveryPin,
  previewDiscoveryRail,
  removeDiscoveryExclusion,
  removeDiscoveryPin,
  runDiscoveryRanking,
  saveDiscoveryHomeRails,
  updateDiscoveryPin,
  type DiscoveryHistoryEntry,
  type DiscoveryResult,
} from '@/lib/api/discovery';

const smallButton =
  'inline-flex items-center justify-center min-h-11 min-w-11 px-3 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 disabled:cursor-not-allowed';
const chip = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium';
const PREVIEW_RAILS = ['trending:week', 'trending:day', 'trending:month', 'popular', 'new', 'featured', 'top'] as const;
const MAIN_RAILS = ['trending:week', 'popular', 'new', 'featured', 'top'];
const KNOWN_ERRORS = ['forbidden', 'invalid_target', 'target_not_found', 'already_pinned', 'already_excluded', 'invalid_position', 'invalid_window', 'invalid_note', 'none_enabled'];

type Fail = Extract<DiscoveryResult<unknown>, { ok: false }>;

const clampPosition = (value: string) => Math.max(1, Math.min(DISCOVERY_MAX_PIN_POSITION, Math.trunc(Number(value)) || 1));

/** Local "YYYY-MM-DDTHH:mm" (DateTimeField) ↔ ISO instant. */
const toInstant = (local: string) => (local ? new Date(local).toISOString() : null);
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function useFailMessage() {
  const { t } = useLanguage();
  return (r: Fail) => t((r.code && KNOWN_ERRORS.includes(r.code) ? `discovery.errors.${r.code}` : 'discovery.errors.failed') as MessageKey);
}

function useItemName() {
  const { t, locale } = useLanguage();
  return (item: { title: string | null; titleLocalized?: { en?: string; ar?: string } | null }) =>
    item.titleLocalized?.[locale]?.trim() || item.title?.trim() || t('discovery.pins.missing');
}

function useRailName() {
  const { t } = useLanguage();
  return (rail: string, categories: DiscoveryAdminState['categories'], locale: 'en' | 'ar') => {
    if (rail.startsWith('category:')) {
      const value = rail.slice('category:'.length);
      const c = categories.find((x) => x.value === value);
      return t('discovery.pins.whereCategory', { name: c ? c.label[locale] : value });
    }
    if (rail === 'explore') return t('discovery.rails.top');
    if (rail === 'trending') return t('discovery.home.names.trending');
    return t(`discovery.rails.${rail}` as MessageKey);
  };
}

export function DiscoveryAdmin({ initial, history }: { initial: DiscoveryAdminState; history: DiscoveryHistoryEntry[] }) {
  const { t } = useLanguage();
  const [pins, setPins] = useState(initial.pins);
  const [exclusions, setExclusions] = useState(initial.exclusions);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canManage = initial.canManage;

  return (
    <div className="space-y-6">
      <p className="sr-only" role="status" aria-live="polite" data-testid="discovery-announce">{notice}</p>
      {error && <ErrorAlert testId="discovery-error">{error}</ErrorAlert>}
      {!canManage && <p className="text-fg-muted" data-testid="discovery-read-only">{t('discovery.readOnly')}</p>}
      <RankingStatus status={initial.status} canManage={canManage} onError={setError} onNotice={setNotice} />
      <HomeRails initial={initial.homeRails} canManage={canManage} onError={setError} onNotice={setNotice} />
      <Pins pins={pins} setPins={setPins} categories={initial.categories} canManage={canManage} onError={setError} onNotice={setNotice} />
      <Exclusions exclusions={exclusions} setExclusions={setExclusions} canManage={canManage} onError={setError} onNotice={setNotice} />
      <Preview categories={initial.categories} />
      <History entries={history} categories={initial.categories} />
    </div>
  );
}

interface SectionProps {
  canManage: boolean;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

function RankingStatus({ status, canManage, onError, onNotice }: SectionProps & { status: DiscoveryAdminState['status'] }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const fail = useFailMessage();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const lastRun = status?.lastRun ?? null;
  const running = status?.jobs.some((j) => j.status === 'queued' || j.status === 'running') ?? false;
  const lastJob = status?.jobs[0];
  const rails = (status?.rails ?? []).filter((r) => r.scope === '' && MAIN_RAILS.includes(r.rail)).sort((a, b) => MAIN_RAILS.indexOf(a.rail) - MAIN_RAILS.indexOf(b.rail));
  const n = (v: number) => formatNumber(v, locale);

  async function run() {
    setBusy(true);
    onError('');
    try {
      const r = await runDiscoveryRanking();
      if (!r.ok) {
        onError(fail(r));
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'discovery-run' } });
        return;
      }
      const text = t(r.data.existing ? 'discovery.status.alreadyRunning' : 'discovery.status.queued');
      setMessage(text);
      onNotice(text);
      router.refresh();
    } catch (e) {
      reportError(e, { shown: true, extra: { action: 'discovery-run' } });
      onError(t('discovery.errors.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass} aria-labelledby="discovery-status-title" data-testid="discovery-status">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="discovery-status-title" className="text-xl font-semibold text-fg">{t('discovery.status.title')}</h2>
          {lastRun ? (
            <>
              <p className="text-fg mt-1" data-testid="discovery-last-run">
                {t('discovery.status.lastRun', { time: formatDate(lastRun.at, locale, true) })}
              </p>
              <p className="text-sm text-fg-muted mt-1">
                {t('discovery.status.counts', { eligible: n(lastRun.eligible), videos: n(lastRun.videos), excluded: n(lastRun.excluded), engaged: n(lastRun.engaged) })}
              </p>
            </>
          ) : (
            <p className="text-fg-muted mt-1" data-testid="discovery-never-ran">{t('discovery.status.never')}</p>
          )}
          {lastJob?.status === 'failed' && lastJob.lastError && (
            <p className="text-sm text-danger-fg mt-1" data-testid="discovery-run-failed">{t('discovery.status.runFailed', { error: lastJob.lastError })}</p>
          )}
          {message && <p className="text-sm text-success-fg mt-1" data-testid="discovery-run-message">{message}</p>}
        </div>
        {canManage && (
          <button type="button" className={primaryButtonClass} onClick={run} disabled={busy || running} data-testid="discovery-run-now">
            {running ? t('discovery.status.running') : t('discovery.status.runNow')}
          </button>
        )}
      </div>

      {rails.length > 0 && (
        <>
          <h3 className="text-base font-semibold text-fg mt-6">{t('discovery.status.railsTitle')}</h3>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="discovery-rails">
            {rails.map((r) => {
              const own = r.rail.startsWith('trending') ? r.label.startsWith('trending') : r.rail === 'popular' ? r.label === 'popular' : true;
              return (
                <li key={r.rail} className="rounded-lg border border-border bg-surface-2 p-4" data-testid="discovery-rail" data-rail={r.rail} data-label={r.label}>
                  <p className="font-medium text-fg">{t(`discovery.rails.${r.rail}` as MessageKey)}</p>
                  {own ? (
                    <p className="text-sm text-fg-muted mt-1">
                      {r.signalItems > 0 ? t('discovery.status.withSignal', { count: n(r.signalItems) }) : t('discovery.status.items', { count: n(r.items) })}
                    </p>
                  ) : (
                    <p className="text-sm mt-1">
                      <span className={`${chip} bg-chip-pending-bg text-chip-pending-fg`}>{t(`discovery.labels.${r.label}` as MessageKey)}</span>
                      <span className="block text-fg-muted mt-1">{t('discovery.status.noSignal', { label: t(`discovery.labels.${r.label}` as MessageKey) })}</span>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

function HomeRails({ initial, canManage, onError, onNotice }: SectionProps & { initial: DiscoveryHomeRailView[] }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const fail = useFailMessage();
  const [rails, setRails] = useState(initial);
  const [busy, setBusy] = useState(false);
  const name = (rail: DiscoveryHomeRailView['rail']) => t(`discovery.home.names.${rail}` as MessageKey);

  async function save(next: DiscoveryHomeRailView[], announce: string) {
    if (!next.some((r) => r.enabled)) {
      onError(t('discovery.home.keepOne'));
      return false;
    }
    const previous = rails;
    setRails(next);
    setBusy(true);
    onError('');
    try {
      const r = await saveDiscoveryHomeRails(next);
      if (!r.ok) {
        setRails(previous);
        onError(fail(r));
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'discovery-home' } });
        return false;
      }
      onNotice(announce);
      router.refresh();
      return true;
    } catch (e) {
      setRails(previous);
      reportError(e, { shown: true, extra: { action: 'discovery-home' } });
      onError(t('discovery.errors.failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function move(index: number, delta: -1 | 1) {
    const to = index + delta;
    if (to < 0 || to >= rails.length) return;
    const next = [...rails];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item!);
    const ok = await save(next, t('discovery.home.moved', { name: name(item!.rail), position: formatNumber(to + 1, locale), total: formatNumber(next.length, locale) }));
    if (ok) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="home-rail-move-${delta < 0 ? 'up' : 'down'}-${item!.rail}"]`)?.focus());
  }

  return (
    <section className={cardClass} aria-labelledby="discovery-home-title">
      <h2 id="discovery-home-title" className="text-xl font-semibold text-fg">{t('discovery.home.title')}</h2>
      <p className="text-sm text-fg-muted mt-1">{t('discovery.home.hint')}</p>
      <ol className="mt-4 space-y-2" data-testid="home-rails">
        {rails.map((r, i) => (
          <li
            key={r.rail}
            className={`flex flex-wrap items-center gap-3 rounded border border-border p-3 ${r.enabled ? '' : 'bg-surface-2'}`}
            data-testid="home-rail"
            data-rail={r.rail}
            data-enabled={r.enabled ? 'true' : 'false'}
            onKeyDown={(e) => {
              if (!canManage || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              e.preventDefault();
              void move(i, e.key === 'ArrowUp' ? -1 : 1);
            }}
          >
            <span className="text-fg-muted text-sm tabular-nums w-8 text-center" aria-hidden="true">{formatNumber(i + 1, locale)}</span>
            <span className="flex-1 min-w-32 font-medium text-fg">{name(r.rail)}</span>
            <span className={`${chip} ${r.enabled ? 'bg-chip-resolved-bg text-chip-resolved-fg' : 'bg-chip-dismissed-bg text-chip-dismissed-fg'}`}>{t(r.enabled ? 'discovery.home.on' : 'discovery.home.off')}</span>
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <button type="button" className={smallButton} disabled={i === 0 || busy} onClick={() => move(i, -1)} aria-label={t('discovery.home.moveUp', { name: name(r.rail) })} data-testid={`home-rail-move-up-${r.rail}`}>
                  <span aria-hidden="true">↑</span>
                </button>
                <button type="button" className={smallButton} disabled={i === rails.length - 1 || busy} onClick={() => move(i, 1)} aria-label={t('discovery.home.moveDown', { name: name(r.rail) })} data-testid={`home-rail-move-down-${r.rail}`}>
                  <span aria-hidden="true">↓</span>
                </button>
                <button
                  type="button"
                  className={smallButton}
                  disabled={busy}
                  aria-pressed={r.enabled}
                  onClick={() => save(rails.map((x) => (x.rail === r.rail ? { ...x, enabled: !x.enabled } : x)), t('discovery.home.saved'))}
                  data-testid={`home-rail-toggle-${r.rail}`}
                >
                  {t(r.enabled ? 'discovery.home.hide' : 'discovery.home.show', { name: name(r.rail) })}
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function KindChoice({ value, onChange, name }: { value: DiscoveryPinKind; onChange: (kind: DiscoveryPinKind) => void; name: string }) {
  const { t } = useLanguage();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm text-fg mb-1">{t('discovery.pins.kind')}</legend>
      <div className="flex gap-2">
        {(['video', 'channel'] as const).map((k) => (
          <label key={k} className={`${smallButton} cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent`}>
            <input type="radio" name={name} value={k} checked={value === k} onChange={() => onChange(k)} className="sr-only" />
            {t(`discovery.pins.${k}` as MessageKey)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Pins({
  pins,
  setPins,
  categories,
  canManage,
  onError,
  onNotice,
}: SectionProps & { pins: DiscoveryPinView[]; setPins: React.Dispatch<React.SetStateAction<DiscoveryPinView[]>>; categories: DiscoveryAdminState['categories'] }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const undoable = useUndoableAction();
  const fail = useFailMessage();
  const itemName = useItemName();
  const railName = useRailName();
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const groups = useMemo(() => {
    const order = [...DISCOVERY_PIN_RAILS, ...categories.map((c) => `category:${c.value}`)] as string[];
    const by = new Map<string, DiscoveryPinView[]>();
    for (const p of pins) by.set(p.rail, [...(by.get(p.rail) ?? []), p]);
    return [...by.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }, [pins, categories]);

  async function remove(pin: DiscoveryPinView) {
    setBusy(pin.id);
    onError('');
    try {
      const r = await undoable.run({
        action: () => removeDiscoveryPin(pin.id),
        undo: async () => {
          const back = await addDiscoveryPin({ rail: pin.rail, kind: pin.kind, target: pin.targetId, position: pin.position, startsAt: pin.startsAt, endsAt: pin.endsAt, note: pin.note });
          if (back.ok) {
            setPins((list) => [...list, back.data.pin]);
            router.refresh();
          }
          return back;
        },
        message: t('discovery.pins.removed', { name: itemName(pin) }),
      });
      if (!r.ok) {
        onError(fail(r));
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'discovery-unpin' } });
        return;
      }
      setPins((list) => list.filter((p) => p.id !== pin.id));
      router.refresh();
    } catch (e) {
      reportError(e, { shown: true, extra: { action: 'discovery-unpin' } });
      onError(t('discovery.errors.failed'));
    } finally {
      setBusy(null);
    }
  }

  const windowText = (p: DiscoveryPinView) => {
    const f = (iso: string) => formatDate(iso, locale, true);
    if (p.startsAt && p.endsAt) return t('discovery.pins.window', { start: f(p.startsAt), end: f(p.endsAt) });
    if (p.startsAt) return t('discovery.pins.from', { start: f(p.startsAt) });
    if (p.endsAt) return t('discovery.pins.until', { end: f(p.endsAt) });
    return null;
  };
  const stateClass: Record<DiscoveryPinView['state'], string> = {
    active: 'bg-chip-resolved-bg text-chip-resolved-fg',
    scheduled: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
    ended: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
  };

  return (
    <section className={cardClass} aria-labelledby="discovery-pins-title">
      <h2 id="discovery-pins-title" className="text-xl font-semibold text-fg">{t('discovery.pins.title')}</h2>
      <p className="text-sm text-fg-muted mt-1">{t('discovery.pins.hint')}</p>
      {canManage && <AddPin categories={categories} onAdded={(pin) => { setPins((list) => [...list, pin]); onNotice(t('discovery.pins.added')); }} onError={onError} />}
      {pins.length === 0 ? (
        <p className="text-fg-muted mt-4" data-testid="pins-empty">{t('discovery.pins.empty')}</p>
      ) : (
        <div className="mt-4 space-y-5" data-testid="pins">
          {groups.map(([rail, list]) => (
            <div key={rail}>
              <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">{railName(rail, categories, locale)}</h3>
              <ul className="mt-2 space-y-2">
                {list
                  .sort((a, b) => a.position - b.position)
                  .map((p) => (
                    <li key={p.id} className="rounded border border-border p-3" data-testid="pin-row" data-pin={p.id} data-state={p.state}>
                      {editing === p.id ? (
                        <EditPin pin={p} onDone={(next) => { if (next) { setPins((all) => all.map((x) => (x.id === next.id ? next : x))); onNotice(t('discovery.pins.saved')); } setEditing(null); }} onError={onError} />
                      ) : (
                        <div className="flex flex-wrap items-center gap-3">
                          {p.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.thumbnailUrl} alt="" className={p.kind === 'channel' ? 'h-10 w-10 rounded-full object-cover' : 'h-10 w-16 rounded object-cover'} />
                          ) : (
                            <span className={p.kind === 'channel' ? 'h-10 w-10 rounded-full bg-surface-2' : 'h-10 w-16 rounded bg-surface-2'} aria-hidden="true" />
                          )}
                          <div className="flex-1 min-w-48">
                            <p className="font-medium text-fg">{itemName(p)}</p>
                            <p className="text-xs text-fg-muted mt-0.5 flex flex-wrap gap-x-2 gap-y-1 items-center">
                              <span>{t(`discovery.pins.${p.kind}` as MessageKey)}</span>
                              <span aria-hidden="true">·</span>
                              <span>{t('discovery.pins.at', { position: formatNumber(p.position, locale) })}</span>
                              <span className={`${chip} ${stateClass[p.state]}`}>{t(`discovery.pins.states.${p.state}` as MessageKey)}</span>
                              {windowText(p) && <span>{windowText(p)}</span>}
                            </p>
                            {p.note && <p className="text-sm text-fg mt-1">{p.note}</p>}
                          </div>
                          {canManage && (
                            <div className="flex flex-wrap gap-2">
                              <button type="button" className={smallButton} disabled={!!busy} onClick={() => setEditing(p.id)} aria-label={t('discovery.pins.editNamed', { name: itemName(p) })} data-testid={`pin-edit-${p.id}`}>
                                {t('discovery.pins.edit')}
                              </button>
                              <button type="button" className={smallButton} disabled={!!busy} onClick={() => remove(p)} aria-label={t('discovery.pins.removeNamed', { name: itemName(p) })} data-testid={`pin-remove-${p.id}`}>
                                {t('discovery.pins.remove')}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AddPin({ categories, onAdded, onError }: { categories: DiscoveryAdminState['categories']; onAdded: (pin: DiscoveryPinView) => void; onError: (m: string) => void }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const id = useId();
  const fail = useFailMessage();
  const railName = useRailName();
  const [rail, setRail] = useState<string>('featured');
  const [kind, setKind] = useState<DiscoveryPinKind>('video');
  const [target, setTarget] = useState('');
  const [picker, setPicker] = useState(0);
  const [position, setPosition] = useState(1);
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [note, setNote] = useState('');
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const rails = [...DISCOVERY_PIN_RAILS, ...categories.map((c) => `category:${c.value}`)];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    if (!target) {
      setFieldError({ target: t('discovery.errors.invalid_target') });
      return;
    }
    setFieldError({});
    setBusy(true);
    try {
      const r = await addDiscoveryPin({ rail, kind, target, position, startsAt: toInstant(startsAt), endsAt: toInstant(endsAt), note: note.trim() || null });
      if (!r.ok) {
        const message = fail(r);
        const field = Object.keys(r.fields ?? {})[0];
        if (field) setFieldError({ [field]: message });
        else onError(message);
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'discovery-pin' } });
        return;
      }
      onAdded(r.data.pin);
      setTarget('');
      setPicker((n) => n + 1);
      setNote('');
      setStartsAt('');
      setEndsAt('');
      router.refresh();
    } catch (e2) {
      reportError(e2, { shown: true, extra: { action: 'discovery-pin' } });
      onError(t('discovery.errors.failed'));
    } finally {
      setBusy(false);
    }
  }

  const err = (name: string) => fieldError[name] && <span id={`${id}-${name}-error`} className="text-sm text-danger-fg" data-testid={`pin-add-${name}-error`}>{fieldError[name]}</span>;

  return (
    <form onSubmit={submit} noValidate className="mt-4 rounded-lg border border-border bg-surface-2 p-4 grid gap-4 md:grid-cols-2" data-testid="pin-add-form" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="md:col-span-2 text-base font-semibold text-fg">{t('discovery.pins.addTitle')}</h3>
      <div className="flex flex-col gap-1 text-sm text-fg">
        <label htmlFor={`${id}-rail`}>{t('discovery.pins.where')}</label>
        <Select id={`${id}-rail`} className={fieldClass} value={rail} onChange={(e) => setRail(e.target.value)} data-testid="pin-add-rail">
          {rails.map((r) => (
            <option key={r} value={r}>{railName(r, categories, locale)}</option>
          ))}
        </Select>
      </div>
      <KindChoice value={kind} onChange={(k) => { setKind(k); setTarget(''); setPicker((n) => n + 1); }} name={`${id}-kind`} />
      <div className="md:col-span-2 flex flex-col gap-1">
        <Autocomplete
          key={`${kind}-${picker}`}
          kind={kind}
          mode="pick"
          label={t(kind === 'video' ? 'discovery.pins.targetVideo' : 'discovery.pins.targetChannel')}
          hint={t('discovery.pins.targetHelp')}
          showIds={false}
          initialResults
          onChange={(value) => setTarget(value)}
          testId="pin-add-target"
        />
        {err('target')}
      </div>
      <label className="flex flex-col gap-1 text-sm text-fg">
        {t('discovery.pins.position')}
        <NumberField
          min={1}
          max={DISCOVERY_MAX_PIN_POSITION}
          className={fieldClass}
          value={position}
          onChange={(e) => setPosition(clampPosition(e.target.value))}
          aria-describedby={`${id}-position-help${fieldError.position ? ` ${id}-position-error` : ''}`}
          data-testid="pin-add-position"
        />
        <span id={`${id}-position-help`} className="text-xs text-fg-muted">{t('discovery.pins.positionHelp', { first: formatNumber(1, locale) })}</span>
        {err('position')}
      </label>
      <label className="flex flex-col gap-1 text-sm text-fg">
        {t('discovery.pins.note')}
        <input className={fieldClass} value={note} maxLength={DISCOVERY_NOTE_MAX} onChange={(e) => setNote(e.target.value)} data-testid="pin-add-note" />
        {err('note')}
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-start`} className="text-sm text-fg">{t('discovery.pins.startsAt')}</label>
        <DateTimeField id={`${id}-start`} value={startsAt} onChange={(v) => setStartsAt(v ?? '')} testId="pin-add-starts" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-end`} className="text-sm text-fg">{t('discovery.pins.endsAt')}</label>
        <DateTimeField id={`${id}-end`} value={endsAt} onChange={(v) => setEndsAt(v ?? '')} testId="pin-add-ends" />
        {err('endsAt')}
      </div>
      <div className="md:col-span-2">
        <button type="submit" className={primaryButtonClass} disabled={busy} data-testid="pin-add-submit">{t('discovery.pins.add')}</button>
      </div>
    </form>
  );
}

function EditPin({ pin, onDone, onError }: { pin: DiscoveryPinView; onDone: (next: DiscoveryPinView | null) => void; onError: (m: string) => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const id = useId();
  const fail = useFailMessage();
  const itemName = useItemName();
  const [position, setPosition] = useState(pin.position);
  const [startsAt, setStartsAt] = useState(toLocal(pin.startsAt));
  const [endsAt, setEndsAt] = useState(toLocal(pin.endsAt));
  const [note, setNote] = useState(pin.note ?? '');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFieldError('');
    try {
      const r = await updateDiscoveryPin(pin.id, { position, startsAt: toInstant(startsAt), endsAt: toInstant(endsAt), note: note.trim() || null });
      if (!r.ok) {
        setFieldError(fail(r));
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'discovery-pin-edit' } });
        return;
      }
      router.refresh();
      onDone(r.data.pin);
    } catch (e2) {
      reportError(e2, { shown: true, extra: { action: 'discovery-pin-edit' } });
      onError(t('discovery.errors.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 md:grid-cols-2" data-testid="pin-edit-form" aria-label={t('discovery.pins.editNamed', { name: itemName(pin) })}>
      <p className="md:col-span-2 font-medium text-fg">{itemName(pin)}</p>
      <label className="flex flex-col gap-1 text-sm text-fg">
        {t('discovery.pins.position')}
        <NumberField min={1} max={DISCOVERY_MAX_PIN_POSITION} className={fieldClass} value={position} onChange={(e) => setPosition(clampPosition(e.target.value))} data-testid="pin-edit-position" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-fg">
        {t('discovery.pins.note')}
        <input className={fieldClass} value={note} maxLength={DISCOVERY_NOTE_MAX} onChange={(e) => setNote(e.target.value)} data-testid="pin-edit-note" />
      </label>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-start`} className="text-sm text-fg">{t('discovery.pins.startsAt')}</label>
        <DateTimeField id={`${id}-start`} value={startsAt} onChange={(v) => setStartsAt(v ?? '')} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-end`} className="text-sm text-fg">{t('discovery.pins.endsAt')}</label>
        <DateTimeField id={`${id}-end`} value={endsAt} onChange={(v) => setEndsAt(v ?? '')} />
      </div>
      {fieldError && <p className="md:col-span-2 text-sm text-danger-fg" data-testid="pin-edit-error">{fieldError}</p>}
      <div className="md:col-span-2 flex gap-2">
        <button type="submit" className={primaryButtonClass} disabled={busy} data-testid="pin-edit-save">{t('discovery.pins.save')}</button>
        <button type="button" className={secondaryButtonClass} onClick={() => onDone(null)} disabled={busy}>{t('discovery.pins.cancel')}</button>
      </div>
    </form>
  );
}

function Exclusions({
  exclusions,
  setExclusions,
  canManage,
  onError,
  onNotice,
}: SectionProps & { exclusions: DiscoveryExclusionView[]; setExclusions: React.Dispatch<React.SetStateAction<DiscoveryExclusionView[]>> }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const undoable = useUndoableAction();
  const fail = useFailMessage();
  const itemName = useItemName();
  const id = useId();
  const [kind, setKind] = useState<DiscoveryPinKind>('channel');
  const [target, setTarget] = useState('');
  const [picker, setPicker] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState('');

  async function add(e: React.FormEvent) {
    e.preventDefault();
    onError('');
    if (!target) {
      setFieldError(t('discovery.errors.invalid_target'));
      return;
    }
    setFieldError('');
    setBusy('add');
    try {
      const r = await addDiscoveryExclusion({ kind, target, reason: reason.trim() || null });
      if (!r.ok) {
        setFieldError(fail(r));
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'discovery-exclude' } });
        return;
      }
      setExclusions((list) => [r.data.exclusion, ...list]);
      onNotice(t('discovery.exclusions.added'));
      setTarget('');
      setReason('');
      setPicker((n) => n + 1);
      router.refresh();
    } catch (e2) {
      reportError(e2, { shown: true, extra: { action: 'discovery-exclude' } });
      onError(t('discovery.errors.failed'));
    } finally {
      setBusy(null);
    }
  }

  async function allow(x: DiscoveryExclusionView) {
    setBusy(`${x.kind}:${x.targetId}`);
    onError('');
    try {
      const r = await undoable.run({
        action: () => removeDiscoveryExclusion(x.kind, x.targetId),
        undo: async () => {
          const back = await addDiscoveryExclusion({ kind: x.kind, target: x.targetId, reason: x.reason });
          if (back.ok) {
            setExclusions((list) => [back.data.exclusion, ...list]);
            router.refresh();
          }
          return back;
        },
        message: t('discovery.exclusions.removed', { name: itemName(x) }),
      });
      if (!r.ok) {
        onError(fail(r));
        return;
      }
      setExclusions((list) => list.filter((e) => !(e.kind === x.kind && e.targetId === x.targetId)));
      router.refresh();
    } catch (e) {
      reportError(e, { shown: true, extra: { action: 'discovery-include' } });
      onError(t('discovery.errors.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={cardClass} aria-labelledby="discovery-exclusions-title">
      <h2 id="discovery-exclusions-title" className="text-xl font-semibold text-fg">{t('discovery.exclusions.title')}</h2>
      <p className="text-sm text-fg-muted mt-1">{t('discovery.exclusions.hint')}</p>
      {canManage && (
        <form onSubmit={add} noValidate className="mt-4 rounded-lg border border-border bg-surface-2 p-4 grid gap-4 md:grid-cols-2" data-testid="exclusion-add-form" aria-labelledby={`${id}-title`}>
          <h3 id={`${id}-title`} className="md:col-span-2 text-base font-semibold text-fg">{t('discovery.exclusions.addTitle')}</h3>
          <KindChoice value={kind} onChange={(k) => { setKind(k); setTarget(''); setPicker((n) => n + 1); }} name={`${id}-kind`} />
          <label className="flex flex-col gap-1 text-sm text-fg">
            {t('discovery.exclusions.reason')}
            <input className={fieldClass} value={reason} maxLength={DISCOVERY_NOTE_MAX} onChange={(e) => setReason(e.target.value)} data-testid="exclusion-add-reason" />
          </label>
          <div className="md:col-span-2 flex flex-col gap-1">
            <Autocomplete
              key={`${kind}-${picker}`}
              kind={kind}
              mode="pick"
              label={t(kind === 'video' ? 'discovery.pins.targetVideo' : 'discovery.pins.targetChannel')}
              hint={t('discovery.pins.targetHelp')}
              showIds={false}
              initialResults
              onChange={(value) => setTarget(value)}
              testId="exclusion-add-target"
            />
            {fieldError && <span className="text-sm text-danger-fg" data-testid="exclusion-add-error">{fieldError}</span>}
          </div>
          <div className="md:col-span-2">
            <button type="submit" className={primaryButtonClass} disabled={!!busy} data-testid="exclusion-add-submit">{t('discovery.exclusions.add')}</button>
          </div>
        </form>
      )}
      {exclusions.length === 0 ? (
        <p className="text-fg-muted mt-4" data-testid="exclusions-empty">{t('discovery.exclusions.empty')}</p>
      ) : (
        <ul className="mt-4 space-y-2" data-testid="exclusions">
          {exclusions.map((x) => (
            <li key={`${x.kind}:${x.targetId}`} className="flex flex-wrap items-center gap-3 rounded border border-border p-3" data-testid="exclusion-row" data-kind={x.kind}>
              <div className="flex-1 min-w-48">
                <p className="font-medium text-fg">{itemName(x)}</p>
                <p className="text-xs text-fg-muted mt-0.5">
                  {t(`discovery.pins.${x.kind}` as MessageKey)} · <time dateTime={x.createdAt}>{formatDate(x.createdAt, locale)}</time>
                  {x.reason && <> · {x.reason}</>}
                </p>
              </div>
              {canManage && (
                <button type="button" className={smallButton} disabled={!!busy} onClick={() => allow(x)} aria-label={t('discovery.exclusions.removeNamed', { name: itemName(x) })} data-testid={`exclusion-remove-${x.kind}`}>
                  {t('discovery.exclusions.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Preview({ categories }: { categories: DiscoveryAdminState['categories'] }) {
  const { t, locale } = useLanguage();
  const id = useId();
  const [rail, setRail] = useState<string>('trending:week');
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ label: string | null; count: number; items: DiscoveryPreviewItem[] } | null>(null);
  const scopes = [
    { value: '', label: t('discovery.preview.scopeAll') },
    { value: 'lang:ar', label: t('discovery.preview.scopeAr') },
    { value: 'lang:en', label: t('discovery.preview.scopeEn') },
    ...categories.map((c) => ({ value: `cat:${c.value}`, label: t('discovery.preview.scopeCategory', { name: c.label[locale] }) })),
  ];
  const localized = (value: string | undefined, map: Record<string, string> | undefined) => map?.[locale]?.trim() || value || '';

  async function show(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await previewDiscoveryRail(rail, scope);
      if (!r.ok) {
        setError(t('discovery.errors.failed'));
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'discovery-preview' } });
        return;
      }
      setResult({ label: r.data.meta?.label ?? null, count: r.data.meta?.items ?? 0, items: r.data.items });
    } catch (e2) {
      reportError(e2, { shown: true, extra: { action: 'discovery-preview' } });
      setError(t('discovery.errors.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-xl font-semibold text-fg">{t('discovery.preview.title')}</h2>
      <p className="text-sm text-fg-muted mt-1">{t('discovery.preview.hint')}</p>
      <form onSubmit={show} className="mt-4 flex flex-wrap items-end gap-3" data-testid="preview-form">
        <div className="flex flex-col gap-1 text-sm text-fg">
          <label htmlFor={`${id}-rail`}>{t('discovery.preview.list')}</label>
          <Select id={`${id}-rail`} className={fieldClass} value={rail} onChange={(e) => setRail(e.target.value)} data-testid="preview-rail">
            {PREVIEW_RAILS.map((r) => (
              <option key={r} value={r}>{t(`discovery.rails.${r}` as MessageKey)}</option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1 text-sm text-fg">
          <label htmlFor={`${id}-scope`}>{t('discovery.preview.scope')}</label>
          <Select id={`${id}-scope`} className={fieldClass} value={scope} onChange={(e) => setScope(e.target.value)} data-testid="preview-scope">
            {scopes.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
        <button type="submit" className={secondaryButtonClass} disabled={busy} data-testid="preview-show">{t('discovery.preview.show')}</button>
      </form>
      {error && <p className="text-sm text-danger-fg mt-3">{error}</p>}
      {result && (
        result.items.length === 0 ? (
          <p className="text-fg-muted mt-4" data-testid="preview-empty">{t('discovery.preview.empty')}</p>
        ) : (
          <>
            {result.label && (
              <p className="text-sm text-fg mt-4" data-testid="preview-label">
                {t('discovery.preview.shows', { label: t(`discovery.labels.${result.label}` as MessageKey), count: formatNumber(result.count, locale) })}
              </p>
            )}
            <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="preview-items">
              {result.items.map((item) => (
                <li key={`${item.position}-${item.id}`} className="rounded-lg border border-border overflow-hidden bg-surface-2" data-testid="preview-item" data-reason={item.reason}>
                  <div className="relative aspect-video bg-surface-hover">
                    {item.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
                    )}
                    <span className="absolute top-2 start-2 rounded bg-black/70 px-2 py-0.5 text-xs font-semibold text-white tabular-nums">{formatNumber(item.position, locale)}</span>
                  </div>
                  <div className="p-3">
                    <p className="font-medium text-fg line-clamp-2">{localized(item.title, item.titleLocalized)}</p>
                    <p className="text-xs text-fg-muted mt-1">{localized(item.channelName, item.channelNameLocalized)}</p>
                    <span className={`${chip} mt-2 ${item.reason === 'pinned' ? 'bg-accent text-on-accent' : 'bg-surface-hover text-fg-muted'}`}>
                      {t(`discovery.preview.reasons.${item.reason}` as MessageKey)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )
      )}
    </section>
  );
}

function History({ entries, categories }: { entries: DiscoveryHistoryEntry[]; categories: DiscoveryAdminState['categories'] }) {
  const { t, locale } = useLanguage();
  const railName = useRailName();
  return (
    <section className={cardClass} aria-labelledby="discovery-history-title">
      <h2 id="discovery-history-title" className="text-xl font-semibold text-fg">{t('discovery.history.title')}</h2>
      {entries.length === 0 ? (
        <p className="text-fg-muted mt-2" data-testid="discovery-history-empty">{t('discovery.history.empty')}</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm" data-testid="discovery-history">
          {entries.map((e) => {
            const rail = typeof e.details?.rail === 'string' ? e.details.rail : typeof e.previous?.rail === 'string' ? (e.previous.rail as string) : null;
            return (
              <li key={e.id} className="flex flex-wrap gap-x-2 text-fg" data-testid="discovery-history-row" data-action={e.action}>
                <span className="font-medium">{t(`discovery.history.actions.${e.action}` as MessageKey)}</span>
                {e.kind !== 'home' && <span>{e.title ?? t('discovery.pins.missing')}</span>}
                {rail && <span className="text-fg-muted">· {railName(rail, categories, locale)}</span>}
                <span className="text-fg-muted">· {e.actorName || <UserName id={e.actorId} showEmail={false} />} · <time dateTime={e.createdAt}>{formatDate(e.createdAt, locale, true)}</time></span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
