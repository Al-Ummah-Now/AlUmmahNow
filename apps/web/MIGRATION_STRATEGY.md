# Locale Route Migration Strategy

## Executive Summary

This document outlines a comprehensive strategy for migrating Al Ummah Now's web application from static locale routes (`/ar/*` and `/en/*`) to dynamic locale routes (`/[locale]/*`). This migration will:

- **Reduce code duplication** from 29 pages (14 AR + 15 EN) to 15 unified pages
- **Improve maintainability** by centralizing locale logic
- **Enable easier addition** of new locales in the future
- **Maintain full RTL/LTR support** through component selection
- **Ensure zero downtime** through phased rollout

**Estimated Timeline**: 2-3 weeks (4-6 hours per phase)
**Risk Level**: Medium (high test coverage mitigates risk)

---

## Current State

### File Inventory

**Arabic Routes (14 pages):**
```
apps/web/src/app/ar/
├── feed/page.tsx
├── layout.tsx
├── live/page.tsx
├── page.tsx
├── playlists/[id]/page.tsx
├── profile/edit/page.tsx
├── profile/page.tsx
├── settings/page.tsx
├── subscriptions/page.tsx
├── test/page.tsx
├── upload/page.tsx
├── videos/[id]/page.tsx
├── watch-history/page.tsx
└── watch-later/page.tsx
```

**English Routes (15 pages):**
```
apps/web/src/app/en/
├── channels/[id]/page.tsx
├── feed/page.tsx
├── layout.tsx
├── live/page.tsx
├── page.tsx
├── playlists/[id]/page.tsx
├── profile/edit/page.tsx
├── profile/page.tsx
├── settings/page.tsx
├── subscriptions/page.tsx
├── test/page.tsx
├── upload/page.tsx
├── videos/[id]/page.tsx
├── watch-history/page.tsx
└── watch-later/page.tsx
```

**Missing Pages:**
- `ar/channels/[id]/page.tsx` (exists in EN only)

### Component Structure

**LTR Components (default):**
```
apps/web/src/components/
├── Feed/index.tsx
├── LiveStreams/index.tsx
├── VideoPlayer/index.tsx
└── ... (50+ components)
```

**RTL Components:**
```
apps/web/src/components/
├── Feed/rtl/index.tsx
├── LiveStreams/rtl/index.tsx
├── VideoPlayer/rtl/index.tsx
└── ... (50+ RTL variants)
```

---

## Target State

### Final Route Structure

```
apps/web/src/app/
├── [locale]/
│   ├── channels/[id]/page.tsx       (unified)
│   ├── feed/page.tsx                (unified)
│   ├── layout.tsx                   (unified with locale support)
│   ├── live/page.tsx                (unified)
│   ├── page.tsx                     (unified home)
│   ├── playlists/[id]/page.tsx      (unified)
│   ├── profile/
│   │   ├── edit/page.tsx            (unified)
│   │   └── page.tsx                 (unified)
│   ├── settings/page.tsx            (unified)
│   ├── subscriptions/page.tsx       (unified)
│   ├── test/page.tsx                (unified)
│   ├── upload/page.tsx              (unified)
│   ├── videos/[id]/page.tsx         (unified)
│   ├── watch-history/page.tsx       (unified)
│   └── watch-later/page.tsx         (unified)
├── layout.tsx                       (root layout)
└── page.tsx                         (root redirect to /en)
```

**Total**: 15 unified pages (down from 29)

---

## Migration Phases

### Phase 0: Prerequisites (1-2 hours)

**Objective**: Set up infrastructure and helpers

**Tasks**:
1. ✅ Create helper utilities (`src/lib/i18n/utils/localeHelpers.ts`)
2. ✅ Document migration strategy (this file)
3. Create example migration (`MIGRATION_EXAMPLE.md`)
4. Set up testing framework for locale routes

**Verification**:
```bash
# Verify helpers compile
npx tsc --noEmit src/lib/i18n/utils/localeHelpers.ts

# Run existing tests
pnpm test

# Lint helpers
pnpm lint src/lib/i18n/utils/localeHelpers.ts
```

**Deliverables**:
- [ ] `src/lib/i18n/utils/localeHelpers.ts` with full type safety
- [ ] `MIGRATION_STRATEGY.md` (this document)
- [ ] `MIGRATION_EXAMPLE.md` with working example
- [ ] Test plan documented

---

### Phase 1: Create Base Structure (2-3 hours)

