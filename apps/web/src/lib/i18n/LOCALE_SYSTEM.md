# Locale Management System

## Overview

The Al Ummah Now web app uses a comprehensive locale management system that provides:

- **Centralized configuration** - All locale data in one place (`locales.ts`)
- **RTL detection** - Automatic right-to-left text direction detection
- **Scalability** - Easy to add new locales
- **Type safety** - Full TypeScript support
- **Backward compatibility** - Works with existing i18n system

## Architecture

```
src/lib/i18n/
├── locales.ts              # Locale configuration (SINGLE SOURCE OF TRUTH)
├── types.ts                # TypeScript types
└── utils/
    ├── isRTL.ts            # RTL detection (uses locales.ts)
    ├── localeHelpers.ts    # Utility functions (uses locales.ts)
    └── index.ts            # Exports all utilities
```

## Quick Start

### 1. Import the utilities you need

```typescript
import {
  isRTL,
  getDirection,
  getLocaleConfig,
  getSupportedLocales,
  isLocaleSupported,
  getValidLocale,
  getTextDirection,
} from '@/lib/i18n/utils';
```

### 2. Use in your components

```typescript
// Check if locale is RTL
const isArabic = isRTL('ar'); // true
const isEnglish = isRTL('en'); // false

// Get text direction
const direction = getDirection('ar'); // 'rtl'
const direction = getTextDirection('en'); // 'ltr'

// Get locale configuration
const arConfig = getLocaleConfig('ar');
// {
//   code: 'ar',
//   name: 'العربية',
//   englishName: 'Arabic',
//   isRTL: true,
//   isSupported: true,
//   isComplete: true
// }

// Check if locale is supported
if (isLocaleSupported('fr')) {
  // French is supported
} else {
  // Fall back to default
}

// Get valid locale (with fallback)
const locale = getValidLocale('fr'); // 'en' (falls back to default)
const locale = getValidLocale('ar'); // 'ar' (valid)

// Get all supported locales
const supported = getSupportedLocales();
// [
//   { code: 'en', name: 'English', ... },
//   { code: 'ar', name: 'العربية', ... }
// ]
```

## API Reference

### Core Configuration

#### `LOCALES: LocaleConfig[]`

Array of all locale configurations. **This is the single source of truth** for all locale data.

```typescript
export interface LocaleConfig {
  code: string;           // Locale code (e.g., 'en', 'ar', 'fr')
  name: string;           // Display name in locale's language
  englishName: string;    // Display name in English
  isRTL: boolean;         // Right-to-left text direction
  isSupported: boolean;   // Currently supported/enabled
  isComplete?: boolean;   // Translations are 100% complete
}
```

#### `DEFAULT_LOCALE: string`

Default locale when none is specified or unsupported locale is requested. Currently `'en'`.

#### `SupportedLocale: type`

TypeScript type for supported locales. Currently `'en' | 'ar'`.

### Utility Functions

#### `getLocaleConfig(locale: string): LocaleConfig | null`

Get the full configuration for a specific locale.

```typescript
const config = getLocaleConfig('ar');
console.log(config?.name); // 'العربية'
console.log(config?.isRTL); // true
```

#### `getSupportedLocales(): LocaleConfig[]`

Get all supported locales (where `isSupported = true`).

```typescript
const supported = getSupportedLocales();
supported.forEach((locale) => {
  console.log(locale.code, locale.name);
});
```

#### `getSupportedLocaleCodes(): string[]`

Get array of supported locale codes.

```typescript
const codes = getSupportedLocaleCodes(); // ['en', 'ar']
```

#### `isLocaleSupported(locale: string): boolean`

Check if a locale is supported.

```typescript
if (isLocaleSupported('ar')) {
  // Arabic is supported
}
```

#### `getValidLocale(locale: string): string`

Get a valid locale, falling back to default if unsupported.

```typescript
const locale = getValidLocale(userLocale);
// Always returns a valid, supported locale
```

#### `getTextDirection(locale: string): 'rtl' | 'ltr'`

Get text direction for a locale.

```typescript
const dir = getTextDirection('ar'); // 'rtl'
const dir = getTextDirection('en'); // 'ltr'
```

#### `getRTLLocales(): LocaleConfig[]`

Get all RTL locales.

```typescript
const rtl = getRTLLocales();
// [{ code: 'ar', isRTL: true, ... }]
```

#### `getLTRLocales(): LocaleConfig[]`

Get all LTR locales.

```typescript
const ltr = getLTRLocales();
// [{ code: 'en', isRTL: false, ... }]
```

#### `isRTL(locale: string): boolean`

Check if a locale uses RTL text direction.

```typescript
if (isRTL('ar')) {
  // Apply RTL styles
}
```

#### `getDirection(locale: string): 'rtl' | 'ltr'`

Get direction string for a locale (alias for `getTextDirection`).

```typescript
const direction = getDirection('ar'); // 'rtl'
```

## Adding a New Locale

