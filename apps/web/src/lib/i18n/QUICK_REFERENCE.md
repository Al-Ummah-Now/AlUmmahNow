# Locale System Quick Reference

## Import

```typescript
import {
  isRTL,
  getLocaleConfig,
  getSupportedLocales,
  getSupportedLocaleCodes,
  isLocaleSupported,
  getValidLocale,
  getTextDirection,
  getRTLLocales,
  getLTRLocales,
} from '@/lib/i18n/utils';
```

## Common Use Cases

### Check if locale is RTL

```typescript
if (isRTL('ar')) {
  // Apply RTL-specific styles
}
```

### Get locale direction for styling

```typescript
const direction = getTextDirection(locale); // 'rtl' | 'ltr'
document.dir = direction;
```

### Build a locale picker

```typescript
const LocalePicker = () => {
  const locales = getSupportedLocales();
  return (
    <select>
      {locales.map((locale) => (
        <option key={locale.code} value={locale.code}>
          {locale.name}
        </option>
      ))}
    </select>
  );
};
```

### Validate user input

```typescript
// User provided locale (e.g., from URL or cookie)
const userLocale = getUserLocale();

// Validate and fallback to 'en' if unsupported
const validLocale = getValidLocale(userLocale);
```

### Check if locale is supported

```typescript
if (isLocaleSupported('fr')) {
  // French is supported
} else {
  // Show error or fallback
}
```

### Get locale information

```typescript
const config = getLocaleConfig('ar');
console.log(config.name);         // 'العربية'
console.log(config.englishName);  // 'Arabic'
console.log(config.isRTL);        // true
console.log(config.isSupported);  // true
console.log(config.isComplete);   // true
```

### Get all RTL or LTR locales

```typescript
const rtlLocales = getRTLLocales();
// [{ code: 'ar', isRTL: true, ... }]

const ltrLocales = getLTRLocales();
// [{ code: 'en', isRTL: false, ... }]
```

## API Reference

| Function | Returns | Use Case |
|----------|---------|----------|
| `isRTL(locale)` | `boolean` | Quick RTL check |
| `getTextDirection(locale)` | `'rtl' \| 'ltr'` | Get direction string |
| `getLocaleConfig(locale)` | `LocaleConfig \| null` | Get full locale info |
| `getSupportedLocales()` | `LocaleConfig[]` | Locale pickers/lists |
| `getSupportedLocaleCodes()` | `string[]` | Simple code arrays |
| `isLocaleSupported(locale)` | `boolean` | Validation checks |
| `getValidLocale(locale)` | `string` | Validate with fallback |
| `getRTLLocales()` | `LocaleConfig[]` | RTL-specific features |
| `getLTRLocales()` | `LocaleConfig[]` | LTR-specific features |

## Adding a New Locale

1. **Update `locales.ts`:**

```typescript
export const LOCALES: LocaleConfig[] = [
  // ... existing locales
  {
    code: 'ur',
    name: 'اردو',
    englishName: 'Urdu',
    isRTL: true,
    isSupported: true,
    isComplete: false,
  },
];

export type SupportedLocale = 'en' | 'ar' | 'ur';
```

2. **Create translation file:** `src/lib/i18n/translations/ur.ts`
3. **Update translations index:** Add to `src/lib/i18n/translations/index.ts`
4. **Create route folder:** `src/app/ur/`

Done! The system handles everything else automatically.

## Full Documentation

- **Complete Guide:** `src/lib/i18n/LOCALE_SYSTEM.md`
- **Implementation Summary:** `LOCALE_SYSTEM_SUMMARY.md`
- **Examples:** `src/lib/i18n/examples/LocaleSystemExample.tsx`
- **Tests:** `src/lib/i18n/__tests__/locale-system.test.ts`
