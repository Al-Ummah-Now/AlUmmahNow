'use client';

/**
 * The Contact messages list (admin UX rules): views with counts, the whole row
 * opens the message, unread rows stand out, rows can be selected for the bulk
 * bar (read/unread, status, assign, delete with Undo), and keyboard j/k/x/Enter
 * work as on the other admin lists. Nothing scrolls sideways: under md every
 * row is a card, and the message text wraps.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/components/AppLink';
import type { ContactBulkChange, ContactMessage, ContactStatus } from '@/lib/api/types';
import { bulkContactMessages, restoreContactMessages } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, translateDynamic } from '@/i18n/translate';
import { ContactStatusChip, ErrorAlert, fieldClass } from '@/components/ui';
import { DataTable, type DataColumn } from '@/components/list/DataTable';
import { BulkBar } from '@/components/list/BulkBar';
import { SavedViews, type SavedViewTab } from '@/components/list/SavedViews';
import { useListKeyboard } from '@/components/list/useListKeyboard';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { logger } from '@/lib/logger-client';
import { AssigneePicker } from './AssigneePicker';
import { UserName } from '@/components/audit/UserName';
import { CONTACT_STATUSES, CONTACT_VIEWS, activeContactView, contactHref, type ContactInboxFilters, type ContactViewId } from './filters';

const smallButton =
  'px-3 py-2 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

export interface ContactInboxProps {
  messages: ContactMessage[];
  filters: ContactInboxFilters;
  viewerId: string | null;
  canManage: boolean;
  counts: Partial<Record<ContactViewId, number | null>>;
}

export const messageHref = (id: string) => `/contact/${encodeURIComponent(id)}`;
const isUnread = (m: ContactMessage) => !m.read_at && m.status !== 'spam';

export function ContactInbox({ messages, filters, viewerId, canManage, counts }: ContactInboxProps) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const undoable = useUndoableAction();
  const tableRef = useRef<HTMLTableElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkStatus, setBulkStatus] = useState<ContactStatus>('in_progress');
  const [pickerKey, setPickerKey] = useState(0);

  // Another page of the list starts with nothing selected
  const listKey = messages.map((m) => m.id).join(',');
  const [selectionFor, setSelectionFor] = useState(listKey);
  if (selectionFor !== listKey) {
    setSelectionFor(listKey);
    setSelected(new Set([...selected].filter((id) => messages.some((m) => m.id === id))));
  }

  const rowIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const chosen = rowIds.filter((id) => selected.has(id));
  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const keyboard = useListKeyboard({
    rowIds,
    containerRef: tableRef,
    onToggle: canManage ? toggle : undefined,
    onOpen: (id) => router.push(messageHref(id)),
    focusSearch: () => document.querySelector<HTMLInputElement>('[data-testid="contact-search-input"]')?.focus(),
  });

  // A click anywhere on a row opens its message (the name's link is what keyboards and screen
  // readers use). Clicks on controls, and a drag that selects text, are left alone.
  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.closest('a, button, input, select, textarea, label, summary')) return;
      if (window.getSelection()?.toString()) return;
      const rowId = target.closest<HTMLElement>('tr[data-row-id]')?.dataset.rowId;
      if (rowId) router.push(messageHref(rowId));
    };
    table.addEventListener('click', onClick);
    return () => table.removeEventListener('click', onClick);
  }, [router]);

  /** One change on the selected messages; refreshes the list (and the nav badge). */
  async function apply(name: string, change: ContactBulkChange, ids = chosen): Promise<string[] | null> {
    setBusy(name);
    setError(null);
    try {
      const result = await bulkContactMessages(ids, change);
      if (!result.ok) {
        logger.warn('[contact] Bulk change failed', { name, status: result.status });
        setError(result.status === 400 && 'assignee' in change ? t('contact.notStaff') : t('contact.failed'));
        return null;
      }
      if (result.data.missing.length) setError(t('contact.bulkPartial', { ok: result.data.ok.length, total: ids.length }));
      router.refresh();
      return result.data.ok;
    } catch (e) {
      logger.error('[contact] Bulk request failed', { name, error: e instanceof Error ? e.message : String(e) });
      setError(t('contact.failed'));
      return null;
    } finally {
      setBusy(null);
    }
  }

  /** Delete at once with Undo (soft delete: also restorable for 30 days from Recently deleted). */
  async function remove(ids: string[]) {
    setError(null);
    setBusy('delete');
    try {
      await undoable.run({
        action: async () => {
          const result = await bulkContactMessages(ids, { delete: true });
          if (!result.ok) throw new Error(`delete ${result.status}`);
          router.refresh();
          return result.data.ok;
        },
        undo: async (done) => {
          await restoreContactMessages(done);
          router.refresh();
        },
        message: (done) => (done.length === 1 ? t('contact.deletedOne') : t('contact.deletedMany', { count: done.length })),
        undoneMessage: t('contact.restored'),
      });
      setSelected(new Set());
    } catch (e) {
      logger.warn('[contact] Delete failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('contact.failed'));
    } finally {
      setBusy(null);
    }
  }

  const statusLabel = (s: string) => translateDynamic(t, 'contactStatus', s);
  const columns: DataColumn<ContactMessage>[] = [
    {
      id: 'from',
      header: t('contact.colFrom'),
      primary: true,
      className: 'min-w-0 md:w-56',
      cell: (m) => (
        <div className="min-w-0">
          {/* The link covers the whole row: anywhere on it opens the message */}
          <Link
            href={messageHref(m.id)}
            className="flex items-center gap-2 text-fg hover:underline focus:outline-none focus-visible:underline after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:rounded-lg md:focus-visible:after:rounded-none"
            aria-label={isUnread(m) ? t('contact.openUnreadMessage', { name: m.name }) : t('contact.openMessage', { name: m.name })}
            data-testid="contact-row-link"
            data-row-primary
          >
            {isUnread(m) && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" data-testid="contact-unread-dot" />}
            <span dir="auto" className={`break-words min-w-0 ${isUnread(m) ? 'font-bold' : 'font-medium'}`}>
              {m.name}
            </span>
          </Link>
          <span className="block text-xs text-fg-subtle break-all rtl:text-right" dir="ltr">
            {m.email}
          </span>
        </div>
      ),
    },
    {
      id: 'message',
      header: t('contact.colMessage'),
      className: 'min-w-0',
      cell: (m) => (
        <p className={`line-clamp-2 break-words text-sm ${isUnread(m) ? 'text-fg font-semibold' : 'text-fg-muted'}`}>
          <span className="text-fg-subtle font-normal">{translateDynamic(t, 'contactTopic', m.topic)} · </span>
          {/* Isolated: the sender's language never reorders the page's own label around it */}
          <bdi dir="auto">{m.message}</bdi>
        </p>
      ),
    },
    {
      id: 'status',
      header: t('contact.colStatus'),
      cell: (m) => (
        <span className="flex flex-wrap gap-1">
          <ContactStatusChip status={m.status} label={statusLabel(m.status)} />
          {m.status === 'spam' && m.spam_reason && m.spam_reason !== 'admin' && (
            <span className="text-xs text-fg-muted self-center" data-testid="contact-spam-reason">
              {translateDynamic(t, 'contact.spamReasons', m.spam_reason)}
            </span>
          )}
          {m.send_failed_at && <ContactStatusChip status="send_failed" label={t('contact.sendFailed')} />}
        </span>
      ),
    },
    {
      id: 'assignee',
      header: t('contact.colAssignee'),
      wide: true,
      className: 'text-sm text-fg-muted break-all md:max-w-48',
      cell: (m) =>
        m.assignee_id ? (
          // Above the row-wide link: the person's own link stays clickable
          <span dir="auto" className="relative z-[1]" data-testid="contact-row-assignee">
            {m.assignee_id === viewerId ? t('contact.you') : <UserName id={m.assignee_id} email={m.assignee_email} showEmail={false} />}
          </span>
        ) : (
          <span className="text-fg-subtle">{t('contact.unassigned')}</span>
        ),
    },
    {
      id: 'received',
      header: t('contact.colReceived'),
      cardLabel: t('contact.colReceived'),
      className: 'text-sm text-fg-muted md:whitespace-nowrap',
      cell: (m) => <time dateTime={m.created_at}>{formatDate(m.created_at, locale, true)}</time>,
    },
  ];

  const views: SavedViewTab[] = CONTACT_VIEWS.map((v) => ({
    id: v.id,
    label: t(`contact.views.${v.id}`),
    count: counts[v.id],
    alertWhenNonZero: v.id === 'send_failed',
    countTestId: `contact-view-count-${v.id}`,
  }));
  const active = activeContactView(filters);

  return (
    // Rows open on click: they show the pointer
    <div className="[&_tbody_tr]:cursor-pointer">
      <SavedViews
        views={views}
        active={active}
        label={t('contact.viewsLabel')}
        testId="contact-views"
        onSelect={(id) => {
          const view = CONTACT_VIEWS.find((v) => v.id === id);
          // A view keeps the search, topic, dates and assignee; it sets status and read
          if (view) router.push(contactHref({ ...filters, status: undefined, read: undefined, page: 1, ...view.filters }));
        }}
      />
      {error && <ErrorAlert testId="contact-bulk-error">{error}</ErrorAlert>}
      <DataTable
        rows={messages}
        columns={columns}
        caption={t('contact.tableCaption')}
        testId="contact-table"
        tableRef={tableRef}
        currentId={keyboard.current}
        rowProps={(m) => ({
          'data-testid': 'contact-row',
          'data-message-id': m.id,
          'data-status': m.status,
          'data-read': isUnread(m) ? 'false' : 'true',
        })}
        selection={
          canManage
            ? {
                selected,
                onToggle: toggle,
                onToggleAll: () => setSelected(chosen.length === rowIds.length ? new Set() : new Set(rowIds)),
                rowLabel: (m) => t('contact.selectRow', { name: m.name }),
                allLabel: t('contact.selectAll'),
                rowTestId: 'contact-row-select',
                allTestId: 'contact-select-all',
              }
            : undefined
        }
      />
      {canManage && (
        <BulkBar
          count={chosen.length}
          label={t('contact.bulkLabel')}
          selectedText={t('contact.selectedCount', { count: chosen.length })}
          onClear={() => setSelected(new Set())}
          testId="contact-bulk"
          countTestId="contact-bulk-count"
          extra={
            <div className="max-w-sm">
              <AssigneePicker
                key={pickerKey}
                testId="contact-bulk-assignee"
                disabled={!!busy}
                onPick={async (id) => {
                  if (await apply('assign', { assignee: id })) setPickerKey((k) => k + 1);
                }}
              />
            </div>
          }
        >
          <button type="button" className={smallButton} disabled={!!busy} onClick={() => apply('read', { read: true })} data-testid="contact-bulk-read">
            {t('contact.markRead')}
          </button>
          <button type="button" className={smallButton} disabled={!!busy} onClick={() => apply('unread', { read: false })} data-testid="contact-bulk-unread">
            {t('contact.markUnread')}
          </button>
          <span className="inline-flex items-center gap-1">
            <label htmlFor="contact-bulk-status" className="sr-only">
              {t('contact.changeStatus')}
            </label>
            <select id="contact-bulk-status" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as ContactStatus)} className={fieldClass} data-testid="contact-bulk-status">
              {CONTACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <button type="button" className={smallButton} disabled={!!busy} onClick={() => apply('status', { status: bulkStatus })} data-testid="contact-bulk-status-apply">
              {t('contact.setStatus')}
            </button>
          </span>
          <button
            type="button"
            className={`${smallButton} text-danger-fg`}
            disabled={!!busy}
            onClick={() => remove(chosen)}
            data-testid="contact-bulk-delete"
          >
            {t('contact.deleteSelected')}
          </button>
        </BulkBar>
      )}
    </div>
  );
}
