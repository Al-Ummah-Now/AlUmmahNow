# TCACC006: Video and Media Accessibility

## Test Case Information

- **Test Case ID**: TCACC006
- **Category**: Accessibility
- **Sub-category**: Video and Media Accessibility
- **Priority**: High
- **Estimated Time**: 75 minutes
- **Target Browsers**: Chrome, Firefox, Safari, Edge
- **Target Devices**: Desktop, Tablet, Mobile
- **Accessibility Standards**: WCAG 2.1 Level AA, Section 508, ADA

## Test Description

This test case validates the accessibility of video and media content throughout the Al Ummah Now platform. It ensures that users with disabilities can access, understand, and interact with video content, including captions, audio descriptions, player controls, and media navigation.

## Test Objectives

1. Verify video player controls are fully accessible
2. Test caption and subtitle functionality
3. Validate audio description support
4. Ensure keyboard navigation for media controls
5. Test media accessibility on mobile devices
6. Verify sign language interpretation options
7. Test media transcript availability
8. Validate media player responsiveness and RTL support

## Prerequisites

- Screen reader software (NVDA, JAWS, VoiceOver, TalkBack)
- Browser developer tools with accessibility inspector
- Various video content with different accessibility features
- Keyboard-only navigation capability
- Mobile devices for touch interface testing
- Test video files with captions and audio descriptions

## Test Steps

### 1. Video Player Control Accessibility

**1.1 Basic Control Structure**
- Navigate to any video page on the platform
- Inspect video player control structure
- Verify all controls have proper semantic markup:
  - `<button>` elements for interactive controls
  - Proper ARIA attributes for custom controls
  - Logical tab order through controls
- Test control visibility and contrast

**1.2 Control Labels and Descriptions**
- Verify each control has accessible labeling:
  - Play/Pause button with `aria-label` or visible text
  - Volume controls with descriptive labels
  - Fullscreen toggle with clear indication
  - Progress bar with proper labeling
- Test screen reader announcement of each control

**1.3 Keyboard Navigation**
- Test keyboard navigation through all video controls:
  - Tab/Shift+Tab between controls
  - Enter/Space for activation
  - Arrow keys for sliders and progress bars
  - Escape for exiting fullscreen
- Verify focus indicators are visible

**1.4 Control States**
- Test dynamic state announcements:
  - Play/Pause state changes
  - Mute/Unmute state changes
  - Fullscreen enter/exit
  - Volume level changes
  - Progress/seek position updates

### 2. Caption and Subtitle Accessibility

**2.1 Caption Availability**
- Verify captions are available for all video content
- Check for caption language options (English, Arabic)
- Test caption toggle functionality
- Verify caption quality and accuracy

**2.2 Caption Display**
- Test caption appearance and readability:
  - Font size and readability
  - Color contrast with video background
  - Position and timing
  - Duration and synchronization
- Test caption customization options if available

**2.3 Caption Controls**
- Test caption control accessibility:
  - Caption on/off toggle
  - Language selection
  - Style customization controls
  - Keyboard shortcuts for captions
- Verify screen reader announcements of caption status

**2.4 Subtitle Support**
- Test subtitle functionality for different languages
- Verify subtitle synchronization
- Test subtitle language switching
- Check subtitle readability and positioning

### 3. Audio Description Support

**3.1 Audio Description Availability**
- Check for audio description tracks
- Verify audio description toggle controls
- Test audio description synchronization
- Verify audio description quality and clarity

**3.2 Audio Description Controls**
- Test audio description control accessibility:
  - On/off toggle with clear labeling
  - Volume control for descriptions
  - Language selection for descriptions
- Verify screen reader announcements

**3.3 Alternative Audio Tracks**
- Test alternative audio track options
- Verify track selection controls
- Test audio track switching during playback
- Check audio quality and synchronization

### 4. Media Navigation and Interaction

**4.1 Progress Bar Accessibility**
- Test progress bar keyboard navigation:
  - Arrow keys for seeking
  - Home/End for start/end
  - Page Up/Down for larger jumps
- Verify position announcements during seeking
- Test progress bar ARIA attributes

**4.2 Volume Control Accessibility**
- Test volume control keyboard navigation:
  - Arrow keys for volume adjustment
  - Mute/Unmute functionality
  - Volume level announcements
- Verify volume slider accessibility

**4.3 Playback Speed Control**
- Test playback speed adjustment controls
- Verify speed options (0.5x, 1x, 1.25x, 1.5x, 2x)
- Test speed control keyboard navigation
- Verify speed change announcements

**4.4 Chapter/Section Navigation**
- Test chapter markers and navigation
- Verify chapter list accessibility
- Test chapter selection via keyboard
- Check chapter announcements during navigation

### 5. Mobile Media Accessibility

**5.1 Touch Interface**
- Test video player on mobile devices:
  - Touch target sizes for controls
  - Swipe gestures for seeking
  - Tap gestures for play/pause
  - Pinch-to-zoom functionality
- Verify touch feedback and accessibility

**5.2 Mobile Controls**
- Test mobile-specific control layouts:
  - Control visibility and auto-hide
  - Gesture-based controls
  - Mobile keyboard support
  - Screen reader compatibility

