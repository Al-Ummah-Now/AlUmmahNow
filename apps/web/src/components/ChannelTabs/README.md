# Channel Tabs Component

Professional tab navigation for channel pages with full bilingual support (LTR/RTL).

## Overview

The ChannelTabs component provides a Material Design-inspired tab navigation system for channel pages. It includes:

- **Horizontal scrollable tab bar** with overflow indicators
- **URL-based state management** (tab parameter in query string)
- **Full RTL support** with reversed scroll direction
- **Responsive design** (mobile, tablet, desktop)
- **Accessibility features** (ARIA roles, keyboard navigation)
- **Tab content rendering** with lazy loading support

## Components

### 1. ChannelTabBar (LTR)
**Location:** `/src/components/ChannelTabs/index.tsx`

Main tab navigation component for LTR languages (English).

**Props:**
- `channelId` (string, required) - The channel ID
- `isOwner` (boolean, optional) - Whether the current user owns the channel
- `defaultTab` (ChannelTab, optional, default: 'home') - Default active tab
- `hiddenTabs` (ChannelTab[], optional, default: []) - Tabs to hide

**Example:**
```tsx
import { ChannelTabBar } from '@/components/ChannelTabs';

<ChannelTabBar
  channelId="channel-123"
  isOwner={true}
  defaultTab="home"
  hiddenTabs={['community']}
/>
```

### 2. ChannelTabBar (RTL)
**Location:** `/src/components/ChannelTabs/rtl/index.tsx`

Tab navigation component for RTL languages (Arabic).

- Same props as LTR version
- Reversed scroll direction
- RTL-aware scroll indicators
- Right-to-left layout

**Example:**
```tsx
import { ChannelTabBar } from '@/components/ChannelTabs/rtl';

<ChannelTabBar
  channelId="channel-123"
  isOwner={true}
/>
```

### 3. ChannelTabContent
**Location:** `/src/components/ChannelTabs/ChannelTabContent.tsx`

Renders content for each tab based on the active tab from URL.

**Props:**
- `channelId` (string, required) - The channel ID
- `defaultTab` (ChannelTab, optional, default: 'home') - Default active tab

**Example:**
```tsx
import { ChannelTabContent } from '@/components/ChannelTabs/ChannelTabContent';

<ChannelTabContent channelId="channel-123" />
```

## Available Tabs

| Tab ID | Label (EN) | Label (AR) | Description |
|--------|------------|------------|-------------|
| `home` | Home | الرئيسية | Channel sections (featured content) |
| `videos` | Videos | الفيديوهات | All videos grid |
| `shorts` | Shorts | الفيديوهات القصيرة | Short-form videos |
| `live` | Live | البث المباشر | Live streams |
| `playlists` | Playlists | قوائم التشغيل | Playlist grid |
| `community` | Community | المجتمع | Community posts |
| `channels` | Channels | القنوات | Featured channels |
| `about` | About | حول القناة | Channel information |

## Usage in Channel Pages

### English (LTR) - `/app/[locale]/channels/[id]/page.tsx`

```tsx
import { ChannelTabBar } from '@/components/ChannelTabs';
import { ChannelTabContent } from '@/components/ChannelTabs/ChannelTabContent';

function ChannelPage() {
  const { isRTL } = useLanguage();

  return (
    <div>
      {/* Channel header */}

      {/* Tab navigation */}
      {isRTL ? (
        <ChannelTabBarRTL channelId={id} isOwner={isOwner} />
      ) : (
        <ChannelTabBar channelId={id} isOwner={isOwner} />
      )}

      {/* Tab content */}
      <ChannelTabContent channelId={id} />
    </div>
  );
}
```

## URL State Management

Tabs use URL query parameters for state management:

- **Default tab:** `/channel/123` → Shows 'home' tab
- **Specific tab:** `/channel/123?tab=videos` → Shows 'videos' tab
- **Navigation:** Clicking a tab updates the URL without page reload

**Benefits:**
- Shareable links to specific tabs
- Browser back/forward navigation
- Bookmark support
- SEO-friendly URLs

## Accessibility

### ARIA Attributes
- `role="tablist"` on tab container
- `role="tab"` on each tab button
- `aria-selected` indicates active tab
- `aria-controls` links tab to panel
- `role="tabpanel"` on content areas
- `aria-labelledby` on panels

### Keyboard Navigation
- **Tab key:** Move focus to tab bar
- **Arrow keys:** Navigate between tabs (planned)
- **Enter/Space:** Activate focused tab (planned)
- **Home/End:** Jump to first/last tab (planned)

### Screen Reader Support
- Semantic HTML (nav, button elements)
- Clear labels in both languages
- Focus management
- State announcements

## Responsive Behavior

### Desktop (1024px+)
- Full tab bar visible
- Smooth hover effects
- Scroll indicators when needed