**Objective**: Set up `[locale]` directory with minimal functionality

**Tasks**:
1. Create `app/[locale]/` directory
2. Migrate root layout to support dynamic locale
3. Create dynamic locale layout
4. Set up locale detection and validation
5. Add redirect logic from root to default locale

**Implementation**:

**Step 1.1: Create dynamic locale layout**

```tsx
// apps/web/src/app/[locale]/layout.tsx
import { notFound } from 'next/navigation';
import { isLocaleSupported, getTextDirection } from '@/lib/i18n/utils';
import { getDictionary } from '@/lib/i18n/dictionaries';

export async function generateStaticParams() {
  return [
    { locale: 'en' },
    { locale: 'ar' },
  ];
}

interface LocaleLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleLayoutProps) {
  const { locale } = await params;

  // Validate locale
  if (!isLocaleSupported(locale)) {
    notFound();
  }

  const dir = getTextDirection(locale);
  const dict = await getDictionary(locale);

  return (
    <html lang={locale} dir={dir}>
      <body>
        {children}
      </body>
    </html>
  );
}
```

**Step 1.2: Update root page for redirect**

```tsx
// apps/web/src/app/page.tsx
import { redirect } from 'next/navigation';
import { getFallbackLocale } from '@/lib/i18n/utils';

export default function RootPage() {
  const locale = getFallbackLocale();
  redirect(`/${locale}`);
}
```

**Verification**:
```bash
# Build should succeed
pnpm --filter @al-ummah/web build

# Type check
npx tsc --noEmit

# Test routes
curl http://localhost:3000/         # Should redirect to /en
curl http://localhost:3000/en       # Should load
curl http://localhost:3000/ar       # Should load
curl http://localhost:3000/invalid  # Should 404
```

**Deliverables**:
- [ ] `app/[locale]/layout.tsx` with locale validation
- [ ] Root redirect working
- [ ] Locale detection functional
- [ ] Type safety verified

---

### Phase 2: Migrate Simple Pages (4-6 hours)

**Objective**: Migrate pages with minimal logic (Feed, Live, Watch History, Watch Later)

**Pattern**: Pages that primarily render a component with props

**Migration Order** (simplest first):
1. Feed (`/feed`)
2. Live Streams (`/live`)
3. Watch History (`/watch-history`)
4. Watch Later (`/watch-later`)
5. Subscriptions (`/subscriptions`)

**Example Migration: Feed Page**

**Before** (2 files):

```tsx
// apps/web/src/app/ar/feed/page.tsx
import Feed from '@/components/Feed/rtl';

export default function FeedPageAR() {
  return <Feed lang="ar" />;
}
```

```tsx
// apps/web/src/app/en/feed/page.tsx
import Feed from '@/components/Feed';

export default function FeedPageEN() {
  return <Feed lang="en" />;
}
```

**After** (1 file):

```tsx
// apps/web/src/app/[locale]/feed/page.tsx
import { getLocaleComponent } from '@/lib/i18n/utils';
import Feed from '@/components/Feed';
import FeedRTL from '@/components/Feed/rtl';

interface FeedPageProps {
  params: Promise<{ locale: string }>;
}

export default async function FeedPage({ params }: FeedPageProps) {
  const { locale } = await params;

  const FeedComponent = getLocaleComponent(
    locale,
    Feed,
    FeedRTL
  );

  return <FeedComponent lang={locale} />;
}
```

**Testing Checklist**:
- [ ] `/en/feed` renders English version
- [ ] `/ar/feed` renders Arabic version (RTL)
- [ ] Components receive correct `lang` prop
- [ ] Navigation works in both directions
- [ ] Build succeeds without errors
- [ ] Type checking passes

**Verification Script**:
```bash
# Test all migrated simple pages
for page in feed live watch-history watch-later subscriptions; do
  echo "Testing $page..."
  curl -s http://localhost:3000/en/$page | grep -q "html"
  curl -s http://localhost:3000/ar/$page | grep -q "html"
done
```

**Deliverables**:
- [ ] 5 unified pages in `app/[locale]/`
- [ ] All tests passing
- [ ] No TypeScript errors
- [ ] Manual testing complete

---

### Phase 3: Migrate Complex Pages (6-8 hours)

**Objective**: Migrate pages with dynamic segments and server-side logic

