/**
 * Locale System Usage Examples
 *
 * This file demonstrates how to use the comprehensive locale management system.
 * These examples can be used as reference when implementing locale-aware features.
 */

'use client';

import { useState } from 'react';
import {
  isRTL,
  getDirection,
  getLocaleConfig,
  getSupportedLocales,
  getSupportedLocaleCodes,
  isLocaleSupported,
  getValidLocale,
  getTextDirection,
  getRTLLocales,
  getLTRLocales,
} from '../utils';
// Locale system example components

/**
 * Example 1: Locale Picker Component
 *
 * Shows all supported locales in a dropdown with their native names
 */
export function LocalePicker({ onChange }: { onChange: (locale: string) => void }) {
  const supportedLocales = getSupportedLocales();

  return (
    <select
      onChange={(e) => onChange(e.target.value)}
      className="px-4 py-2 border rounded-lg"
    >
      {supportedLocales.map((locale) => (
        <option key={locale.code} value={locale.code}>
          {locale.name} ({locale.englishName})
        </option>
      ))}
    </select>
  );
}

/**
 * Example 2: RTL-Aware Text Container
 *
 * Automatically sets text direction based on locale
 */
export function RTLAwareContainer({
  locale,
  children,
}: {
  locale: string;
  children: React.ReactNode;
}) {
  const direction = getTextDirection(locale);

  return (
    <div dir={direction} className={direction === 'rtl' ? 'text-right' : 'text-left'}>
      {children}
    </div>
  );
}

/**
 * Example 3: Locale Information Display
 *
 * Shows detailed information about a locale
 */
export function LocaleInfo({ locale }: { locale: string }) {
  const config = getLocaleConfig(locale);

  if (!config) {
    return <div className="text-red-500">Unknown locale: {locale}</div>;
  }

  return (
    <div className="p-4 border rounded-lg space-y-2">
      <h3 className="font-bold text-lg">{config.name}</h3>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="font-semibold">Code:</dt>
        <dd>{config.code}</dd>

        <dt className="font-semibold">English Name:</dt>
        <dd>{config.englishName}</dd>

        <dt className="font-semibold">Direction:</dt>
        <dd>{config.isRTL ? 'Right-to-Left (RTL)' : 'Left-to-Right (LTR)'}</dd>

        <dt className="font-semibold">Supported:</dt>
        <dd>{config.isSupported ? '✅ Yes' : '❌ No'}</dd>

        <dt className="font-semibold">Complete:</dt>
        <dd>{config.isComplete ? '✅ 100%' : '⚠️ In Progress'}</dd>
      </dl>
    </div>
  );
}

/**
 * Example 4: Locale Validator
 *
 * Validates user input and provides fallback
 */
export function LocaleValidator({ userLocale }: { userLocale: string }) {
  const isSupported = isLocaleSupported(userLocale);
  const validLocale = getValidLocale(userLocale);

  return (
    <div className="p-4 border rounded-lg">
      <p className="mb-2">
        <strong>User Locale:</strong> {userLocale}
      </p>
      <p className="mb-2">
        <strong>Is Supported:</strong>{' '}
        {isSupported ? (
          <span className="text-green-600">✅ Yes</span>
        ) : (
          <span className="text-orange-600">⚠️ No</span>
        )}
      </p>
      <p>
        <strong>Valid Locale:</strong> {validLocale}
        {!isSupported && (
          <span className="text-sm text-gray-600 ml-2">(fallback applied)</span>
        )}
      </p>
    </div>
  );
}

/**
 * Example 5: RTL/LTR Locale Lists
 *
 * Shows separate lists for RTL and LTR locales
 */
