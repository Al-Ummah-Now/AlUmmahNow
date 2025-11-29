'use client';

import { useState, useMemo } from 'react';
import { useAdminTranslations } from '@/hooks/useAdminTranslations';
import type { SupportedLanguage, AppTranslations } from '@al-ummah/shared-types';

interface TranslationEditorProps {
  availableLocales: string[];
}

export function TranslationEditor({ availableLocales }: TranslationEditorProps) {
  const [selectedLocale, setSelectedLocale] = useState<SupportedLanguage>('en');
  const [selectedSection, setSelectedSection] = useState<string>('common');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  const {
    translations,
    isLoading,
    isError,
    error,
    isUpdating,
    updateTranslations,
    refetch,
  } = useAdminTranslations(selectedLocale);

  // Get available sections from translations
  const sections = useMemo(() => {
    if (!translations) return [];
    return Object.keys(translations).sort();
  }, [translations]);

  // Get keys for the selected section
  const sectionKeys = useMemo(() => {
    if (!translations || !selectedSection) return [];
    const section = translations[selectedSection as keyof AppTranslations];
    if (!section || typeof section !== 'object') return [];
    return Object.entries(section).filter(([key, value]) => {
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        return (
          key.toLowerCase().includes(searchLower) ||
          String(value).toLowerCase().includes(searchLower)
        );
      }
      return true;
    });
  }, [translations, selectedSection, searchTerm]);

  const handleStartEdit = (key: string, value: string) => {
    setEditingKey(key);
    setEditValue(value);
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setEditValue('');
  };

  const handleSaveEdit = async () => {
    if (!editingKey || !selectedSection) return;

    setSaveStatus('saving');
    try {
      await updateTranslations(
        {
          [selectedSection]: {
            [editingKey]: editValue,
          },
        } as Partial<AppTranslations>,
        'merge'
      );
      setSaveStatus('success');
      setEditingKey(null);
      setEditValue('');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          <span className="ml-3 text-gray-400">Loading translations...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded">
          <p className="font-medium">Failed to load translations</p>
          <p className="text-sm mt-1">{error?.message}</p>
          <button
            onClick={() => refetch()}
            className="mt-3 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg overflow-hidden">
      {/* Header Controls */}
      <div className="p-4 border-b border-gray-700 flex flex-wrap gap-4 items-center">
        {/* Language Selector */}
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-sm">Language:</label>
          <select
            value={selectedLocale}
            onChange={(e) => setSelectedLocale(e.target.value as SupportedLanguage)}
            className="bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
          >
            {availableLocales.map((locale) => (
              <option key={locale} value={locale}>
                {locale.toUpperCase()} - {locale === 'en' ? 'English' : locale === 'ar' ? 'Arabic' : locale}
              </option>
            ))}
          </select>
        </div>

        {/* Section Selector */}
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-sm">Section:</label>
          <select
            value={selectedSection}
            onChange={(e) => setSelectedSection(e.target.value)}
            className="bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
          >
            {sections.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </select>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search keys or values..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1 bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-blue-500"
          />
        </div>

        {/* Status Indicator */}
        {saveStatus === 'saving' && (
          <span className="text-yellow-400 text-sm flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-400"></div>
            Saving...
          </span>
        )}
        {saveStatus === 'success' && (
          <span className="text-green-400 text-sm">Saved successfully!</span>
        )}
        {saveStatus === 'error' && (
          <span className="text-red-400 text-sm">Failed to save</span>
        )}
      </div>

      {/* Translation Keys Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-700">
            <tr>
              <th className="text-left px-4 py-3 text-gray-300 font-medium w-1/4">Key</th>
              <th className="text-left px-4 py-3 text-gray-300 font-medium">Value</th>
              <th className="text-right px-4 py-3 text-gray-300 font-medium w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700">
            {sectionKeys.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                  {searchTerm
                    ? 'No keys match your search'
                    : 'No keys in this section'}
                </td>
              </tr>
            ) : (
              sectionKeys.map(([key, value]) => (
                <tr key={key} className="hover:bg-gray-700/50">
                  <td className="px-4 py-3">
                    <code className="text-blue-400 text-sm bg-gray-900 px-2 py-1 rounded">
                      {key}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    {editingKey === key ? (
                      <textarea
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-blue-500 focus:outline-none resize-y min-h-[60px]"
                        autoFocus
                        dir={selectedLocale === 'ar' ? 'rtl' : 'ltr'}
                      />
                    ) : (
                      <span
                        className="text-gray-200 block break-words"
                        dir={selectedLocale === 'ar' ? 'rtl' : 'ltr'}
                      >
                        {String(value)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingKey === key ? (
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={handleSaveEdit}
                          disabled={isUpdating}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1 rounded text-sm"
                        >
                          Save
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="bg-gray-600 hover:bg-gray-500 text-white px-3 py-1 rounded text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartEdit(key, String(value))}
                        className="text-blue-400 hover:text-blue-300 text-sm"
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer with count */}
      <div className="p-4 border-t border-gray-700 text-gray-400 text-sm">
        Showing {sectionKeys.length} key{sectionKeys.length !== 1 ? 's' : ''} in{' '}
        <span className="text-white">{selectedSection}</span>
        {searchTerm && ` matching "${searchTerm}"`}
      </div>
    </div>
  );
}