**Migration Order**:
1. Video Player (`/videos/[id]`)
2. Channel (`/channels/[id]`)
3. Playlist (`/playlists/[id]`)
4. Profile (`/profile`)
5. Profile Edit (`/profile/edit`)

**Example Migration: Video Player**

**Before** (2 files):

```tsx
// apps/web/src/app/ar/videos/[id]/page.tsx
import { notFound } from 'next/navigation';
import VideoPlayer from '@/components/VideoPlayer/rtl';
import { getVideo } from '@/lib/api/videos';

interface VideoPageProps {
  params: Promise<{ id: string }>;
}

export default async function VideoPageAR({ params }: VideoPageProps) {
  const { id } = await params;
  const video = await getVideo(id);

  if (!video) {
    notFound();
  }

  return <VideoPlayer video={video} lang="ar" />;
}
```

```tsx
// apps/web/src/app/en/videos/[id]/page.tsx
import { notFound } from 'next/navigation';
import VideoPlayer from '@/components/VideoPlayer';
import { getVideo } from '@/lib/api/videos';

interface VideoPageProps {
  params: Promise<{ id: string }>;
}

export default async function VideoPageEN({ params }: VideoPageProps) {
  const { id } = await params;
  const video = await getVideo(id);

  if (!video) {
    notFound();
  }

  return <VideoPlayer video={video} lang="en" />;
}
```

**After** (1 file):

```tsx
// apps/web/src/app/[locale]/videos/[id]/page.tsx
import { notFound } from 'next/navigation';
import { getLocaleComponent } from '@/lib/i18n/utils';
import VideoPlayer from '@/components/VideoPlayer';
import VideoPlayerRTL from '@/components/VideoPlayer/rtl';
import { getVideo } from '@/lib/api/videos';

interface VideoPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

export default async function VideoPage({ params }: VideoPageProps) {
  const { locale, id } = await params;

  // Fetch video data (same for all locales)
  const video = await getVideo(id);

  if (!video) {
    notFound();
  }

  // Select component based on locale
  const VideoPlayerComponent = getLocaleComponent(
    locale,
    VideoPlayer,
    VideoPlayerRTL
  );

  return <VideoPlayerComponent video={video} lang={locale} />;
}

// Generate static params for static generation
export async function generateStaticParams() {
  // This would be populated from your video API
  return [];
}
```

**Key Patterns**:

1. **Multiple Dynamic Segments**:
```tsx
// Params now include both locale and other segments
params: Promise<{
  locale: string;
  id: string;        // or any other dynamic segment
}>
```

2. **Data Fetching**:
```tsx
// Fetch once, use for both locales (data is locale-agnostic)
const data = await fetchData(id);

// UI selection is locale-specific
const Component = getLocaleComponent(locale, Default, RTL);
```

3. **Error Handling**:
```tsx
// Error handling is locale-agnostic
if (!data) {
  notFound(); // Works for all locales
}
```

**Testing Checklist**:
- [ ] `/en/videos/123` renders English video player
- [ ] `/ar/videos/123` renders Arabic video player (RTL)
- [ ] Invalid video IDs trigger 404
- [ ] Video data loads correctly
- [ ] Navigation between videos works
- [ ] Related videos appear
- [ ] Comments render in correct direction

**Deliverables**:
- [ ] 5 unified dynamic pages
- [ ] Server-side data fetching working
- [ ] Error handling functional
- [ ] Type safety maintained

---

### Phase 4: Migrate Settings & Upload (4-5 hours)

**Objective**: Migrate pages with forms and client-side state

**Migration Order**:
1. Settings (`/settings`)
2. Upload (`/upload`)

**Example Migration: Settings Page**

**Before** (2 files):

```tsx
// apps/web/src/app/ar/settings/page.tsx
import Settings from '@/components/Settings/rtl';

export default function SettingsPageAR() {
  return <Settings lang="ar" />;
}
```

**After** (1 file):

```tsx
// apps/web/src/app/[locale]/settings/page.tsx
import { getLocaleComponent } from '@/lib/i18n/utils';
import Settings from '@/components/Settings';
import SettingsRTL from '@/components/Settings/rtl';

interface SettingsPageProps {
  params: Promise<{ locale: string }>;
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { locale } = await params;

  const SettingsComponent = getLocaleComponent(
    locale,
    Settings,
    SettingsRTL
  );

  return <SettingsComponent lang={locale} />;
}
```

**Key Considerations**:

1. **Form Submissions**: Ensure form actions respect locale
```tsx
// In the component
'use client';

import { useParams } from 'next/navigation';
import { getLocalizedPath } from '@/lib/i18n/utils';

export function SettingsForm() {
  const params = useParams();
  const locale = params.locale as string;

  const handleSubmit = async (data: FormData) => {
    // Form submission logic
    // Redirect with locale
    router.push(getLocalizedPath(locale, '/profile'));
  };
}
```

2. **Client-Side Navigation**:
```tsx
import { getLocalizedPath } from '@/lib/i18n/utils';

// In Link components
<Link href={getLocalizedPath(locale, '/profile')}>
  Profile
</Link>
```

**Testing Checklist**:
- [ ] Settings page loads in both locales
- [ ] Form submissions work
- [ ] Redirects maintain locale
- [ ] Validation messages in correct language
- [ ] Upload page functional
- [ ] File uploads work in both locales

**Deliverables**:
- [ ] Settings page unified
- [ ] Upload page unified
- [ ] Forms working correctly
- [ ] Client-side navigation functional

---

### Phase 5: Migrate Home & Test Pages (2-3 hours)

**Objective**: Complete migration of remaining pages

**Migration Order**:
1. Home (`/page.tsx`)
2. Test page (`/test/page.tsx`)

**Example Migration: Home Page**

```tsx
// apps/web/src/app/[locale]/page.tsx
import { getLocaleComponent } from '@/lib/i18n/utils';
import Home from '@/components/Home';
import HomeRTL from '@/components/Home/rtl';

interface HomePageProps {
  params: Promise<{ locale: string }>;
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;

  const HomeComponent = getLocaleComponent(
    locale,
    Home,
    HomeRTL
  );

  return <HomeComponent lang={locale} />;
}
```

**Deliverables**:
- [ ] Home page unified
- [ ] Test page unified
- [ ] All pages migrated

---

### Phase 6: Cleanup & Verification (3-4 hours)

**Objective**: Remove old routes and verify migration

**Tasks**:

1. **Remove Static Locale Routes**:
```bash
# After verifying all pages work
rm -rf apps/web/src/app/ar/
rm -rf apps/web/src/app/en/
```

2. **Update Internal Links**:
```bash
# Find and update hardcoded locale links
rg "/en/" apps/web/src --type tsx
rg "/ar/" apps/web/src --type tsx
```

3. **Verify All Routes**:
```bash
# Test script to verify all routes
#!/bin/bash

ROUTES=(
  ""
  "feed"
  "live"
  "videos/test-id"
  "channels/test-id"
  "playlists/test-id"
  "profile"
  "profile/edit"
  "settings"
  "subscriptions"
  "upload"
  "watch-history"
  "watch-later"
)

for route in "${ROUTES[@]}"; do
  echo "Testing /$route..."
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/en/$route"
  curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/ar/$route"
done
```

4. **Update Middleware** (if exists):
```tsx
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isLocaleSupported, getFallbackLocale } from '@/lib/i18n/utils';

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Check if pathname is missing locale
  const pathnameHasLocale = /^\/[a-z]{2}(\/|$)/.test(pathname);

  if (!pathnameHasLocale) {
    const locale = getFallbackLocale();
    return NextResponse.redirect(
      new URL(`/${locale}${pathname}`, request.url)
    );
  }

  // Extract locale from pathname
  const locale = pathname.split('/')[1];

  // Verify locale is supported
  if (!isLocaleSupported(locale)) {
    const fallbackLocale = getFallbackLocale();
    return NextResponse.redirect(
      new URL(pathname.replace(`/${locale}`, `/${fallbackLocale}`), request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
```

**Final Verification Checklist**:
- [ ] All 15 pages accessible via `/en/*` and `/ar/*`
- [ ] Root `/` redirects to `/en`
- [ ] Invalid locales return 404
- [ ] RTL layouts work correctly
- [ ] All internal links use `getLocalizedPath()`
- [ ] Build succeeds: `pnpm build`
- [ ] Type check passes: `pnpm type-check`
- [ ] Linting passes: `pnpm lint`
- [ ] No console errors in browser
- [ ] All forms submit correctly
- [ ] Navigation preserves locale
- [ ] SEO metadata correct for both locales

**Deliverables**:
- [ ] Old routes removed
- [ ] All links updated
- [ ] Middleware configured
- [ ] Full test suite passing

---

## Patterns & Examples

### Pattern 1: Simple Component Selection

