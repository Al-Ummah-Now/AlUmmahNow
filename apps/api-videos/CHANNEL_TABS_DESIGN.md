# Channel Tabs - Complete Design

This document provides the complete design for implementing YouTube-style channel tabs and sections, exactly matching YouTube's implementation.

## Overview

YouTube channels have **tabs** for navigation, and **sections** appear only within the **Home tab**. This design covers both features.

### YouTube's Structure

```
Channel Page
├── Channel Header (banner, avatar, name, subscribe button)
├── Channel Tabs (navigation)
│   ├── Home (⭐ shows sections)
│   ├── Videos (all videos, filterable)
│   ├── Shorts (short-form videos)
│   ├── Live (past, current, upcoming live streams)
│   ├── Playlists (all public playlists)
│   ├── Community (posts, polls - requires 1K+ subscribers)
│   └── About (description, links, stats)
└── Tab Content (changes based on selected tab)
    └── If Home tab: Shows Channel Sections (customizable)
```

---

## Part 1: Channel Tabs

### YouTube's Exact Tabs

YouTube channels have 7 standard tabs:

1. **Home** - Default tab, shows channel trailer + customizable sections
2. **Videos** - All long-form videos, sortable (Latest, Popular, Oldest)
3. **Shorts** - YouTube Shorts only
4. **Live** - Live streams (Past, Current, Upcoming)
5. **Playlists** - All public playlists
6. **Community** - Posts, polls, images (requires 1K+ subscribers)
7. **About** - Channel description, links, stats, contact info

### Tab Visibility Rules

Not all tabs are always visible:

- **Home**: Always visible
- **Videos**: Always visible if channel has videos
- **Shorts**: Only if channel has Shorts
- **Live**: Only if channel has live streams
- **Playlists**: Only if channel has public playlists
- **Community**: Only if channel has 1K+ subscribers
- **About**: Always visible

### Database Schema for Tabs

Tabs don't need database storage - they're determined dynamically based on channel content:

```typescript
/**
 * Channel tab visibility is determined by:
 * - Videos tab: videosCount > 0
 * - Shorts tab: shortsCount > 0
 * - Live tab: liveStreamsCount > 0
 * - Playlists tab: playlistsCount > 0
 * - Community tab: subscribersCount >= 1000
 * - Home and About: always visible
 */
```

Update Channel type in `packages/shared-types/src/channel.ts`:

```typescript
export interface Channel extends Timestamps {
  id: string;
  userId: string;
  email: string;
  name: string;
  nameLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  isMain: boolean;
  isVerified?: boolean;

  // Stats (determine tab visibility)
  subscribersCount?: number;
  videosCount?: number; // Long-form videos
  shortsCount?: number; // Short-form videos
  liveStreamsCount?: number; // Past + upcoming live streams
  playlistsCount?: number; // Public playlists
  totalViews?: number;

  // Metadata
  category?: string;
  tags?: string[];
  websiteUrl?: string;
  socialLinks?: SocialLinks;

  // Timestamps
  dateCreated: string;
  dateModified: string;
}
```

### UI Implementation: Channel Tabs

**File**: `apps/web/src/components/Channel/ChannelTabs.tsx`