To add a new locale (e.g., Urdu), follow these steps:

### 1. Update `locales.ts`

Add the new locale to the `LOCALES` array:

```typescript
export const LOCALES: LocaleConfig[] = [
  {
    code: 'en',
    name: 'English',
    englishName: 'English',
    isRTL: false,
    isSupported: true,
    isComplete: true,
  },
  {
    code: 'ar',
    name: 'العربية',
    englishName: 'Arabic',
    isRTL: true,
    isSupported: true,
    isComplete: true,
  },
  // New locale
  {
    code: 'ur',
    name: 'اردو',
    englishName: 'Urdu',
    isRTL: true,
    isSupported: true,  // Set to false until translations ready
    isComplete: false,   // Set to true when translations complete
  },
];
```

### 2. Update `SupportedLocale` type

```typescript
export type SupportedLocale = 'en' | 'ar' | 'ur';
```

### 3. Create translation file

Create `src/lib/i18n/translations/ur.ts` with all translations.

### 4. Update translation index

Add to `src/lib/i18n/translations/index.ts`:

```typescript
export { default as ur } from './ur';
```

### 5. Update routing

Add route folder: `src/app/ur/`

That's it! The locale system will automatically:
- ✅ Detect RTL for Urdu
- ✅ Include it in `getSupportedLocales()` (if `isSupported: true`)
- ✅ Validate it with `isLocaleSupported()`
- ✅ Provide all utilities for the new locale

## Migration from Old System

The new system is **backward compatible** with the existing i18n system:

### Old Code (still works)

```typescript
import { isRTL } from '@/lib/i18n/utils';

const rtl = isRTL('ar'); // Still works!
```

### New Code (recommended)

```typescript
import {
  isRTL,
  getLocaleConfig,
  getSupportedLocales,
} from '@/lib/i18n/utils';

const rtl = isRTL('ar');
const config = getLocaleConfig('ar');
const supported = getSupportedLocales();
```

## Benefits

### Before (Hardcoded)

```typescript
// Scattered RTL checks
const isRTL = locale === 'ar';

// No centralized config
const supported = ['en', 'ar'];

// Manual validation
const valid = locale === 'en' || locale === 'ar' ? locale : 'en';
```

### After (Centralized)

```typescript
// Single source of truth
import { isRTL, getSupportedLocales, getValidLocale } from '@/lib/i18n/utils';

const rtl = isRTL(locale);
const supported = getSupportedLocales();
const valid = getValidLocale(locale);
```

## Best Practices

1. **Use `getValidLocale()`** for user input validation
   ```typescript
   const userLocale = getValidLocale(request.locale);
   ```

2. **Use `isLocaleSupported()`** before rendering locale-specific UI
   ```typescript
   if (isLocaleSupported(locale)) {
     renderLocaleSelector(locale);
   }
   ```

3. **Use `getSupportedLocales()`** for locale pickers
   ```typescript
   const LocalePicker = () => (
     <select>
       {getSupportedLocales().map((locale) => (
         <option key={locale.code} value={locale.code}>
           {locale.name}
         </option>
       ))}
     </select>
   );
   ```

4. **Use `getTextDirection()`** for dynamic styling
   ```typescript
   const direction = getTextDirection(locale);
   document.dir = direction;
   ```

## Testing

The locale system includes comprehensive tests. Run them with:

```bash
pnpm --filter @al-ummah/web test src/lib/i18n/__tests__/locale-system.test.ts
```

## TypeScript Integration

The system is fully typed:

```typescript
import type { LocaleConfig, SupportedLocale } from '@/lib/i18n/locales';

// Type-safe locale code
const locale: SupportedLocale = 'en'; // ✅
const invalid: SupportedLocale = 'fr'; // ❌ TypeScript error

// Type-safe locale config
const config: LocaleConfig = {
  code: 'ur',
  name: 'اردو',
  englishName: 'Urdu',
  isRTL: true,
  isSupported: true,
  isComplete: false,
};
```

## Performance

All locale utilities are **O(1)** or **O(n)** where n is the number of locales (currently 2):

- `getLocaleConfig()`: O(n) - finds in array
- `isLocaleSupported()`: O(n) - finds in array
- `getSupportedLocales()`: O(n) - filters array
- `isRTL()`: O(n) - finds in array
- All other utilities: O(1) or O(n)

With only 2-10 locales, performance is negligible.

## Future Enhancements

Potential future improvements:

1. **Locale fallback chains** - `ur` → `ar` → `en`
2. **Regional variants** - `en-US`, `en-GB`, `ar-SA`, `ar-EG`
3. **Pluralization rules** - Locale-specific plural forms
4. **Number formatting** - Locale-specific number/date formats
5. **Lazy loading** - Load translations on demand
6. **Translation coverage** - Track completion percentage

## Support

For questions or issues with the locale system:

1. Check this documentation
2. Review the tests in `__tests__/locale-system.test.ts`
3. Examine `locales.ts` for current configuration
4. Create an issue on GitHub