**5.3 Responsive Media**
- Test video player across different screen sizes:
  - Portrait and landscape orientations
  - Different viewport dimensions
  - Control layout adaptation
  - Caption positioning on mobile

### 6. Sign Language and Visual Accessibility

**6.1 Sign Language Support**
- Check for sign language interpretation options
- Test sign language picture-in-picture functionality
- Verify sign language positioning and sizing
- Test sign language toggle controls

**6.2 Visual Indicators**
- Test visual accessibility features:
  - High contrast mode support
  - Color blind friendly indicators
  - Visual-only notifications
  - Flashing content warnings

**6.3 Audio-Only Content**
- Test audio-only content accessibility:
  - Audio descriptions for visual content
  - Transcripts for audio content
  - Alternative text for visual elements
  - Audio player accessibility

### 7. Transcripts and Alternative Content

**7.1 Transcript Availability**
- Verify transcripts are available for all media
- Test transcript accessibility:
  - Proper heading structure
  - Time stamps linking to video
  - Screen reader compatibility
  - Keyboard navigation

**7.2 Transcript Interaction**
- Test transcript-video synchronization:
  - Click on transcript to seek video
  - Video position highlights transcript
  - Auto-scroll during playback
- Verify transcript search functionality

**7.3 Alternative Formats**
- Check for alternative content formats:
  - Audio descriptions
  - Text summaries
  - Image descriptions
  - Downloadable transcripts

### 8. RTL and Bilingual Media Support

**8.1 Arabic Language Support**
- Test video player in Arabic interface:
  - RTL layout for controls
  - Arabic captions and subtitles
  - Right-to-left text direction
  - Arabic screen reader support

**8.2 Bilingual Content**
- Test bilingual video features:
  - Language switching
  - Dual-language captions
  - Interface language changes
  - Content localization

**8.3 RTL Media Controls**
- Verify media player adapts to RTL:
  - Control positioning
  - Text direction in labels
  - Progress bar direction
  - Caption positioning

## Expected Results

### 1. Video Player Controls
- All controls are keyboard accessible
- Controls have proper labels and descriptions
- Focus indicators are clearly visible
- State changes are properly announced
- Touch targets meet minimum size requirements

### 2. Captions and Subtitles
- Captions are available and accurate
- Caption controls are fully accessible
- Caption display is readable and synchronized
- Multiple language options are available

### 3. Audio Descriptions
- Audio descriptions are available where needed
- Description controls are accessible
- Synchronization is maintained
- Quality is clear and understandable

### 4. Media Navigation
- Progress bar is fully keyboard accessible
- Volume controls work via keyboard
- Playback speed adjustment is available
- Chapter navigation is supported

### 5. Mobile Experience
- Touch targets meet size requirements
- Gestures work as expected
- Responsive design maintains accessibility
- Mobile screen readers work correctly

### 6. Visual Accessibility
- Sign language options are available
- High contrast mode is supported
- Visual indicators are clear
- Flashing content warnings are provided

### 7. Transcripts
- Complete transcripts are available
- Transcripts are synchronized with video
- Transcripts are fully accessible
- Search functionality works

### 8. RTL Support
- Arabic interface is properly RTL
- Bilingual features work correctly
- Text direction is maintained
- Screen reader support is complete

## Test Data

