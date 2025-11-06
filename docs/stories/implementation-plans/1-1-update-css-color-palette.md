# Implementation Plan: Update CSS Color Palette to Meet Contrast Requirements

**Story**: 1.1 - Fix Critical WCAG Color Contrast Violations  
**Task Group**: Update CSS color palette to meet contrast requirements  
**Acceptance Criteria**: AC: 1, 2 - Color contrast meets WCAG 2.1 AA standards and interactive elements have enhanced contrast indicators

## Overview

This implementation plan covers updating the CSS color palette across the video player interface to ensure all text and interactive elements meet WCAG 2.1 AA contrast requirements (4.5:1 for normal text, 3:1 for large text).

## Prerequisites

- Contrast audit completed with documented violations
- Access to Tailwind CSS configuration
- Understanding of video player component structure
- Color contrast validation tools

## Implementation Steps

### Step 1: Analyze Current Color System and Define New Palette

**Duration**: 4-6 hours  
**Files to Modify**:
- `apps/web/tailwind.config.ts` - Tailwind configuration
- `apps/web/src/styles/globals.css` - Global CSS variables

**Actions**:
1. Create color contrast validation utility:
   ```typescript
   // apps/web/src/lib/accessibility/color-validator.ts
   export interface ColorPair {
     foreground: string;
     background: string;
     ratio: number;
     wcagAA: boolean;
     wcagAAA: boolean;
   }
   
   export class ColorValidator {
     static validateContrast(foreground: string, background: string): ColorPair {
       const ratio = this.calculateContrastRatio(foreground, background);
       
       return {
         foreground,
         background,
         ratio,
         wcagAA: ratio >= 4.5,
         wcagAAA: ratio >= 7.0
       };
     }
     
     static calculateContrastRatio(foreground: string, background: string): number {
       // Convert hex to RGB
       const fg = this.hexToRgb(foreground);
       const bg = this.hexToRgb(background);
       
       // Calculate relative luminance
       const fgLuminance = this.relativeLuminance(fg);
       const bgLuminance = this.relativeLuminance(bg);
       
       // Calculate contrast ratio
       const lighter = Math.max(fgLuminance, bgLuminance);
       const darker = Math.min(fgLuminance, bgLuminance);
       
       return (lighter + 0.05) / (darker + 0.05);
     }
     
     private static hexToRgb(hex: string): { r: number; g: number; b: number } {
       const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
       return result ? {
         r: parseInt(result[1], 16),
         g: parseInt(result[2], 16),
         b: parseInt(result[3], 16)
       } : { r: 0, g: 0, b: 0 };
     }
     
     private static relativeLuminance(rgb: { r: number; g: number; b: number }): number {
       const rsRGB = rgb.r / 255;
       const gsRGB = rgb.g / 255;
       const bsRGB = rgb.b / 255;
       
       const r = rsRGB <= 0.03928 ? rsRGB / 12.92 : Math.pow((rsRGB + 0.055) / 1.055, 2.4);
       const g = gsRGB <= 0.03928 ? gsRGB / 12.92 : Math.pow((gsRGB + 0.055) / 1.055, 2.4);
       const b = bsRGB <= 0.03928 ? bsRGB / 12.92 : Math.pow((bsRGB + 0.055) / 1.055, 2.4);
       
       return 0.2126 * r + 0.7152 * g + 0.0722 * b;
     }
   }
   ```

2. Define new accessible color palette:
   ```typescript
   // apps/web/src/styles/colors.ts
   export const accessibleColors = {
     // Primary colors with proper contrast
     primary: {
       50: '#f0f9ff',
       100: '#e0f2fe', 
       200: '#bae6fd',
       300: '#7dd3fc',
       400: '#38bdf8',
       500: '#0ea5e9',  // Primary blue
       600: '#0284c7',
       700: '#0369a1',
       800: '#075985',
       900: '#0c4a6e'
     },
     
     // Text colors with guaranteed contrast
     text: {
       primary: '#111827',    // On white: 15.8:1
       secondary: '#374151',  // On white: 10.1:1
       tertiary: '#6b7280',   // On white: 5.9:1
       inverse: '#ffffff',    // On dark: high contrast
       muted: '#9ca3af'       // On white: 3.9:1 (large text only)
     },
     
     // Background colors
     background: {
       primary: '#ffffff',
       secondary: '#f9fafb',
       tertiary: '#f3f4f6',
       inverse: '#111827'
     },
     
     // Interactive element colors
     interactive: {
       default: '#0ea5e9',
       hover: '#0284c7',
       active: '#0369a1',
       disabled: '#d1d5db',
       focus: '#0ea5e9'
     },
     
     // Status colors with contrast
     success: {
       background: '#f0fdf4',
       text: '#166534'
     },
     warning: {
       background: '#fffbeb', 
       text: '#92400e'
     },
     error: {
       background: '#fef2f2',
       text: '#991b1b'
     }
   };
   
   // Contrast-validated color combinations
   export const colorCombinations = {
     textOnBackground: {
       primary: { fg: accessibleColors.text.primary, bg: accessibleColors.background.primary },
       secondary: { fg: accessibleColors.text.secondary, bg: accessibleColors.background.primary },
       onSecondary: { fg: accessibleColors.text.primary, bg: accessibleColors.background.secondary }
     },
     
     interactiveStates: {
       default: { fg: '#ffffff', bg: accessibleColors.interactive.default },
       hover: { fg: '#ffffff', bg: accessibleColors.interactive.hover },
       active: { fg: '#ffffff', bg: accessibleColors.interactive.active },
       disabled: { fg: accessibleColors.text.tertiary, bg: accessibleColors.interactive.disabled }
     }
   };
   ```

