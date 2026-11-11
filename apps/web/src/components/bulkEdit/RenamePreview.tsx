/**
 * Live preview of a bulk rename, in the order the numbers follow.
 *
 * One row per video: drag handle, position, include checkbox, then current →
 * new title for each chosen language (each in its own direction), flags for
 * empty / too long / duplicate, and Move up / Move down. Alt+↑ / Alt+↓ on a
 * row moves it too; every move is announced ("Moved to position 3 of 12").
 * Above the list: quick sorts (ascending or descending; the direction
 * button re-sorts at once and, after a move by hand, replaces that order) and "Continue
 * numbering after", which finds the highest number the channel already used
 * for this pattern.
 */
'use client';

import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, ArrowLeft, ChevronUp, ChevronDown, GripVertical, ArrowDownNarrowWide, ArrowDownWideNarrow } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import {
  hasOrderValue,
  highestNumber,
  missingOrderValues,
  orderReducer,
  renameSummary,
  sortIds,
  VIDEO_TITLE_MAX,
  type OrderKey,
  type RenameRow,
  type RenameSubject,
  type TitleLanguage,
} from '@al-ummah/shared-types';
import { numberedPatterns, type RenameState } from '@/lib/bulk-edit/form';

const PAGE = 50;

interface RenamePreviewProps {
  /** Preview rows (from renamePreview: already in order) */
  rows: RenameRow[];
  /** Every subject (any order); the rename state holds the order */
  subjects: RenameSubject[];
  rename: RenameState;
  onRenameChange: (next: RenameState) => void;
  /** Quick sorts offered (e.g. no duration for files not uploaded yet) */
  orderKeys: OrderKey[];
  /** Titles already on the channel, for "Continue numbering after" (absent: no button) */
  loadExistingTitles?: () => Promise<string[]>;
  testId?: string;
}

const dirOf = (lang: TitleLanguage) => (lang === 'ar' ? 'rtl' : 'ltr');