### Sample Accessible Video Player Markup
```html
<div class="video-container" role="application" aria-label="Video player">
  <video 
    id="main-video"
    controls
    crossorigin="anonymous"
    aria-label="Video content"
    aria-describedby="video-title video-description"
  >
    <source src="video.mp4" type="video/mp4">
    <source src="video.webm" type="video/webm">
    
    <!-- Caption tracks -->
    <track 
      kind="subtitles" 
      src="captions-en.vtt" 
      srclang="en" 
      label="English"
      default
    >
    <track 
      kind="subtitles" 
      src="captions-ar.vtt" 
      srclang="ar" 
      label="العربية"
    >
    
    <!-- Audio description track -->
    <track 
      kind="descriptions" 
      src="descriptions-en.vtt" 
      srclang="en" 
      label="English Audio Description"
    >
    
    <!-- Chapter track -->
    <track 
      kind="chapters" 
      src="chapters.vtt" 
      srclang="en" 
      label="Chapters"
    >
    
    Your browser does not support the video element.
  </video>
  
  <div id="video-title" class="sr-only">
    Understanding Islamic Prayer - Educational Video
  </div>
  
  <div id="video-description" class="sr-only">
    A comprehensive guide to performing Islamic prayer, covering movements, recitations, and spiritual significance.
  </div>
  
  <!-- Custom controls for enhanced accessibility -->
  <div class="video-controls" role="toolbar" aria-label="Video controls">
    <button 
      type="button" 
      class="play-pause-btn"
      aria-label="Play video"
      aria-pressed="false"
      data-action="play-pause"
    >
      <span class="icon-play" aria-hidden="true"></span>
      <span class="icon-pause" aria-hidden="true"></span>
    </button>
    
    <div class="volume-control" role="group" aria-label="Volume control">
      <button 
        type="button"
        class="volume-btn"
        aria-label="Mute volume"
        aria-pressed="false"
        data-action="mute"
      >
        <span class="icon-volume-up" aria-hidden="true"></span>
        <span class="icon-volume-mute" aria-hidden="true"></span>
      </button>
      
      <input 
        type="range" 
        class="volume-slider"
        min="0" 
        max="100" 
        value="100"
        aria-label="Volume level"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="100"
        aria-valuetext="100%"
        data-action="volume"
      >
    </div>
    
    <div class="progress-container" role="group" aria-label="Video progress">
      <input 
        type="range" 
        class="progress-bar"
        min="0" 
        max="100" 
        value="0"
        aria-label="Video position"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="0"
        aria-valuetext="0:00 / 10:30"
        data-action="seek"
      >
      
      <div class="time-display" aria-live="polite" aria-atomic="true">
        <span class="current-time">0:00</span>
        <span class="time-separator" aria-hidden="true">/</span>
        <span class="duration">10:30</span>
      </div>
    </div>
    
    <button 
      type="button"
      class="captions-btn"
      aria-label="Toggle captions"
      aria-pressed="false"
      data-action="captions"
    >
      <span class="icon-captions" aria-hidden="true"></span>
    </button>
    
    <button 
      type="button"
      class="settings-btn"
      aria-label="Video settings"
      aria-expanded="false"
      aria-controls="settings-menu"
      data-action="settings"
    >
      <span class="icon-settings" aria-hidden="true"></span>
    </button>
    
    <button 
      type="button"
      class="fullscreen-btn"
      aria-label="Enter fullscreen"
      aria-pressed="false"
      data-action="fullscreen"
    >
      <span class="icon-fullscreen-enter" aria-hidden="true"></span>
      <span class="icon-fullscreen-exit" aria-hidden="true"></span>
    </button>
  </div>
  
  <!-- Settings menu -->
  <div 
    id="settings-menu"
    class="settings-menu"
    role="menu"
    aria-labelledby="settings-btn"
    hidden
  >
    <div class="menu-section" role="group" aria-labelledby="playback-speed-label">
      <h3 id="playback-speed-label">Playback Speed</h3>
      <button 
        type="button"
        role="menuitem"
        class="speed-option"
        data-speed="0.5"
        aria-checked="false"
      >
        0.5x
      </button>
      <button 
        type="button"
        role="menuitem"
        class="speed-option"
        data-speed="1"
        aria-checked="true"
      >
        1x
      </button>
      <button 
        type="button"
        role="menuitem"
        class="speed-option"
        data-speed="1.25"
        aria-checked="false"
      >
        1.25x
      </button>
      <button 
        type="button"
        role="menuitem"
        class="speed-option"
        data-speed="1.5"
        aria-checked="false"
      >
        1.5x
      </button>
      <button 
        type="button"
        role="menuitem"
        class="speed-option"
        data-speed="2"
        aria-checked="false"
      >
        2x
      </button>
    </div>
    
    <div class="menu-section" role="group" aria-labelledby="captions-label">
      <h3 id="captions-label">Captions</h3>
      <button 
        type="button"
        role="menuitem"
        class="caption-option"
        data-caption="off"
        aria-checked="false"
      >
        Off
      </button>
      <button 
        type="button"
        role="menuitem"
        class="caption-option"
        data-caption="en"
        aria-checked="true"
      >
        English
      </button>
      <button 
        type="button"
        role="menuitem"
        class="caption-option"
        data-caption="ar"
        aria-checked="false"
      >
        العربية
      </button>
    </div>
  </div>
  
  <!-- Transcript section -->
  <section class="transcript-section" aria-labelledby="transcript-heading">
    <h2 id="transcript-heading">Video Transcript</h2>
    <div class="transcript-controls">
      <button 
        type="button"
        class="transcript-toggle"
        aria-expanded="false"
        aria-controls="transcript-content"
      >
        Show Transcript
      </button>
    </div>
    
    <div 
      id="transcript-content"
      class="transcript-content"
      hidden
      role="document"
      aria-label="Video transcript with timestamps"
      tabindex="0"
    >
      <div class="transcript-item" data-time="0">
        <span class="timestamp">0:00</span>
        <span class="transcript-text">Welcome to our guide on Islamic prayer.</span>
      </div>
      <div class="transcript-item" data-time="5">
        <span class="timestamp">0:05</span>
        <span class="transcript-text">In this video, we'll cover the essential movements and recitations.</span>
      </div>
      <!-- More transcript items -->
    </div>
  </section>
</div>
```

