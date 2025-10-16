# Video Player Internationalization (i18n) Design

## Overview

Design for implementing comprehensive internationalization support for the CustomVideoPlayer component, eliminating all hardcoded strings and supporting extensible multilingual content.

## Current State Analysis

### Hardcoded Strings (to be removed)

**CustomVideoPlayer.tsx (lines 319-320)**:
- `'Video player loaded and ready'`
- `'Loading video player...'`

**ErrorDisplay.tsx (line 166)**:
- `'Error Details'` / `'تفاصيل الخطأ'`

**ErrorDisplay.tsx (lines 177, 184, 192, 200)**:
- `'Type:'` / `'النوع:'`
- `'Message:'` / `'الرسالة:'`
- `'Code:'` / `'الكود:'`
- `'Time:'` / `'الوقت:'`

**Default Props**:
- `ariaLabel = 'Video player'` (line 69)

### Existing i18n Infrastructure

✅ **Already implemented**:
- `error-messages.ts` - Bilingual error messages
- `getErrorMessage()` function for error type lookup
- `lang` prop support (`'en'` | `'ar'`)
- RTL/LTR layout handling

❌ **Not implemented**:
- UI labels internationalization
- Accessibility strings i18n
- Player status messages
- Extensible translation system

## Design Goals

1. **Zero Hardcoded Strings**: All user-facing text must be translatable
2. **Type Safety**: Full TypeScript support for translation keys
3. **Extensibility**: Easy to add new languages
4. **Performance**: No runtime overhead, tree-shakeable
5. **Developer Experience**: Simple API, autocomplete support
6. **Backward Compatibility**: Existing components continue to work

## Architecture

### 1. Translation Structure

```typescript
// File: apps/web/src/lib/video/i18n/types.ts

export type SupportedLanguage = 'en' | 'ar' | 'es' | 'fr' | 'de' | 'zh' | 'ja';

export interface VideoPlayerTranslations {
  // Player status
  player: {
    loading: string;
    ready: string;
    buffering: string;
    error: string;
  };

  // Accessibility
  accessibility: {
    videoPlayer: string;
    playButton: string;
    pauseButton: string;
    muteButton: string;
    unmuteButton: string;
    fullscreenButton: string;
    exitFullscreenButton: string;
    volumeSlider: string;
    progressBar: string;
    seekSlider: string;
  };

  // Error handling
  errors: {
    title: Record<VideoErrorType, string>;
    description: Record<VideoErrorType, string>;
    retryButton: string;
    fallbackButton: Record<VideoErrorType, string>;
    details: Record<VideoErrorType, string>;

    // Error detail labels
    detailLabels: {
      type: string;
      message: string;
      code: string;
      time: string;
      severity: string;
      detailsTitle: string;
    };
  };

  // Controls
  controls: {
    play: string;
    pause: string;
    mute: string;
    unmute: string;
    fullscreen: string;
    exitFullscreen: string;
    settings: string;
    captions: string;
    quality: string;
    speed: string;
    volume: string;
  };

  // Quality settings
  quality: {
    auto: string;
    high: string;
    medium: string;
    low: string;
    labels: {
      '2160p': string;
      '1080p': string;
      '720p': string;
      '480p': string;
      '360p': string;
      '240p': string;
    };
  };

  // Speed settings
  speed: {
    normal: string;
    labels: {
      '0.25': string;
      '0.5': string;
      '0.75': string;
      '1': string;
      '1.25': string;
      '1.5': string;
      '1.75': string;
      '2': string;
    };
  };

  // Time formatting
  time: {
    hours: string;
    minutes: string;
    seconds: string;
    live: string;
    elapsed: string;
    remaining: string;
  };
}
```

### 2. Translation Files Structure