export function RenamePreview({ rows, subjects, rename, onRenameChange, orderKeys, loadExistingTitles, testId = 'rename-preview' }: RenamePreviewProps) {
  const { t, lang, isRTL } = useLanguage();
  const r = t.bulkEdit.rename;
  const [showAll, setShowAll] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [found, setFound] = useState<{ state: 'idle' | 'loading' | 'done'; n: number | null }>({ state: 'idle', n: null });
  const summary = useMemo(() => renameSummary(rows), [rows]);
  const fmt = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar' : 'en-US');
  const Arrow = isRTL ? ArrowLeft : ArrowRight;
  const sortLanguage: TitleLanguage = rename.languages[0] ?? (lang === 'ar' ? 'ar' : 'en');

  // One row per subject, in order, with its rows per language
  const byId = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const ids = useMemo(() => {
    const out: string[] = [];
    for (const row of rows) if (!out.includes(row.id)) out.push(row.id);
    return out;
  }, [rows]);
  const rowsOf = useMemo(() => {
    const m = new Map<string, RenameRow[]>();
    for (const row of rows) m.set(row.id, [...(m.get(row.id) ?? []), row]);
    return m;
  }, [rows]);
  const shown = showAll ? ids : ids.slice(0, PAGE);

  const titleOf = (id: string) => {
    const s = byId.get(id);
    return (s?.title[sortLanguage] || s?.title.en || s?.title.ar || s?.filename || id) as string;
  };

  const setOrder = (next: string[], custom: boolean, extra: Partial<RenameState> = {}) =>
    onRenameChange({ ...rename, ...extra, order: next, orderCustom: custom });

  const move = (id: string, action: { to?: number; delta?: number }) => {
    const next = action.to !== undefined
      ? orderReducer(ids, { type: 'move', id, to: action.to })
      : orderReducer(ids, { type: 'moveBy', id, delta: action.delta ?? 0 });
    if (next === ids) return;
    setOrder(next, true);
    const position = next.indexOf(id) + 1;
    setAnnouncement(r.moved.replace('{position}', fmt(position)).replace('{total}', fmt(next.length)));
    logger.debug('[RenamePreview] Moved', { position, total: next.length });
  };

  // A quick sort or a new direction always sorts again by the field, dropping a move by hand
  const sortBy = (key: OrderKey, dir: 'asc' | 'desc') => {
    setOrder(sortIds(subjects, key, dir, sortLanguage), false, { orderKey: key, orderDir: dir });
    logger.debug('[RenamePreview] Sorted', { key, dir, replacedManual: rename.orderCustom, count: subjects.length });
  };
  const flipDirection = () => sortBy(rename.orderKey, rename.orderDir === 'asc' ? 'desc' : 'asc');
  const DirIcon = rename.orderDir === 'asc' ? ArrowDownNarrowWide : ArrowDownWideNarrow;
  const dirLabel = rename.orderDir === 'asc' ? r.ascending : r.descending;
  // Sorts nothing can be sorted by are offered disabled; the rest say how many sit at the end
  const usable = (key: OrderKey) => subjects.some((s) => hasOrderValue(s, key, sortLanguage));
  const missing = rename.orderCustom ? 0 : missingOrderValues(subjects, rename.orderKey, sortLanguage);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    move(String(active.id), { to: ids.indexOf(String(over.id)) });
  };

  const findHighest = async () => {
    if (!loadExistingTitles) return;
    setFound({ state: 'loading', n: null });
    try {
      const titles = await loadExistingTitles();
      // The highest number any ticked language's pattern already used
      const found = numberedPatterns(rename).map((p) => highestNumber(p, titles)).filter((n): n is number => n !== null);
      setFound({ state: 'done', n: found.length ? Math.max(...found) : null });
    } catch (error) {
      logger.warn('[RenamePreview] Could not read the channel titles', { error: error instanceof Error ? error.message : String(error) });
      setFound({ state: 'done', n: null });
    }
  };

  const problemText = (p: RenameRow['problems'][number]) =>
    p === 'empty' ? r.problemEmpty : p === 'too_long' ? r.problemTooLong.replace('{max}', fmt(VIDEO_TITLE_MAX)) : r.problemDuplicate;

  return (
    <section aria-labelledby={`${testId}-title`} data-testid={testId}>
      <h4 id={`${testId}-title`} className="text-sm font-semibold text-[var(--fanous-color-text-primary)]">{r.preview}</h4>

      {/* Order: quick sorts; the list below can also be moved by hand */}
      <div className="mt-2 flex flex-wrap items-end gap-2" data-testid={`${testId}-order`}>
        <label className="flex flex-col text-xs font-medium text-[var(--fanous-color-text-secondary)]">
          {r.orderBy}
          <select
            value={rename.orderCustom ? '' : rename.orderKey}
            onChange={(e) => sortBy(e.target.value as OrderKey, rename.orderDir)}
            className="mt-1 min-h-11 rounded-md border border-[var(--fanous-color-outline)] bg-[var(--fanous-color-surface)] px-2 text-sm text-[var(--fanous-color-text-primary)]"
            data-testid={`${testId}-order-key`}
          >
            {rename.orderCustom && <option value="">{r.customOrder}</option>}
            {orderKeys.map((key) => {
              const ok = usable(key) || key === rename.orderKey;
              return <option key={key} value={key} disabled={!ok}>{ok ? r.orderKeys[key] : r.orderKeyUnavailable.replace('{field}', r.orderKeys[key])}</option>;
            })}
          </select>
        </label>
        <button
          type="button"
          className="b b-secondary b-sm min-h-11"
          onClick={flipDirection}
          aria-label={dirLabel}
          aria-describedby={rename.orderCustom ? `${testId}-order-manual` : undefined}
          data-testid={`${testId}-order-dir`}
          data-dir={rename.orderDir}
        >
          <DirIcon aria-hidden="true" data-testid={`${testId}-order-dir-icon`} data-icon={rename.orderDir} />
          {dirLabel}
        </button>
        {loadExistingTitles && numberedPatterns(rename).length > 0 && (
          <button type="button" className="b b-ghost b-sm min-h-11" onClick={() => void findHighest()} disabled={found.state === 'loading'} data-testid={`${testId}-continue`}>
            {found.state === 'loading' ? r.continueLoading : r.continueFind}
          </button>
        )}
      </div>
      {found.state === 'done' && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="status" data-testid={`${testId}-continue-result`} data-found={found.n ?? ''}>
          {found.n === null ? r.continueNone : r.continueFound.replace('{n}', fmt(found.n))}
          {found.n !== null && (
            <button type="button" className="b b-secondary b-sm" onClick={() => onRenameChange({ ...rename, start: (found.n as number) + Math.max(1, rename.step) })} data-testid={`${testId}-continue-use`}>
              {r.continueUse.replace('{next}', fmt((found.n as number) + Math.max(1, rename.step)))}
            </button>
          )}
        </p>
      )}
      {rename.orderCustom && (
        <p className="mt-1 text-xs text-[var(--fanous-color-text-secondary)]" id={`${testId}-order-manual`} data-testid={`${testId}-order-manual`}>{r.orderReplacesManual}</p>
      )}
      {missing > 0 && (
        <p className="mt-1 text-xs text-[var(--fanous-color-text-secondary)]" data-testid={`${testId}-order-missing`} data-missing={missing}>
          {r.orderMissing.replace('{count}', fmt(missing)).replace('{field}', r.orderKeys[rename.orderKey])}
        </p>
      )}
      <p className="mt-1 text-xs text-[var(--fanous-color-text-secondary)]" id={`${testId}-hint`}>{r.orderHint}</p>

      <p className="mt-2 text-xs text-[var(--fanous-color-text-secondary)]" role="status" aria-live="polite" data-testid={`${testId}-summary`}
        data-applies={summary.applies} data-blocked={summary.blocked} data-duplicates={summary.duplicates} data-skipped={summary.skipped}>
        {r.summary
          .replace('{applies}', fmt(summary.applies))
          .replace('{skipped}', fmt(summary.skipped))
          .replace('{blocked}', fmt(summary.blocked))
          .replace('{duplicates}', fmt(summary.duplicates))
          .replace('{unchanged}', fmt(summary.unchanged))}
      </p>
      <p className="sr-only" role="status" aria-live="assertive" aria-atomic="true" data-testid={`${testId}-moved`}>{announcement}</p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ screenReaderInstructions: { draggable: r.orderHint } }}>
        <SortableContext items={shown} strategy={verticalListSortingStrategy}>
          <ol className="mt-2 max-h-96 space-y-1 overflow-auto rounded-md border border-[var(--fanous-color-divider)] p-1" aria-describedby={`${testId}-hint`} data-testid={`${testId}-list`}>
            {shown.map((id, index) => (
              <SortableRow
                key={id}
                id={id}
                index={index}
                total={ids.length}
                rows={rowsOf.get(id) ?? []}
                title={titleOf(id)}
                testId={testId}
                fmt={fmt}
                Arrow={Arrow}
                problemText={problemText}
                onToggle={(include) => onRenameChange({
                  ...rename,
                  excluded: include ? rename.excluded.filter((x) => x !== id) : Array.from(new Set([...rename.excluded, id])),
                })}
                onMove={(action) => move(id, action)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {!showAll && ids.length > PAGE && (
        <button type="button" className="b b-ghost b-sm mt-2" onClick={() => setShowAll(true)} data-testid={`${testId}-show-all`}>
          {r.showMore.replace('{count}', fmt(ids.length))}
        </button>
      )}
    </section>
  );
}

interface SortableRowProps {
  id: string;
  index: number;
  total: number;
  rows: RenameRow[];
  title: string;
  testId: string;
  fmt: (n: number) => string;
  Arrow: typeof ArrowRight;
  problemText: (p: RenameRow['problems'][number]) => string;
  onToggle: (include: boolean) => void;
  onMove: (action: { to?: number; delta?: number }) => void;
}

function SortableRow({ id, index, total, rows, title, testId, fmt, Arrow, problemText, onToggle, onMove }: SortableRowProps) {
  const { t } = useLanguage();
  const r = t.bulkEdit.rename;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const excluded = rows[0]?.excluded ?? false;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    onMove({ delta: e.key === 'ArrowUp' ? -1 : 1 });
    // Keep the focus on the moved row's handle
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="${testId}-handle"][data-id="${id.replace(/["\\]/g, '\\$&')}"]`)?.focus());
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onKeyDown={onKeyDown}
      className={`grid grid-cols-[auto_auto_auto_1fr_auto] items-start gap-2 rounded-md p-2 ${isDragging ? 'relative z-10 bg-[var(--fanous-color-surface-raised)] shadow-lg' : 'bg-[var(--fanous-color-surface)]'}`}
      data-testid={`${testId}-row`}
      data-id={id}
      data-position={index + 1}
      data-excluded={excluded ? 'true' : 'false'}
      data-problems={Array.from(new Set(rows.flatMap((row) => row.problems))).join(' ')}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="grid h-11 w-8 cursor-grab touch-none place-items-center rounded text-[var(--fanous-color-text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fanous-color-focus-ring)]"
        aria-label={r.dragHandle.replace('{title}', title)}
        data-testid={`${testId}-handle`}
        data-id={id}
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="pt-3 text-xs tabular-nums text-[var(--fanous-color-text-secondary)]" data-testid={`${testId}-position`}>
        {r.position.replace('{position}', fmt(index + 1))}
      </span>
      <input
        type="checkbox"
        checked={!excluded}
        onChange={(e) => onToggle(e.target.checked)}
        aria-label={r.include.replace('{title}', title)}
        className="mt-3 h-5 w-5 accent-[var(--fanous-color-primary)]"
        data-testid={`${testId}-include`}
      />
      {/* English and Arabic side by side (stacked on phones) */}
      <div className={`min-w-0 grid gap-2 ${rows.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {rows.map((row) => {
          const blocked = row.problems.some((p) => p !== 'duplicate');
          return (
            <div key={row.language} className="grid grid-cols-1 gap-x-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]" data-testid={`${testId}-cell`} data-language={row.language} data-problems={row.problems.join(' ')} data-skipped={row.skipped ?? ''}>
              <span className="text-xs text-[var(--fanous-color-text-secondary)] lg:col-span-3">{row.language === 'ar' ? r.langAr : r.langEn}</span>
              <span className="break-words text-sm text-[var(--fanous-color-text-secondary)]" dir={dirOf(row.language)} lang={row.language}>
                <bdi>{row.before || r.emptyValue}</bdi>
              </span>
              <Arrow className="hidden h-4 w-4 self-center text-[var(--fanous-color-text-muted)] lg:block" aria-hidden="true" />
              <span
                dir={dirOf(row.language)}
                lang={row.language}
                className={`break-words text-sm ${row.excluded ? 'text-[var(--fanous-color-text-muted)] line-through' : 'font-medium text-[var(--fanous-color-text-primary)]'}`}
                data-testid={`${testId}-after`}
                data-language={row.language}
              >
                <bdi>{row.excluded ? row.before || r.emptyValue : row.after || r.emptyValue}</bdi>
              </span>
              <span className="flex flex-wrap gap-1 lg:col-span-3">
                {row.excluded && <Badge>{r.excluded}</Badge>}
                {row.skipped && <Badge tone="warn">{r.skippedNoTitle[row.language]}</Badge>}
                {!row.excluded && !row.skipped && !row.changed && row.problems.length === 0 && <Badge>{r.unchanged}</Badge>}
                {row.problems.map((p) => (
                  <Badge key={p} tone={blocked && p !== 'duplicate' ? 'error' : 'warn'}>
                    <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    {problemText(p)}
                  </Badge>
                ))}
              </span>
            </div>
          );
        })}
      </div>
      <span className="flex flex-col">
        <button type="button" className="b b-ghost b-icon" onClick={() => onMove({ delta: -1 })} disabled={index === 0}
          aria-label={r.moveUp.replace('{title}', title)} data-testid={`${testId}-up`}>
          <ChevronUp aria-hidden="true" />
        </button>
        <button type="button" className="b b-ghost b-icon" onClick={() => onMove({ delta: 1 })} disabled={index === total - 1}
          aria-label={r.moveDown.replace('{title}', title)} data-testid={`${testId}-down`}>
          <ChevronDown aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}

function Badge({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warn' | 'error' }) {
  const color = tone === 'error'
    ? 'border-[var(--fanous-color-error-text)] text-[var(--fanous-color-error-text)]'
    : tone === 'warn'
      ? 'border-[var(--fanous-color-outline)] text-[var(--fanous-color-text-primary)]'
      : 'border-[var(--fanous-color-divider)] text-[var(--fanous-color-text-secondary)]';
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${color}`}>{children}</span>;
}

export default RenamePreview;
