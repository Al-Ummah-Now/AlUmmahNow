# Actual Migration Patterns - Using useLanguage Hook

## Overview

This document describes the **actual migration patterns** based on the existing codebase. All pages use the `useLanguage()` hook which auto-detects locale from the URL.

## Current Codebase Reality

### ✅ What We Actually Have

1. **Most pages are CLIENT components** (marked with `"use client"`)
2. **Pages use `useLanguage()` hook** to get locale and translations
3. **Some pages are identical** between AR and EN (just render a component)
4. **Components have LTR/RTL variants** in separate files

### ❌ What the Old Docs Assumed (Wrong!)

- Server components with `params: Promise<{ locale: string }>`
- Using `getLocaleComponent()` helper at the page level
- Using `useI18n(locale)` with explicit locale parameter

## Migration Patterns

### Pattern 1: Identical Pages (Simplest)

**When to use**: Page just renders a component, identical in both locales

**Example**: Feed page, Subscriptions page

**Before** (2 identical files):
```tsx
// apps/web/src/app/en/feed/page.tsx
import React from 'react';
import { SubscriptionFeed } from '@/components/subscription';

export default function FeedPage() {
  return <SubscriptionFeed />;
}
```

```tsx
// apps/web/src/app/ar/feed/page.tsx
import React from 'react';
import { SubscriptionFeed } from '@/components/subscription';

export default function FeedPage() {
  return <SubscriptionFeed />;
}
```

**After** (1 file):
```tsx
// apps/web/src/app/[locale]/feed/page.tsx
import React from 'react';
import { SubscriptionFeed } from '@/components/subscription';

export default function FeedPage() {
  return <SubscriptionFeed />;
}
```

**Migration steps**:
1. Copy `/en/feed/page.tsx` to `/[locale]/feed/page.tsx`
2. Test `/en/feed` and `/ar/feed` - should work immediately
3. Delete both `/en/feed/page.tsx` and `/ar/feed/page.tsx`

---

### Pattern 2: Client Component with useLanguage Hook

**When to use**: Page uses state, effects, or needs translations

**Example**: Upload page, Home page, Video page

**Before** (EN version):
```tsx
// apps/web/src/app/en/upload/page.tsx
"use client";
import React, { useState } from "react";
import VideoUpload from "@/components/videoUpload";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/hooks/useLanguage";

const UploadPage: React.FC = () => {
  const { t } = useLanguage();
  const router = useRouter();
  const [uploadComplete, setUploadComplete] = useState(false);

  const handleViewVideo = () => {
    if (uploadedVideo) {
      router.push(`/en/video/${uploadedVideo.id}`);  // ❌ Hardcoded locale
    }
  };

  return (
    <main>
      <h1>{t.upload.uploadTitle}</h1>
      <VideoUpload onUploadComplete={handleUploadComplete} />
    </main>
  );
};

export default UploadPage;
```

**After** (unified):
```tsx
// apps/web/src/app/[locale]/upload/page.tsx
"use client";
import React, { useState } from "react";
import VideoUpload from "@/components/videoUpload";
import { useRouter, useParams } from "next/navigation";
import { useLanguage } from "@/hooks/useLanguage";

const UploadPage: React.FC = () => {
  const { t } = useLanguage();  // ✅ Auto-detects locale from URL
  const router = useRouter();
  const params = useParams();
  const locale = params.locale as string;  // ✅ Get locale from URL params
  const [uploadComplete, setUploadComplete] = useState(false);

  const handleViewVideo = () => {
    if (uploadedVideo) {
      router.push(`/${locale}/video/${uploadedVideo.id}`);  // ✅ Dynamic locale
    }
  };

  return (
    <main>
      <h1>{t.upload.uploadTitle}</h1>
      <VideoUpload onUploadComplete={handleUploadComplete} />
    </main>
  );
};

export default UploadPage;
```

**Key Changes**:
1. Keep `"use client"` directive
2. Keep `useLanguage()` hook (works automatically with `[locale]` routes)
3. Add `useParams()` to get locale for navigation
4. Replace hardcoded `/en/` or `/ar/` with `/${locale}/`

