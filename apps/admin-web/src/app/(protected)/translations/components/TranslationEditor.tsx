'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAdminTranslations } from '@/hooks/useAdminTranslations';
import type { SupportedLanguage, AppTranslations } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { ErrorAlert, fieldClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

interface TranslationEditorProps {
  availableLocales: string[];
}

interface FlatEntry {
  /** Path inside the section, e.g. ["tabs", "home"]. */
  path: string[];
  /** Display key, e.g. "tabs.home". */
  key: string;
  value: string;
}

/**
 * Sections can contain nested groups (e.g. channel.tabs.*). Flatten them so
 * every leaf string is editable on its own row; editing a group as a whole
 * would stringify it to "[object Object]" and corrupt the stored data.
 */
function flattenSection(node: unknown, prefix: string[] = []): FlatEntry[] {
  if (!node || typeof node !== 'object') return [];
  const entries: FlatEntry[] = [];
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const path = [...prefix, k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      entries.push(...flattenSection(v, path));
    } else {
      entries.push({ path, key: path.join('.'), value: v == null ? '' : String(v) });
    }
  }
  return entries;
}

function buildNestedUpdate(section: string, path: string[], value: string): Partial<AppTranslations> {
  const leaf = path.reduceRight<unknown>((acc, segment) => ({ [segment]: acc }), value);
  return { [section]: leaf } as Partial<AppTranslations>;
}

const SUPPORTED: SupportedLanguage[] = ['en', 'ar'];