```
apps/web/src/lib/video/i18n/
├── types.ts                 # TypeScript types
├── index.ts                 # Main exports
├── translations/
│   ├── en.ts               # English translations
│   ├── ar.ts               # Arabic translations
│   ├── es.ts               # Spanish translations (future)
│   ├── fr.ts               # French translations (future)
│   └── index.ts            # Barrel export
├── hooks/
│   ├── useVideoPlayerI18n.ts   # React hook
│   └── index.ts
└── utils/
    ├── getTranslations.ts      # Translation getter
    ├── formatTime.ts           # Localized time formatting
    └── index.ts
```

### 3. Implementation Strategy

#### Phase 1: Core Infrastructure (Priority: HIGH)

**Files to create**:
1. `apps/web/src/lib/video/i18n/types.ts` - Type definitions
2. `apps/web/src/lib/video/i18n/translations/en.ts` - English translations
3. `apps/web/src/lib/video/i18n/translations/ar.ts` - Arabic translations
4. `apps/web/src/lib/video/i18n/utils/getTranslations.ts` - Translation getter
5. `apps/web/src/lib/video/i18n/hooks/useVideoPlayerI18n.ts` - React hook
6. `apps/web/src/lib/video/i18n/index.ts` - Main exports

**Files to update**:
1. `CustomVideoPlayer.tsx` - Use i18n hook
2. `ErrorDisplay.tsx` - Use i18n for labels
3. `error-messages.ts` - Migrate to new i18n system (backward compatible)

#### Phase 2: Enhanced Features (Priority: MEDIUM)

1. **Locale-aware formatting**:
   - Date/time formatting using `Intl.DateTimeFormat`
   - Number formatting for file sizes, durations
   - Relative time formatting ("2 minutes ago")

2. **Pluralization support**:
   ```typescript
   interface PluralRules {
     zero?: string;
     one: string;
     two?: string;
     few?: string;
     many?: string;
     other: string;
   }
   ```

3. **Interpolation support**:
   ```typescript
   t('player.currentTime', { time: '1:23' })
   // => "Current time: 1:23"
   ```

#### Phase 3: Advanced Features (Priority: LOW)

1. **Dynamic language switching** without page reload
2. **Missing translation fallback** chain (ar → en → default)
3. **Translation validation** in CI/CD
4. **Developer tools** for finding untranslated strings
5. **Context-aware translations** (formal vs. informal)

## API Design

### Hook-based API (Recommended)

```typescript
// Usage in CustomVideoPlayer
import { useVideoPlayerI18n } from '@/lib/video/i18n';

export default function CustomVideoPlayer(props) {
  const { t, lang, isRTL } = useVideoPlayerI18n(props.lang);

  return (
    <div>
      <div className="sr-only">
        {playerReady ? t('player.ready') : t('player.loading')}
      </div>
      <video aria-label={t('accessibility.videoPlayer')} />
    </div>
  );
}
```

### Function-based API (Alternative)

```typescript
// Usage without React hooks
import { getTranslations } from '@/lib/video/i18n';

const translations = getTranslations('ar');
console.log(translations.player.loading); // "جاري التحميل..."
```

### Utility Functions

```typescript
// Format time in localized format
import { formatDuration } from '@/lib/video/i18n/utils';

formatDuration(125, 'en'); // => "2:05"
formatDuration(125, 'ar'); // => "٢:٠٥" (Arabic numerals)

// Format file size
import { formatBytes } from '@/lib/video/i18n/utils';

formatBytes(1024 * 1024, 'en'); // => "1 MB"
formatBytes(1024 * 1024, 'ar'); // => "١ ميجابايت"
```

## Migration Strategy

### Step 1: Create i18n Infrastructure (Non-breaking)

✅ Create new i18n files alongside existing code
✅ Existing code continues to work
✅ No changes to public APIs

### Step 2: Update Components (Backward compatible)

✅ Add i18n to CustomVideoPlayer (default values unchanged)
✅ Add i18n to ErrorDisplay (fallback to existing error-messages.ts)
✅ All tests continue to pass

### Step 3: Deprecate Old System (Gradual)

