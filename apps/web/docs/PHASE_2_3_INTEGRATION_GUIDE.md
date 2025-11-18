# Phase 2.3: Keyboard Shortcuts Integration Guide

## Overview

Phase 2.3 implements comprehensive keyboard shortcuts for the video player, following YouTube-style patterns. This document provides the integration steps that need to be completed in `CustomVideoPlayer.tsx`.

## Files Created

✅ **Complete:**
1. `apps/web/src/lib/video/keyboard-shortcuts.ts` - Core keyboard shortcuts logic
2. `apps/web/src/components/VideoPlayer/KeyboardHelpModal.tsx` - Help modal component
3. `apps/web/src/styles/keyboard-feedback.css` - Visual feedback styles
4. Updated `apps/web/src/lib/video/i18n/types.ts` - Added keyboard shortcuts translations structure
5. Updated `apps/web/src/lib/video/i18n/translations/en.ts` - English translations
6. Updated `apps/web/src/lib/video/i18n/translations/ar.ts` - Arabic translations

## Integration Steps for CustomVideoPlayer.tsx

### Step 1: Add Imports

Add these imports after the existing imports:

```typescript
import { setupKeyboardShortcuts } from '@/lib/video/keyboard-shortcuts';
import { KeyboardHelpModal } from './KeyboardHelpModal';
import '@/styles/keyboard-feedback.css';
```

### Step 2: Add State

Add state for the keyboard help modal after the existing state declarations:

```typescript
const keyboardShortcutsCleanupRef = useRef<(() => void) | null>(null);
const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
```

### Step 3: Initialize Keyboard Shortcuts

Add this inside `player.ready()` callback, after other initializations:

```typescript
// Phase 2.3: Setup keyboard shortcuts
keyboardShortcutsCleanupRef.current = setupKeyboardShortcuts(player, {
  onShowHelp: () => setShowKeyboardHelp(true),
  lang,
  showFeedback: true,
});
```

### Step 4: Add Cleanup

Add this in the cleanup function (return statement of useEffect), before player disposal:

```typescript
// Cleanup keyboard shortcuts
if (keyboardShortcutsCleanupRef.current) {
  keyboardShortcutsCleanupRef.current();
  keyboardShortcutsCleanupRef.current = null;
}
```

### Step 5: Render Help Modal

Add this before the closing `</div>` in the return statement:

```typescript
{/* Phase 2.3: Keyboard shortcuts help modal */}
<KeyboardHelpModal
  isOpen={showKeyboardHelp}
  onClose={() => setShowKeyboardHelp(false)}
  lang={lang}
/>
```

## Keyboard Shortcuts Implemented

| Action | Keys | Description |
|--------|------|-------------|
| Play/Pause | `Space`, `K` | Toggle playback |
| Rewind 5s | `←` (Arrow Left) | Jump back 5 seconds |
| Rewind 10s | `J` | Jump back 10 seconds |
| Forward 5s | `→` (Arrow Right) | Jump forward 5 seconds |
| Forward 10s | `L` | Jump forward 10 seconds |
| Volume Up | `↑` (Arrow Up) | Increase volume by 10% |
| Volume Down | `↓` (Arrow Down) | Decrease volume by 10% |
| Mute/Unmute | `M` | Toggle mute |
| Fullscreen | `F` | Toggle fullscreen mode |
| Picture-in-Picture | `P` | Toggle PiP mode |
| Decrease Speed | `<` (Shift+,) | Decrease playback speed |
| Increase Speed | `>` (Shift+.) | Increase playback speed |
| Seek to % | `0-9` | Jump to 0%-90% of video |
| Show Help | `?` | Show keyboard shortcuts modal |

## Features

### 1. Smart Input Detection
- Shortcuts don't trigger when focus is on input fields, textareas, or contenteditable elements
- Prevents conflicts with form inputs

### 2. Visual Feedback
- Temporary overlay shows action performed
- Displays current value (volume %, timestamp, speed)
- Auto-hides after 1 second
- Accessible via screen readers (aria-live region)

### 3. Bilingual Support
- Full English and Arabic translations
- RTL support for Arabic
- Localized key names and descriptions

### 4. Fullscreen Compatibility
- All shortcuts work in fullscreen mode
- Feedback overlay visible with maximum z-index
- Proper cleanup when exiting fullscreen

### 5. Accessibility
- Screen reader announcements for actions
- Keyboard-navigable help modal
- Focus trap in help modal
- Escape key to close modal
- Backdrop click to close

## Testing Checklist

Once integrated, test the following:

- [ ] All keyboard shortcuts work correctly
- [ ] Shortcuts don't interfere with form inputs
- [ ] Visual feedback displays correctly
- [ ] Help modal opens with `?` key
- [ ] Help modal closes with `Esc` or backdrop click
- [ ] Shortcuts work in fullscreen mode
- [ ] RTL layout works correctly for Arabic
- [ ] Screen reader announcements work
- [ ] No console errors
- [ ] Cleanup works properly (no memory leaks)

## Notes

1. **Phase Integration**: This is Phase 2.3 of the video player enhancement roadmap
2. **Dependencies**: Requires Video.js player to be initialized
3. **Conflicts**: Works alongside Phase 2.2 playback speed shortcuts (integrated separately)
4. **Performance**: Lightweight, no performance impact
5. **Browser Support**: Works in all modern browsers with Picture-in-Picture API support

## Next Steps

After integration:
1. Test all shortcuts
2. Verify bilingual support
3. Check accessibility features
4. Update main README.md with keyboard shortcuts documentation
5. Consider adding keyboard shortcuts hint on first video load (Phase 3)

## Related Files

- Phase 2.2: `apps/web/src/lib/video/playback-speed.ts`
- Phase 2.4: `apps/web/src/lib/video/progress-preview.ts`
- Phase 2.5: `apps/web/src/lib/video/volume-control.ts`
- Phase 2.6: `apps/web/src/lib/video/fullscreen-pip.ts`
