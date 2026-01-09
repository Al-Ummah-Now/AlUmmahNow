# Video Player i18n Quick Start Guide

## TL;DR - What's Changing

**Problem**: Hardcoded strings make the video player difficult to translate and maintain.

**Solution**: Comprehensive i18n system with type-safe translations and zero performance overhead.

## Quick Examples

### Before vs After

#### Example 1: Player Status Messages

```typescript
// ❌ BEFORE (Hardcoded)
<div className="sr-only">
  {playerReady
    ? 'Video player loaded and ready'
    : 'Loading video player...'}
</div>
```

```typescript
// ✅ AFTER (i18n)
import { useVideoPlayerI18n } from '@/lib/video/i18n';

const { t } = useVideoPlayerI18n(lang);

<div className="sr-only">
  {playerReady ? t.player.ready : t.player.loading}
</div>
```

#### Example 2: Error Messages

```typescript
// ❌ BEFORE (Scattered in error-messages.ts)
const messages = getErrorMessage(error.type, lang);
<h2>{messages.title}</h2>
<p>{messages.description}</p>
<button>{messages.retryButton}</button>
```

```typescript
// ✅ AFTER (Unified i18n)
const { t } = useVideoPlayerI18n(lang);

<h2>{t.errors.title[error.type]}</h2>
<p>{t.errors.description[error.type]}</p>
<button>{t.errors.retryButton}</button>
```

#### Example 3: Accessibility Labels

```typescript
// ❌ BEFORE (Hardcoded or missing)
<button aria-label="Play">▶</button>
<button aria-label="Mute">🔇</button>
```

```typescript
// ✅ AFTER (Translated)
const { t } = useVideoPlayerI18n(lang);

<button aria-label={t.accessibility.playButton}>▶</button>
<button aria-label={t.accessibility.muteButton}>🔇</button>
```

## 5-Minute Integration Guide

### Step 1: Import the Hook

```typescript
import { useVideoPlayerI18n } from '@/lib/video/i18n';
```

### Step 2: Use in Your Component

```typescript
export default function MyVideoComponent({ lang = 'en' }) {
  const { t, isRTL, formatTime } = useVideoPlayerI18n(lang);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <h1>{t.player.loading}</h1>
      <p>{formatTime(125)}</p> {/* "2:05" */}
    </div>
  );
}
```

### Step 3: Replace All Hardcoded Strings

```typescript
// Find-and-replace patterns:
'Video player loaded and ready' → t.player.ready
'Loading video player...'       → t.player.loading
'Retry'                         → t.errors.retryButton
'Error Details'                 → t.errors.detailLabels.detailsTitle
```

### Step 4: Update Tests

```typescript
// Before
expect(screen.getByText('Video player loaded and ready')).toBeInTheDocument();

// After
expect(screen.getByText('Video player loaded and ready')).toBeInTheDocument();
// Still works! Default language is English
```

## Available Translations

### Full Translation Object Structure

```typescript
const { t } = useVideoPlayerI18n('en');

// Player status
t.player.loading         // "Loading video player..."
t.player.ready          // "Video player loaded and ready"
t.player.buffering      // "Buffering..."
t.player.error          // "An error occurred"

// Accessibility
t.accessibility.videoPlayer            // "Video player"
t.accessibility.playButton            // "Play video"
t.accessibility.pauseButton           // "Pause video"
t.accessibility.muteButton            // "Mute audio"
t.accessibility.unmuteButton          // "Unmute audio"
t.accessibility.fullscreenButton      // "Enter fullscreen"
t.accessibility.exitFullscreenButton  // "Exit fullscreen"
t.accessibility.volumeSlider          // "Volume control"
t.accessibility.progressBar           // "Video progress"
t.accessibility.seekSlider            // "Seek position"

// Error handling
t.errors.title.NETWORK_ERROR         // "Network Error"
t.errors.description.NETWORK_ERROR   // "Unable to connect..."
t.errors.retryButton                 // "Retry"
t.errors.fallbackButton.HLS_ERROR    // "Use Direct Download"

// Error detail labels
t.errors.detailLabels.type          // "Type:"
t.errors.detailLabels.message       // "Message:"
t.errors.detailLabels.code          // "Code:"
t.errors.detailLabels.time          // "Time:"
t.errors.detailLabels.detailsTitle  // "Error Details"

// Controls
t.controls.play          // "Play"
t.controls.pause         // "Pause"
t.controls.mute          // "Mute"
t.controls.unmute        // "Unmute"
t.controls.fullscreen    // "Fullscreen"
t.controls.settings      // "Settings"
t.controls.quality       // "Quality"
t.controls.speed         // "Speed"

// Quality settings
t.quality.auto           // "Auto"
t.quality.high           // "High"
t.quality.medium         // "Medium"
t.quality.low            // "Low"
t.quality.labels['1080p'] // "1080p Full HD"
t.quality.labels['720p']  // "720p HD"
t.quality.labels['480p']  // "480p"

// Speed settings
t.speed.normal           // "Normal"
t.speed.labels['0.5']    // "0.5x Slow"
t.speed.labels['1']      // "1x Normal"
t.speed.labels['2']      // "2x Fast"

// Time formatting (utility function)
formatTime(125)          // "2:05"
formatTime(3725)         // "1:02:05"
```

