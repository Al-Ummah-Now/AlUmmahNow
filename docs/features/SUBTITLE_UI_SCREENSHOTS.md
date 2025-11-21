# Subtitles & Captions Upload UI - Visual Guide

## Component Screenshots (Text-Based Mockups)

### 1. SubtitleUploadSection - Empty State (Mobile 375px)

```
┌─────────────────────────────────────┐
│ 🌍 Subtitles / Captions            │
│ Upload subtitle files in multiple   │
│ languages                           │
│                                     │
│              [+ Add Subtitle]       │
├─────────────────────────────────────┤
│                                     │
│              📄                     │
│      No subtitles uploaded yet      │
│                                     │
│ Add subtitle tracks to make your    │
│ video accessible in multiple        │
│ languages                           │
│                                     │
│      [+ Upload First Subtitle]      │
│                                     │
└─────────────────────────────────────┘
```

### 2. SubtitleUploadSection - With Subtitles (Mobile 375px)

```
┌─────────────────────────────────────┐
│ 🌍 Subtitles / Captions            │
│ Upload subtitle files in multiple   │
│ languages                           │
│              [+ Add Subtitle]       │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ 🇬🇧 English                      │ │
│ │     [⭐ Default] [Active]        │ │
│ │     💾 245 KB                    │ │
│ │     📅 Nov 20, 2025              │ │
│ │                     [🗑️ Delete] │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🇸🇦 العربية                     │ │
│ │     [Active]                     │ │
│ │     💾 312 KB                    │ │
│ │     📅 Nov 20, 2025              │ │
│ │  [Set Default]     [🗑️ Delete] │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🇫🇷 Français                     │ │
│ │     [Processing]                 │ │
│ │     💾 198 KB                    │ │
│ │     📅 Nov 20, 2025              │ │
│ │  [Set Default]     [🗑️ Delete] │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

### 3. SubtitleUploadModal - Initial State (Mobile 375px)

```
┌─────────────────────────────────────┐
│  Upload Subtitle                 ✕  │
├─────────────────────────────────────┤
│                                     │
│ Select Language *                   │
│ ┌─────────────────────────────────┐ │
│ │ Choose a language            ▼  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Subtitle File *                     │
│ ┌─────────────────────────────────┐ │
│ │         ⬆️                      │ │
│ │  Drag and drop or click to      │ │
│ │         browse                   │ │
│ │                                  │ │
│ │  Supported: SRT, VTT, SBV       │ │
│ │       (Max 2MB)                  │ │
│ └─────────────────────────────────┘ │
│                                     │
│            [Cancel]  [Upload]       │
│           (disabled) (disabled)     │
└─────────────────────────────────────┘
```

### 4. SubtitleUploadModal - Language Selected (Mobile 375px)

```
┌─────────────────────────────────────┐
│  Upload Subtitle                 ✕  │
├─────────────────────────────────────┤
│                                     │
│ Select Language *                   │
│ ┌─────────────────────────────────┐ │
│ │ 🇬🇧 English                  ▼  │ │
│ └─────────────────────────────────┘ │
│  ▼ Dropdown:                        │
│  ┌───────────────────────────────┐  │
│  │ 🇸🇦 العربية                  │  │
│  │ 🇬🇧 English ✓                 │  │
│  │ 🇵🇰 اردو                      │  │
│  │ 🇫🇷 Français                  │  │
│  │ 🇮🇩 Bahasa Indonesia          │  │
│  │ 🇹🇷 Türkçe                    │  │
│  │ 🇲🇾 Bahasa Melayu             │  │
│  │ 🇧🇩 বাংলা                     │  │
│  │ 🇩🇪 Deutsch                   │  │
│  │ 🇪🇸 Español                   │  │
│  └───────────────────────────────┘  │
│                                     │
│ Subtitle File *                     │
│ ┌─────────────────────────────────┐ │
│ │         ⬆️                      │ │
│ │  Drag and drop or click to      │ │
│ │         browse                   │ │
│ └─────────────────────────────────┘ │
│                                     │
│            [Cancel]  [Upload]       │
│                     (disabled)      │
└─────────────────────────────────────┘
```

### 5. SubtitleUploadModal - File Selected & Validated (Mobile 375px)

```
┌─────────────────────────────────────┐
│  Upload Subtitle                 ✕  │
├─────────────────────────────────────┤
│                                     │
│ Select Language *                   │
│ ┌─────────────────────────────────┐ │
│ │ 🇬🇧 English                  ▼  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Subtitle File *                     │
│ ┌─────────────────────────────────┐ │
│ │  📄 lecture_subtitles.srt       │ │
│ │      245.8 KB                    │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ──────────────────────────────────  │
│ Subtitle Preview                    │
│ Showing first 5 cues                │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ [00:00:00 → 00:00:03]           │ │
│ │ In the name of Allah, the Most  │ │
│ │ Gracious, the Most Merciful     │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ [00:00:04 → 00:00:07]           │ │
│ │ Welcome to today's lecture on   │ │
│ │ Islamic jurisprudence           │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ [00:00:08 → 00:00:12]           │ │
│ │ We will discuss the principles  │ │
│ │ of fiqh and their application   │ │
│ └─────────────────────────────────┘ │
│  +127 more cues                     │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ✅ No issues detected.          │ │
│ │    Subtitles look good!         │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ☑ Set as default subtitle track    │
│                                     │
│            [Cancel]  [Upload]       │
└─────────────────────────────────────┘
```

### 6. SubtitleUploadModal - Uploading (Mobile 375px)

```
┌─────────────────────────────────────┐
│  Upload Subtitle                 ✕  │
├─────────────────────────────────────┤
│                                     │
│ Select Language *                   │
│ ┌─────────────────────────────────┐ │
│ │ 🇬🇧 English                  ▼  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Subtitle File *                     │
│ ┌─────────────────────────────────┐ │
│ │  📄 lecture_subtitles.srt       │ │
│ │      245.8 KB                    │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ☑ Set as default subtitle track    │
│                                     │
│ ──────────────────────────────────  │
│ Uploading...                    67% │
│ ████████████████████░░░░░░░░        │
│ ──────────────────────────────────  │
│                                     │
│         [Cancel]  [⟳ Uploading...]  │
│        (disabled)    (disabled)     │
└─────────────────────────────────────┘
```

### 7. SubtitleUploadModal - Success (Mobile 375px)

```
┌─────────────────────────────────────┐
│  Upload Subtitle                 ✕  │
├─────────────────────────────────────┤
│                                     │
│ Select Language *                   │
│ ┌─────────────────────────────────┐ │
│ │ 🇬🇧 English                  ▼  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Subtitle File *                     │
│ ┌─────────────────────────────────┐ │
│ │  📄 lecture_subtitles.srt       │ │
│ │      245.8 KB                    │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ☑ Set as default subtitle track    │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ✅ Subtitle uploaded            │ │
│ │    successfully!                 │ │
│ └─────────────────────────────────┘ │
│                                     │
│         [Cancel]  [Upload]          │
│        (disabled) (disabled)        │
│                                     │
│         (Modal closes in 1.5s)      │
└─────────────────────────────────────┘
```

### 8. SubtitleUploadModal - Error (Mobile 375px)

```
┌─────────────────────────────────────┐
│  Upload Subtitle                 ✕  │
├─────────────────────────────────────┤
│                                     │
│ Select Language *                   │
│ ┌─────────────────────────────────┐ │
│ │ 🇬🇧 English                  ▼  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Subtitle File *                     │
│ ┌─────────────────────────────────┐ │
│ │  📄 invalid_file.txt            │ │
│ │      3.5 MB                      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ⚠️ File size exceeds 2MB limit  │ │
│ └─────────────────────────────────┘ │
│                                     │
│            [Cancel]  [Upload]       │
│                     (disabled)      │
└─────────────────────────────────────┘
```

### 9. Delete Confirmation Dialog (Mobile 375px)

```
┌─────────────────────────────────────┐
│  Delete Subtitle?                   │
├─────────────────────────────────────┤
│                                     │
│ Are you sure you want to delete     │
│ this subtitle track? This action    │
│ cannot be undone.                   │
│                                     │
│ English                             │
│                                     │
│                                     │
│            [Cancel]                 │
│            [Delete]                 │
│           (red button)              │
└─────────────────────────────────────┘
```

### 10. Desktop View (1024px+)

```
┌──────────────────────────────────────────────────────────────────┐
│ 🌍 Subtitles / Captions                    [+ Add Subtitle]      │
│ Upload subtitle files in multiple languages                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│ ┌───────────────────────────────────────────────────────────────┐│
│ │ 🇬🇧 English          [⭐ Default] [Active]                     ││
│ │     💾 245 KB  📅 Nov 20, 2025              [🗑️ Delete]       ││
│ └───────────────────────────────────────────────────────────────┘│
│                                                                   │
│ ┌───────────────────────────────────────────────────────────────┐│
│ │ 🇸🇦 العربية         [Active]                                  ││
│ │     💾 312 KB  📅 Nov 20, 2025  [Set Default] [🗑️ Delete]     ││
│ └───────────────────────────────────────────────────────────────┘│
│                                                                   │
│ ┌───────────────────────────────────────────────────────────────┐│
│ │ 🇫🇷 Français         [Processing]                              ││
│ │     💾 198 KB  📅 Nov 20, 2025  [Set Default] [🗑️ Delete]     ││
│ └───────────────────────────────────────────────────────────────┘│
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## Color Scheme