```typescript
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Channel } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';

interface ChannelTabsProps {
  channel: Channel;
  locale: string;
}

export function ChannelTabs({ channel, locale }: ChannelTabsProps) {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = getVisibleTabs(channel);

  return (
    <div className="border-b border-gray-200 bg-white sticky top-0 z-10">
      <div className="container mx-auto px-4">
        <nav className="flex gap-6 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => {
            const href = `/${locale}/channels/${channel.id}${tab.path}`;
            const isActive = pathname === href || (tab.path === '' && pathname === `/${locale}/channels/${channel.id}`);

            return (
              <button
                key={tab.id}
                onClick={() => router.push(href)}
                className={cn(
                  'py-4 px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

interface Tab {
  id: string;
  label: string;
  path: string;
}

function getVisibleTabs(channel: Channel): Tab[] {
  const tabs: Tab[] = [
    { id: 'home', label: 'Home', path: '' },
  ];

  if ((channel.videosCount ?? 0) > 0) {
    tabs.push({ id: 'videos', label: 'Videos', path: '/videos' });
  }

  if ((channel.shortsCount ?? 0) > 0) {
    tabs.push({ id: 'shorts', label: 'Shorts', path: '/shorts' });
  }

  if ((channel.liveStreamsCount ?? 0) > 0) {
    tabs.push({ id: 'live', label: 'Live', path: '/live' });
  }

  if ((channel.playlistsCount ?? 0) > 0) {
    tabs.push({ id: 'playlists', label: 'Playlists', path: '/playlists' });
  }

  if ((channel.subscribersCount ?? 0) >= 1000) {
    tabs.push({ id: 'community', label: 'Community', path: '/community' });
  }

  tabs.push({ id: 'about', label: 'About', path: '/about' });

  return tabs;
}
```

### RTL Variant

**File**: `apps/web/src/components/Channel/rtl/ChannelTabs.tsx`

```typescript
// Same as LTR but with RTL-specific adjustments
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Channel } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';

interface ChannelTabsProps {
  channel: Channel;
  locale: string;
}

export function ChannelTabs({ channel, locale }: ChannelTabsProps) {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = getVisibleTabs(channel);

  return (
    <div className="border-b border-gray-200 bg-white sticky top-0 z-10" dir="rtl">
      <div className="container mx-auto px-4">
        <nav className="flex gap-6 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => {
            const href = `/${locale}/channels/${channel.id}${tab.path}`;
            const isActive = pathname === href || (tab.path === '' && pathname === `/${locale}/channels/${channel.id}`);

            return (
              <button
                key={tab.id}
                onClick={() => router.push(href)}
                className={cn(
                  'py-4 px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                )}
              >
                {tab.labelAr}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

interface Tab {
  id: string;
  label: string;
  labelAr: string;
  path: string;
}

function getVisibleTabs(channel: Channel): Tab[] {
  const tabs: Tab[] = [
    { id: 'home', label: 'Home', labelAr: 'الرئيسية', path: '' },
  ];

  if ((channel.videosCount ?? 0) > 0) {
    tabs.push({ id: 'videos', label: 'Videos', labelAr: 'الفيديوهات', path: '/videos' });
  }

  if ((channel.shortsCount ?? 0) > 0) {
    tabs.push({ id: 'shorts', label: 'Shorts', labelAr: 'الفيديوهات القصيرة', path: '/shorts' });
  }

  if ((channel.liveStreamsCount ?? 0) > 0) {
    tabs.push({ id: 'live', label: 'Live', labelAr: 'البث المباشر', path: '/live' });
  }

  if ((channel.playlistsCount ?? 0) > 0) {
    tabs.push({ id: 'playlists', label: 'Playlists', labelAr: 'قوائم التشغيل', path: '/playlists' });
  }

  if ((channel.subscribersCount ?? 0) >= 1000) {
    tabs.push({ id: 'community', label: 'Community', labelAr: 'المجتمع', path: '/community' });
  }

  tabs.push({ id: 'about', label: 'About', labelAr: 'حول', path: '/about' });

  return tabs;
}
```

### Route Structure

Create these pages in Next.js App Router:

```
apps/web/src/app/
├── [locale]/
│   └── channels/
│       └── [id]/
│           ├── page.tsx              # Home tab (shows sections)
│           ├── videos/
│           │   └── page.tsx          # Videos tab
│           ├── shorts/
│           │   └── page.tsx          # Shorts tab
│           ├── live/
│           │   └── page.tsx          # Live tab
│           ├── playlists/
│           │   └── page.tsx          # Playlists tab
│           ├── community/
│           │   └── page.tsx          # Community tab
│           └── about/
│               └── page.tsx          # About tab
```

### Main Channel Page Layout