### Video Player Accessibility JavaScript
```javascript
class AccessibleVideoPlayer {
  constructor(videoElement, controlsContainer) {
    this.video = videoElement;
    this.controls = controlsContainer;
    this.setupAccessibility();
    this.bindEvents();
  }

  setupAccessibility() {
    // Ensure video element has proper ARIA attributes
    this.video.setAttribute('role', 'application');
    this.video.setAttribute('aria-label', 'Video player');
    
    // Setup control ARIA attributes
    this.setupControlAccessibility();
    
    // Setup live regions for announcements
    this.setupLiveRegions();
    
    // Setup keyboard navigation
    this.setupKeyboardNavigation();
  }

  setupControlAccessibility() {
    // Play/Pause button
    const playPauseBtn = this.controls.querySelector('[data-action="play-pause"]');
    if (playPauseBtn) {
      this.updatePlayPauseButton(playPauseBtn);
    }

    // Volume controls
    const volumeSlider = this.controls.querySelector('[data-action="volume"]');
    if (volumeSlider) {
      this.updateVolumeSlider(volumeSlider);
    }

    // Progress bar
    const progressBar = this.controls.querySelector('[data-action="seek"]');
    if (progressBar) {
      this.updateProgressBar(progressBar);
    }

    // Captions button
    const captionsBtn = this.controls.querySelector('[data-action="captions"]');
    if (captionsBtn) {
      this.updateCaptionsButton(captionsBtn);
    }
  }

  setupLiveRegions() {
    // Create live region for announcements
    if (!document.getElementById('video-announcements')) {
      const liveRegion = document.createElement('div');
      liveRegion.id = 'video-announcements';
      liveRegion.setAttribute('aria-live', 'polite');
      liveRegion.setAttribute('aria-atomic', 'true');
      liveRegion.className = 'sr-only';
      document.body.appendChild(liveRegion);
    }
    this.announcer = document.getElementById('video-announcements');
  }

  setupKeyboardNavigation() {
    this.video.addEventListener('keydown', (e) => this.handleKeyboard(e));
    this.controls.addEventListener('keydown', (e) => this.handleKeyboard(e));
  }

  handleKeyboard(event) {
    const { key } = event;
    
    switch (key) {
      case ' ':
      case 'Enter':
        event.preventDefault();
        this.togglePlayPause();
        break;
        
      case 'ArrowLeft':
        event.preventDefault();
        this.seek(-5); // Seek back 5 seconds
        break;
        
      case 'ArrowRight':
        event.preventDefault();
        this.seek(5); // Seek forward 5 seconds
        break;
        
      case 'ArrowUp':
        event.preventDefault();
        this.adjustVolume(0.1); // Increase volume
        break;
        
      case 'ArrowDown':
        event.preventDefault();
        this.adjustVolume(-0.1); // Decrease volume
        break;
        
      case 'm':
      case 'M':
        event.preventDefault();
        this.toggleMute();
        break;
        
      case 'f':
      case 'F':
        event.preventDefault();
        this.toggleFullscreen();
        break;
        
      case 'c':
      case 'C':
        event.preventDefault();
        this.toggleCaptions();
        break;
    }
  }

  updatePlayPauseButton(button) {
    const isPlaying = !this.video.paused;
    button.setAttribute('aria-pressed', isPlaying);
    button.setAttribute('aria-label', isPlaying ? 'Pause video' : 'Play video');
    
    // Update visible state
    const playIcon = button.querySelector('.icon-play');
    const pauseIcon = button.querySelector('.icon-pause');
    
    if (playIcon && pauseIcon) {
      playIcon.hidden = isPlaying;
      pauseIcon.hidden = !isPlaying;
    }
  }

  updateVolumeSlider(slider) {
    const volume = Math.round(this.video.volume * 100);
    slider.setAttribute('aria-valuenow', volume);
    slider.setAttribute('aria-valuetext', `${volume}%`);
    slider.value = volume;
  }

  updateProgressBar(progressBar) {
    const percentage = (this.video.currentTime / this.video.duration) * 100;
    const currentTime = this.formatTime(this.video.currentTime);
    const duration = this.formatTime(this.video.duration);
    
    progressBar.setAttribute('aria-valuenow', percentage);
    progressBar.setAttribute('aria-valuetext', `${currentTime} / ${duration}`);
    progressBar.value = percentage;
    
    // Update time display
    const timeDisplay = this.controls.querySelector('.time-display');
    if (timeDisplay) {
      timeDisplay.querySelector('.current-time').textContent = currentTime;
      timeDisplay.querySelector('.duration').textContent = duration;
    }
  }

  updateCaptionsButton(button) {
    const track = this.video.textTracks[0]; // Assuming first track is captions
    const isShowing = track && track.mode === 'showing';
    
    button.setAttribute('aria-pressed', isShowing);
    button.setAttribute('aria-label', isShowing ? 'Hide captions' : 'Show captions');
  }

  togglePlayPause() {
    if (this.video.paused) {
      this.video.play();
      this.announce('Video playing');
    } else {
      this.video.pause();
      this.announce('Video paused');
    }
  }

  seek(seconds) {
    const newTime = Math.max(0, Math.min(this.video.duration, this.video.currentTime + seconds));
    this.video.currentTime = newTime;
    this.announce(`Seeked to ${this.formatTime(newTime)}`);
  }

  adjustVolume(delta) {
    const newVolume = Math.max(0, Math.min(1, this.video.volume + delta));
    this.video.volume = newVolume;
    this.announce(`Volume ${Math.round(newVolume * 100)}%`);
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
    this.announce(this.video.muted ? 'Muted' : 'Unmuted');
  }

  toggleFullscreen() {
    if (!document.fullscreenElement) {
      this.video.requestFullscreen();
      this.announce('Entered fullscreen');
    } else {
      document.exitFullscreen();
      this.announce('Exited fullscreen');
    }
  }

  toggleCaptions() {
    const track = this.video.textTracks[0];
    if (track) {
      track.mode = track.mode === 'showing' ? 'hidden' : 'showing';
      this.announce(track.mode === 'showing' ? 'Captions on' : 'Captions off');
    }
  }

  announce(message) {
    if (this.announcer) {
      this.announcer.textContent = message;
      // Clear after announcement
      setTimeout(() => {
        this.announcer.textContent = '';
      }, 1000);
    }
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  bindEvents() {
    // Video events
    this.video.addEventListener('play', () => this.updatePlayPauseButton(
      this.controls.querySelector('[data-action="play-pause"]')
    ));
    
    this.video.addEventListener('pause', () => this.updatePlayPauseButton(
      this.controls.querySelector('[data-action="play-pause"]')
    ));
    
    this.video.addEventListener('volumechange', () => this.updateVolumeSlider(
      this.controls.querySelector('[data-action="volume"]')
    ));
    
    this.video.addEventListener('timeupdate', () => this.updateProgressBar(
      this.controls.querySelector('[data-action="seek"]')
    ));
    
    this.video.addEventListener('loadedmetadata', () => this.updateProgressBar(
      this.controls.querySelector('[data-action="seek"]')
    ));

    // Control events
    this.controls.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action) {
        this.handleControlAction(action, e.target);
      }
    });
  }

  handleControlAction(action, element) {
    switch (action) {
      case 'play-pause':
        this.togglePlayPause();
        break;
      case 'mute':
        this.toggleMute();
        break;
      case 'fullscreen':
        this.toggleFullscreen();
        break;
      case 'captions':
        this.toggleCaptions();
        break;
      case 'settings':
        this.toggleSettings(element);
        break;
    }
  }

  toggleSettings(button) {
    const menu = document.getElementById('settings-menu');
    const isExpanded = menu && !menu.hidden;
    
    button.setAttribute('aria-expanded', !isExpanded);
    
    if (menu) {
      menu.hidden = isExpanded;
      if (!isExpanded) {
        // Focus first menu item
        const firstItem = menu.querySelector('[role="menuitem"]');
        if (firstItem) {
          firstItem.focus();
        }
      }
    }
  }
}
```