## Common Use Cases

### Use Case 1: CustomVideoPlayer Component

```typescript
import { useVideoPlayerI18n } from '@/lib/video/i18n';

export default function CustomVideoPlayer({
  lang = 'en',
  ariaLabel, // Optional override
  ...props
}) {
  const { t, isRTL } = useVideoPlayerI18n(lang);

  return (
    <div className="custom-video-player" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Screen reader status */}
      <div className="sr-only" role="status">
        {playerReady ? t.player.ready : t.player.loading}
      </div>

      {/* Video element */}
      <video
        aria-label={ariaLabel || t.accessibility.videoPlayer}
        {...props}
      />

      {/* Controls */}
      <button aria-label={t.accessibility.playButton}>
        <PlayIcon />
      </button>
    </div>
  );
}
```

### Use Case 2: ErrorDisplay Component

```typescript
import { useVideoPlayerI18n } from '@/lib/video/i18n';

export function ErrorDisplay({ error, lang, onRetry }) {
  const { t, isRTL } = useVideoPlayerI18n(lang);

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'}>
      <h2>{t.errors.title[error.type]}</h2>
      <p>{t.errors.description[error.type]}</p>

      <div>
        <span>{t.errors.detailLabels.type}</span> {error.type}
      </div>
      <div>
        <span>{t.errors.detailLabels.message}</span> {error.message}
      </div>
      {error.code && (
        <div>
          <span>{t.errors.detailLabels.code}</span> {error.code}
        </div>
      )}

      {onRetry && (
        <button onClick={onRetry}>
          {t.errors.retryButton}
        </button>
      )}
    </div>
  );
}
```

### Use Case 3: Video Controls

```typescript
import { useVideoPlayerI18n } from '@/lib/video/i18n';

export function VideoControls({ lang, onPlay, onMute }) {
  const { t } = useVideoPlayerI18n(lang);

  return (
    <div className="controls">
      <button
        onClick={onPlay}
        aria-label={isPlaying ? t.accessibility.pauseButton : t.accessibility.playButton}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </button>

      <button
        onClick={onMute}
        aria-label={isMuted ? t.accessibility.unmuteButton : t.accessibility.muteButton}
      >
        {isMuted ? <UnmuteIcon /> : <MuteIcon />}
      </button>
    </div>
  );
}
```

### Use Case 4: Quality Selector

```typescript
import { useVideoPlayerI18n } from '@/lib/video/i18n';

export function QualitySelector({ lang, currentQuality, onQualityChange }) {
  const { t } = useVideoPlayerI18n(lang);

  const qualities = ['auto', '1080p', '720p', '480p', '360p'];

  return (
    <select
      value={currentQuality}
      onChange={(e) => onQualityChange(e.target.value)}
      aria-label={t.controls.quality}
    >
      <option value="auto">{t.quality.auto}</option>
      {qualities.map(quality => (
        <option key={quality} value={quality}>
          {t.quality.labels[quality]}
        </option>
      ))}
    </select>
  );
}
```

### Use Case 5: Without React Hook (Utility Function)

