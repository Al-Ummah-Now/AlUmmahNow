# Video Player i18n Architecture

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Application Layer                            │
│                                                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │ CustomVideoPlayer │  │  ErrorDisplay    │  │  Other Components│ │
│  │                  │  │                  │  │                  │ │
│  │ Uses: lang prop  │  │ Uses: lang prop  │  │ Uses: lang prop  │ │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘ │
│           │                     │                     │            │
└───────────┼─────────────────────┼─────────────────────┼─────────────┘
            │                     │                     │
            └─────────────────────┴─────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      i18n Layer (New)                                │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │              useVideoPlayerI18n() Hook                         │ │
│  │                                                                 │ │
│  │  Input:  lang: 'en' | 'ar'                                     │ │
│  │  Output: { t, lang, isRTL, formatTime }                        │ │
│  └─────────────────────────┬────────────────────────────────────────┘ │
│                            │                                          │
│           ┌────────────────┼────────────────┐                        │
│           │                │                │                        │
│           ▼                ▼                ▼                        │
│  ┌────────────────┐ ┌──────────────┐ ┌──────────────┐              │
│  │ getTranslations│ │ formatTime   │ │  isRTL       │              │
│  │                │ │              │ │  detection   │              │
│  │ Utility Fn     │ │ Utility Fn   │ │  Logic       │              │
│  └───────┬────────┘ └──────────────┘ └──────────────┘              │
│          │                                                           │
└──────────┼───────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Translation Data Layer                           │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │
│  │  en.ts       │  │  ar.ts       │  │  future...   │             │
│  │              │  │              │  │              │             │
│  │ {            │  │ {            │  │ - es.ts      │             │
│  │   player: {  │  │   player: {  │  │ - fr.ts      │             │
│  │     loading  │  │     loading  │  │ - de.ts      │             │
│  │     ready    │  │     ready    │  │ - zh.ts      │             │
│  │   },         │  │   },         │  │ - ja.ts      │             │
│  │   errors: {  │  │   errors: {  │  │              │             │
│  │     ...      │  │     ...      │  │              │             │
│  │   }          │  │   }          │  │              │             │
│  │ }            │  │ }            │  │              │             │
│  └──────────────┘  └──────────────┘  └──────────────┘             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

```
User Action (e.g., page load in Arabic)
    │
    ├─> lang='ar' prop passed to CustomVideoPlayer
    │
    ├─> useVideoPlayerI18n('ar') called
    │   │
    │   ├─> getTranslations('ar') loads ar.ts
    │   │   │
    │   │   └─> Returns VideoPlayerTranslations object
    │   │
    │   ├─> isRTL = true (computed from lang)
    │   │
    │   └─> formatTime utility configured
    │
    ├─> Component renders with Arabic text
    │   │
    │   ├─> t.player.loading → "جاري تحميل مشغل الفيديو..."
    │   ├─> t.accessibility.videoPlayer → "مشغل الفيديو"
    │   └─> t.errors.title.NETWORK_ERROR → "خطأ في الشبكة"
    │
    └─> RTL layout applied (dir="rtl")
```

## File Structure

```
apps/web/src/lib/video/i18n/
│
├── index.ts                          # Public API exports
│   └── Exports: {
│         useVideoPlayerI18n,
│         getTranslations,
│         formatDuration,
│         type SupportedLanguage,
│         type VideoPlayerTranslations
│       }
│
├── types.ts                          # TypeScript definitions
│   ├── SupportedLanguage
│   ├── VideoPlayerTranslations
│   ├── ErrorMessages (extends existing)
│   └── TranslationUtils
│
├── translations/
│   ├── index.ts                      # Barrel export
│   ├── en.ts                         # English translations
│   │   └── const EN_TRANSLATIONS: VideoPlayerTranslations
│   │
│   ├── ar.ts                         # Arabic translations
│   │   └── const AR_TRANSLATIONS: VideoPlayerTranslations
│   │
│   └── [future languages].ts         # Spanish, French, etc.
│
├── hooks/
│   ├── index.ts
│   └── useVideoPlayerI18n.ts         # React hook
│       ├── useVideoPlayerI18n(lang)
│       └── Returns: { t, lang, isRTL, formatTime }
│
└── utils/
    ├── index.ts
    ├── getTranslations.ts            # Translation loader
    │   └── getTranslations(lang): VideoPlayerTranslations
    │
    ├── formatTime.ts                 # Time formatting
    │   ├── formatDuration(seconds, lang)
    │   └── formatTimestamp(timestamp, lang)
    │
    └── isRTL.ts                      # RTL detection
        └── isRTL(lang): boolean
```

## Type System