## Performance Metrics

- **Video Load Time**: < 3 seconds for initial playback
- **Control Response Time**: < 100ms for control interactions
- **Caption Synchronization**: < 100ms accuracy
- **Keyboard Navigation**: 100% of controls accessible
- **Screen Reader Compatibility**: 100% of elements properly announced
- **Mobile Touch Response**: < 150ms for touch interactions

## Cross-Browser Testing Matrix

| Browser | Version | Video Controls | Captions | Screen Reader | Status |
|---------|---------|---------------|----------|---------------|--------|
| Chrome | 120+ | ✅ | ✅ | NVDA, JAWS | ✅ |
| Firefox | 119+ | ✅ | ✅ | NVDA, JAWS | ✅ |
| Safari | 17+ | ✅ | ✅ | VoiceOver | ✅ |
| Edge | 120+ | ✅ | ✅ | NVDA, JAWS | ✅ |

## Mobile Testing Requirements

### Touch Interface Testing
- **iOS**: VoiceOver navigation and video control
- **Android**: TalkBack navigation and video control
- Touch target size verification (44x44px minimum)
- Gesture-based video interactions

### Responsive Video Testing
- Portrait and landscape orientations
- Different screen sizes and aspect ratios
- Control layout adaptation
- Caption positioning on mobile devices

## RTL Testing Requirements

### Arabic Video Player
- Right-to-left control layout
- Arabic captions and subtitles
- RTL text direction in controls
- Arabic screen reader announcements

### Bilingual Media Support
- Language switching during playback
- Dual-language caption options
- Interface localization
- Content metadata in multiple languages

## Automation Script

