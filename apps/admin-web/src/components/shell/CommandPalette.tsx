'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminSuggestion, AdminSuggestKind } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { createTranslator, type MessageKey } from '@/i18n/translate';
import { DEBOUNCE_MS, hrefFor, suggestUrl } from '@/components/search/autocomplete-model';
import { logger } from '@/lib/logger-client';
import { Icon, type IconName } from './icons';
import type { NavAccess, NavItem } from './nav-model';
import { asksForEntities, matchPages, move, paletteKinds, paletteOptions, type PaletteOption } from './palette-model';

const english = createTranslator('en');

const KIND_ICON: Record<AdminSuggestKind, IconName> = {
  user: 'user', channel: 'tv', video: 'film', playlist: 'list', post: 'people', comment: 'chat', contact: 'inbox', error: 'alert', invite: 'key', report: 'flag',
};
const KIND_GROUP: Record<AdminSuggestKind, MessageKey> = {
  user: 'palette.groups.user', channel: 'palette.groups.channel', video: 'palette.groups.video', playlist: 'palette.groups.playlist',
  post: 'palette.groups.post', comment: 'palette.groups.comment', contact: 'palette.groups.contact', error: 'palette.groups.error', invite: 'palette.groups.invite', report: 'palette.groups.report',
};

type Results = Partial<Record<AdminSuggestKind, AdminSuggestion[]>>;

/**
 * Search everything and jump there. A modal dialog holding a combobox: focus stays in the input,
 * arrows move the active option (aria-activedescendant), Enter opens it, Escape closes and
 * returns focus to whatever opened the palette.
 */
export function CommandPalette({ open, onClose, items, access }: { open: boolean; onClose: () => void; items: NavItem[]; access: NavAccess }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results>({});
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const listId = useId();
  const kinds = useMemo(() => paletteKinds(access), [access]);

  // Opening: remember where focus was, start empty, focus the input
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement;
    setQuery('');
    setResults({});
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      const el = returnFocus.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, [open]);

  // Suggestions: one request per kind, debounced, the previous round cancelled
  useEffect(() => {
    if (!open || !asksForEntities(query) || kinds.length === 0) {
      setResults({});
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setResults({});
    // Each kind shows as soon as it answers: a slow kind never holds back the others
    const timer = setTimeout(() => {
      let pending = kinds.length;
      for (const kind of kinds) {
        fetch(suggestUrl(kind, query), { signal: controller.signal, headers: { Accept: 'application/json' }, cache: 'no-store' })
          .then(async (res) => {
            const body = (await res.json().catch(() => ({}))) as { result?: { items?: AdminSuggestion[] } };
            return res.ok ? body.result?.items ?? [] : [];
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted) logger.warn('[palette] Suggestions failed', { kind, error: error instanceof Error ? error.message : String(error) });
            return [] as AdminSuggestion[];
          })
          .then((items) => {
            if (controller.signal.aborted) return;
            setResults((previous) => ({ ...previous, [kind]: items }));
            pending -= 1;
            if (pending === 0) setLoading(false);
          });
      }
    }, DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, query, kinds]);

  const pages = useMemo(() => matchPages(query, items, (i) => t(i.label), (i) => english(i.label)), [query, items, t]);
  const options = useMemo(() => paletteOptions(pages, results, kinds), [pages, results, kinds]);

  useEffect(() => setActive((a) => (options.length ? Math.min(Math.max(a, 0), options.length - 1) : -1)), [options.length]);

  const choose = useCallback(
    (option: PaletteOption | undefined) => {
      if (!option) return;
      const href = option.type === 'page' ? option.item.href : hrefFor(option.suggestion);
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => move(a, options.length, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // The input is the dialog's only stop: options are chosen with the arrows
      e.preventDefault();
    }
  };

  const activeId = active >= 0 && options[active] ? `${listId}-${options[active].id}` : undefined;
  const groups: { key: string; label: string; options: PaletteOption[] }[] = [];
  for (const option of options) {
    const key = option.type === 'page' ? 'pages' : option.suggestion.kind;
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, label: option.type === 'page' ? t('palette.groups.pages') : t(KIND_GROUP[option.suggestion.kind]), options: [] };
      groups.push(group);
    }
    group.options.push(option);
  }
  const typedEnough = asksForEntities(query);
  const nothing = typedEnough && !loading && options.length === 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-bg/70 px-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.label')}
        data-testid="command-palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-menu-border bg-menu-bg text-menu-text shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-menu-border px-4">
          <Icon name="search" className="size-5 text-menu-muted" />
          <input
            ref={inputRef}
            data-testid="command-input"
            role="combobox"
            aria-expanded={options.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label={t('palette.label')}
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-menu-text placeholder:text-menu-muted focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="rounded border border-menu-border px-1.5 text-xs text-menu-muted" dir="ltr">Esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label={t('palette.results')} className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
          {groups.map((group) => (
            <li key={group.key} role="presentation">
              <div className="px-3 pb-1 pt-2 text-xs font-semibold text-menu-muted" aria-hidden="true">{group.label}</div>
              <ul role="group" aria-label={group.label}>
                {group.options.map((option) => {
                  const index = options.indexOf(option);
                  const selected = index === active;
                  const icon = option.type === 'page' ? option.item.icon : KIND_ICON[option.suggestion.kind];
                  const label = option.type === 'page' ? option.label : option.suggestion.label;
                  const secondary = option.type === 'page' ? null : option.suggestion.secondary;
                  return (
                    <li
                      key={option.id}
                      id={`${listId}-${option.id}`}
                      role="option"
                      aria-selected={selected}
                      data-testid="command-option"
                      onMouseMove={() => setActive(index)}
                      onClick={() => choose(option)}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${selected ? 'bg-menu-hover' : ''}`}
                    >
                      <Icon name={icon} className="size-[18px] text-menu-muted" />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {secondary && <span className="max-w-[45%] truncate text-xs text-menu-muted">{secondary}</span>}
                      {selected && <Icon name="enter" className="size-4 text-menu-muted rtl:-scale-x-100" />}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-menu-border px-4 py-2 text-xs text-menu-muted" aria-live="polite">
          {loading ? (
            <span>{t('palette.searching')}</span>
          ) : nothing ? (
            <span data-testid="command-empty">{t('palette.nothing', { query: query.trim() })}</span>
          ) : (
            <span>{typedEnough ? t('palette.count', { count: options.length }) : t('palette.hint')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