**File**: `apps/web/src/app/[locale]/channels/[id]/layout.tsx`

```typescript
import { getChannelById } from '@/lib/api/channels';
import { ChannelHeader } from '@/components/Channel/ChannelHeader';
import { ChannelTabs } from '@/components/Channel/ChannelTabs';
import { notFound } from 'next/navigation';

interface ChannelLayoutProps {
  children: React.ReactNode;
  params: {
    locale: string;
    id: string;
  };
}

export default async function ChannelLayout({
  children,
  params,
}: ChannelLayoutProps) {
  const channel = await getChannelById(params.id);

  if (!channel) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Channel Header (banner, avatar, name, subscribe) */}
      <ChannelHeader channel={channel} locale={params.locale} />

      {/* Channel Tabs */}
      <ChannelTabs channel={channel} locale={params.locale} />

      {/* Tab Content */}
      <div className="container mx-auto px-4 py-6">
        {children}
      </div>
    </div>
  );
}
```

### Home Tab (Default)

**File**: `apps/web/src/app/[locale]/channels/[id]/page.tsx`

```typescript
import { getChannelById } from '@/lib/api/channels';
import { ChannelSections } from '@/components/ChannelSections';
import { ChannelTrailer } from '@/components/Channel/ChannelTrailer';
import { notFound } from 'next/navigation';

interface ChannelPageProps {
  params: {
    locale: string;
    id: string;
  };
}

export default async function ChannelPage({ params }: ChannelPageProps) {
  const channel = await getChannelById(params.id);

  if (!channel) {
    notFound();
  }

  return (
    <div className="space-y-8">
      {/* Channel Trailer (for new visitors) */}
      <ChannelTrailer channel={channel} />

      {/* Channel Sections (customizable) */}
      <ChannelSections channelId={params.id} />
    </div>
  );
}
```

### Videos Tab

**File**: `apps/web/src/app/[locale]/channels/[id]/videos/page.tsx`

```typescript
import { getChannelById } from '@/lib/api/channels';
import { listVideos } from '@/lib/api/videos';
import { VideoGrid } from '@/components/VideoGrid';
import { notFound } from 'next/navigation';

interface ChannelVideosPageProps {
  params: {
    locale: string;
    id: string;
  };
  searchParams: {
    sort?: 'latest' | 'popular' | 'oldest';
  };
}

export default async function ChannelVideosPage({
  params,
  searchParams,
}: ChannelVideosPageProps) {
  const channel = await getChannelById(params.id);

  if (!channel) {
    notFound();
  }

  // Fetch videos for this channel
  const sortBy = searchParams.sort === 'popular' ? 'views' : 'dateCreated';
  const sortOrder = searchParams.sort === 'oldest' ? 'asc' : 'desc';

  const videosData = await listVideos({
    channelId: params.id,
    limit: 30,
    sortBy,
    sortOrder,
  });

  return (
    <div className="space-y-6">
      {/* Sort filter */}
      <div className="flex gap-4">
        <SortButton sort="latest" currentSort={searchParams.sort} />
        <SortButton sort="popular" currentSort={searchParams.sort} />
        <SortButton sort="oldest" currentSort={searchParams.sort} />
      </div>

      {/* Video grid */}
      <VideoGrid videos={videosData?.videos ?? []} />
    </div>
  );
}

function SortButton({ sort, currentSort }: { sort: string; currentSort?: string }) {
  const isActive = (currentSort ?? 'latest') === sort;
  const label = sort.charAt(0).toUpperCase() + sort.slice(1);

  return (
    <a
      href={`?sort=${sort}`}
      className={cn(
        'px-4 py-2 rounded-full text-sm font-medium transition-colors',
        isActive
          ? 'bg-blue-600 text-white'
          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
      )}
    >
      {label}
    </a>
  );
}
```

### About Tab

**File**: `apps/web/src/app/[locale]/channels/[id]/about/page.tsx`