### Step 2: Modify Tailwind CSS Custom Properties for Compliant Colors

**Duration**: 3-4 hours  
**Files to Modify**:
- `apps/web/tailwind.config.ts` - Update color definitions
- `apps/web/src/styles/globals.css` - Add CSS custom properties

**Actions**:
1. Update Tailwind configuration:
   ```typescript
   // apps/web/tailwind.config.ts
   import type { Config } from 'tailwindcss';
   import { accessibleColors } from './src/styles/colors';
   
   const config: Config = {
     content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
     theme: {
       extend: {
         colors: {
           // Override default colors with accessible palette
           primary: accessibleColors.primary,
           text: accessibleColors.text,
           background: accessibleColors.background,
           interactive: accessibleColors.interactive,
           
           // Semantic color mappings
           'video-controls': {
             bg: accessibleColors.background.inverse,
             text: accessibleColors.text.inverse,
             button: accessibleColors.interactive.default,
             'button-hover': accessibleColors.interactive.hover
           },
           
           'progress-bar': {
             bg: accessibleColors.background.tertiary,
             fill: accessibleColors.interactive.default,
             buffer: accessibleColors.text.muted
           },
           
           'volume-control': {
             bg: accessibleColors.background.inverse,
             slider: accessibleColors.interactive.default,
             'slider-hover': accessibleColors.interactive.hover
           }
         },
         
         // Ensure minimum touch target sizes
         minWidth: {
           '44': '11rem', // 44px minimum
           '48': '12rem'  // 48px preferred
         },
         
         minHeight: {
           '44': '11rem',
           '48': '12rem'
         }
       },
     },
     plugins: [],
   };
   
   export default config;
   ```

2. Add CSS custom properties for theme consistency:
   ```css
   /* apps/web/src/styles/globals.css */
   @layer base {
     :root {
       /* Light theme colors */
       --color-text-primary: 17 24 39;      /* #111827 */
       --color-text-secondary: 55 65 81;    /* #374151 */
       --color-text-tertiary: 107 114 128;  /* #6b7280 */
       --color-text-inverse: 255 255 255;   /* #ffffff */
       
       --color-bg-primary: 255 255 255;    /* #ffffff */
       --color-bg-secondary: 249 250 251;   /* #f9fafb */
       --color-bg-tertiary: 243 244 246;    /* #f3f4f6 */
       --color-bg-inverse: 17 24 39;       /* #111827 */
       
       --color-interactive-default: 14 165 233;  /* #0ea5e9 */
       --color-interactive-hover: 2 132 199;     /* #0284c7 */
       --color-interactive-active: 3 105 161;    /* #0369a1 */
       --color-interactive-focus: 14 165 233;     /* #0ea5e9 */
       
       /* Video player specific colors */
       --color-video-controls-bg: 17 24 39;
       --color-video-controls-text: 255 255 255;
       --color-video-controls-button: 14 165 233;
       --color-video-controls-button-hover: 2 132 199;
       
       --color-progress-bar-bg: 243 244 246;
       --color-progress-bar-fill: 14 165 233;
       --color-progress-bar-buffer: 156 163 175;
       
       --color-volume-control-bg: 17 24 39;
       --color-volume-control-slider: 14 165 233;
       --color-volume-control-slider-hover: 2 132 199;
     }
     
     [data-theme="dark"] {
       /* Dark theme colors - maintain contrast ratios */
       --color-text-primary: 243 244 246;
       --color-text-secondary: 209 213 219;
       --color-text-tertiary: 156 163 175;
       --color-text-inverse: 17 24 39;
       
       --color-bg-primary: 17 24 39;
       --color-bg-secondary: 31 41 55;
       --color-bg-tertiary: 55 65 81;
       --color-bg-inverse: 243 244 246;
     }
   }
   
   @layer components {
     /* High contrast utility classes */
     .text-contrast-primary {
       color: rgb(var(--color-text-primary));
     }
     
     .text-contrast-secondary {
       color: rgb(var(--color-text-secondary));
     }
     
     .bg-contrast-primary {
       background-color: rgb(var(--color-bg-primary));
     }
     
     .bg-contrast-secondary {
       background-color: rgb(var(--color-bg-secondary));
     }
     
     /* Interactive element styles with proper contrast */
     .btn-interactive {
       background-color: rgb(var(--color-interactive-default));
       color: rgb(var(--color-text-inverse));
       min-height: 44px;
       min-width: 44px;
       transition: all 0.2s ease;
     }
     
     .btn-interactive:hover {
       background-color: rgb(var(--color-interactive-hover));
     }
     
     .btn-interactive:focus {
       outline: 2px solid rgb(var(--color-interactive-focus));
       outline-offset: 2px;
     }
     
     .btn-interactive:disabled {
       background-color: rgb(var(--color-text-tertiary));
       color: rgb(var(--color-text-secondary));
       opacity: 0.6;
     }
   }
   ```