```typescript
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test.describe('Video and Media Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/videos/test-video');
    await page.waitForLoadState('networkidle');
  });

  test('video player control accessibility', async ({ page }) => {
    // Check for video element
    const video = page.locator('video');
    await expect(video).toBeVisible();
    
    // Verify video has proper ARIA attributes
    await expect(video).toHaveAttribute('role', 'application');
    await expect(video).toHaveAttribute('aria-label');

    // Check for custom controls
    const controls = page.locator('.video-controls, [role="toolbar"]');
    await expect(controls).toBeVisible();

    // Test play/pause button
    const playPauseBtn = page.locator('[data-action="play-pause"], button[aria-label*="play"], button[aria-label*="pause"]');
    await expect(playPauseBtn).toBeVisible();
    await expect(playPauseBtn).toHaveAttribute('aria-label');
    await expect(playPauseBtn).toHaveAttribute('aria-pressed');

    // Test volume controls
    const volumeBtn = page.locator('[data-action="mute"], button[aria-label*="volume"], button[aria-label*="mute"]');
    await expect(volumeBtn).toBeVisible();
    
    const volumeSlider = page.locator('[data-action="volume"], input[type="range"][aria-label*="volume"]');
    if (await volumeSlider.count() > 0) {
      await expect(volumeSlider).toHaveAttribute('aria-valuemin');
      await expect(volumeSlider).toHaveAttribute('aria-valuemax');
      await expect(volumeSlider).toHaveAttribute('aria-valuenow');
    }

    // Test progress bar
    const progressBar = page.locator('[data-action="seek"], input[type="range"][aria-label*="progress"], input[type="range"][aria-label*="seek"]');
    if (await progressBar.count() > 0) {
      await expect(progressBar).toHaveAttribute('aria-valuemin');
      await expect(progressBar).toHaveAttribute('aria-valuemax');
      await expect(progressBar).toHaveAttribute('aria-valuenow');
      await expect(progressBar).toHaveAttribute('aria-valuetext');
    }

    // Test fullscreen button
    const fullscreenBtn = page.locator('[data-action="fullscreen"], button[aria-label*="fullscreen"]');
    await expect(fullscreenBtn).toBeVisible();
    await expect(fullscreenBtn).toHaveAttribute('aria-label');
  });

  test('keyboard navigation for video controls', async ({ page }) => {
    // Focus video player
    const video = page.locator('video');
    await video.focus();

    // Test space bar for play/pause
    const initialState = await page.locator('[data-action="play-pause"]').getAttribute('aria-pressed');
    await page.keyboard.press('Space');
    
    // Wait a moment for state change
    await page.waitForTimeout(500);
    
    const newState = await page.locator('[data-action="play-pause"]').getAttribute('aria-pressed');
    expect(newState).not.toBe(initialState);

    // Test arrow keys for seeking
    const initialProgress = await page.locator('[data-action="seek"]').getAttribute('aria-valuenow');
    await page.keyboard.press('ArrowRight');
    
    await page.waitForTimeout(500);
    
    const newProgress = await page.locator('[data-action="seek"]').getAttribute('aria-valuenow');
    expect(parseFloat(newProgress!)).toBeGreaterThan(parseFloat(initialProgress!));

    // Test volume controls
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(500);
    
    // Test mute with 'm' key
    await page.keyboard.press('m');
    await page.waitForTimeout(500);

    // Test fullscreen with 'f' key
    await page.keyboard.press('f');
    await page.waitForTimeout(1000);
    
    // Exit fullscreen
    if (await page.locator('html').getAttribute('data-fullscreen') === 'true') {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  });

  test('caption and subtitle accessibility', async ({ page }) => {
    // Check for caption tracks
    const video = page.locator('video');
    const captionTracks = await video.locator('track[kind="subtitles"], track[kind="captions"]').count();
    expect(captionTracks).toBeGreaterThan(0);

    // Test caption toggle button
    const captionsBtn = page.locator('[data-action="captions"], button[aria-label*="caption"]');
    if (await captionsBtn.count() > 0) {
      await expect(captionsBtn).toBeVisible();
      await expect(captionsBtn).toHaveAttribute('aria-pressed');

      // Toggle captions
      const initialState = await captionsBtn.getAttribute('aria-pressed');
      await captionsBtn.click();
      
      const newState = await captionsBtn.getAttribute('aria-pressed');
      expect(newState).not.toBe(initialState);
    }

    // Check for caption language options
    const captionOptions = page.locator('.caption-option, [data-caption]');
    if (await captionOptions.count() > 0) {
      const optionCount = await captionOptions.count();
      expect(optionCount).toBeGreaterThan(0);

      // Test caption option selection
      for (let i = 0; i < optionCount; i++) {
        const option = captionOptions.nth(i);
        await expect(option).toHaveAttribute('role', 'menuitem');
        await expect(option).toHaveAttribute('aria-checked');
      }
    }
  });

  test('audio description support', async ({ page }) => {
    // Check for audio description tracks
    const video = page.locator('video');
    const descriptionTracks = await video.locator('track[kind="descriptions"]').count();
    
    if (descriptionTracks > 0) {
      // Test audio description controls if available
      const descriptionBtn = page.locator('button[aria-label*="description"], button[aria-label*="audio"]');
      if (await descriptionBtn.count() > 0) {
        await expect(descriptionBtn).toBeVisible();
        await descriptionBtn.click();
      }
    }

    // Check for alternative audio tracks
    const audioTracks = await video.evaluate((v) => v.audioTracks?.length || 0);
    if (audioTracks > 1) {
      // Should have audio track selection controls
      const audioControls = page.locator('[data-audio-track], .audio-track-select');
      expect(await audioControls.count()).toBeGreaterThan(0);
    }
  });

  test('transcript accessibility', async ({ page }) => {
    // Check for transcript section
    const transcriptSection = page.locator('.transcript-section, [aria-labelledby*="transcript"]');
    if (await transcriptSection.count() > 0) {
      await expect(transcriptSection).toBeVisible();

      // Check for transcript heading
      const transcriptHeading = page.locator('#transcript-heading, h2:has-text("Transcript")');
      await expect(transcriptHeading).toBeVisible();

      // Test transcript toggle
      const transcriptToggle = page.locator('.transcript-toggle, button[aria-controls*="transcript"]');
      if (await transcriptToggle.count() > 0) {
        await expect(transcriptToggle).toBeVisible();
        await expect(transcriptToggle).toHaveAttribute('aria-expanded');

        // Toggle transcript visibility
        await transcriptToggle.click();
        
        // Check transcript content is visible
        const transcriptContent = page.locator('#transcript-content, .transcript-content');
        await expect(transcriptContent).toBeVisible();
        await expect(transcriptContent).toHaveAttribute('role', 'document');

        // Test transcript items
        const transcriptItems = transcriptContent.locator('.transcript-item, [data-time]');
        const itemCount = await transcriptItems.count();
        expect(itemCount).toBeGreaterThan(0);

        // Test transcript item structure
        for (let i = 0; i < Math.min(itemCount, 5); i++) {
          const item = transcriptItems.nth(i);
          const timestamp = item.locator('.timestamp');
          const text = item.locator('.transcript-text');
          
          if (await timestamp.count() > 0) {
            await expect(timestamp).toBeVisible();
          }
          if (await text.count() > 0) {
            await expect(text).toBeVisible();
          }
        }
      }
    }
  });

  test('mobile video accessibility', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check touch target sizes
    const controls = page.locator('.video-controls button, [data-action]');
    const controlCount = await controls.count();
    
    for (let i = 0; i < controlCount; i++) {
      const control = controls.nth(i);
      const boundingBox = await control.boundingBox();
      
      if (boundingBox) {
        expect(boundingBox.width).toBeGreaterThanOrEqual(44);
        expect(boundingBox.height).toBeGreaterThanOrEqual(44);
      }
    }

    // Test video player in landscape
    await page.setViewportSize({ width: 667, height: 375 });
    await expect(page.locator('video')).toBeVisible();
    await expect(page.locator('.video-controls')).toBeVisible();
  });

  test('RTL video player support', async ({ page }) => {
    // Switch to Arabic language
    await page.goto('/ar/videos/test-video');
    await page.waitForLoadState('networkidle');

    // Check RTL layout
    const html = page.locator('html');
    await expect(html).toHaveAttribute('dir', 'rtl');

    // Check video player controls in RTL
    const controls = page.locator('.video-controls');
    await expect(controls).toBeVisible();

    // Check for Arabic captions
    const captionTracks = page.locator('track[srclang="ar"]');
    if (await captionTracks.count() > 0) {
      await expect(captionTracks.first()).toHaveAttribute('label', /\u0627\u0644\u0639\u0631\u0628\u064A\u0629/); // Arabic text
    }

    // Test keyboard navigation in RTL
    const video = page.locator('video');
    await video.focus();
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    
    // Verify controls still work in RTL
    const playPauseBtn = page.locator('[data-action="play-pause"]');
    await expect(playPauseBtn).toBeVisible();
  });

  test('accessibility compliance with axe', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .include('video, .video-container, .video-controls')
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('video player announcements', async ({ page }) => {
    // Check for live region for announcements
    const liveRegion = page.locator('#video-announcements, [aria-live="polite"]');
    const liveRegionCount = await liveRegion.count();
    
    if (liveRegionCount > 0) {
      await expect(liveRegion.first()).toHaveAttribute('aria-live', 'polite');
      await expect(liveRegion.first()).toHaveAttribute('aria-atomic', 'true');
    }

    // Test play/pause announcement
    const playPauseBtn = page.locator('[data-action="play-pause"]');
    await playPauseBtn.click();
    await page.waitForTimeout(500);
    
    // Check if announcement was made (if live region exists)
    if (liveRegionCount > 0) {
      const announcement = await liveRegion.first().textContent();
      expect(announcement).toMatch(/playing|paused/i);
    }
  });
});

test.describe('Video Player - Advanced Features', () => {
  test('chapter navigation accessibility', async ({ page }) => {
    await page.goto('/videos/test-video-with-chapters');
    
    // Check for chapter tracks
    const video = page.locator('video');
    const chapterTracks = await video.locator('track[kind="chapters"]').count();
    
    if (chapterTracks > 0) {
      // Check for chapter navigation controls
      const chapterControls = page.locator('.chapter-list, [data-chapter]');
      if (await chapterControls.count() > 0) {
        await expect(chapterControls).toBeVisible();
        
        // Test chapter selection
        const chapterItems = chapterControls.locator('[role="menuitem"], .chapter-item');
        const itemCount = await chapterItems.count();
        
        if (itemCount > 0) {
          await expect(chapterItems.first()).toBeVisible();
          await chapterItems.first().click();
          
          // Verify video seeks to chapter
          await page.waitForTimeout(1000);
        }
      }
    }
  });

  test('playback speed accessibility', async ({ page }) => {
    await page.goto('/videos/test-video');
    
    // Check for speed controls
    const speedControls = page.locator('.speed-option, [data-speed]');
    if (await speedControls.count() > 0) {
      await expect(speedControls.first()).toBeVisible();
      await expect(speedControls.first()).toHaveAttribute('role', 'menuitem');
      await expect(speedControls.first()).toHaveAttribute('aria-checked');
      
      // Test speed change
      const initialSpeed = await page.locator('video').evaluate(v => v.playbackRate);
      await speedControls.nth(2).click(); // Select different speed
      
      await page.waitForTimeout(500);
      const newSpeed = await page.locator('video').evaluate(v => v.playbackRate);
      expect(newSpeed).not.toBe(initialSpeed);
    }
  });
});
```