```typescript
import { getChannelById } from '@/lib/api/channels';
import { notFound } from 'next/navigation';
import { formatNumber } from '@/lib/utils';

interface ChannelAboutPageProps {
  params: {
    locale: string;
    id: string;
  };
}

export default async function ChannelAboutPage({ params }: ChannelAboutPageProps) {
  const channel = await getChannelById(params.id);

  if (!channel) {
    notFound();
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* Description */}
      <section>
        <h2 className="text-xl font-semibold mb-4">Description</h2>
        <p className="text-gray-700 whitespace-pre-wrap">
          {channel.description || 'No description provided.'}
        </p>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Subscribers" value={formatNumber(channel.subscribersCount ?? 0)} />
        <StatCard label="Videos" value={formatNumber(channel.videosCount ?? 0)} />
        <StatCard label="Views" value={formatNumber(channel.totalViews ?? 0)} />
        <StatCard label="Joined" value={formatDate(channel.dateCreated)} />
      </section>

      {/* Links */}
      {channel.socialLinks && (
        <section>
          <h2 className="text-xl font-semibold mb-4">Links</h2>
          <div className="space-y-2">
            {channel.socialLinks.website && (
              <a href={channel.socialLinks.website} className="text-blue-600 hover:underline block">
                {channel.socialLinks.website}
              </a>
            )}
            {channel.socialLinks.twitter && (
              <a href={channel.socialLinks.twitter} className="text-blue-600 hover:underline block">
                Twitter: {channel.socialLinks.twitter}
              </a>
            )}
            {/* Add more social links */}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4 rounded-lg border">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm text-gray-600">{label}</div>
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
```

---

## Part 2: Channel Sections (Within Home Tab)

For the complete sections implementation, see `CHANNEL_SECTIONS_DESIGN.md`.

**Key points**:
- Sections only appear in the **Home tab** (`/channels/{id}` page)
- 10 section types matching YouTube exactly
- Max 10 sections per channel
- Drag-and-drop reordering in management UI
- Horizontal carousel layout

---

## Implementation Summary

### Phase 1: Channel Tabs (Frontend Only)

**Tasks**:
1. Update Channel type with counts (videosCount, shortsCount, etc.)
2. Create ChannelTabs component (LTR + RTL)
3. Create channel layout with tabs
4. Create individual tab pages (Videos, Shorts, Live, Playlists, Community, About)
5. Implement tab visibility logic

**Files to create**:
- `packages/shared-types/src/channel.ts` (update)
- `apps/web/src/components/Channel/ChannelTabs.tsx`
- `apps/web/src/components/Channel/rtl/ChannelTabs.tsx`
- `apps/web/src/components/Channel/ChannelHeader.tsx`
- `apps/web/src/app/[locale]/channels/[id]/layout.tsx`
- `apps/web/src/app/[locale]/channels/[id]/page.tsx` (Home)
- `apps/web/src/app/[locale]/channels/[id]/videos/page.tsx`
- `apps/web/src/app/[locale]/channels/[id]/shorts/page.tsx`
- `apps/web/src/app/[locale]/channels/[id]/live/page.tsx`
- `apps/web/src/app/[locale]/channels/[id]/playlists/page.tsx`
- `apps/web/src/app/[locale]/channels/[id]/community/page.tsx`
- `apps/web/src/app/[locale]/channels/[id]/about/page.tsx`

**Estimated time**: 8-10 hours

### Phase 2: Channel Sections

See `CHANNEL_SECTIONS_DESIGN.md` for complete implementation.

**Estimated time**: 24-32 hours

---

## Total Estimated Time

**Channel Tabs**: 8-10 hours
**Channel Sections**: 24-32 hours

**Total**: 32-42 hours

---

## References

- [YouTube Help - Channel Tabs](https://www.dummies.com/article/technology/social-media/youtube/youtube-channel-tabs-143455/)
- [YouTube Help - Customize channel layout](https://support.google.com/youtube/answer/3219384)
- [Channel Sections Design](./CHANNEL_SECTIONS_DESIGN.md)
