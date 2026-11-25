'use client';

/**
 * The Categories editor: the list in display order (move up/down, Alt+↑/↓ on a
 * row), add, rename (en + ar) and the AI hint inline, retire/restore with an
 * Undo toast (owner decision: undo, not confirm, for reversible changes), and
 * the latest changes. Read-only without videos:categories.
 */
import { useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { slugFromLabel } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { createVideoCategory, reorderVideoCategories, updateVideoCategory } from '@/lib/api/categories';
import type { VideoCategoryAdminList, VideoCategoryAdminView, VideoCategoryHistoryEntry } from '@/lib/api/category-types';
import { reportError } from '@/lib/errors/reporter';
import { UserName } from '@/components/audit/UserName';
import { LocalizedFieldPair } from '@/components/localized/LocalizedFieldPair';

import { LocalTime } from '@/components/LocalTime';
import { Sep } from '@/components/Sep';
type Fields = Partial<Record<'value' | 'labelEn' | 'labelAr' | 'hint', string>>;
type Result = { ok: true } | { ok: false; status: number; error: string; code?: string; fields?: Record<string, string> };

const smallButton = 'inline-flex items-center justify-center min-h-11 min-w-11 px-3 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 disabled:cursor-not-allowed';

export function CategoriesAdmin({ initial, history }: { initial: VideoCategoryAdminList; history: VideoCategoryHistoryEntry[] }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const undoable = useUndoableAction();
  const [categories, setCategories] = useState(initial.categories);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [announce, setAnnounce] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const canManage = initial.canManage;
  const nameOf = (c: VideoCategoryAdminView) => (locale === 'ar' ? c.label.ar : c.label.en);

  const failMessage = (r: Extract<Result, { ok: false }>): string => {
    const known: Record<string, MessageKey> = {
      exists: 'videoCategories.errors.exists',
      last_active: 'videoCategories.errors.lastActive',
      too_many: 'videoCategories.errors.tooMany',
      relabel_not_queued: 'videoCategories.errors.tryAgain',
      forbidden: 'videoCategories.errors.forbidden',
    };
    return t(r.code && known[r.code] ? known[r.code]! : 'videoCategories.errors.failed');
  };

  async function guarded(key: string, fn: () => Promise<Result>, onOk?: () => void): Promise<boolean> {
    setBusy(key);
    setError('');
    try {
      const r = await fn();
      if (!r.ok) {
        setError(failMessage(r));
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: key } });
        return false;
      }
      onOk?.();
      router.refresh();
      return true;
    } catch (e) {
      reportError(e, { shown: true, extra: { action: key } });
      setError(t('videoCategories.errors.failed'));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function move(index: number, delta: -1 | 1) {
    const to = index + delta;
    if (to < 0 || to >= categories.length) return;
    const next = [...categories];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item!);
    const previous = categories;
    setCategories(next);
    const ok = await guarded(`move:${item!.value}`, () => reorderVideoCategories(next.map((c) => c.value)) as Promise<Result>);
    if (ok) {
      setAnnounce(t('videoCategories.moved', { name: nameOf(item!), position: formatNumber(to + 1, locale), total: formatNumber(next.length, locale) }));
      // Keep the focus on the moved row's same button
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-testid="category-move-${delta < 0 ? 'up' : 'down'}-${item!.value}"]`)?.focus());
    } else {
      setCategories(previous);
    }
  }

  async function setRetired(c: VideoCategoryAdminView, retired: boolean) {
    const apply = (value: boolean) => setCategories((list) => list.map((x) => (x.value === c.value ? { ...x, retired: value } : x)));
    await guarded(`retire:${c.value}`, async () => {
      const r = (await undoable.run({
        action: () => updateVideoCategory(c.value, { retired }),
        undo: async () => {
          const back = await updateVideoCategory(c.value, { retired: !retired });
          if (back.ok) {
            apply(!retired);
            router.refresh();
          }
          return back;
        },
        message: t(retired ? 'videoCategories.retiredToast' : 'videoCategories.restoredToast', { name: nameOf(c) }),
      })) as Result;
      if (r.ok) apply(retired);
      return r;
    });
  }

  return (
    <div className="space-y-6">
      <p className="sr-only" role="status" aria-live="polite" data-testid="categories-announce">{announce}</p>
      {error && <ErrorAlert testId="categories-error">{error}</ErrorAlert>}
      {!canManage && <p className="text-fg-muted" data-testid="categories-read-only">{t('videoCategories.readOnly')}</p>}

      {canManage && <AddCategory limits={initial.limits} existing={categories.map((c) => c.value)} onAdded={(c) => setCategories((list) => [...list, c])} />}

      <section className={cardClass} aria-labelledby="categories-list-title">
        <h2 id="categories-list-title" className="text-xl font-semibold text-fg">{t('videoCategories.listTitle')}</h2>
        <p className="text-sm text-fg-muted mt-1">{t('videoCategories.listHint')}</p>
        <ol className="mt-4 space-y-2" data-testid="categories-list">
          {categories.map((c, i) => (
            <li
              key={c.value}
              className={`border border-border rounded p-3 ${c.retired ? 'bg-surface-2' : ''}`}
              data-testid="category-row"
              data-value={c.value}
              data-retired={c.retired ? 'true' : 'false'}
              onKeyDown={(e) => {
                if (!canManage || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                const target = e.target as HTMLElement;
                if (target.closest('input, textarea, select')) return;
                e.preventDefault();
                void move(i, e.key === 'ArrowUp' ? -1 : 1);
              }}
            >
              {editing === c.value ? (
                <EditCategory category={c} limits={initial.limits} onDone={(next) => { if (next) setCategories((list) => list.map((x) => (x.value === next.value ? { ...x, ...next } : x))); setEditing(null); }} />
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-fg-muted text-sm tabular-nums w-8 text-center" aria-hidden="true">{formatNumber(i + 1, locale)}</span>
                  <div className="flex-1 min-w-48">
                    <p className="font-medium text-fg">
                      <span lang="en" dir="ltr">{c.label.en}</span>
                      <span className="text-fg-muted" aria-hidden="true"><Sep /></span>
                      <span lang="ar" dir="rtl">{c.label.ar}</span>
                    </p>
                    <p className="text-xs text-fg-muted mt-0.5">
                      <code dir="ltr" className="font-mono">{c.value}</code>
                      <Sep />
                      {t('videoCategories.videoCount', { count: formatNumber(c.videoCount, locale) })}
                      {c.retired && (
                        <>
                          <Sep />
                          <span className="font-medium text-warning-fg" data-testid="category-retired-chip">{t('videoCategories.retiredTag')}</span>
                        </>
                      )}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={smallButton} disabled={i === 0 || !!busy} onClick={() => move(i, -1)} aria-label={t('videoCategories.moveUp', { name: nameOf(c) })} data-testid={`category-move-up-${c.value}`}>
                        <span aria-hidden="true">↑</span>
                      </button>
                      <button type="button" className={smallButton} disabled={i === categories.length - 1 || !!busy} onClick={() => move(i, 1)} aria-label={t('videoCategories.moveDown', { name: nameOf(c) })} data-testid={`category-move-down-${c.value}`}>
                        <span aria-hidden="true">↓</span>
                      </button>
                      <button type="button" className={smallButton} disabled={!!busy} onClick={() => setEditing(c.value)} aria-label={t('videoCategories.editNamed', { name: nameOf(c) })} data-testid={`category-edit-${c.value}`}>
                        {t('videoCategories.edit')}
                      </button>
                      <button type="button" className={smallButton} disabled={!!busy} onClick={() => setRetired(c, !c.retired)} aria-label={t(c.retired ? 'videoCategories.restoreNamed' : 'videoCategories.retireNamed', { name: nameOf(c) })} data-testid={`category-${c.retired ? 'restore' : 'retire'}-${c.value}`}>
                        {t(c.retired ? 'videoCategories.restore' : 'videoCategories.retire')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      </section>

      <History entries={history} categories={categories} />
    </div>
  );
}

function AddCategory({ limits, existing, onAdded }: { limits: VideoCategoryAdminList['limits']; existing: string[]; onAdded: (c: VideoCategoryAdminView) => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const id = useId();
  const [labelEn, setLabelEn] = useState('');
  const [labelAr, setLabelAr] = useState('');
  const [value, setValue] = useState('');
  const [valueTouched, setValueTouched] = useState(false);
  const [hint, setHint] = useState('');
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const slug = valueTouched ? value : slugFromLabel(labelEn);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setDone('');
    const local: Fields = {};
    if (!labelEn.trim()) local.labelEn = 'required';
    if (!labelAr.trim()) local.labelAr = 'required';
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(slug)) local.value = 'invalid_slug';
    else if (existing.includes(slug)) local.value = 'exists';
    setFields(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    try {
      const r = await createVideoCategory({ value: slug, labelEn, labelAr, ...(hint.trim() ? { hint } : {}) });
      if (!r.ok) {
        setFields((r.fields ?? {}) as Fields);
        setError(r.code === 'exists' ? t('videoCategories.errors.exists') : r.code === 'too_many' ? t('videoCategories.errors.tooMany') : t('videoCategories.errors.failed'));
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'create' } });
        return;
      }
      onAdded(r.data.category);
      setDone(t('videoCategories.added', { name: r.data.category.label.en }));
      setLabelEn('');
      setLabelAr('');
      setValue('');
      setValueTouched(false);
      setHint('');
      router.refresh();
    } catch (e2) {
      reportError(e2, { shown: true, extra: { action: 'create' } });
      setError(t('videoCategories.errors.failed'));
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (name: keyof Fields) => fields[name] && (
    <span id={`${id}-${name}-error`} className="text-sm text-danger-fg" data-testid={`category-add-${name}-error`}>
      {t(`videoCategories.fieldErrors.${fields[name]}` as MessageKey)}
    </span>
  );
  const described = (name: keyof Fields, help?: string) => [fields[name] ? `${id}-${name}-error` : '', help ?? ''].filter(Boolean).join(' ') || undefined;

  return (
    <section className={cardClass} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-xl font-semibold text-fg">{t('videoCategories.addTitle')}</h2>
      <form onSubmit={submit} noValidate className="mt-4 grid gap-4 md:grid-cols-2" data-testid="category-add-form">
        <div className="md:col-span-2">
          <LocalizedFieldPair
            id={`${id}-label`}
            label={t('videoCategories.label')}
            field="categories.label"
            value={{ en: labelEn, ar: labelAr }}
            onChange={(v) => {
              setLabelEn(v.en);
              setLabelAr(v.ar);
            }}
            errors={{
              en: fields.labelEn ? t(`videoCategories.fieldErrors.${fields.labelEn}` as MessageKey) : undefined,
              ar: fields.labelAr ? t(`videoCategories.fieldErrors.${fields.labelAr}` as MessageKey) : undefined,
            }}
            maxLength={limits.label}
            required
            disabled={busy}
            testId="category-add-label"
            inputTestIds={{ en: 'category-add-label-en', ar: 'category-add-label-ar' }}
          />
        </div>
        <label className="flex flex-col gap-1 text-sm text-fg">
          {t('videoCategories.value')}
          <input
            dir="ltr"
            className={`${fieldClass} font-mono`}
            value={slug}
            maxLength={40}
            onChange={(e) => { setValueTouched(true); setValue(e.target.value.toLowerCase()); }}
            aria-invalid={!!fields.value}
            aria-describedby={described('value', `${id}-value-help`)}
            data-testid="category-add-value"
          />
          <span id={`${id}-value-help`} className="text-xs text-fg-muted">{t('videoCategories.valueHelp')}</span>
          {fieldError('value')}
        </label>
        <label className="flex flex-col gap-1 text-sm text-fg md:col-span-2">
          {t('videoCategories.hint')}
          <textarea className={fieldClass} rows={2} value={hint} maxLength={limits.hint} onChange={(e) => setHint(e.target.value)} aria-describedby={described('hint', `${id}-hint-help`)} data-testid="category-add-hint" />
          <span id={`${id}-hint-help`} className="text-xs text-fg-muted">{t('videoCategories.hintHelp')}</span>
          {fieldError('hint')}
        </label>
        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryButtonClass} disabled={busy} data-testid="category-add-submit">
            {busy ? t('videoCategories.saving') : t('videoCategories.add')}
          </button>
          <p role="status" aria-live="polite" className="text-sm text-success-fg" data-testid="category-add-done">{done}</p>
        </div>
        {error && <div className="md:col-span-2"><ErrorAlert testId="category-add-error">{error}</ErrorAlert></div>}
      </form>
    </section>
  );
}

function EditCategory({ category, limits, onDone }: { category: VideoCategoryAdminView; limits: VideoCategoryAdminList['limits']; onDone: (next: Partial<VideoCategoryAdminView> & { value: string } | null) => void }) {
  const { t } = useLanguage();
  const router = useRouter();
  const id = useId();
  const [labelEn, setLabelEn] = useState(category.label.en);
  const [labelAr, setLabelAr] = useState(category.label.ar);
  const [hint, setHint] = useState(category.hint);
  const [fields, setFields] = useState<Fields>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const local: Fields = {};
    if (!labelEn.trim()) local.labelEn = 'required';
    if (!labelAr.trim()) local.labelAr = 'required';
    setFields(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    setError('');
    try {
      const r = await updateVideoCategory(category.value, { labelEn, labelAr, hint });
      if (!r.ok) {
        setFields((r.fields ?? {}) as Fields);
        setError(r.code === 'relabel_not_queued' ? t('videoCategories.errors.tryAgain') : t('videoCategories.errors.failed'));
        if (r.status >= 500) reportError(new Error(r.error), { shown: true, status: r.status, extra: { action: 'update' } });
        return;
      }
      onDone({ value: category.value, label: r.data.category.label, hint: r.data.category.hint });
      router.refresh();
    } catch (e2) {
      reportError(e2, { shown: true, extra: { action: 'update' } });
      setError(t('videoCategories.errors.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} noValidate className="grid gap-3 md:grid-cols-2" data-testid={`category-edit-form-${category.value}`} aria-label={t('videoCategories.editNamed', { name: category.label.en })}>
      <div className="md:col-span-2">
        <LocalizedFieldPair
          id={`${id}-edit-label`}
          label={t('videoCategories.label')}
          field="categories.label"
          value={{ en: labelEn, ar: labelAr }}
          onChange={(v) => {
            setLabelEn(v.en);
            setLabelAr(v.ar);
          }}
          errors={{
            en: fields.labelEn ? t(`videoCategories.fieldErrors.${fields.labelEn}` as MessageKey) : undefined,
            ar: fields.labelAr ? t(`videoCategories.fieldErrors.${fields.labelAr}` as MessageKey) : undefined,
          }}
          maxLength={limits.label}
          required
          autoFocus
          disabled={busy}
          testId="category-edit-label"
          inputTestIds={{ en: 'category-edit-label-en', ar: 'category-edit-label-ar' }}
        />
      </div>
      <label className="flex flex-col gap-1 text-sm text-fg md:col-span-2">
        {t('videoCategories.hint')}
        <textarea className={fieldClass} rows={2} value={hint} maxLength={limits.hint} onChange={(e) => setHint(e.target.value)} data-testid="category-edit-hint" />
      </label>
      <p className="text-xs text-fg-muted md:col-span-2">
        {t('videoCategories.valueFixed')} <code dir="ltr" className="font-mono">{category.value}</code>
      </p>
      <div className="flex flex-wrap gap-3 md:col-span-2">
        <button type="submit" className={primaryButtonClass} disabled={busy} data-testid="category-edit-save">{busy ? t('videoCategories.saving') : t('videoCategories.save')}</button>
        <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => onDone(null)} data-testid="category-edit-cancel">{t('videoCategories.cancel')}</button>
      </div>
      {error && <div className="md:col-span-2"><ErrorAlert testId="category-edit-error">{error}</ErrorAlert></div>}
    </form>
  );
}

function History({ entries, categories }: { entries: VideoCategoryHistoryEntry[]; categories: VideoCategoryAdminView[] }) {
  const { t, locale } = useLanguage();
  const names = useMemo(() => new Map(categories.map((c) => [c.value, locale === 'ar' ? c.label.ar : c.label.en])), [categories, locale]);
  return (
    <section className={cardClass} aria-labelledby="categories-history-title">
      <h2 id="categories-history-title" className="text-xl font-semibold text-fg">{t('videoCategories.historyTitle')}</h2>
      {entries.length === 0 ? (
        <p className="text-fg-muted mt-2" data-testid="categories-history-empty">{t('videoCategories.historyEmpty')}</p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm" data-testid="categories-history">
          {entries.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2 text-fg" data-testid="categories-history-row" data-action={e.change.action}>
              <span className="font-medium">{t(`videoCategories.actions.${e.change.action}` as MessageKey)}</span>
              {e.value !== '*order' && <span>{names.get(e.value) ?? e.value}</span>}
              <span className="text-fg-muted"><Sep />{e.actorName || <UserName id={e.actorId} showEmail={false} />}<Sep /><LocalTime value={e.createdAt} withTime /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