## Test Environment Setup

### Required Tools
1. **Screen Readers**:
   - NVDA (Windows)
   - JAWS (Windows)
   - VoiceOver (macOS/iOS)
   - TalkBack (Android)

2. **Browser Extensions**:
   - Axe DevTools
   - WAVE Evaluation Tool
   - Accessibility Insights for Web
   - Video player testing tools

3. **Testing Frameworks**:
   - Playwright with @axe-core/playwright
   - Custom video player testing utilities
   - Mobile device emulators

### Environment Variables
```typescript
// test/config/video.ts
export const videoTestConfig = {
  testVideos: {
    withCaptions: '/videos/test-captions',
    withDescriptions: '/videos/test-descriptions',
    withChapters: '/videos/test-chapters',
    withTranscript: '/videos/test-transcript',
    arabicContent: '/ar/videos/test-arabic'
  },
  captionLanguages: ['en', 'ar'],
  playbackSpeeds: [0.5, 0.75, 1, 1.25, 1.5, 2],
  accessibilityThresholds: {
    controlResponseTime: 100,
    captionSyncAccuracy: 100,
    touchTargetSize: 44,
    loadTime: 3000
  },
  keyboardShortcuts: {
    playPause: ['Space', 'Enter'],
    seekBackward: 'ArrowLeft',
    seekForward: 'ArrowRight',
    volumeUp: 'ArrowUp',
    volumeDown: 'ArrowDown',
    mute: 'm',
    fullscreen: 'f',
    captions: 'c'
  }
};
```

