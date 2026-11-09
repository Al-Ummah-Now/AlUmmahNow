'use client';

/**
 * VariableGuide Component
 *
 * Displays all available template variables with descriptions and examples.
 * Allows users to copy variables to clipboard for easy insertion.
 */

import { useState } from 'react';
import { TEMPLATE_VARIABLES, type TemplateVariable } from '@/lib/upload/template-variables';
import { useLanguage } from '@/hooks/useLanguage';
import { Check, Copy, ChevronDown, ChevronUp } from 'lucide-react';

interface VariableGuideProps {
  onInsertVariable?: (variable: string) => void;
}

const CATEGORY_LABELS = {
  datetime: { en: 'Date & Time', ar: 'التاريخ والوقت' },
  islamic: { en: 'Islamic Calendar', ar: 'التقويم الإسلامي' },
  episode: { en: 'Episode & Series', ar: 'الحلقة والسلسلة' },
  quran: { en: 'Quran References', ar: 'مراجع القرآن' },
  channel: { en: 'Channel Info', ar: 'معلومات القناة' },
  video: { en: 'Video Info', ar: 'معلومات الفيديو' },
};

export function VariableGuide({ onInsertVariable }: VariableGuideProps) {
  const { isRTL } = useLanguage();
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedVariable, setCopiedVariable] = useState<string | null>(null);

  const handleCopyVariable = async (variable: string) => {
    await navigator.clipboard.writeText(variable);
    setCopiedVariable(variable);
    setTimeout(() => setCopiedVariable(null), 2000);
  };

  const handleInsertVariable = (variable: string) => {
    if (onInsertVariable) {
      onInsertVariable(variable);
    } else {
      handleCopyVariable(variable);
    }
  };

  // Group variables by category
  const groupedVariables = TEMPLATE_VARIABLES.reduce((acc, v) => {
    if (!acc[v.category]) {
      acc[v.category] = [];
    }
    acc[v.category].push(v);
    return acc;
  }, {} as Record<string, TemplateVariable[]>);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        type="button"
        aria-expanded={isExpanded}
        data-testid="variable-guide-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
        className="
          w-full
          flex
          items-center
          justify-between
          p-4
          bg-gray-50
          dark:bg-gray-800
          hover:bg-gray-100
          dark:hover:bg-gray-750
          transition-colors
        "
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {isRTL ? 'دليل المتغيرات' : 'Variable Guide'}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            ({TEMPLATE_VARIABLES.length} {isRTL ? 'متغيرات' : 'variables'})
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-500" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-500" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
          {Object.entries(groupedVariables).map(([category, variables]) => (
            <div key={category} className="space-y-2">
              {/* Category Header */}
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase">
                {CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS][isRTL ? 'ar' : 'en']}
              </h4>

              {/* Variables in Category */}
              <div className="space-y-1">
                {variables.map((variable) => (
                  <div
                    key={variable.variable}
                    className="
                      flex
                      flex-col
                      sm:flex-row
                      sm:items-start
                      gap-2
                      p-2
                      rounded
                      bg-white
                      dark:bg-gray-800
                      border
                      border-gray-100
                      dark:border-gray-700
                      hover:border-primary/50
                      dark:hover:border-primary/50
                      transition-colors
                    "
                  >
                    {/* Variable Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <code className="
                          text-xs
                          font-mono
                          px-2
                          py-0.5
                          rounded
                          bg-gray-100
                          dark:bg-gray-700
                          text-primary
                          dark:text-primary-light
                        ">
                          {variable.variable}
                        </code>
                        {variable.requiresInput && (
                          <span className="
                            text-xs
                            px-1.5
                            py-0.5
                            rounded
                            bg-brand-soft
                            dark:bg-brand-soft
                            text-brand
                            dark:text-brand
                          ">
                            {isRTL ? 'يتطلب إدخال' : 'Requires input'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                        {variable.description}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-500">
                        {isRTL ? 'مثال:' : 'Example:'} <span className="font-medium">{variable.example}</span>
                      </p>
                    </div>

                    {/* Copy/Insert Button */}
                    <button
                      type="button"
                      data-testid="variable-guide-insert"
                      data-variable={variable.variable}
                      aria-label={`${onInsertVariable ? (isRTL ? 'إدراج' : 'Insert') : (isRTL ? 'نسخ' : 'Copy')} ${variable.variable}`}
                      onClick={() => handleInsertVariable(variable.variable)}
                      className="
                        flex-shrink-0
                        flex
                        items-center
                        gap-1.5
                        px-3
                        py-1.5
                        text-xs
                        font-medium
                        rounded
                        border
                        border-gray-300
                        dark:border-gray-600
                        bg-white
                        dark:bg-gray-800
                        hover:bg-gray-50
                        dark:hover:bg-gray-700
                        transition-colors
                        min-w-[80px]
                        justify-center
                      "
                    >
                      {copiedVariable === variable.variable ? (
                        <>
                          <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                          <span>{isRTL ? 'تم النسخ' : 'Copied'}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>{onInsertVariable ? (isRTL ? 'إدراج' : 'Insert') : (isRTL ? 'نسخ' : 'Copy')}</span>
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Usage Instructions */}
          <div className="
            p-3
            rounded
            bg-blue-50
            dark:bg-blue-900/20
            border
            border-blue-200
            dark:border-blue-800
          ">
            <p className="text-xs text-blue-800 dark:text-blue-300">
              {isRTL
                ? 'استخدم هذه المتغيرات في العنوان أو الوصف. سيتم استبدالها تلقائيًا بالقيم الفعلية عند رفع الفيديو.'
                : 'Use these variables in your title or description. They will be automatically replaced with actual values when you upload a video.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
