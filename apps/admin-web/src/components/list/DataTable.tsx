'use client';

/**
 * The admin lists' table: a sticky header, optional row selection (with
 * "select all on this page"), the current row from the keyboard
 * (useListKeyboard) and, under the md breakpoint, every row as a card: the
 * same markup restyled, so test ids and links exist once whatever the width.
 * Explicit table roles keep the semantics when the cells are laid out as blocks.
 *
 * Columns: `primary` is the card's heading cell; `wide` columns are hidden on
 * a phone (fold what matters into the primary cell instead); `label` shows
 * before the value in card layout.
 */
import { useLanguage } from '@/i18n/I18nProvider';

export interface DataColumn<T> {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** The row's heading in card layout. */
  primary?: boolean;
  /** Only from md up. */
  wide?: boolean;
  /** Shown before the value in card layout (default: none). */
  cardLabel?: string;
  align?: 'start' | 'end';
  className?: string;
  /**
   * The column's minimum width from md up (Tailwind classes). An auto-layout table squeezes a
   * column to its min-content, so a title cell with a long unbreakable word (or an id) collapsed
   * to one letter per line. The primary column defaults to md:min-w-[16rem].
   */
  minWidth?: string;
  /** Short values (counts, dates, badges): never wrap from md up, so they take only their width. */
  nowrap?: boolean;
  /**
   * Shown only when the table itself is at least this wide (a container query: the space beside
   * the sidebar, not the viewport). Lower-priority columns step out before the table overflows;
   * fold what matters into the primary cell for the widths where they are hidden.
   */
  from?: ColumnFrom;
  /** The row's actions: on a phone card they sit in its footer, end-aligned (owner rule). */
  footer?: boolean;
}

/** Container widths a column can wait for (Tailwind's @container sizes: 2xl 42rem … 6xl 72rem). */
export type ColumnFrom = '2xl' | '3xl' | '4xl' | '5xl' | '6xl';
// Whole class names, so Tailwind finds them
const FROM_CLASS: Record<ColumnFrom, string> = {
  '2xl': 'hidden @2xl:table-cell',
  '3xl': 'hidden @3xl:table-cell',
  '4xl': 'hidden @4xl:table-cell',
  '5xl': 'hidden @5xl:table-cell',
  '6xl': 'hidden @6xl:table-cell',
};

/** Display classes of a column's cells: always, from md (wide), or from a table width (from). */
export function columnDisplayClass(c: { wide?: boolean; from?: ColumnFrom; footer?: boolean }, cell: boolean): string {
  if (c.from) return FROM_CLASS[c.from];
  if (c.footer && cell) return 'flex justify-end md:table-cell';
  if (c.wide) return 'hidden md:table-cell';
  return cell ? 'block md:table-cell' : '';
}

/** The primary (title) column's minimum width when it sets none. */
export const PRIMARY_MIN_WIDTH = 'md:min-w-[16rem]';

/** The width classes of a column's cells (exported for the unit tests). */
export function columnWidthClass(c: { primary?: boolean; minWidth?: string; nowrap?: boolean }): string {
  return [c.minWidth ?? (c.primary ? PRIMARY_MIN_WIDTH : ''), c.nowrap ? 'md:whitespace-nowrap' : ''].filter(Boolean).join(' ');
}

export interface DataTableProps<T extends { id: string }> {
  rows: T[];
  columns: DataColumn<T>[];
  caption: string;
  testId: string;
  /** Per-row test id and data attributes. */
  rowProps?: (row: T) => Record<string, string | undefined>;
  selection?: {
    selected: ReadonlySet<string>;
    onToggle: (id: string) => void;
    onToggleAll: () => void;
    rowLabel: (row: T) => string;
    allLabel: string;
    rowTestId?: string;
    allTestId?: string;
  };
  /** The keyboard's current row. */
  currentId?: string | null;
  /** Rows on screen are a previous page while the next one loads. */
  stale?: boolean;
  /** The table element (the keyboard finds rows in it). */
  tableRef?: React.Ref<HTMLTableElement>;
}

const th = 'text-start px-3 sm:px-4 py-3 text-fg-muted font-medium whitespace-nowrap text-sm';
const td = 'px-3 sm:px-4 md:py-3 align-top';

export function DataTable<T extends { id: string }>({ rows, columns, caption, testId, rowProps, selection, currentId, stale, tableRef }: DataTableProps<T>) {
  const { t } = useLanguage();
  const allSelected = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(r.id));
  const someSelected = !!selection && !allSelected && rows.some((r) => selection.selected.has(r.id));

  return (
    <div className={`@container bg-transparent md:bg-surface md:border md:border-border md:rounded-lg transition-opacity ${stale ? 'opacity-60' : ''}`} aria-busy={stale || undefined}>
      <table ref={tableRef} role="table" className="block md:table w-full" data-testid={testId}>
        <caption className="sr-only">
          {caption}
          {selection && `. ${t('list.keyboardHint')}`}
        </caption>
        <thead role="rowgroup" className="sr-only md:not-sr-only md:table-header-group">
          <tr role="row" className="md:border-b md:border-border">
            {selection && (
              <th role="columnheader" scope="col" className={`${th} w-10 sticky top-[var(--app-header-height,0px)] z-10 bg-surface rounded-ss-lg`}>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={selection.onToggleAll}
                  aria-label={selection.allLabel}
                  data-testid={selection.allTestId}
                />
              </th>
            )}
            {columns.map((c) => (
              <th key={c.id} role="columnheader" scope="col" className={`${th} ${columnWidthClass(c)} ${columnDisplayClass(c, false)} ${c.align === 'end' ? 'text-end' : ''} sticky top-[var(--app-header-height,0px)] z-10 bg-surface`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="block md:table-row-group space-y-3 md:space-y-0">
          {rows.map((row) => {
            const selected = !!selection?.selected.has(row.id);
            const current = currentId === row.id;
            return (
              <tr
                key={row.id}
                role="row"
                data-row-id={row.id}
                data-current={current || undefined}
                className={`relative flex flex-wrap items-start gap-x-3 gap-y-2 p-3 bg-surface border border-border rounded-lg md:table-row md:p-0 md:border-0 md:border-b md:rounded-none md:last:border-0 hover:bg-surface-hover ${selected ? 'bg-surface-2' : ''} ${current ? 'outline outline-2 -outline-offset-2 outline-focus' : ''}`}
                {...(rowProps?.(row) ?? {})}
              >
                {selection && (
                  // Above a row-wide link (a list whose whole row opens the item): the box stays clickable
                  <td role="cell" className={`${td} order-first md:table-cell p-0 md:px-4 relative z-[1]`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 mt-1"
                      checked={selected}
                      onChange={() => selection.onToggle(row.id)}
                      aria-label={selection.rowLabel(row)}
                      data-testid={selection.rowTestId}
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td
                    key={c.id}
                    role="cell"
                    className={`${td} p-0 ${columnWidthClass(c)} ${c.primary ? 'basis-[calc(100%-2.5rem)] md:basis-auto min-w-0' : 'basis-full md:basis-auto'} ${columnDisplayClass(c, true)} ${c.align === 'end' ? 'md:text-end tabular-nums' : ''} ${c.className ?? ''}`}
                  >
                    {c.cardLabel && <span className="md:hidden me-2 text-xs text-fg-muted">{c.cardLabel}</span>}
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