export function TranslationEditor({ availableLocales }: TranslationEditorProps) {
  const { t } = useLanguage();
  const locales = availableLocales.filter((l): l is SupportedLanguage => SUPPORTED.includes(l as SupportedLanguage));
  const [selectedLocale, setSelectedLocale] = useState<SupportedLanguage>('en');
  const [selectedSection, setSelectedSection] = useState<string>('common');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localeId = useId();
  const sectionId = useId();
  const searchId = useId();

  const { translations, isLoading, isError, isUpdating, updateTranslations, refetch } =
    useAdminTranslations(selectedLocale);

  useEffect(() => () => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
  }, []);

  const sections = useMemo(() => {
    if (!translations) return [];
    return Object.keys(translations).sort();
  }, [translations]);

  const activeSection = sections.includes(selectedSection) ? selectedSection : sections[0] ?? selectedSection;

  const sectionEntries = useMemo(() => {
    if (!translations || !activeSection) return [];
    const entries = flattenSection(translations[activeSection as keyof AppTranslations]);
    if (!searchTerm) return entries;
    const needle = searchTerm.toLowerCase();
    return entries.filter((e) => e.key.toLowerCase().includes(needle) || e.value.toLowerCase().includes(needle));
  }, [translations, activeSection, searchTerm]);

  const valueDir = selectedLocale === 'ar' ? 'rtl' : 'ltr';

  const flashStatus = (status: 'success' | 'error', ms: number) => {
    setSaveStatus(status);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setSaveStatus('idle'), ms);
  };

  const handleStartEdit = (entry: FlatEntry) => {
    setEditingKey(entry.key);
    setEditValue(entry.value);
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const handleSaveEdit = async (entry: FlatEntry) => {
    setSaveStatus('saving');
    try {
      await updateTranslations(buildNestedUpdate(activeSection, entry.path, editValue), 'merge');
      setEditingKey(null);
      setEditValue('');
      flashStatus('success', 4000);
    } catch (error) {
      logger.warn('[translations] Save failed', {
        locale: selectedLocale,
        key: `${activeSection}.${entry.key}`,
        error: error instanceof Error ? error.message : String(error),
      });
      flashStatus('error', 5000);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6" role="status" aria-live="polite">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" aria-hidden="true"></div>
          <span className="ms-3 text-fg-muted">{t('translations.loading')}</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6">
        <ErrorAlert testId="translations-error">
          <p className="font-medium">{t('translations.loadFailed')}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 bg-btn-banned hover:bg-btn-banned-hover text-white px-4 py-2 rounded text-sm"
          >
            {t('common.retry')}
          </button>
        </ErrorAlert>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden" data-testid="translation-editor">
      <div className="p-4 border-b border-border flex flex-wrap gap-4 items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor={localeId} className="text-fg-muted text-sm">
            {t('translations.language')}
          </label>
          <select
            id={localeId}
            data-testid="translation-locale"
            value={selectedLocale}
            onChange={(e) => {
              setSelectedLocale(e.target.value as SupportedLanguage);
              handleCancelEdit();
            }}
            className={fieldClass}
          >
            {locales.map((locale) => (
              <option key={locale} value={locale}>
                {locale.toUpperCase()} - {translateDynamic(t, 'translations.localeName', locale)}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={sectionId} className="text-fg-muted text-sm">
            {t('translations.section')}
          </label>
          <select
            id={sectionId}
            data-testid="translation-section"
            value={activeSection}
            onChange={(e) => {
              setSelectedSection(e.target.value);
              handleCancelEdit();
            }}
            className={fieldClass}
            dir="ltr"
          >
            {sections.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
          <label htmlFor={searchId} className="text-fg-muted text-sm">
            {t('translations.search')}
          </label>
          <input
            id={searchId}
            type="search"
            data-testid="translation-search"
            placeholder={t('translations.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={fieldClass}
          />
        </div>

        <div role="status" aria-live="polite" className="min-h-[1.5rem] text-sm" data-testid="save-status">
          {saveStatus === 'saving' && <span className="text-warning-fg">{t('translations.saving')}</span>}
          {saveStatus === 'success' && <span className="text-success-fg">{t('translations.saved')}</span>}
          {saveStatus === 'error' && <span className="text-danger-fg">{t('translations.saveFailed')}</span>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" data-testid="translation-table">
          <caption className="sr-only">{t('translations.tableCaption', { section: activeSection })}</caption>
          <thead className="bg-surface-2">
            <tr>
              <th scope="col" className="text-start px-4 py-3 text-fg-muted font-medium w-1/4">
                {t('translations.colKey')}
              </th>
              <th scope="col" className="text-start px-4 py-3 text-fg-muted font-medium">
                {t('translations.colValue')}
              </th>
              <th scope="col" className="text-end px-4 py-3 text-fg-muted font-medium w-24">
                {t('translations.colActions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sectionEntries.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-fg-muted">
                  {searchTerm ? t('translations.noMatches') : t('translations.noKeys')}
                </td>
              </tr>
            ) : (
              sectionEntries.map((entry) => (
                <tr key={entry.key} className="hover:bg-surface-hover" data-testid="translation-row" data-key={entry.key}>
                  <td className="px-4 py-3">
                    <code className="text-link text-sm bg-surface-2 px-2 py-1 rounded break-all" dir="ltr">
                      {entry.key}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    {editingKey === entry.key ? (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        aria-label={t('translations.valueFor', { key: entry.key })}
                        className="w-full bg-surface-2 text-fg px-3 py-2 rounded border border-focus focus:outline-none focus-visible:ring-2 focus-visible:ring-focus resize-y min-h-[60px]"
                        autoFocus
                        dir={valueDir}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                      />
                    ) : (
                      <span className="text-fg block break-words" dir={valueDir} data-testid="translation-value">
                        {entry.value}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-end">
                    {editingKey === entry.key ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveEdit(entry)}
                          disabled={isUpdating}
                          aria-label={t('translations.saveKey', { key: entry.key })}
                          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-on-accent px-3 py-1 rounded text-sm"
                        >
                          {t('common.save')}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          aria-label={t('translations.cancelEdit', { key: entry.key })}
                          className="bg-surface-2 hover:bg-surface-hover border border-border text-fg px-3 py-1 rounded text-sm"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStartEdit(entry)}
                        aria-label={t('translations.editKey', { key: entry.key })}
                        className="text-link hover:text-link-hover text-sm px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        {t('common.edit')}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="p-4 border-t border-border text-fg-muted text-sm" data-testid="translation-count">
        {t('translations.showing', { count: sectionEntries.length, section: activeSection })}
        {searchTerm && ` ${t('translations.matching', { term: searchTerm })}`}
      </div>
    </div>
  );
}