**Migration steps**:
1. Copy `/en/upload/page.tsx` to `/[locale]/upload/page.tsx`
2. Add `import { useParams } from "next/navigation"`
3. Add `const params = useParams(); const locale = params.locale as string;`
4. Find/replace all hardcoded locale paths:
   - Replace `/en/` with `/${locale}/`
   - Replace `/ar/` with `/${locale}/`
5. Test both `/en/upload` and `/ar/upload`
6. Delete old files

---

### Pattern 3: Dynamic Component Import Based on Locale

**When to use**: Page imports different RTL/LTR component variants

**Example**: Home page (ar/page.tsx vs en/page.tsx)

**Before** (AR version):
```tsx
// apps/web/src/app/ar/page.tsx
"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard/rtl/index";  // ❌ Hardcoded RTL import
import { useQueryState } from "nuqs";
import { usePathname } from "next/navigation";
import { fetchVideosWithPagination } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useI18n } from "@/lib/i18n";

const VideosPage: React.FC = () => {
  const { t } = useI18n('ar');  // ❌ Hardcoded 'ar'
  const { user } = useAuth();
  const [videos, setVideos] = useState<VideoObject[]>([]);
  const path = usePathname();
  const rtl = path.indexOf('/ar') > -1;  // ❌ Manual RTL detection

  return (
    <main
      className={`flex flex-col p-4 w-full md:pr-20`}  // ❌ RTL padding
      style={{ direction: rtl ? "rtl" : "ltr" }}
    >
      <h1>{t.video.videos}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
        {videos.map((video) => (
          <VideoCard key={`rtl_${video.id}`} {...video} />  // ❌ RTL key prefix
        ))}
      </div>
    </main>
  );
};

export default VideosPage;
```

**Before** (EN version):
```tsx
// apps/web/src/app/en/page.tsx
"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { VideoObject } from "@/interfaces";
import VideoCard from "@/components/videoCard/index";  // ❌ Hardcoded LTR import
import { useQueryState } from "nuqs";
import { fetchVideosWithPagination } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useLanguage } from "@/hooks/useLanguage";

const VideosPage: React.FC = () => {
  const { t } = useLanguage();  // ✅ Auto-detect
  const { user } = useAuth();
  const [videos, setVideos] = useState<VideoObject[]>([]);

  return (
    <main className={`flex flex-col p-4 w-full md:pl-20`}>  // ❌ LTR padding
      <h1>{t.video.videos}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
        {videos.map((video) => (
          <VideoCard key={video.id} {...video} />  // ❌ No prefix
        ))}
      </div>
    </main>
  );
};

export default VideosPage;
```

**After** (unified with dynamic imports):
```tsx
// apps/web/src/app/[locale]/page.tsx
"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { VideoObject } from "@/interfaces";
import { useQueryState } from "nuqs";
import { useParams } from "next/navigation";
import { fetchVideosWithPagination } from "@/lib/api/videos";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useLanguage } from "@/hooks/useLanguage";
import { getDirectionalClasses } from "@/lib/i18n/utils";

// ✅ Dynamic component import based on locale
import VideoCardLTR from "@/components/videoCard/index";
import VideoCardRTL from "@/components/videoCard/rtl/index";

const VideosPage: React.FC = () => {
  const { t, isRTL } = useLanguage();  // ✅ Auto-detect with RTL flag
  const { user } = useAuth();
  const params = useParams();
  const locale = params.locale as string;
  const [videos, setVideos] = useState<VideoObject[]>([]);

  // ✅ Select component based on locale
  const VideoCard = isRTL ? VideoCardRTL : VideoCardLTR;

  return (
    <main
      className={`flex flex-col p-4 w-full ${
        getDirectionalClasses(
          locale,
          "md:pl-20",  // LTR
          "md:pr-20"   // RTL
        )
      }`}
      style={{ direction: isRTL ? "rtl" : "ltr" }}
    >
      <h1>{t.video.videos}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-5 gap-4">
        {videos.map((video) => (
          <VideoCard key={video.id} {...video} />  // ✅ No prefix needed
        ))}
      </div>
    </main>
  );
};

export default VideosPage;
```