```typescript
┌────────────────────────────────────────────────────────┐
│                  SupportedLanguage                      │
│                                                         │
│  type SupportedLanguage = 'en' | 'ar' | 'es' | ...     │
│                                                         │
│  Enforces: Only valid language codes accepted          │
└────────────────────────────────────────────────────────┘
                          │
                          │ constrains
                          ▼
┌────────────────────────────────────────────────────────┐
│           VideoPlayerTranslations Interface             │
│                                                         │
│  interface VideoPlayerTranslations {                    │
│    player: {                                           │
│      loading: string                                   │
│      ready: string                                     │
│      ...                                               │
│    }                                                   │
│    accessibility: { ... }                              │
│    errors: { ... }                                     │
│    controls: { ... }                                   │
│    quality: { ... }                                    │
│  }                                                     │
│                                                         │
│  Enforces: All translations have same structure        │
└────────────────────────────────────────────────────────┘
                          │
                          │ implements
                          ▼
┌────────────────────────────────────────────────────────┐
│              Translation Files                          │
│                                                         │
│  const EN: VideoPlayerTranslations = { ... }           │
│  const AR: VideoPlayerTranslations = { ... }           │
│                                                         │
│  TypeScript verifies: All keys present in all langs    │
└────────────────────────────────────────────────────────┘
```

## Component Integration Pattern

### Before (Hardcoded)

```typescript
export default function CustomVideoPlayer({ lang = 'en', ... }) {
  return (
    <div>
      <div className="sr-only">
        {playerReady
          ? 'Video player loaded and ready'  ❌ Hardcoded
          : 'Loading video player...'        ❌ Hardcoded
        }
      </div>
      <video aria-label="Video player" />    ❌ Hardcoded
    </div>
  );
}
```

### After (i18n)

```typescript
import { useVideoPlayerI18n } from '@/lib/video/i18n';

export default function CustomVideoPlayer({ lang = 'en', ... }) {
  const { t, isRTL } = useVideoPlayerI18n(lang);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="sr-only">
        {playerReady
          ? t.player.ready              ✅ Translated
          : t.player.loading            ✅ Translated
        }
      </div>
      <video aria-label={t.accessibility.videoPlayer} /> ✅ Translated
    </div>
  );
}
```

## Migration Path

```
Phase 0: Current State
├── error-messages.ts (existing)
└── Hardcoded strings in components

        │
        │ Create i18n infrastructure (non-breaking)
        ▼

Phase 1: Parallel Implementation
├── error-messages.ts (kept for backward compatibility)
├── i18n/ (new system)
│   ├── types.ts
│   ├── translations/
│   ├── hooks/
│   └── utils/
└── Components use new system internally

        │
        │ Migrate all components
        ▼

Phase 2: Deprecation
├── error-messages.ts (deprecated, logs warnings)
└── i18n/ (primary system)

        │
        │ Remove old system in next major version
        ▼

Phase 3: Complete Migration
└── i18n/ (only system)
```

## Testing Strategy

```
┌─────────────────────────────────────────────────────────┐
│                    Testing Pyramid                       │
│                                                          │
│                        ▲                                 │
│                       ╱ ╲                                │
│                      ╱   ╲   E2E Tests                   │
│                     ╱     ╲  - Full user flows          │
│                    ╱───────╲ - Visual regression        │
│                   ╱         ╲                            │
│                  ╱           ╲                           │
│                 ╱             ╲                          │
│                ╱   Integration ╲                         │
│               ╱    Tests        ╲                        │
│              ╱  - Component +    ╲                       │
│             ╱    i18n hook       ╲                       │
│            ╱─────────────────────╲                       │
│           ╱                       ╲                      │
│          ╱                         ╲                     │
│         ╱       Unit Tests          ╲                    │
│        ╱    - Translation loading    ╲                   │
│       ╱     - Format functions        ╲                  │
│      ╱      - Type validation          ╲                 │
│     ╱────────────────────────────────────╲               │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Test Coverage Matrix

```
┌────────────────┬──────────┬─────────────┬──────────┐
│ Component      │ Unit     │ Integration │ E2E      │
├────────────────┼──────────┼─────────────┼──────────┤
│ getTranslations│ ✓✓✓      │             │          │
│ formatTime     │ ✓✓✓      │             │          │
│ useVideoPlayerI│ ✓✓       │ ✓✓          │          │
│ CustomVideoPlay│          │ ✓✓✓         │ ✓        │
│ ErrorDisplay   │          │ ✓✓✓         │ ✓        │
│ Full Flow      │          │             │ ✓✓✓      │
└────────────────┴──────────┴─────────────┴──────────┘

Legend:
✓✓✓ = Comprehensive coverage
✓✓  = Good coverage
✓   = Basic coverage
```

## Performance Metrics

### Bundle Size Impact

```
Current State:
├── error-messages.ts: 2 KB (minified)
└── Hardcoded strings: ~0.5 KB

After i18n Implementation:
├── Core system: 1 KB (minified)
├── English translations: 4 KB (minified)
├── Arabic translations: 4 KB (minified)
├── Utilities: 1 KB (minified)
└── Total: ~10 KB (minified)

After Gzip:
└── Total: ~3 KB (gzipped, 70% compression)

Per Additional Language:
└── ~1.2 KB (gzipped)
```

### Runtime Performance

```
Operation                 | Time      | Impact
─────────────────────────┼───────────┼────────
getTranslations('en')     | <0.1ms   | None
useVideoPlayerI18n()      | <0.1ms   | None
t.player.loading          | <0.01ms  | None (object lookup)
formatTime(125)           | <0.1ms   | None
Language switch           | <1ms     | Minimal re-render