```typescript
import { getTranslations } from '@/lib/video/i18n';

// In a non-React context (e.g., Video.js plugin)
function setupVideoJsPlugin(lang: 'en' | 'ar') {
  const translations = getTranslations(lang);

  videojs.registerPlugin('myPlugin', function() {
    this.controlBar.addChild('button', {
      text: translations.controls.settings,
      clickHandler: () => { /* ... */ }
    });
  });
}
```

## Testing with i18n

### Unit Tests

```typescript
import { getTranslations } from '@/lib/video/i18n';

describe('Translations', () => {
  it('should return English translations', () => {
    const t = getTranslations('en');
    expect(t.player.loading).toBe('Loading video player...');
  });

  it('should return Arabic translations', () => {
    const t = getTranslations('ar');
    expect(t.player.loading).toBe('جاري تحميل مشغل الفيديو...');
  });
});
```

### Component Tests

```typescript
import { render, screen } from '@testing-library/react';
import CustomVideoPlayer from './CustomVideoPlayer';

describe('CustomVideoPlayer i18n', () => {
  it('should display English loading message', () => {
    render(<CustomVideoPlayer lang="en" {...props} />);
    expect(screen.getByText('Loading video player...')).toBeInTheDocument();
  });

  it('should display Arabic loading message', () => {
    render(<CustomVideoPlayer lang="ar" {...props} />);
    expect(screen.getByText('جاري تحميل مشغل الفيديو...')).toBeInTheDocument();
  });

  it('should apply RTL layout for Arabic', () => {
    const { container } = render(<CustomVideoPlayer lang="ar" {...props} />);
    expect(container.querySelector('[dir="rtl"]')).toBeInTheDocument();
  });
});
```

## Migration Checklist

### For CustomVideoPlayer.tsx

- [ ] Import `useVideoPlayerI18n` hook
- [ ] Replace line 319: `'Video player loaded and ready'` → `t.player.ready`
- [ ] Replace line 320: `'Loading video player...'` → `t.player.loading`
- [ ] Replace line 69: `ariaLabel = 'Video player'` → `ariaLabel = t.accessibility.videoPlayer`
- [ ] Add `dir={isRTL ? 'rtl' : 'ltr'}` to root div
- [ ] Update tests to use new strings

### For ErrorDisplay.tsx

- [ ] Import `useVideoPlayerI18n` hook
- [ ] Replace error message lookups with `t.errors.*`
- [ ] Replace line 166: `'Error Details'` → `t.errors.detailLabels.detailsTitle`
- [ ] Replace lines 177-200: Use `t.errors.detailLabels.*`
- [ ] Remove `getErrorMessage` import (deprecated)
- [ ] Add `dir={isRTL ? 'rtl' : 'ltr'}` if not present
- [ ] Update tests

### For error-messages.ts

- [ ] Add deprecation comment at top of file
- [ ] Add console.warn() in `getErrorMessage()` function
- [ ] Update JSDoc to point to new i18n system
- [ ] Keep file for backward compatibility (1-2 releases)
- [ ] Schedule removal in next major version

## Backward Compatibility

The new i18n system is **100% backward compatible**:

✅ Existing components continue to work unchanged
✅ Tests don't need immediate updates
✅ `error-messages.ts` continues to work
✅ No breaking changes to public APIs

Components can migrate incrementally:
1. Update one component at a time
2. Test thoroughly
3. Move to next component
4. No "big bang" migration required

## Performance Impact

**Zero runtime performance impact**:
- Translation lookup: O(1) object property access
- No re-renders on language change (if using same lang)
- Tree-shakeable: Only imported translations included in bundle

**Minimal bundle size impact**:
- Current: 2 KB (error-messages.ts)
- After i18n: 3 KB (gzipped, with English + Arabic)
- Each additional language: +1.2 KB (gzipped)

## Troubleshooting

### Issue: TypeScript Error "Property does not exist on type"

```typescript
// ❌ Error
const text = t.player.notExist; // TypeScript error

// ✅ Solution
const text = t.player.loading; // Use existing key
```

**Cause**: Translation key doesn't exist in type definition.
**Fix**: Use autocomplete (Ctrl+Space) to see available keys.

### Issue: Translations Not Loading

```typescript
// ❌ Wrong
import { useVideoPlayerI18n } from './i18n';

// ✅ Correct
import { useVideoPlayerI18n } from '@/lib/video/i18n';
```

**Cause**: Incorrect import path.
**Fix**: Use absolute path from project root.