**Key Changes**:
1. Import both LTR and RTL component variants
2. Use `const { t, isRTL } = useLanguage()` to get RTL flag
3. Conditionally select component: `const VideoCard = isRTL ? VideoCardRTL : VideoCardLTR`
4. Use `getDirectionalClasses()` for RTL/LTR CSS classes
5. Use `isRTL` flag for inline styles
6. Remove hardcoded locale from `useI18n('ar')`
7. Remove manual RTL detection from pathname
8. Remove RTL key prefixes

**Migration steps**:
1. Identify all component imports that differ between AR and EN
2. Import both variants at the top
3. Add `const { t, isRTL } = useLanguage()`
4. Add `const params = useParams(); const locale = params.locale as string;`
5. Add conditional component selection: `const Component = isRTL ? RTL : LTR`
6. Replace directional CSS classes with `getDirectionalClasses()`
7. Update `style={{ direction }}` to use `isRTL` flag
8. Remove RTL-specific key prefixes
9. Test both locales

---

## Common Migration Scenarios

### Scenario A: Page with Dynamic Routes

**Before**:
```tsx
// apps/web/src/app/en/video/[id]/page.tsx
"use client";
import { useParams } from "next/navigation";

export default function VideoPage() {
  const params = useParams();
  const id = params.id as string;  // ✅ Already using params

  return <VideoPlayer videoId={id} />;
}
```

**After**:
```tsx
// apps/web/src/app/[locale]/video/[id]/page.tsx
"use client";
import { useParams } from "next/navigation";

export default function VideoPage() {
  const params = useParams();
  const locale = params.locale as string;  // ✅ Add locale
  const id = params.id as string;

  return <VideoPlayer videoId={id} locale={locale} />;
}
```

**Params structure changes**:
```typescript
// Before: params = { id: "123" }
// After:  params = { locale: "en", id: "123" }
```

---

### Scenario B: Updating Hardcoded Links

**Find and replace** in the migrated file:

```tsx
// ❌ Before (hardcoded locales)
<Link href="/en/profile">Profile</Link>
<Link href="/ar/video/123">Watch</Link>
router.push("/en/settings");

// ✅ After (dynamic locale)
const params = useParams();
const locale = params.locale as string;

<Link href={`/${locale}/profile`}>Profile</Link>
<Link href={`/${locale}/video/123`}>Watch</Link>
router.push(`/${locale}/settings`);
```

**Or use the helper**:
```tsx
import { getLocalizedPath } from "@/lib/i18n/utils";

<Link href={getLocalizedPath(locale, "/profile")}>Profile</Link>
router.push(getLocalizedPath(locale, "/settings"));
```

---

### Scenario C: Form Redirects

**Before**:
```tsx
// apps/web/src/app/en/profile/edit/page.tsx
const handleSubmit = async () => {
  await saveProfile();
  router.push("/en/profile");  // ❌ Hardcoded
};
```

**After**:
```tsx
// apps/web/src/app/[locale]/profile/edit/page.tsx
const params = useParams();
const locale = params.locale as string;

const handleSubmit = async () => {
  await saveProfile();
  router.push(`/${locale}/profile`);  // ✅ Dynamic
};
```

---

## Migration Checklist

For each page being migrated:

### Pre-Migration
- [ ] Identify page pattern (identical, client component, etc.)
- [ ] Check if page has dynamic routes (`[id]`, `[slug]`, etc.)
- [ ] Note all hardcoded `/en/` or `/ar/` paths
- [ ] Check if page uses `router.push()` or `<Link>`

### During Migration
- [ ] Create new file in `/[locale]/` directory
- [ ] Copy content from `/en/` version (usually more complete)
- [ ] Add `useParams()` if page needs locale for navigation
- [ ] Replace hardcoded locale paths with `${locale}`
- [ ] Update `params` type if page has dynamic routes
- [ ] Test with both `/en/` and `/ar/` URLs

### Post-Migration
- [ ] Verify `/en/{page}` works
- [ ] Verify `/ar/{page}` works
- [ ] Check RTL layout in Arabic
- [ ] Test all links maintain locale
- [ ] Test form submissions redirect correctly
- [ ] Delete old `/en/{page}` file
- [ ] Delete old `/ar/{page}` file