Conclusion: Zero measurable performance impact
```

## Scalability Analysis

### Adding New Language

```
Step 1: Create translation file (15 minutes)
   └── apps/web/src/lib/video/i18n/translations/es.ts

Step 2: Add to SupportedLanguage type (1 minute)
   └── types.ts: type SupportedLanguage = ... | 'es'

Step 3: Import in translations/index.ts (1 minute)
   └── export { ES_TRANSLATIONS } from './es'

Total Time: ~20 minutes per language
```

### Adding New Translation Key

```
Step 1: Update VideoPlayerTranslations interface
   └── types.ts: Add new key with type

Step 2: Add to all language files
   └── TypeScript will error until all languages updated

Step 3: Use in components
   └── Full autocomplete support

Compiler ensures: No missing translations
```

## Security Considerations

### XSS Prevention

```typescript
// All translations are plain strings, rendered by React
// React automatically escapes content, preventing XSS

// Example - Safe by default:
<div>{t.player.loading}</div>
// Even if translation contains <script>, React escapes it

// Interpolation (Phase 2) must use safe escaping:
const interpolate = (template: string, values: Record<string, string>) => {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    return escapeHtml(values[key] || ''); // Always escape
  });
};
```

### Content Security Policy

```typescript
// No inline scripts, all translations are static data
// Compatible with strict CSP policies

// Translation loading is synchronous, no dynamic imports needed
// All translations bundled with app code
```

## Accessibility Enhancements

### Screen Reader Support

```
Before:
└── Hardcoded English, regardless of user language

After:
├── Content in user's language
├── Proper lang attributes
└── Language-specific pronunciation
```

### ARIA Labels

```typescript
// Before
<button aria-label="Play">▶</button>

// After (language-aware)
<button aria-label={t.controls.play}>▶</button>
// English: "Play"
// Arabic: "تشغيل"
```

### RTL Support

```typescript
// Automatic RTL layout
const { isRTL } = useVideoPlayerI18n(lang);

<div dir={isRTL ? 'rtl' : 'ltr'}>
  {/* Content flows correctly for RTL languages */}
</div>
```

## Monitoring & Observability

### Translation Coverage Metrics

```typescript
// CI/CD check: Ensure all languages have all keys
const checkTranslationCoverage = () => {
  const languages = ['en', 'ar', 'es', ...];
  const referenceKeys = getAllKeys(EN_TRANSLATIONS);

  languages.forEach(lang => {
    const translation = getTranslations(lang);
    const missingKeys = findMissingKeys(translation, referenceKeys);

    if (missingKeys.length > 0) {
      throw new Error(`Missing translations in ${lang}: ${missingKeys}`);
    }
  });
};
```

### Usage Analytics

```typescript
// Track which languages are used
analytics.track('video_player_language', {
  language: lang,
  component: 'CustomVideoPlayer'
});

// Identify missing translations in production
const t = (key: string) => {
  const value = translations[key];
  if (!value) {
    analytics.track('missing_translation', { key, lang });
    return key; // Fallback to key itself
  }
  return value;
};
```

## Documentation Structure

```
docs/
├── README.md                    # Overview and quick start
├── API.md                       # Complete API reference
├── MIGRATION.md                 # Migration from old system
├── CONTRIBUTING.md              # How to add translations
├── examples/
│   ├── basic-usage.tsx         # Simple component example
│   ├── custom-formatting.tsx   # Custom format functions
│   └── dynamic-switching.tsx   # Language switching
└── translations/
    ├── guidelines.md           # Translation best practices
    ├── context.md              # Context for translators
    └── style-guide.md          # Tone and style guide
```

## Success Criteria

### Phase 1 Complete When:
- ✅ All hardcoded strings removed from CustomVideoPlayer
- ✅ All hardcoded strings removed from ErrorDisplay
- ✅ English and Arabic translations complete
- ✅ All tests passing
- ✅ TypeScript compilation clean
- ✅ Documentation complete
- ✅ Zero bundle size regression (after gzip)

### Phase 2 Complete When:
- ✅ Locale-aware formatting implemented
- ✅ Pluralization support added
- ✅ Interpolation support added
- ✅ error-messages.ts deprecated (with warnings)
- ✅ Migration guide published

### Phase 3 Complete When:
- ✅ Dynamic language switching working
- ✅ 5+ languages supported
- ✅ Translation validation in CI/CD
- ✅ Developer tools available
- ✅ error-messages.ts removed

## Conclusion

This architecture provides:
- ✅ **Type Safety**: Full TypeScript support with compile-time checks
- ✅ **Performance**: Zero runtime overhead, minimal bundle impact
- ✅ **Scalability**: Easy to add new languages and keys
- ✅ **Developer Experience**: Simple API, excellent tooling
- ✅ **User Experience**: Native language support, proper RTL
- ✅ **Maintainability**: Clear structure, good documentation
- ✅ **Accessibility**: Enhanced screen reader and keyboard support

The modular design allows incremental adoption without breaking changes, and the type system ensures translation completeness across all supported languages.