export function LocalesByDirection() {
  const rtlLocales = getRTLLocales();
  const ltrLocales = getLTRLocales();

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="p-4 border rounded-lg">
        <h3 className="font-bold mb-2">RTL Locales</h3>
        <ul className="space-y-1">
          {rtlLocales.map((locale) => (
            <li key={locale.code} className="text-sm">
              {locale.name} ({locale.code})
            </li>
          ))}
        </ul>
      </div>

      <div className="p-4 border rounded-lg">
        <h3 className="font-bold mb-2">LTR Locales</h3>
        <ul className="space-y-1">
          {ltrLocales.map((locale) => (
            <li key={locale.code} className="text-sm">
              {locale.name} ({locale.code})
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Example 6: Dynamic Styling Based on Direction
 *
 * Shows how to apply different styles for RTL/LTR
 */
export function DirectionAwareCard({ locale }: { locale: string }) {
  const isRTLLocale = isRTL(locale);

  return (
    <div
      className={`p-4 border rounded-lg ${
        isRTLLocale ? 'border-r-4 border-r-blue-500' : 'border-l-4 border-l-blue-500'
      }`}
    >
      <p className={isRTLLocale ? 'text-right' : 'text-left'}>
        This card adapts to {isRTLLocale ? 'RTL' : 'LTR'} direction
      </p>
    </div>
  );
}

/**
 * Example 7: Complete Locale System Demo
 *
 * Interactive demo of all locale system features
 */
export function LocaleSystemDemo() {
  const [selectedLocale, setSelectedLocale] = useState<string>('en');
  const [customLocale, setCustomLocale] = useState<string>('');

  const supportedCodes = getSupportedLocaleCodes();
  const currentConfig = getLocaleConfig(selectedLocale);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-3xl font-bold mb-6">Locale System Demo</h1>

      {/* Locale Picker */}
      <div className="space-y-2">
        <label className="block font-semibold">Select Locale:</label>
        <LocalePicker onChange={setSelectedLocale} />
      </div>

      {/* Current Locale Info */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold">Current Locale Information</h2>
        <LocaleInfo locale={selectedLocale} />
      </div>

      {/* RTL Aware Container */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold">RTL-Aware Container</h2>
        <RTLAwareContainer locale={selectedLocale}>
          <p className="p-4 bg-gray-100 rounded">
            This text automatically adjusts its direction based on the selected locale.
            {isRTL(selectedLocale) && <span> (RTL mode active)</span>}
            {!isRTL(selectedLocale) && <span> (LTR mode active)</span>}
          </p>
        </RTLAwareContainer>
      </div>

      {/* Direction Aware Card */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold">Direction-Aware Styling</h2>
        <DirectionAwareCard locale={selectedLocale} />
      </div>

      {/* Locale Validator */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold">Locale Validator</h2>
        <input
          type="text"
          value={customLocale}
          onChange={(e) => setCustomLocale(e.target.value)}
          placeholder="Enter locale code (e.g., 'fr', 'es', 'ur')"
          className="w-full px-4 py-2 border rounded-lg mb-2"
        />
        {customLocale && <LocaleValidator userLocale={customLocale} />}
      </div>

      {/* Locales by Direction */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold">Locales by Direction</h2>
        <LocalesByDirection />
      </div>

      {/* System Information */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold">System Information</h2>
        <div className="p-4 border rounded-lg space-y-2 bg-gray-50">
          <p>
            <strong>Supported Locale Codes:</strong> {supportedCodes.join(', ')}
          </p>
          <p>
            <strong>Current Direction:</strong> {getDirection(selectedLocale).toUpperCase()}
          </p>
          <p>
            <strong>Is RTL:</strong> {isRTL(selectedLocale) ? 'Yes' : 'No'}
          </p>
          {currentConfig && (
            <>
              <p>
                <strong>Is Supported:</strong>{' '}
                {currentConfig.isSupported ? 'Yes' : 'No'}
              </p>
              <p>
                <strong>Is Complete:</strong>{' '}
                {currentConfig.isComplete ? 'Yes (100%)' : 'No (In Progress)'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Usage Examples */}
      <div className="space-y-2">
        <h2 className="text-xl font-bold">Code Examples</h2>
        <div className="p-4 border rounded-lg bg-gray-50 font-mono text-sm space-y-2">
          <p className="text-green-700">{'// Check if locale is RTL'}</p>
          <p>const isRTLVal = isRTL(&apos;{selectedLocale}&apos;); {'//'} {String(isRTL(selectedLocale))}</p>

          <p className="text-green-700 mt-4">{'// Get text direction'}</p>
          <p>
            const dir = getTextDirection(&apos;{selectedLocale}&apos;); {'// \''}
            {getTextDirection(selectedLocale)}&apos;
          </p>

          <p className="text-green-700 mt-4">{'// Get locale config'}</p>
          <p>const config = getLocaleConfig(&apos;{selectedLocale}&apos;);</p>

          <p className="text-green-700 mt-4">{'// Validate locale'}</p>
          <p>
            const valid = getValidLocale(&apos;unknown&apos;); {'//'} &apos;{getValidLocale('unknown')}&apos;
            (fallback)
          </p>

          <p className="text-green-700 mt-4">{'// Check support'}</p>
          <p>
            const supported = isLocaleSupported(&apos;{selectedLocale}&apos;); {'//'}{' '}
            {String(isLocaleSupported(selectedLocale))}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Example 8: Using Locale in Next.js Pages
 *
 * Shows how to integrate with Next.js page params
 */
export function NextJSLocaleExample({
  params,
}: {
  params: { locale: string };
}) {
  // Validate the locale from route params
  const validLocale = getValidLocale(params.locale);
  const config = getLocaleConfig(validLocale);

  if (!config) {
    return <div>Invalid locale configuration</div>;
  }

  return (
    <div dir={getTextDirection(validLocale)} className="p-4">
      <h1 className={config.isRTL ? 'text-right' : 'text-left'}>
        {config.name}
      </h1>
      <p className={config.isRTL ? 'text-right' : 'text-left'}>
        Current locale: {validLocale}
      </p>
    </div>
  );
}