1. Add deprecation warnings to `error-messages.ts`
2. Update documentation
3. Provide migration guide
4. Remove old code in major version bump

## TypeScript Integration

### Strict Type Checking

```typescript
// Auto-completion for translation keys
const text = t('player.loading'); // ✅ Valid
const invalid = t('player.notExist'); // ❌ TypeScript error

// Type-safe language codes
const lang: SupportedLanguage = 'en'; // ✅ Valid
const badLang: SupportedLanguage = 'xx'; // ❌ TypeScript error
```

### Translation Validation

```typescript
// Ensure all translations have the same keys
type TranslationKeys = keyof VideoPlayerTranslations;

// Compile-time check that Arabic has all English keys
const ar: VideoPlayerTranslations = { ... };
```

## Testing Strategy

### Unit Tests

```typescript
// tests/i18n.test.ts
describe('Video Player i18n', () => {
  it('should return English translations by default', () => {
    const t = getTranslations('en');
    expect(t.player.loading).toBe('Loading video player...');
  });

  it('should return Arabic translations for ar', () => {
    const t = getTranslations('ar');
    expect(t.player.loading).toBe('جاري تحميل مشغل الفيديو...');
  });

  it('should handle RTL for Arabic', () => {
    const { isRTL } = useVideoPlayerI18n('ar');
    expect(isRTL).toBe(true);
  });

  it('should format time in correct locale', () => {
    expect(formatDuration(125, 'en')).toBe('2:05');
    expect(formatDuration(125, 'ar')).toMatch(/٢:٠٥|2:05/);
  });
});
```

### Integration Tests

```typescript
// tests/CustomVideoPlayer.i18n.test.tsx
it('should display loading message in Arabic', () => {
  render(<CustomVideoPlayer lang="ar" {...props} />);
  expect(screen.getByText('جاري تحميل مشغل الفيديو...')).toBeInTheDocument();
});

it('should display error messages in correct language', () => {
  render(<CustomVideoPlayer lang="ar" {...props} />);
  // Trigger error
  expect(screen.getByText(/خطأ/)).toBeInTheDocument();
});
```

## Performance Considerations

### Bundle Size

- **Tree-shaking**: Only import used translations
- **Code splitting**: Lazy load translations per language
- **Compression**: Translations are highly compressible (gzip/brotli)

### Runtime Performance

- **No overhead**: Pure object lookups, O(1) complexity
- **Memoization**: Translation objects are immutable, can be memoized
- **No re-renders**: Language changes don't trigger unnecessary renders

### Estimated Impact

```
Current bundle (error-messages.ts):    ~2 KB (minified)
New i18n system (en + ar):             ~8 KB (minified)
Additional per language:               ~4 KB (minified)

Gzip compression ratio:                ~70% reduction
Final impact per language:             ~1.2 KB (gzipped)
```

## Accessibility Improvements

### Screen Reader Support

```typescript
// All controls have localized aria-labels
<button aria-label={t('accessibility.playButton')}>
  <PlayIcon />
</button>

// Status announcements in correct language
<div role="status" aria-live="polite">
  {t('player.buffering')}
</div>
```

### Keyboard Navigation

```typescript
// Keyboard shortcuts are locale-aware
// English: 'p' for play, 'm' for mute
// Other locales: Mapped to first letter in that language
const shortcuts = getKeyboardShortcuts(lang);
```

## Documentation Requirements

### For Developers

1. **Integration Guide**: How to add i18n to new components
2. **Translation Guide**: How to add new languages
3. **API Reference**: Complete TypeScript API documentation
4. **Migration Guide**: Moving from old error-messages.ts

### For Translators

1. **Translation File Format**: Structure and conventions
2. **Context Guidelines**: When to use formal vs. informal
3. **Character Limits**: UI space constraints
4. **Testing Checklist**: Verify translations in context

## Implementation Checklist

### Phase 1: Core (Week 1)