**Use Case**: Page with just a component, no data fetching

```tsx
// apps/web/src/app/[locale]/feed/page.tsx
import { getLocaleComponent } from '@/lib/i18n/utils';
import Feed from '@/components/Feed';
import FeedRTL from '@/components/Feed/rtl';

interface FeedPageProps {
  params: Promise<{ locale: string }>;
}

export default async function FeedPage({ params }: FeedPageProps) {
  const { locale } = await params;

  const FeedComponent = getLocaleComponent(locale, Feed, FeedRTL);

  return <FeedComponent lang={locale} />;
}
```

### Pattern 2: With Server-Side Data Fetching

**Use Case**: Page that fetches data before rendering

```tsx
// apps/web/src/app/[locale]/videos/[id]/page.tsx
import { notFound } from 'next/navigation';
import { getLocaleComponent } from '@/lib/i18n/utils';
import VideoPlayer from '@/components/VideoPlayer';
import VideoPlayerRTL from '@/components/VideoPlayer/rtl';
import { getVideo } from '@/lib/api/videos';

interface VideoPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

export default async function VideoPage({ params }: VideoPageProps) {
  const { locale, id } = await params;

  // Fetch data (locale-agnostic)
  const video = await getVideo(id);

  if (!video) {
    notFound();
  }

  // Select component (locale-specific)
  const VideoPlayerComponent = getLocaleComponent(
    locale,
    VideoPlayer,
    VideoPlayerRTL
  );

  return <VideoPlayerComponent video={video} lang={locale} />;
}
```

### Pattern 3: With Metadata Generation

**Use Case**: SEO-optimized pages with locale-specific metadata

```tsx
// apps/web/src/app/[locale]/videos/[id]/page.tsx
import { Metadata } from 'next';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const video = await getVideo(id);

  if (!video) {
    return {
      title: 'Video Not Found',
    };
  }

  return {
    title: video.title,
    description: video.description,
    openGraph: {
      title: video.title,
      description: video.description,
      locale: locale,
      type: 'video.other',
    },
  };
}
```

### Pattern 4: Client Component with Locale

**Use Case**: Interactive components that need locale context

```tsx
// apps/web/src/components/Settings/index.tsx
'use client';

import { useParams, useRouter } from 'next/navigation';
import { getLocalizedPath } from '@/lib/i18n/utils';

export default function Settings({ lang }: { lang: string }) {
  const params = useParams();
  const router = useRouter();
  const locale = params.locale as string;

  const handleSave = async () => {
    // Save logic...

    // Redirect maintaining locale
    router.push(getLocalizedPath(locale, '/profile'));
  };

  return (
    <form onSubmit={handleSave}>
      {/* Form fields */}
    </form>
  );
}
```

### Pattern 5: Directional Styling

**Use Case**: Components with direction-specific styles

```tsx
import { getDirectionalClasses } from '@/lib/i18n/utils';

export function Card({ locale, children }: { locale: string; children: React.ReactNode }) {
  return (
    <div
      className={getDirectionalClasses(
        locale,
        'ml-4 rounded-l-md border-l-4',  // LTR
        'mr-4 rounded-r-md border-r-4'   // RTL
      )}
    >
      {children}
    </div>
  );
}
```

---

## Helper Functions Reference

### Component Selection

```typescript
getLocaleComponent<T>(locale: string, ltrComponent: T, rtlComponent: T): T
```
Selects appropriate component based on locale direction.

### Path Generation

```typescript
getLocalizedPath(locale: string, path: string): string
```
Generates locale-prefixed paths for navigation.

### Styling Helpers

```typescript
getDirectionalClasses(locale: string, ltrClasses: string, rtlClasses: string): string
getDirectionalStyles<T>(locale: string, ltrStyles: T, rtlStyles: T): T
getTextDirection(locale: string): 'rtl' | 'ltr'
```

### Validation

```typescript
isSupportedLocale(locale: string): boolean
parseLocaleFromPath(pathname: string): string
```

---

## Testing Plan

### Unit Tests

