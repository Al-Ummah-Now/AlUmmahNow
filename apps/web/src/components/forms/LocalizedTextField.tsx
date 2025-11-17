/**
 * Multi-language text field component
 *
 * Provides a tabbed interface for entering content in multiple languages
 */

'use client';

import { useState, useEffect } from 'react';
import { LocalizedContent, LocalizationHelper, SupportedLanguage } from '@al-ummah/shared-types';
import { useCurrentLanguage } from '@/hooks/useLocalizedContent';
import { cn } from '@/lib/utils';

interface LocalizedTextFieldProps {
  /**
   * Field name for form handling
   */
  name: string;

  /**
   * Current localized content
   */
  value?: LocalizedContent;

  /**
   * Callback when content changes
   */
  onChange: (value: LocalizedContent) => void;

  /**
   * Label for the field
   */
  label?: string;

  /**
   * Placeholder text (can be localized)
   */
  placeholder?: LocalizedContent | string;

  /**
   * Whether the field is required
   */
  required?: boolean;

  /**
   * Whether to show as textarea
   */
  multiline?: boolean;

  /**
   * Number of rows for textarea
   */
  rows?: number;

  /**
   * Maximum character length
   */
  maxLength?: number;

  /**
   * Help text to display below the field
   */
  helpText?: string;

  /**
   * Whether the field is disabled
   */
  disabled?: boolean;

  /**
   * Additional CSS classes
   */
  className?: string;

  /**
   * Whether to show language detection
   */
  showLanguageDetection?: boolean;

  /**
   * Whether to show translation completeness
   */
  showCompleteness?: boolean;

  /**
   * Error message to display
   */
  error?: string;

  /**
   * Auto-focus on mount
   */
  autoFocus?: boolean;
}

const languageLabels: Record<SupportedLanguage, { name: string; nativeName: string; dir: 'ltr' | 'rtl' }> = {
  en: { name: 'English', nativeName: 'English', dir: 'ltr' },
  ar: { name: 'Arabic', nativeName: 'العربية', dir: 'rtl' }
};

