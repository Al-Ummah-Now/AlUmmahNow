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
import { forwardRef } from 'react';
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
}

const th = 'text-start px-3 sm:px-4 py-3 text-fg-muted font-medium whitespace-nowrap text-sm';
const td = 'px-3 sm:px-4 md:py-3 align-top';

function DataTableInner<T extends { id: string }>({ rows, columns, caption, testId, rowProps, selection, currentId, stale }: DataTableProps<T>, ref: React.ForwardedRef<HTMLTableElement>) {
  const { t } = useLanguage();
  const allSelected = !!selection && rows.length > 0 && rows.every((r) => selection.selected.has(r.id));
  const someSelected = !!selection && !allSelected && rows.some((r) => selection.selected.has(r.id));

  return (
    <div className={`bg-transparent md:bg-surface md:border md:border-border md:rounded-lg transition-opacity ${stale ? 'opacity-60' : ''}`} aria-busy={stale || undefined}>
      <table ref={ref} role="table" className="block md:table w-full" data-testid={testId}>
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
              <th key={c.id} role="columnheader" scope="col" className={`${th} ${c.wide ? 'hidden md:table-cell' : ''} ${c.align === 'end' ? 'text-end' : ''} sticky top-[var(--app-header-height,0px)] z-10 bg-surface`}>
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
                  <td role="cell" className={`${td} order-first md:table-cell p-0 md:px-4`}>
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
                    className={`${td} p-0 ${c.primary ? 'basis-[calc(100%-2.5rem)] md:basis-auto min-w-0' : 'basis-full md:basis-auto'} ${c.wide ? 'hidden md:table-cell' : 'block md:table-cell'} ${c.align === 'end' ? 'md:text-end tabular-nums' : ''} ${c.className ?? ''}`}
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

export const DataTable = forwardRef(DataTableInner) as <T extends { id: string }>(props: DataTableProps<T> & { ref?: React.Ref<HTMLTableElement> }) => React.ReactElement;