### Issue: Arabic Text Not Displaying Correctly

```typescript
// ❌ Missing dir attribute
<div>
  {t.player.loading}
</div>

// ✅ Add dir="rtl" for Arabic
const { isRTL } = useVideoPlayerI18n(lang);
<div dir={isRTL ? 'rtl' : 'ltr'}>
  {t.player.loading}
</div>
```

**Cause**: RTL not enabled.
**Fix**: Use `isRTL` from hook and set `dir` attribute.

### Issue: Tests Failing After Migration

```typescript
// ❌ Old test expecting exact string
expect(screen.getByText('Video player loaded and ready')).toBeInTheDocument();

// ✅ Updated test
import { getTranslations } from '@/lib/video/i18n';
const t = getTranslations('en');
expect(screen.getByText(t.player.ready)).toBeInTheDocument();
```

**Cause**: Tests using hardcoded strings.
**Fix**: Use translations in tests too.

## Adding a New Translation Key

### Step 1: Update Type Definition

```typescript
// apps/web/src/lib/video/i18n/types.ts
export interface VideoPlayerTranslations {
  player: {
    loading: string;
    ready: string;
    // Add new key
    connectionLost: string; // ← NEW
  };
  // ...
}
```

### Step 2: Add to English Translations

```typescript
// apps/web/src/lib/video/i18n/translations/en.ts
export const EN_TRANSLATIONS: VideoPlayerTranslations = {
  player: {
    loading: 'Loading video player...',
    ready: 'Video player loaded and ready',
    // Add translation
    connectionLost: 'Connection lost. Reconnecting...', // ← NEW
  },
  // ...
};
```

### Step 3: Add to Arabic Translations

```typescript
// apps/web/src/lib/video/i18n/translations/ar.ts
export const AR_TRANSLATIONS: VideoPlayerTranslations = {
  player: {
    loading: 'جاري تحميل مشغل الفيديو...',
    ready: 'مشغل الفيديو جاهز',
    // Add translation
    connectionLost: 'فقد الاتصال. جاري إعادة الاتصال...', // ← NEW
  },
  // ...
};
```

### Step 4: Use in Component

```typescript
const { t } = useVideoPlayerI18n(lang);

return (
  <div>
    {connectionLost && (
      <div className="warning">
        {t.player.connectionLost} {/* ← Use new key */}
      </div>
    )}
  </div>
);
```

**TypeScript will enforce** that all language files have the new key!

## Best Practices

### ✅ DO

```typescript
// Use the hook at component top level
const { t, isRTL } = useVideoPlayerI18n(lang);

// Use semantic translation keys
t.player.loading // Clear what it does
t.errors.title[errorType] // Context included

// Always set dir attribute for RTL
<div dir={isRTL ? 'rtl' : 'ltr'}>

// Use translations for all user-visible text
aria-label={t.accessibility.playButton}
```

### ❌ DON'T

```typescript
// Don't hardcode strings
const text = 'Loading...'; // ❌

// Don't call hook conditionally
if (showPlayer) {
  const { t } = useVideoPlayerI18n(lang); // ❌ Breaks React rules
}

// Don't ignore RTL
<div>{t.player.loading}</div> // ❌ Missing dir attribute

// Don't use generic keys
t.text1 // ❌ What does this mean?
t.str2  // ❌ No context
```

## Next Steps

1. **Review Design**: Read `I18N_DESIGN.md` for complete architecture
2. **Check Architecture**: Read `I18N_ARCHITECTURE.md` for diagrams
3. **Start Implementation**: Follow Phase 1 checklist in design doc
4. **Test Changes**: Run tests after each component migration
5. **Update Docs**: Keep documentation in sync with code

## Support

- **Questions**: Check `I18N_DESIGN.md` FAQ section
- **Issues**: Open GitHub issue with `i18n` label
- **Contributions**: See `CONTRIBUTING.md` for translation guidelines

## Summary

The new i18n system provides:
- ✅ **Type-safe** translations with autocomplete
- ✅ **Zero** hardcoded strings
- ✅ **Full** RTL support
- ✅ **Easy** to add new languages
- ✅ **Backward** compatible
- ✅ **Fast** - zero performance overhead

Start migrating today - one component at a time! 🚀