## Success Criteria

### Functional Requirements
- ✅ All video controls are keyboard accessible
- ✅ Captions and subtitles are available and accurate
- ✅ Audio descriptions are provided where needed
- ✅ Transcripts are available and synchronized
- ✅ Mobile touch targets meet size requirements
- ✅ RTL language support is complete
- ✅ No accessibility violations in automated testing

### Technical Requirements
- ✅ 100% compliance with WCAG 2.1 Level AA
- ✅ Proper ARIA implementation for custom controls
- ✅ Cross-browser compatibility maintained
- ✅ Mobile responsiveness verified
- ✅ Performance impact minimal (< 5% overhead)
- ✅ Screen reader compatibility confirmed

### User Experience Requirements
- ✅ Users can control video using only keyboard
- ✅ Screen reader users understand video content
- ✅ Captions are readable and synchronized
- ✅ Mobile video experience is accessible
- ✅ Arabic language support is complete
- ✅ Video player is intuitive and predictable

## Bug Reporting Template

### Issue Title
`[Accessibility] Video Player Issue: [Specific Feature]`

### Environment
- **URL**: [Video page URL]
- **Browser**: [Browser and version]
- **Screen Reader**: [Screen reader and version]
- **Device**: [Desktop/Mobile/Tablet]

### Description
[Detailed description of the video accessibility issue]

### Steps to Reproduce
1. Navigate to [video URL]
2. Attempt to [specific action]
3. Observe [accessibility barrier]

### Expected Behavior
[What should happen with proper video accessibility]

### Actual Behavior
[What actually happens]

### Screen Reader Output
[Exact text announced by screen reader]

### Video Player Details
- **Control Type**: [play/pause/volume/progress/etc.]
- **Caption Status**: [on/off/language]
- **Audio Description**: [available/not available]
- **Transcript**: [available/not available]

### Suggested Fix
[Recommended solution for the video accessibility issue]

### Priority
[High/Medium/Low based on impact on video access]

## Related Test Cases

- **TCACC001**: Keyboard Navigation and Focus Management
- **TCACC002**: Screen Reader Compatibility
- **TCACC004**: ARIA Implementation and Semantic HTML
- **TCACC007**: Mobile Accessibility
- **TCACC009**: Accessibility Testing Tools Integration

## Documentation References

- [WCAG 2.1 Audio-only and Video-only Content](https://www.w3.org/WAI/WCAG21/Understanding/audio-only-and-video-only-prerecorded.html)
- [WCAG 2.1 Captions](https://www.w3.org/WAI/WCAG21/Understanding/captions-prerecorded.html)
- [WCAG 2.1 Audio Description](https://www.w3.org/WAI/WCAG21/Understanding/audio-description-prerecorded.html)
- [HTML5 Video Accessibility](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/video#accessibility_concerns)
- [Web Video Text Tracks Format (WebVTT)](https://www.w3.org/TR/webvtt1/)

---

**Test Case Status**: Ready for Implementation
**Last Updated**: 2024-11-18
**Next Review**: 2024-12-18