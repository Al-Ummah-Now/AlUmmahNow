# Video Player Controls Research - Menu Clipping Issue

**Date:** 2025-10-24
**Issue:** Quality selector menu is being clipped by the video player container

## Research Summary

### Famous Video Player Libraries Analysis

Researched how Video.js, Plyr, and MediaElement.js handle control menus to prevent clipping/overflow.

#### Key Patterns Identified

1. **Upward Menu Positioning** (Critical)
   - **Video.js:** Uses `bottom: 100%` to position menus ABOVE the button
   - **Plyr:** Uses `bottom: 100%` with `margin-bottom: 10px` for spacing
   - Both libraries position menus upward to avoid clipping at viewport bottom

2. **Z-Index Layering**
   - Control Bar: `z-index: 10-1000`
   - Menus: `z-index: 1000-9999`
   - Modals: `z-index: 1000+`

3. **Overflow Strategy Hierarchy**
   - Container: `overflow: visible` (allow extension)
   - Menu: `position: absolute` (break out of flow)
   - Menu Content: `overflow: auto` (scrollable if needed)

4. **Max-Height Constraints**
   - Video.js: Responsive max-height (5em-25em based on player size)
   - Prevents menus from exceeding viewport bounds
   - Adds scrolling when needed

### Current Implementation Analysis

#### File Structure
- **Component:** `apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx`
- **Styles:** `apps/web/src/styles/video-player.css`
- **LTR Wrapper:** `apps/web/src/components/VideoPagePlayer/index.tsx`
- **RTL Wrapper:** `apps/web/src/components/VideoPagePlayer/rtl/index.tsx`

#### Current CSS (video-player.css:241-252)

```css
/* Quality selector and menu button - allow overflow for menu */
.video-js .vjs-quality-selector,
.video-js .vjs-menu-button-popup {
  overflow: visible !important; /* ✅ Correct */
}

/* Quality selector menu */
.video-js .vjs-quality-selector .vjs-menu,
.video-js .vjs-menu-button-popup .vjs-menu {
  /* Use default absolute positioning from Video.js */
  z-index: 9999 !important; /* ✅ Correct */
}
```

#### Problems Identified

1. **Missing Upward Positioning:** No `bottom: 100%` specified
   - Menu likely uses default `top` positioning
   - Opens downward, hitting container/viewport edge

2. **No Max-Height Constraint:** No maximum height set
   - Long quality lists could exceed available space
   - No scrolling fallback

3. **Container Constraints:**
   - `.aspect-video` has `aspect-ratio: 16/9` (fixed height)
   - Control bar at `bottom: 0` (edge of container)
   - Any downward menu hits the boundary immediately

### Proposed Solution

#### CSS Changes to Add

```css
/* Quality selector menu - position ABOVE the button to prevent clipping */
.video-js .vjs-quality-selector .vjs-menu,
.video-js .vjs-menu-button-popup .vjs-menu {
  position: absolute !important;
  bottom: 100% !important; /* Position above button - KEY FIX */
  top: auto !important; /* Override any default top positioning */
  left: 50% !important;
  transform: translateX(-50%) !important; /* Center horizontally */
  margin-bottom: 0.5rem !important; /* 8px spacing from button */
  z-index: 9999 !important;

  /* Styling */
  background: oklch(var(--card)) !important;
  border: 1px solid oklch(var(--border)) !important;
  border-radius: 0.5rem !important;
  box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1),
              0 4px 6px -4px rgb(0 0 0 / 0.1) !important;
  min-width: 8rem !important;
  max-width: 12rem !important;
}

/* Menu content with scrolling */
.video-js .vjs-quality-selector .vjs-menu .vjs-menu-content,
.video-js .vjs-menu-button-popup .vjs-menu .vjs-menu-content {
  max-height: 20rem !important; /* 320px - fits ~8-10 quality options */
  overflow-y: auto !important;
  overflow-x: hidden !important;
}

/* RTL support */
[dir="rtl"] .video-js .vjs-quality-selector .vjs-menu,
[dir="rtl"] .video-js .vjs-menu-button-popup .vjs-menu {
  left: auto !important;
  right: 50% !important;
  transform: translateX(50%) !important;
}
```

#### Why This Should Work

1. **`bottom: 100%`** - Positions menu directly above button (industry standard)
2. **`transform: translateX(-50%)`** - Centers menu horizontally on button
3. **`margin-bottom: 0.5rem`** - Adds breathing room between menu and button
4. **`max-height: 20rem`** - Constrains menu height, adds scrolling if needed
5. **`z-index: 9999`** - Ensures menu appears above all other elements
6. **RTL support** - Mirrors positioning for Arabic layout