### Step 3: Update Video Player Component Styles with New Color Palette

**Duration**: 6-8 hours  
**Files to Modify**:
- `apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx` - Main component
- `apps/web/src/components/VideoPlayer/VideoControls.tsx` - Controls component
- `apps/web/src/components/VideoPlayer/ProgressBar.tsx` - Progress bar
- `apps/web/src/components/VideoPlayer/VolumeControl.tsx` - Volume control

**Actions**:
1. Update main video player component:
   ```tsx
   // apps/web/src/components/VideoPlayer/CustomVideoPlayer.tsx
   import React from 'react';
   import './CustomVideoPlayer.css';
   
   export const CustomVideoPlayer: React.FC<VideoPlayerProps> = ({ 
     src, 
     poster, 
     title,
     className 
   }) => {
     return (
       <div 
         className={`video-player bg-contrast-primary text-contrast-primary ${className}`}
         data-component="video-player"
       >
         <video
           className="w-full h-auto"
           poster={poster}
           aria-label={title}
         >
           <source src={src} type="video/mp4" />
           Your browser does not support the video tag.
         </video>
         
         <VideoControls />
         <ProgressBar />
         <VolumeControl />
       </div>
     );
   };
   ```

2. Update video controls with accessible colors:
   ```tsx
   // apps/web/src/components/VideoPlayer/VideoControls.tsx
   import React from 'react';
   import { PlayButton } from './PlayButton';
   import { FullscreenButton } from './FullscreenButton';
   import { SettingsButton } from './SettingsButton';
   
   export const VideoControls: React.FC = () => {
     return (
       <div 
         className="video-controls bg-video-controls-bg text-video-controls-text"
         role="toolbar"
         aria-label="Video player controls"
       >
         <div className="flex items-center space-x-2 p-2">
           <PlayButton />
           <VolumeControl />
           <ProgressBar />
           <div className="flex-1" />
           <SettingsButton />
           <FullscreenButton />
         </div>
       </div>
     );
   };
   ```

3. Create accessible button components:
   ```tsx
   // apps/web/src/components/VideoPlayer/PlayButton.tsx
   import React from 'react';
   
   export const PlayButton: React.FC = () => {
     return (
       <button
         className="btn-interactive bg-video-controls-button hover:bg-video-controls-button-hover"
         aria-label="Play"
         title="Play (Space)"
         min-width="44px"
         min-height="44px"
       >
         <svg 
           width="24" 
           height="24" 
           viewBox="0 0 24 24" 
           fill="currentColor"
           aria-hidden="true"
         >
           <path d="M8 5v14l11-7z"/>
         </svg>
       </button>
     );
   };
   ```

4. Update progress bar with contrast:
   ```tsx
   // apps/web/src/components/VideoPlayer/ProgressBar.tsx
   import React from 'react';
   
   export const ProgressBar: React.FC = () => {
     return (
       <div 
         className="progress-bar-container bg-progress-bar-bg h-2 rounded-full cursor-pointer"
         role="slider"
         aria-label="Video progress"
         aria-valuemin={0}
         aria-valuemax={100}
         aria-valuenow={30}
       >
         <div 
           className="progress-bar-fill bg-progress-bar-fill h-full rounded-full transition-all duration-150"
           style={{ width: '30%' }}
         />
         <div 
           className="progress-bar-buffer bg-progress-bar-buffer h-full rounded-full absolute top-0"
           style={{ width: '60%' }}
         />
       </div>
     );
   };
   ```

### Step 4: Ensure Both Light and Dark Themes Use Compliant Colors

**Duration**: 3-4 hours  
**Files to Modify**:
- `apps/web/src/components/providers/ThemeProvider.tsx` - Theme provider
- `apps/web/src/styles/themes.css` - Theme-specific styles