```typescript
// src/lib/i18n/utils/__tests__/localeHelpers.test.ts
import {
  getLocaleComponent,
  getLocalizedPath,
  isLocaleSupported,
  getTextDirection,
} from '../localeHelpers';

describe('Locale Helpers', () => {
  describe('getLocaleComponent', () => {
    it('returns RTL component for Arabic', () => {
      const ltr = 'LTR';
      const rtl = 'RTL';
      expect(getLocaleComponent('ar', ltr, rtl)).toBe('RTL');
    });

    it('returns LTR component for English', () => {
      const ltr = 'LTR';
      const rtl = 'RTL';
      expect(getLocaleComponent('en', ltr, rtl)).toBe('LTR');
    });
  });

  describe('getLocalizedPath', () => {
    it('generates correct path with locale', () => {
      expect(getLocalizedPath('ar', '/profile')).toBe('/ar/profile');
      expect(getLocalizedPath('en', 'profile')).toBe('/en/profile');
    });
  });

  describe('isLocaleSupported', () => {
    it('validates supported locales', () => {
      expect(isLocaleSupported('ar')).toBe(true);
      expect(isLocaleSupported('en')).toBe(true);
      expect(isLocaleSupported('fr')).toBe(false);
    });
  });

  describe('getTextDirection', () => {
    it('returns correct direction', () => {
      expect(getTextDirection('ar')).toBe('rtl');
      expect(getTextDirection('en')).toBe('ltr');
    });
  });
});
```

### Integration Tests

```typescript
// Test route rendering
describe('Locale Routes', () => {
  it('renders English feed page', async () => {
    const response = await fetch('http://localhost:3000/en/feed');
    expect(response.status).toBe(200);
  });

  it('renders Arabic feed page', async () => {
    const response = await fetch('http://localhost:3000/ar/feed');
    expect(response.status).toBe(200);
  });

  it('redirects root to default locale', async () => {
    const response = await fetch('http://localhost:3000/', {
      redirect: 'manual',
    });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('/en');
  });
});
```

### Manual Testing Checklist

**Per Page:**
- [ ] EN version renders correctly
- [ ] AR version renders correctly (RTL)
- [ ] Navigation works in both directions
- [ ] Forms submit and redirect correctly
- [ ] External links work
- [ ] Images load
- [ ] No console errors

**Overall:**
- [ ] Root redirects to `/en`
- [ ] Invalid locales return 404
- [ ] Locale switching works
- [ ] Browser back/forward works
- [ ] Deep linking works
- [ ] SEO metadata correct

---

## Rollback Plan

### If Migration Fails

**Option 1: Revert to Previous Commit**
```bash
git revert <migration-commit-hash>
git push
```

**Option 2: Keep Both Routes Temporarily**
```bash
# Don't delete old routes immediately
# Deploy new [locale] routes alongside ar/* and en/*
# Use middleware to redirect gradually
```

**Option 3: Feature Flag**
```tsx
// In middleware or layout
const USE_DYNAMIC_LOCALE = process.env.NEXT_PUBLIC_USE_DYNAMIC_LOCALE === 'true';

if (USE_DYNAMIC_LOCALE) {
  // Use [locale] routes
} else {
  // Use static routes
}
```

### Gradual Rollout Strategy

1. **Week 1**: Deploy `[locale]` routes alongside existing routes
2. **Week 2**: Redirect 10% of traffic to new routes, monitor errors
3. **Week 3**: Redirect 50% of traffic
4. **Week 4**: Redirect 100% of traffic
5. **Week 5**: Remove old routes if no issues

---

## Risk Mitigation

### Risk 1: SEO Impact

**Mitigation**:
- Set up 301 redirects from old paths to new paths
- Update sitemap.xml
- Submit updated sitemap to search engines
- Monitor search console for crawl errors

```tsx
// In middleware
const oldToNewMap = {
  '/ar/feed': '/ar/feed',  // Same path structure = no SEO impact
  '/en/feed': '/en/feed',
};
```

### Risk 2: Broken Internal Links

**Mitigation**:
- Use `getLocalizedPath()` helper everywhere
- Search codebase for hardcoded `/ar/` and `/en/` links
- Add linting rule to prevent hardcoded locale paths

```bash
# Find hardcoded links
rg '"/(?:ar|en)/' apps/web/src --type tsx
```

### Risk 3: Type Safety Issues

**Mitigation**:
- Strict TypeScript mode enabled
- Type all `params` as `Promise<{ locale: string }>`
- Run `tsc --noEmit` after each migration

### Risk 4: Performance Degradation

**Mitigation**:
- Use `generateStaticParams()` for static generation
- Monitor Core Web Vitals
- Compare build times before/after

### Risk 5: Translation Consistency

**Mitigation**:
- Keep translation files unchanged
- Use same dictionary structure
- Test all translated strings render