### Tablet (768px-1023px)
- Scrollable tabs with indicators
- Touch-optimized spacing
- Compact padding

### Mobile (<768px)
- Compact tab layout
- Horizontal scroll
- Clear scroll indicators
- Touch-friendly targets (48px min)

## RTL Support

The RTL variant provides proper right-to-left support:

1. **Layout Direction:** `dir="rtl"` on container
2. **Scroll Direction:** Reversed scroll logic
3. **Indicators:** Swapped left/right scroll buttons
4. **Text:** Arabic labels from i18n
5. **Icons:** Mirrored chevron directions

## Styling

### Tailwind Classes
- Active tab: `border-blue-600 text-blue-600`
- Inactive tab: `border-transparent text-gray-600 hover:text-blue-600`
- Smooth transitions on all states
- Dark mode support

### Custom Utilities
```css
/* Hide scrollbar while maintaining scroll */
.scrollbar-hide {
  -ms-overflow-style: none;  /* IE/Edge */
  scrollbar-width: none;     /* Firefox */
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;             /* Chrome/Safari */
}
```

## Performance

- **Lazy content rendering:** Only active tab content is rendered
- **Optimized scroll detection:** Debounced scroll handlers
- **Minimal re-renders:** URL-based state prevents unnecessary updates
- **Code splitting:** Tab content can be dynamically imported

## Future Enhancements

1. **Tab Management (Owner Only)**
   - Show/hide tabs
   - Reorder tabs
   - Set default tab
   - Create custom tabs

2. **Keyboard Navigation**
   - Arrow key support
   - Home/End keys
   - Focus trapping

3. **Tab Indicators**
   - Badge counts (e.g., new posts)
   - Live stream indicator
   - Upload notifications

4. **Analytics Integration**
   - Track tab views
   - User engagement metrics
   - Popular tab analytics

## Translation Keys

All labels use the i18n system:

**English:** `/src/lib/i18n/translations/en.ts`
```ts
channel: {
  home: 'Home',
  videos: 'Videos',
  shorts: 'Shorts',
  live: 'Live',
  playlists: 'Playlists',
  community: 'Community',
  channels: 'Channels',
  about: 'About',
  manageTabs: 'Manage Tabs',
  setAsDefault: 'Set as Default',
  hideTab: 'Hide Tab',
  showTab: 'Show Tab',
  // ...
}
```

**Arabic:** `/src/lib/i18n/translations/ar.ts`
```ts
channel: {
  home: 'الرئيسية',
  videos: 'الفيديوهات',
  shorts: 'الفيديوهات القصيرة',
  live: 'البث المباشر',
  playlists: 'قوائم التشغيل',
  community: 'المجتمع',
  channels: 'القنوات',
  about: 'حول القناة',
  manageTabs: 'إدارة التبويبات',
  // ...
}
```

## Testing

### Manual Testing Checklist

**LTR (English):**
- [ ] All tabs visible and clickable
- [ ] Active tab highlighted correctly
- [ ] URL updates on tab click
- [ ] Scroll indicators appear/disappear correctly
- [ ] Smooth scroll behavior
- [ ] Direct URL navigation works

**RTL (Arabic):**
- [ ] Tabs display right-to-left
- [ ] Arabic labels display correctly
- [ ] Scroll direction reversed
- [ ] Indicators on correct sides
- [ ] URL updates correctly

**Responsive:**
- [ ] Desktop: Full tab bar
- [ ] Tablet: Scrollable tabs
- [ ] Mobile: Compact layout
- [ ] Touch scroll works

**Accessibility:**
- [ ] Screen reader announces tabs
- [ ] Focus visible on keyboard navigation
- [ ] ARIA attributes correct
- [ ] Tab order logical

## Logging

Client-side logging for debugging:

```ts
logger.info('[ChannelTabBar] Tab clicked', {
  tab,
  channelId,
  activeTab
});
```

Log messages prefixed with:
- `[ChannelTabBar]` - LTR component
- `[ChannelTabBar:RTL]` - RTL component

## Dependencies

- React 19
- Next.js 15 (App Router)
- `useLanguage` hook
- `useSearchParams`, `useRouter`, `usePathname` (Next.js navigation)
- `logger` (client-side logging)

## Files Structure

```
src/components/ChannelTabs/
├── index.tsx                    # LTR tab bar
├── rtl/
│   └── index.tsx               # RTL tab bar
├── ChannelTabContent.tsx       # Tab content renderer
└── README.md                   # This file
```

## Related Components

- **ChannelSections** - Renders channel sections in Home tab
- **Navigation** - Main app navigation (uses similar patterns)
- **Header** - Top navigation bar

## See Also

- [Channel Sections Documentation](../ChannelSections/README.md)
- [i18n System](../../lib/i18n/README.md)
- [useLanguage Hook](../../hooks/useLanguage.ts)
