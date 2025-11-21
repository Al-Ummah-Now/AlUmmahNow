'use client';

/**
 * TemplateSelector Component
 *
 * Dropdown to select and apply upload templates in the video upload form.
 * Pre-fills metadata fields when a template is selected.
 */

import { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { FileText, ChevronDown, AlertCircle } from 'lucide-react';
import { UploadTemplate } from '@al-ummah/shared-types';
import { listTemplates } from '@/lib/api/upload-defaults';
import { processTemplateVariables, type VariableContext, type ProcessedMetadata } from '@/lib/upload/template-variables';

interface TemplateSelectorProps {
  onTemplateApply: (metadata: ProcessedMetadata) => void;
  channelName?: string;
  uploaderName?: string;
}

export function TemplateSelector({
  onTemplateApply,
  channelName,
  uploaderName,
}: TemplateSelectorProps) {
  const { t, isRTL } = useLanguage();

  // State
  const [templates, setTemplates] = useState<UploadTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVariablePrompt, setShowVariablePrompt] = useState(false);
  const [variableContext, setVariableContext] = useState<Partial<VariableContext>>({});
  const [pendingTemplate, setPendingTemplate] = useState<UploadTemplate | null>(null);

  // Load templates
  useEffect(() => {
    const loadTemplates = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await listTemplates();
        if (response) {
          // API returns { success: true, result: { templates, defaultTemplateId } }
          // But apiRequest returns the full response, so we need to access .result
          const data = (response as any).result || response;
          setTemplates(data.templates || []);
          setDefaultTemplateId(data.defaultTemplateId || null);

          // Auto-select default template if exists
          if (data.defaultTemplateId) {
            setSelectedTemplateId(data.defaultTemplateId);
            const defaultTemplate = data.templates?.find((t: any) => t.id === data.defaultTemplateId);
            if (defaultTemplate) {
              applyTemplate(defaultTemplate);
            }
          }
        } else {
          setError(isRTL ? 'فشل في تحميل القوالب' : 'Failed to load templates');
        }
      } catch (err) {
        setError(isRTL ? 'حدث خطأ أثناء التحميل' : 'An error occurred while loading');
      } finally {
        setLoading(false);
      }
    };

    loadTemplates();
  }, []);

  // Check if template requires user input
  const requiresUserInput = (template: UploadTemplate): boolean => {
    const text = `${template.template.title} ${template.template.titleLocalized?.en || ''} ${template.template.titleLocalized?.ar || ''} ${template.template.description || ''} ${template.template.descriptionLocalized?.en || ''} ${template.template.descriptionLocalized?.ar || ''}`;

    const inputVariables = [
      '{{episode}}',
      '{{season}}',
      '{{series_name}}',
      '{{part}}',
      '{{surah}}',
      '{{ayah}}',
      '{{juz}}',
    ];

    return inputVariables.some((v) => text.includes(v));
  };

  // Apply template
  const applyTemplate = (template: UploadTemplate) => {
    // Check if template requires user input
    if (requiresUserInput(template)) {
      setPendingTemplate(template);
      setShowVariablePrompt(true);
      return;
    }

    // Process template with default context
    const context: VariableContext = {
      channelName,
      uploaderName,
      uploadDate: new Date().toLocaleDateString(),
    };

    const metadata = processTemplateVariables(template, context);
    onTemplateApply(metadata);
  };

  // Handle template selection
  const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const templateId = e.target.value;
    setSelectedTemplateId(templateId);

    if (templateId === '') {
      // Clear metadata (manual entry)
      onTemplateApply({
        title: '',
        description: '',
        tags: [],
        category: undefined,
        visibility: 'public',
        language: 'en',
      });
      return;
    }

    const template = templates.find((t) => t.id === templateId);
    if (template) {
      applyTemplate(template);
    }
  };

  // Handle variable input submission
  const handleVariableSubmit = () => {
    if (!pendingTemplate) return;

    const context: VariableContext = {
      channelName,
      uploaderName,
      uploadDate: new Date().toLocaleDateString(),
      ...variableContext,
    };

    const metadata = processTemplateVariables(pendingTemplate, context);
    onTemplateApply(metadata);

    setShowVariablePrompt(false);
    setPendingTemplate(null);
    setVariableContext({});
  };

  // Detect required variables from template
  const getRequiredVariables = (template: UploadTemplate): string[] => {
    const text = `${template.template.title} ${template.template.titleLocalized?.en || ''} ${template.template.titleLocalized?.ar || ''} ${template.template.description || ''} ${template.template.descriptionLocalized?.en || ''} ${template.template.descriptionLocalized?.ar || ''}`;

    const variableMap = {
      '{{episode}}': 'episode',
      '{{season}}': 'season',
      '{{series_name}}': 'seriesName',
      '{{part}}': 'part',
      '{{surah}}': 'surah',
      '{{ayah}}': 'ayah',
      '{{juz}}': 'juz',
    };

    const required: string[] = [];
    Object.entries(variableMap).forEach(([variable, key]) => {
      if (text.includes(variable)) {
        required.push(key);
      }
    });

    return required;
  };

  return (
    <>
      {/* Template Selector */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {isRTL ? 'قالب الرفع' : 'Upload Template'}
        </label>

        <div className="relative">
          <select
            value={selectedTemplateId}
            onChange={handleTemplateChange}
            disabled={loading}
            className="
              w-full
              px-4
              py-2
              pr-10
              rtl:pl-10
              rtl:pr-4
              border
              border-gray-300
              dark:border-gray-600
              rounded-lg
              bg-white
              dark:bg-gray-800
              text-gray-900
              dark:text-gray-100
              focus:ring-2
              focus:ring-primary
              focus:border-transparent
              disabled:opacity-50
              disabled:cursor-not-allowed
              appearance-none
            "
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <option value="">
              {isRTL ? 'بدون قالب (إدخال يدوي)' : 'None (Manual Entry)'}
            </option>
            {templates?.map((template) => (
              <option key={template.id} value={template.id}>
                {isRTL
                  ? template.nameLocalized?.ar || template.name
                  : template.name}
                {template.id === defaultTemplateId && ` ${isRTL ? '(افتراضي)' : '(Default)'}`}
              </option>
            ))}
          </select>

          <ChevronDown className="absolute right-3 rtl:left-3 rtl:right-auto top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
        </div>

        {/* Helper Text */}
        {selectedTemplateId && (
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
            <FileText className="w-3 h-3" />
            {isRTL
              ? 'تم تطبيق القالب على النموذج أدناه'
              : 'Template applied to form below'}
          </p>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
            <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}
      </div>

      {/* Variable Input Modal */}
      {showVariablePrompt && pendingTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowVariablePrompt(false);
              setPendingTemplate(null);
              setVariableContext({});
            }
          }}
        >
          <div
            className="
              relative
              w-full
              max-w-md
              bg-white
              dark:bg-gray-900
              rounded-lg
              shadow-xl
              overflow-hidden
            "
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {isRTL ? 'ادخل قيم المتغيرات' : 'Enter Variable Values'}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                {isRTL
                  ? 'هذا القالب يتطلب بعض المدخلات'
                  : 'This template requires some inputs'}
              </p>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {getRequiredVariables(pendingTemplate).map((varKey) => {
                const labels: Record<string, { en: string; ar: string; placeholder: { en: string; ar: string } }> = {
                  episode: {
                    en: 'Episode Number',
                    ar: 'رقم الحلقة',
                    placeholder: { en: 'e.g., 12', ar: 'مثال: 12' },
                  },
                  season: {
                    en: 'Season Number',
                    ar: 'رقم الموسم',
                    placeholder: { en: 'e.g., 2', ar: 'مثال: 2' },
                  },
                  seriesName: {
                    en: 'Series Name',
                    ar: 'اسم السلسلة',
                    placeholder: { en: 'e.g., Islamic History', ar: 'مثال: التاريخ الإسلامي' },
                  },
                  part: {
                    en: 'Part Number',
                    ar: 'رقم الجزء',
                    placeholder: { en: 'e.g., 3', ar: 'مثال: 3' },
                  },
                  surah: {
                    en: 'Surah Name/Number',
                    ar: 'اسم/رقم السورة',
                    placeholder: { en: 'e.g., Al-Fatiha or 1', ar: 'مثال: الفاتحة أو 1' },
                  },
                  ayah: {
                    en: 'Ayah Range',
                    ar: 'نطاق الآيات',
                    placeholder: { en: 'e.g., 1-7', ar: 'مثال: 1-7' },
                  },
                  juz: {
                    en: 'Juz Number',
                    ar: 'رقم الجزء',
                    placeholder: { en: 'e.g., 1', ar: 'مثال: 1' },
                  },
                };

                const label = labels[varKey];
                if (!label) return null;

                return (
                  <div key={varKey}>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {label[isRTL ? 'ar' : 'en']}
                    </label>
                    <input
                      type="text"
                      value={(variableContext as any)[varKey] || ''}
                      onChange={(e) =>
                        setVariableContext((prev) => ({
                          ...prev,
                          [varKey]: e.target.value,
                        }))
                      }
                      className="
                        w-full
                        px-4
                        py-2
                        border
                        border-gray-300
                        dark:border-gray-600
                        rounded-lg
                        bg-white
                        dark:bg-gray-800
                        text-gray-900
                        dark:text-gray-100
                        focus:ring-2
                        focus:ring-primary
                        focus:border-transparent
                      "
                      placeholder={label.placeholder[isRTL ? 'ar' : 'en']}
                    />
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <button
                type="button"
                onClick={() => {
                  setShowVariablePrompt(false);
                  setPendingTemplate(null);
                  setVariableContext({});
                }}
                className="
                  px-6
                  py-2
                  text-sm
                  font-medium
                  text-gray-700
                  dark:text-gray-300
                  bg-white
                  dark:bg-gray-700
                  border
                  border-gray-300
                  dark:border-gray-600
                  rounded-lg
                  hover:bg-gray-50
                  dark:hover:bg-gray-600
                  transition-colors
                "
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleVariableSubmit}
                className="
                  px-6
                  py-2
                  text-sm
                  font-medium
                  text-white
                  bg-primary
                  hover:bg-primary/90
                  rounded-lg
                  transition-colors
                "
              >
                {t.common.confirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