### Light Mode
- Background: White (#FFFFFF)
- Border: Gray-300 (#D1D5DB)
- Text Primary: Gray-900 (#111827)
- Text Secondary: Gray-600 (#4B5563)
- Primary Button: Blue-500 (#3B82F6)
- Success: Green-50 (#F0FDF4) / Green-700 (#15803D)
- Error: Red-50 (#FEF2F2) / Red-700 (#B91C1C)
- Warning: Orange-50 (#FFF7ED) / Orange-700 (#C2410C)

### Dark Mode
- Background: Gray-900 (#111827)
- Border: Gray-700 (#374151)
- Text Primary: White (#FFFFFF)
- Text Secondary: Gray-400 (#9CA3AF)
- Primary Button: Blue-500 (#3B82F6)
- Success: Green-900/20 with Green-400 text
- Error: Red-900/20 with Red-400 text
- Warning: Orange-900/20 with Orange-400 text

## Accessibility Features

### Keyboard Navigation
- Tab through all interactive elements
- Enter/Space to trigger file input
- Escape to close modal
- Arrow keys in language dropdown

### Screen Reader Announcements
- "Language selector, choose a language, collapsed"
- "File upload area, drag and drop or click to browse"
- "Upload progress: 67%"
- "Subtitle uploaded successfully"
- "Delete button for English subtitle"

### Focus Indicators
- Visible blue ring around focused elements
- 2px outline with 2px offset
- Works in both light and dark modes

### ARIA Labels
```html
<button aria-label="Delete English subtitle">
<div role="button" aria-label="Upload subtitle file">
<select aria-label="Select subtitle language">
<progress aria-label="Upload progress" value="67" max="100">
```

## RTL Support (Arabic)

### Arabic Version - SubtitleUploadSection

```
┌─────────────────────────────────────┐
│           الترجمات / التعليقات 🌍   │
│       رفع ملفات ترجمة بلغات متعددة  │
│       [إضافة ترجمة +]               │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │                     English 🇬🇧 │ │
│ │        [نشط] [افتراضي ⭐]       │ │
│ │              245 KB 💾          │ │
│ │              2025 نوفمبر 20 📅  │ │
│ │ [حذف 🗑️]                        │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │                      العربية 🇸🇦│ │
│ │                          [نشط]  │ │
│ │              312 KB 💾          │ │
│ │              2025 نوفمبر 20 📅  │ │
│ │ [حذف 🗑️]     [تعيين كافتراضي] │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

## Mobile Gestures

### Drag and Drop
- Works on desktop browsers
- Disabled on mobile (shows click-to-browse instead)
- Visual feedback during drag (border changes to blue)

### Touch Targets
- All buttons: 44x44px minimum
- Adequate spacing between interactive elements
- Delete button is clearly separated from other actions

## Loading States

### Skeleton Loader (While fetching subtitles)
```
┌─────────────────────────────────────┐
│ 🌍 Subtitles / Captions            │
│                                     │
│          ⟳ Loading...               │
│                                     │
└─────────────────────────────────────┘
```

### Validation Loading
```
┌─────────────────────────────────────┐
│  📄 lecture_subtitles.srt           │
│      245.8 KB                        │
│  ⟳ Validating subtitle file...     │
└─────────────────────────────────────┘
```

## Edge Cases

### Maximum Subtitles Reached (10/10)
```
┌─────────────────────────────────────┐
│ 🌍 Subtitles / Captions            │
│ Upload subtitle files in multiple   │
│ languages                           │
│      [+ Add Subtitle] (disabled)    │
│      Max 10 subtitles reached       │
└─────────────────────────────────────┘
```

### Failed Upload
```
┌─────────────────────────────────────┐
│ 🇬🇧 English                         │
│     [Failed] ⚠️                     │
│     💾 245 KB                       │
│     📅 Nov 20, 2025                 │
│     Upload failed. Click to retry.  │
│     [Retry]             [🗑️ Delete]│
└─────────────────────────────────────┘
```

## Integration in Video Edit Page

### Full Page Context
```
┌─────────────────────────────────────┐
│  Edit Video Details                 │
├─────────────────────────────────────┤
│  [Video Preview Player]             │
│                                     │
│  Title (EN/AR Tabs)                 │
│  Description (EN/AR Tabs)           │
│  Thumbnail Selector                 │
│  Tags                               │
│  Privacy Settings                   │
│  ──────────────────────────────────│
│  🌍 Subtitles / Captions            │  ← THIS SECTION
│  [Subtitle list/empty state]       │
│  ──────────────────────────────────│
│  📖 Video Chapters                  │
│  [Chapter editor]                   │
│  ──────────────────────────────────│
│  [Save Changes] [Cancel]            │
└─────────────────────────────────────┘
```

---

**Note:** These are text-based mockups representing the actual UI. The real implementation uses React components with Tailwind CSS styling, lucide-react icons, and shadcn/ui components for a polished, production-ready interface.