---

## Testing Strategy

### Manual Testing

For each migrated page:

```bash
# Start dev server
pnpm dev

# Test English version
open http://localhost:3000/en/{page}

# Test Arabic version (RTL)
open http://localhost:3000/ar/{page}

# Test navigation
# 1. Click all links - should maintain locale
# 2. Submit forms - should redirect to correct locale
# 3. Check console for errors
```

### Automated Testing

```bash
# Type checking
pnpm type-check

# Linting
pnpm lint

# Build test
pnpm build
```

---

## Common Issues & Solutions

### Issue 1: useLanguage() returns wrong locale

**Problem**: Hook detects locale from old URL structure

**Solution**: We already fixed this! The `useLanguage` hook now uses `parseLocaleFromPath()` which supports both `/ar/*`, `/en/*`, and `/[locale]/*` patterns.

---

### Issue 2: Links don't maintain locale

**Problem**: Clicked a link and lost the locale

**Cause**: Hardcoded `/en/` or `/ar/` in links

**Solution**:
```tsx
// ❌ Wrong
<Link href="/en/profile">Profile</Link>

// ✅ Correct
const params = useParams();
const locale = params.locale as string;
<Link href={`/${locale}/profile`}>Profile</Link>
```

---

### Issue 3: Can't access params.locale

**Problem**: `params.locale` is undefined

**Cause**: Forgot to import/use `useParams()`

**Solution**:
```tsx
import { useParams } from "next/navigation";

export default function MyPage() {
  const params = useParams();
  const locale = params.locale as string;  // Now it works!
}
```

---

### Issue 4: TypeScript error on params

**Problem**: TypeScript complains about `params.locale`

**Solution**:
```typescript
// Add type assertion
const locale = params.locale as string;

// Or check if it exists
const locale = params.locale as string | undefined;
if (!locale) return null;
```

---

## Quick Reference

### Get Current Locale

```tsx
// Method 1: From useLanguage (auto-detected)
const { lang } = useLanguage();

// Method 2: From URL params
const params = useParams();
const locale = params.locale as string;
```

### Generate Localized Path

```tsx
import { getLocalizedPath } from "@/lib/i18n/utils";

const path = getLocalizedPath(locale, "/profile");
// Returns: "/en/profile" or "/ar/profile"
```

### Navigate with Locale

```tsx
import { useRouter, useParams } from "next/navigation";

const router = useRouter();
const params = useParams();
const locale = params.locale as string;

// Navigate
router.push(`/${locale}/profile`);
router.push(getLocalizedPath(locale, "/settings"));
```

### Link with Locale

```tsx
import Link from "next/link";
import { useParams } from "next/navigation";

const params = useParams();
const locale = params.locale as string;

<Link href={`/${locale}/profile`}>Profile</Link>
```

---

## Migration Order (Recommended)

1. **Simple Pages First** (Identical between locales - Pattern 1)
   - feed
   - subscriptions
   - test

2. **Client Pages without Navigation** (Pattern 2)
   - analytics
   - profile (view)

3. **Client Pages with Navigation** (Pattern 2)
   - upload
   - settings

4. **Dynamic Component Import Pages** (Pattern 3)
   - **home (page.tsx)** ⚠️ Uses RTL/LTR VideoCard variants
   - Any other pages with different component imports per locale

5. **Dynamic Route Pages** (Pattern 2 + params)
   - video/[id]
   - channel/[id]
   - playlist/[id]

6. **Complex Pages** (Pattern 2/3 + forms)
   - moderation
   - profile/edit
   - channel/[id]/edit

---

## Next Steps

1. Start with simplest pages (feed, subscriptions)
2. Test thoroughly after each migration
3. Update links incrementally
4. Keep both old and new routes until all pages migrated
5. Remove old routes only after full verification

---

**Remember**: The `useLanguage()` hook already supports `[locale]` routes! We updated it to use `parseLocaleFromPath()`, so it automatically works with both old (`/ar/*`, `/en/*`) and new (`/[locale]/*`) URL patterns.