export function LocalizedTextField({
  name,
  value = {},
  onChange,
  label,
  placeholder,
  required = false,
  multiline = false,
  rows = 4,
  maxLength,
  helpText,
  disabled = false,
  className,
  showLanguageDetection = false,
  showCompleteness = false,
  error,
  autoFocus = false
}: LocalizedTextFieldProps) {
  const currentLang = useCurrentLanguage();
  const [activeTab, setActiveTab] = useState<SupportedLanguage>(currentLang);
  const [detectedLang, setDetectedLang] = useState<SupportedLanguage | null>(null);

  // Update active tab when current language changes
  useEffect(() => {
    setActiveTab(currentLang);
  }, [currentLang]);

  // Handle text change for a specific language
  const handleChange = (lang: SupportedLanguage, text: string) => {
    const newValue = { ...value };

    if (text) {
      newValue[lang] = text;

      // Detect language if enabled
      if (showLanguageDetection && text.length > 10) {
        const detected = LocalizationHelper.detectLanguage(text);
        if (detected !== lang) {
          setDetectedLang(detected);
        } else {
          setDetectedLang(null);
        }
      }
    } else {
      // Remove empty values
      delete newValue[lang];
      setDetectedLang(null);
    }

    onChange(newValue);
  };

  // Get placeholder for current language
  const getPlaceholder = (lang: SupportedLanguage): string => {
    if (!placeholder) return '';

    if (typeof placeholder === 'string') {
      return placeholder;
    }

    return placeholder[lang] || '';
  };

  // Calculate completeness
  const completeness = showCompleteness ? {
    en: value.en ? 100 : 0,
    ar: value.ar ? 100 : 0
  } : null;

  // Check if field has any content
  const hasContent = Boolean(value.en || value.ar);

  // Validation
  const isValid = !required || hasContent;

  const InputComponent = multiline ? 'textarea' : 'input';

  return (
    <div className={cn('space-y-2', className)}>
      {/* Label */}
      {label && (
        <label htmlFor={`${name}-${activeTab}`} className="block text-sm font-medium">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {/* Language Tabs */}
      <div className="border rounded-lg">
        <div className="flex border-b">
          {(Object.keys(languageLabels) as SupportedLanguage[]).map((lang) => {
            const isActive = activeTab === lang;
            const hasValue = Boolean(value[lang]);
            const { name: langName, nativeName } = languageLabels[lang];

            return (
              <button
                key={lang}
                type="button"
                onClick={() => setActiveTab(lang)}
                disabled={disabled}
                className={cn(
                  'flex-1 px-4 py-2 text-sm font-medium transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-offset-2',
                  isActive
                    ? 'bg-primary text-primary-foreground border-b-2 border-primary'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800',
                  disabled && 'cursor-not-allowed opacity-50'
                )}
              >
                <span>{nativeName}</span>
                {hasValue && (
                  <span className="ml-2 text-xs">
                    ✓
                  </span>
                )}
                {showCompleteness && completeness && (
                  <span className="ml-2 text-xs opacity-60">
                    ({completeness[lang]}%)
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Input Field */}
        <div className="p-4">
          {(Object.keys(languageLabels) as SupportedLanguage[]).map((lang) => {
            if (activeTab !== lang) return null;

            const { dir } = languageLabels[lang];
            const currentValue = value[lang] || '';
            const charCount = currentValue.length;

            return (
              <div key={lang} className="space-y-2">
                <div className="relative">
                  <InputComponent
                    id={`${name}-${lang}`}
                    name={`${name}-${lang}`}
                    value={currentValue}
                    onChange={(e) => handleChange(lang, e.target.value)}
                    placeholder={getPlaceholder(lang)}
                    disabled={disabled}
                    maxLength={maxLength}
                    dir={dir}
                    autoFocus={autoFocus && lang === currentLang}
                    className={cn(
                      'w-full px-3 py-2 border rounded-md',
                      'focus:outline-none focus:ring-2 focus:ring-primary',
                      'disabled:bg-gray-100 disabled:cursor-not-allowed',
                      dir === 'rtl' && 'text-right',
                      error && 'border-red-500',
                      multiline && 'resize-vertical'
                    )}
                    {...(multiline && { rows })}
                  />

                  {/* Character count */}
                  {maxLength && (
                    <div
                      className={cn(
                        'absolute bottom-2 text-xs text-gray-500',
                        dir === 'rtl' ? 'left-2' : 'right-2'
                      )}
                    >
                      {charCount}/{maxLength}
                    </div>
                  )}
                </div>

                {/* Language detection warning */}
                {showLanguageDetection && detectedLang && detectedLang !== lang && (
                  <div className="flex items-center gap-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 rounded text-sm">
                    <span className="text-yellow-600 dark:text-yellow-400">⚠</span>
                    <span>
                      This appears to be {languageLabels[detectedLang].name} content.
                      Consider switching to the {languageLabels[detectedLang].name} tab.
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Help text */}
      {helpText && !error && (
        <p className="text-sm text-gray-500">{helpText}</p>
      )}

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {/* Validation message */}
      {required && !hasContent && !error && (
        <p className="text-sm text-gray-500">
          At least one language translation is required
        </p>
      )}
    </div>
  );
}

/**
 * Simplified version for single-language context
 */
export function SimpleLocalizedTextField({
  name,
  value = {},
  onChange,
  lang,
  ...props
}: Omit<LocalizedTextFieldProps, 'showCompleteness' | 'showLanguageDetection'> & {
  lang: SupportedLanguage;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange({
      ...value,
      [lang]: e.target.value
    });
  };

  const InputComponent = props.multiline ? 'textarea' : 'input';
  const { dir } = languageLabels[lang];

  return (
    <div className={cn('space-y-2', props.className)}>
      {props.label && (
        <label htmlFor={name} className="block text-sm font-medium">
          {props.label}
          {props.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <InputComponent
        id={name}
        name={name}
        value={value[lang] || ''}
        onChange={handleChange}
        placeholder={typeof props.placeholder === 'string' ? props.placeholder : props.placeholder?.[lang]}
        disabled={props.disabled}
        maxLength={props.maxLength}
        dir={dir}
        autoFocus={props.autoFocus}
        className={cn(
          'w-full px-3 py-2 border rounded-md',
          'focus:outline-none focus:ring-2 focus:ring-primary',
          'disabled:bg-gray-100 disabled:cursor-not-allowed',
          dir === 'rtl' && 'text-right',
          props.error && 'border-red-500',
          props.multiline && 'resize-vertical'
        )}
        {...(props.multiline && { rows: props.rows || 4 })}
      />

      {props.helpText && !props.error && (
        <p className="text-sm text-gray-500">{props.helpText}</p>
      )}

      {props.error && (
        <p className="text-sm text-red-500">{props.error}</p>
      )}
    </div>
  );
}