## Playwright Investigation Results

**Attempted to inspect live video player but encountered API connectivity issues:**
- Dev server running on `localhost:3001`
- Video API not available (ERR_CONNECTION_REFUSED on port 3086)
- Could not load actual video page with quality selector

**Code Analysis Findings:**
- **Quality Selector Plugin:** `videojs-hls-quality-selector` v2.0.0
- **Quality Levels Plugin:** `videojs-contrib-quality-levels` v4.1.0
- **Initialization Location:** `apps/web/src/lib/video/videojs-setup.ts:90-101`
- **Control Bar Order:** Play → Volume → Progress → Time → **hlsQualitySelector** → Fullscreen

**Key Technical Details:**
```typescript
// videojs-setup.ts:92-94
player.hlsQualitySelector({
  displayCurrentQuality: true
});
```

**Current CSS Implementation (video-player.css:241-252):**
```css
.video-js .vjs-quality-selector,
.video-js .vjs-menu-button-popup {
  overflow: visible !important; /* ✅ Correct */
}

.video-js .vjs-quality-selector .vjs-menu,
.video-js .vjs-menu-button-popup .vjs-menu {
  /* Use default absolute positioning from Video.js */
  z-index: 9999 !important; /* ✅ Correct */
}
```

**Problem Confirmed:** Missing explicit `bottom: 100%` positioning directive.

## Conclusion

Based on comprehensive research of Video.js, Plyr, and analysis of the current implementation:

1. **Root Cause:** Quality selector menu lacks upward positioning (`bottom: 100%`)
2. **Industry Standard:** All major video players position menus ABOVE buttons
3. **Your Implementation:** Has correct overflow and z-index, but missing positioning
4. **Proposed Solution:** Add `bottom: 100%` with proper centering and max-height constraints

## Implementation Results

### CSS Fix Applied (video-player.css:248-278)

**Key Changes:**
1. Added `bottom: 100%` to position menu above button
2. Applied `max-height: 20rem` and `overflow-y: auto` to `.vjs-menu-content` (not parent)
3. Set `.vjs-menu-content` to `position: relative` to allow parent height expansion
4. Added proper RTL support with `transform: translateX(50%)`

### Testing Results

#### LTR Mode (English) ✅
- **URL:** `http://localhost:3001/en/video?vid=0a3a5049-0999-4ca4-9003-d507a13d39b4`
- **Result:** Menu appears correctly above the button
- **Quality Options Visible:** 240p, 360p, 480p, 720p, 1080p, Auto
- **CSS Inspection:**
  - Menu: `position: absolute`, `bottom: 64px`, `z-index: 9999`
  - Menu Content: `position: relative`, `max-height: 320px`, `height: 228.844px`
- **Screenshot:** `quality-selector-menu-after-fix.png`

#### RTL Mode (Arabic) ✅
- **URL:** `http://localhost:3001/ar/video?vid=0a3a5049-0999-4ca4-9003-d507a13d39b4`
- **Result:** Menu appears correctly above the button with RTL alignment
- **Quality Options Visible:** All 6 quality levels displayed properly
- **Screenshot:** `quality-selector-menu-rtl-arabic.png`

### Critical Fix Detail

**Problem:** Initial implementation had `max-height` and `overflow` on `.vjs-menu` parent, but `.vjs-menu-content` child was `position: absolute`, causing parent to have `height: 0px`.

**Solution:** Moved `max-height` and `overflow` to `.vjs-menu-content` and changed it to `position: relative`, allowing it to contribute to parent height while still enabling scrolling.

## Next Steps

1. ✅ Research completed
2. ✅ Current implementation analyzed
3. ✅ Solution designed
4. ✅ Code structure investigated
5. ✅ Implement fix to video-player.css
6. ✅ Test in browser with actual video
7. ✅ Test in LTR mode
8. ✅ Test in RTL mode (Arabic)

**Status:** Issue resolved successfully. Quality selector menu now appears above the button in both LTR and RTL modes without clipping.

## References

- **Video.js Menu Popup SCSS:** `src/css/components/menu/_menu-popup.scss`
- **Plyr Menu SCSS:** `src/sass/components/menus.scss`
- **MDN Overflow:** Overflow and positioning strategies
- **Current Issue:** Menu clipping at bottom of video player container