---

## Timeline

| Phase | Estimated Time | Dependencies |
|-------|----------------|--------------|
| **Phase 0**: Prerequisites | 1-2 hours | None |
| **Phase 1**: Base Structure | 2-3 hours | Phase 0 |
| **Phase 2**: Simple Pages | 4-6 hours | Phase 1 |
| **Phase 3**: Complex Pages | 6-8 hours | Phase 2 |
| **Phase 4**: Forms & Upload | 4-5 hours | Phase 3 |
| **Phase 5**: Remaining Pages | 2-3 hours | Phase 4 |
| **Phase 6**: Cleanup | 3-4 hours | Phase 5 |
| **Total** | **22-31 hours** | - |

**Recommended Schedule** (2-3 weeks):
- **Week 1**: Phases 0-2 (setup + simple pages)
- **Week 2**: Phases 3-4 (complex pages + forms)
- **Week 3**: Phases 5-6 (cleanup + verification)

---

## Success Metrics

### Code Quality
- [ ] 29 files reduced to 15 (-48% files)
- [ ] Zero TypeScript errors
- [ ] Zero linting violations
- [ ] 100% type coverage on new code

### Functionality
- [ ] All 15 pages accessible in both locales
- [ ] All forms functional
- [ ] All navigation working
- [ ] No console errors

### Performance
- [ ] Build time unchanged or improved
- [ ] Page load time unchanged
- [ ] No new runtime errors

### Maintainability
- [ ] Easier to add new locales
- [ ] Centralized locale logic
- [ ] Consistent component selection
- [ ] Better developer experience

---

## Post-Migration Tasks

### Documentation
- [ ] Update `CLAUDE.md` with new route structure
- [ ] Update `README.md` with locale examples
- [ ] Document component selection pattern
- [ ] Add migration notes to CHANGELOG

### Developer Experience
- [ ] Add VS Code snippets for locale pages
- [ ] Create Copilot instructions for locale routes
- [ ] Update pull request template

### Monitoring
- [ ] Set up error tracking for locale routes
- [ ] Monitor 404 rates
- [ ] Track locale distribution (EN vs AR users)
- [ ] Monitor Core Web Vitals per locale

---

## Appendix A: Complete File Mapping

| Old EN Route | Old AR Route | New Unified Route |
|-------------|-------------|-------------------|
| `en/page.tsx` | `ar/page.tsx` | `[locale]/page.tsx` |
| `en/feed/page.tsx` | `ar/feed/page.tsx` | `[locale]/feed/page.tsx` |
| `en/live/page.tsx` | `ar/live/page.tsx` | `[locale]/live/page.tsx` |
| `en/videos/[id]/page.tsx` | `ar/videos/[id]/page.tsx` | `[locale]/videos/[id]/page.tsx` |
| `en/channels/[id]/page.tsx` | ❌ Missing | `[locale]/channels/[id]/page.tsx` |
| `en/playlists/[id]/page.tsx` | `ar/playlists/[id]/page.tsx` | `[locale]/playlists/[id]/page.tsx` |
| `en/profile/page.tsx` | `ar/profile/page.tsx` | `[locale]/profile/page.tsx` |
| `en/profile/edit/page.tsx` | `ar/profile/edit/page.tsx` | `[locale]/profile/edit/page.tsx` |
| `en/settings/page.tsx` | `ar/settings/page.tsx` | `[locale]/settings/page.tsx` |
| `en/subscriptions/page.tsx` | `ar/subscriptions/page.tsx` | `[locale]/subscriptions/page.tsx` |
| `en/upload/page.tsx` | `ar/upload/page.tsx` | `[locale]/upload/page.tsx` |
| `en/watch-history/page.tsx` | `ar/watch-history/page.tsx` | `[locale]/watch-history/page.tsx` |
| `en/watch-later/page.tsx` | `ar/watch-later/page.tsx` | `[locale]/watch-later/page.tsx` |
| `en/test/page.tsx` | `ar/test/page.tsx` | `[locale]/test/page.tsx` |
| `en/layout.tsx` | `ar/layout.tsx` | `[locale]/layout.tsx` |

**Total**: 29 files → 15 files (48% reduction)

---

## Appendix B: Helper Usage Examples

See `MIGRATION_EXAMPLE.md` for complete working examples.

---

**Document Version**: 1.0
**Last Updated**: 2025-11-18
**Author**: Development Team
**Status**: Ready for Implementation
