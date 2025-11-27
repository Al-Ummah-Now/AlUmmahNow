import { TranslationEditor } from './components/TranslationEditor';
import { getI18nMetadata } from '@/lib/api/i18n';

export const dynamic = 'force-dynamic';

export default async function TranslationsPage() {
  let metadata = null;
  let error = null;

  try {
    metadata = await getI18nMetadata();
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to load i18n metadata';
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Translation Management</h1>
        <p className="text-gray-400 mt-2">
          Edit translations for the Al Ummah Now platform
        </p>
      </div>

      {error && (
        <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {metadata && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-gray-400 text-sm font-medium">Version</h3>
            <p className="text-2xl font-bold text-white mt-2">{metadata.version}</p>
          </div>
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-gray-400 text-sm font-medium">Languages</h3>
            <p className="text-2xl font-bold text-white mt-2">
              {metadata.locales.join(', ').toUpperCase()}
            </p>
          </div>
          <div className="bg-gray-800 rounded-lg p-6">
            <h3 className="text-gray-400 text-sm font-medium">Sections</h3>
            <p className="text-2xl font-bold text-white mt-2">{metadata.sections.length}</p>
          </div>
        </div>
      )}

      <TranslationEditor availableLocales={metadata?.locales || ['en', 'ar']} />
    </div>
  );
}