- [ ] Create type definitions (`types.ts`)
- [ ] Create English translations (`en.ts`)
- [ ] Create Arabic translations (`ar.ts`)
- [ ] Create translation getter (`getTranslations.ts`)
- [ ] Create React hook (`useVideoPlayerI18n.ts`)
- [ ] Update CustomVideoPlayer to use i18n
- [ ] Update ErrorDisplay to use i18n
- [ ] Write unit tests for i18n system
- [ ] Update integration tests
- [ ] Document API usage

### Phase 2: Enhanced (Week 2)

- [ ] Add locale-aware date/time formatting
- [ ] Add number formatting utilities
- [ ] Add relative time formatting
- [ ] Add pluralization support
- [ ] Add interpolation support
- [ ] Migrate error-messages.ts to new system
- [ ] Add backward compatibility layer
- [ ] Update all documentation

### Phase 3: Advanced (Future)

- [ ] Add dynamic language switching
- [ ] Add missing translation fallback
- [ ] Add translation validation in CI/CD
- [ ] Add developer tools for finding untranslated strings
- [ ] Add context-aware translations
- [ ] Add support for additional languages (es, fr, de, zh, ja)

## Example Code Snippets

### Complete Implementation Example

```typescript
// apps/web/src/lib/video/i18n/hooks/useVideoPlayerI18n.ts
import { useMemo } from 'react';
import { getTranslations } from '../utils/getTranslations';
import type { SupportedLanguage, VideoPlayerTranslations } from '../types';

export interface UseVideoPlayerI18nResult {
  t: VideoPlayerTranslations;
  lang: SupportedLanguage;
  isRTL: boolean;
  formatTime: (seconds: number) => string;
}

export function useVideoPlayerI18n(
  lang: SupportedLanguage = 'en'
): UseVideoPlayerI18nResult {
  const translations = useMemo(() => getTranslations(lang), [lang]);
  const isRTL = lang === 'ar';

  const formatTime = useMemo(() => {
    return (seconds: number) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = Math.floor(seconds % 60);

      if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      }
      return `${m}:${s.toString().padStart(2, '0')}`;
    };
  }, []);

  return {
    t: translations,
    lang,
    isRTL,
    formatTime,
  };
}
```

### Usage in Component

```typescript
// Before (hardcoded)
<div className="sr-only">
  {playerReady
    ? 'Video player loaded and ready'
    : 'Loading video player...'}
</div>

// After (i18n)
<div className="sr-only">
  {playerReady ? t.player.ready : t.player.loading}
</div>
```

## Benefits Summary

### For Developers
- ✅ Type-safe translation keys
- ✅ Auto-completion in IDEs
- ✅ Easy to add new languages
- ✅ Consistent API across components
- ✅ Better code organization

### For Users
- ✅ Content in their native language
- ✅ Proper RTL support
- ✅ Localized formats (dates, numbers)
- ✅ Better accessibility
- ✅ Improved user experience

### For Business
- ✅ Easier to enter new markets
- ✅ Reduced translation costs (structured data)
- ✅ Faster time to market for new languages
- ✅ Better SEO (localized content)
- ✅ Increased user engagement

## Future Enhancements

1. **CMS Integration**: Load translations from headless CMS
2. **A/B Testing**: Test different phrasings
3. **User Preferences**: Remember language choice
4. **Auto-detection**: Detect user's preferred language
5. **Crowdsourced Translations**: Community-contributed translations
6. **Machine Translation**: AI-assisted translation suggestions
7. **Translation Memory**: Reuse translations across components
8. **Quality Assurance**: Automated translation quality checks

## Conclusion

This design provides a scalable, type-safe, and developer-friendly internationalization system for the video player components. It eliminates hardcoded strings while maintaining backward compatibility and providing a clear migration path.

The phased approach allows incremental implementation without breaking existing functionality, and the modular architecture enables easy extension with new languages and features.

**Next Steps**: Review this design, get stakeholder approval, and begin Phase 1 implementation.