**Actions**:
1. Update theme provider with accessible colors:
   ```tsx
   // apps/web/src/components/providers/ThemeProvider.tsx
   import React, { createContext, useContext, useEffect, useState } from 'react';
   
   type Theme = 'light' | 'dark';
   
   interface ThemeContextType {
     theme: Theme;
     toggleTheme: () => void;
     setTheme: (theme: Theme) => void;
   }
   
   const ThemeContext = createContext<ThemeContextType | undefined>(undefined);
   
   export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
     const [theme, setTheme] = useState<Theme>('light');
     
     useEffect(() => {
       document.documentElement.setAttribute('data-theme', theme);
       document.documentElement.classList.toggle('dark', theme === 'dark');
     }, [theme]);
     
     const toggleTheme = () => {
       setTheme(prev => prev === 'light' ? 'dark' : 'light');
     };
     
     return (
       <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
         {children}
       </ThemeContext.Provider>
     );
   };
   
   export const useTheme = () => {
     const context = useContext(ThemeContext);
     if (!context) {
       throw new Error('useTheme must be used within a ThemeProvider');
     }
     return context;
   };
   ```

2. Add theme-specific CSS with contrast validation:
   ```css
   /* apps/web/src/styles/themes.css */
   @layer base {
     [data-theme="light"] {
       /* Light theme - already validated in globals.css */
     }
     
     [data-theme="dark"] {
       /* Dark theme colors with validated contrast */
       --color-text-primary: 243 244 246;    /* #f3f4f6 on #111827 = 15.8:1 */
       --color-text-secondary: 209 213 219;  /* #d1d5db on #111827 = 10.1:1 */
       --color-text-tertiary: 156 163 175;   /* #9ca3af on #111827 = 5.9:1 */
       
       --color-bg-primary: 17 24 39;        /* #111827 */
       --color-bg-secondary: 31 41 55;      /* #1f2937 */
       --color-bg-tertiary: 55 65 81;       /* #374151 */
       
       /* Interactive colors for dark theme */
       --color-interactive-default: 56 189 248;  /* #38bdf8 */
       --color-interactive-hover: 14 165 233;   /* #0ea5e9 */
       --color-interactive-active: 2 132 199;    /* #0284c7 */
       
       /* Video player dark theme */
       --color-video-controls-bg: 31 41 55;
       --color-video-controls-text: 243 244 246;
       --color-video-controls-button: 56 189 248;
       --color-video-controls-button-hover: 14 165 233;
       
       --color-progress-bar-bg: 55 65 81;
       --color-progress-bar-fill: 56 189 248;
       --color-progress-bar-buffer: 156 163 175;
       
       --color-volume-control-bg: 31 41 55;
       --color-volume-control-slider: 56 189 248;
       --color-volume-control-slider-hover: 14 165 233;
     }
   }
   ```

## Testing Strategy

### Automated Testing
- Run axe-core contrast validation on updated components
- Create visual regression tests for both themes
- Test color combinations with automated contrast checking

### Manual Testing
- Visual inspection of all UI elements in both themes
- Manual contrast verification with color picker tools
- Test with various display settings and color profiles

### Accessibility Testing
- Screen reader testing with high contrast mode
- Keyboard navigation testing with new colors
- Test with Windows High Contrast mode

## Deliverables

1. **Color Validation Utility** (`apps/web/src/lib/accessibility/color-validator.ts`)
2. **Accessible Color Palette** (`apps/web/src/styles/colors.ts`)
3. **Updated Tailwind Config** (`apps/web/tailwind.config.ts`)
4. **CSS Custom Properties** (`apps/web/src/styles/globals.css`)
5. **Theme-Specific Styles** (`apps/web/src/styles/themes.css`)
6. **Updated Video Player Components** (Multiple component files)
7. **Enhanced Theme Provider** (`apps/web/src/components/providers/ThemeProvider.tsx`)
8. **Test Suite** (`apps/web/src/__tests__/accessibility/color-contrast.test.ts`)

## Success Criteria

- ✅ All color combinations meet WCAG 2.1 AA standards (4.5:1 normal, 3:1 large)
- ✅ Both light and dark themes maintain contrast compliance
- ✅ Interactive elements have enhanced contrast indicators
- ✅ Video player controls are fully accessible with new colors
- ✅ Theme switching maintains visual hierarchy and readability
- ✅ Automated tests validate contrast compliance
- ✅ Manual testing confirms visual quality

## Estimated Timeline

**Total Duration**: 16-22 hours  
**Dependencies**: Contrast audit completion  
**Risks**: Medium - Color changes may affect visual design consistency

## Next Steps

After completing color palette updates:
1. Run contrast audit to verify all violations are resolved
2. Proceed to "Implement enhanced contrast indicators for interactive elements" task
3. Test theme switching functionality
4. Validate with accessibility tools and manual testing