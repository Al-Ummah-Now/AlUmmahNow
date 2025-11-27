# API-Based i18n System Implementation Plan

## Overview

Transform the current static TypeScript-based i18n system to a dynamic API-driven approach where translations are:
1. Stored in R2 (`global_settings` bucket)
2. Served via API endpoints
3. Cached on client-side for performance
4. Manageable by admins
5. Shared between web and admin apps

## Current State Analysis

### Web App (`apps/web`)
- **Location**: `/apps/web/src/lib/i18n/`
- **Format**: Static TypeScript files (`en.ts`, `ar.ts`)
- **Keys**: ~1,500+ translation keys across 40+ sections
- **Hook**: `useLanguage()` returns `t` object synchronously
- **Type Safety**: `AppTranslations` interface enforces structure

### Admin Apps (`apps/admin-web`, `apps/admin-api`)
- **Status**: NO i18n support - all hardcoded English
- **Opportunity**: Implement from scratch using shared API system

### R2 Storage
- **Available Bucket**: `global_settings` / `global-settings-preview` (configured but unused)
- **Pattern**: R2Repository generic class available
- **Example**: Upload defaults system stores user settings in R2

---

## Architecture Design

### Storage Structure (R2)

```
global_settings bucket:
├── translations/
│   ├── en.json              # English translations (full)
│   ├── ar.json              # Arabic translations (full)
│   └── metadata.json        # Version, last updated, available locales
├── translations/sections/   # Optional: split by section for granular fetching
│   ├── en/
│   │   ├── common.json
│   │   ├── video.json
│   │   └── ...
│   └── ar/
│       ├── common.json
│       ├── video.json
│       └── ...
└── config/
    └── i18n-config.json     # Locale config, default locale, RTL settings
```

### Data Format

```typescript
// translations/en.json
{
  "version": "1.0.0",
  "locale": "en",
  "updatedAt": "2025-01-15T10:30:00Z",
  "translations": {
    "common": {
      "appName": "Al Ummah Now",
      "loading": "Loading...",
      // ... all common keys
    },
    "video": {
      "title": "Video Title",
      // ... all video keys
    },
    // ... all 40+ sections
  }
}

// translations/metadata.json
{
  "version": "1.0.0",
  "locales": ["en", "ar"],
  "defaultLocale": "en",
  "updatedAt": "2025-01-15T10:30:00Z",
  "sections": ["common", "header", "video", "channel", ...],
  "checksums": {
    "en": "abc123...",
    "ar": "def456..."
  }
}

// config/i18n-config.json
{
  "locales": [
    { "code": "en", "name": "English", "isRTL": false, "isDefault": true },
    { "code": "ar", "name": "العربية", "isRTL": true, "isDefault": false }
  ],
  "fallbackLocale": "en",
  "cacheMaxAge": 3600
}
```

---

## API Design

### New Endpoints (in `api-videos`)

#### 1. GET /api/i18n/translations/:locale
Fetch full translations for a locale.

```typescript
// Request
GET /api/i18n/translations/en
Headers:
  If-None-Match: "abc123"  // Optional: for cache validation

// Response 200
{
  "success": true,
  "result": {
    "locale": "en",
    "version": "1.0.0",
    "translations": { /* full translations object */ }
  }
}
Headers:
  ETag: "abc123"
  Cache-Control: public, max-age=3600

// Response 304 (Not Modified)
// When ETag matches - client uses cached version
```

#### 2. GET /api/i18n/translations/:locale/:section
Fetch specific section (for lazy loading).

```typescript
// Request
GET /api/i18n/translations/en/video

// Response
{
  "success": true,
  "result": {
    "locale": "en",
    "section": "video",
    "translations": { /* video section only */ }
  }
}
```

#### 3. GET /api/i18n/config
Fetch i18n configuration (locales, RTL settings).

```typescript
// Response
{
  "success": true,
  "result": {
    "locales": [
      { "code": "en", "name": "English", "isRTL": false, "isDefault": true },
      { "code": "ar", "name": "العربية", "isRTL": true }
    ],
    "fallbackLocale": "en",
    "version": "1.0.0"
  }
}
```

#### 4. GET /api/i18n/metadata
Fetch metadata for cache invalidation.

```typescript
// Response
{
  "success": true,
  "result": {
    "version": "1.0.0",
    "locales": ["en", "ar"],
    "updatedAt": "2025-01-15T10:30:00Z",
    "checksums": {
      "en": "abc123",
      "ar": "def456"
    }
  }
}
```

### Admin Endpoints (in `admin-api`)

#### 5. PUT /api/i18n/translations/:locale
Update translations for a locale (admin only).

```typescript
// Request
PUT /api/i18n/translations/en
Authorization: Bearer <admin-token>
Body: {
  "translations": { /* full or partial translations */ },
  "merge": true  // true = merge with existing, false = replace
}

// Response
{
  "success": true,
  "result": {
    "locale": "en",
    "version": "1.0.1",
    "updatedAt": "2025-01-15T11:00:00Z"
  }
}
```

#### 6. PUT /api/i18n/translations/:locale/:section
Update specific section.

#### 7. POST /api/i18n/sync
Trigger sync/validation of all translations.

---

## Client-Side Implementation

### Web App Changes

#### New: `useTranslationsQuery` hook
```typescript
// apps/web/src/hooks/useTranslationsQuery.ts
import { useQuery } from '@tanstack/react-query';  // Or SWR
import { getTranslations } from '@/lib/api/i18n';

export function useTranslationsQuery(locale: string) {
  return useQuery({
    queryKey: ['translations', locale],
    queryFn: () => getTranslations(locale),
    staleTime: 1000 * 60 * 60,  // 1 hour
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
    refetchOnWindowFocus: false,
  });
}
```

#### Updated: `useLanguage` hook
```typescript
// apps/web/src/hooks/useLanguage.ts
export function useLanguage(): UseLanguageResult {
  const pathname = usePathname();
  const lang = parseLocaleFromPath(pathname);

  // Fetch translations from API with caching
  const { data: translations, isLoading, error } = useTranslationsQuery(lang);

  // Fallback to static translations during loading
  const t = translations?.translations ?? getStaticTranslations(lang);

  return {
    lang,
    locale: lang,
    t,
    isLoading,
    dir: isRTL(lang) ? 'rtl' : 'ltr',
    isRTL: isRTL(lang),
    // ... rest
  };
}
```

#### New: API Client
```typescript
// apps/web/src/lib/api/i18n.ts
const I18N_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3086';

export async function getTranslations(locale: string) {
  const response = await fetch(`${I18N_API_URL}/api/i18n/translations/${locale}`, {
    headers: {
      'Accept': 'application/json',
    },
    next: { revalidate: 3600 }  // Next.js cache
  });

  if (!response.ok) throw new Error('Failed to fetch translations');
  const data = await response.json();
  return data.result;
}

export async function getI18nConfig() {
  const response = await fetch(`${I18N_API_URL}/api/i18n/config`);
  if (!response.ok) throw new Error('Failed to fetch i18n config');
  const data = await response.json();
  return data.result;
}
```

#### Caching Strategy
```typescript
// apps/web/src/lib/i18n/cache.ts

// 1. localStorage cache (persistent across sessions)
const CACHE_KEY = 'i18n_translations';
const CACHE_VERSION_KEY = 'i18n_version';

export function getCachedTranslations(locale: string) {
  if (typeof window === 'undefined') return null;

  const cached = localStorage.getItem(`${CACHE_KEY}_${locale}`);
  const version = localStorage.getItem(`${CACHE_VERSION_KEY}_${locale}`);

  if (cached && version) {
    return { translations: JSON.parse(cached), version };
  }
  return null;
}

export function setCachedTranslations(locale: string, data: any) {
  if (typeof window === 'undefined') return;

  localStorage.setItem(`${CACHE_KEY}_${locale}`, JSON.stringify(data.translations));
  localStorage.setItem(`${CACHE_VERSION_KEY}_${locale}`, data.version);
}

// 2. Version check for cache invalidation
export async function checkForUpdates(locale: string, currentVersion: string) {
  const metadata = await getI18nMetadata();
  return metadata.checksums[locale] !== currentVersion;
}
```

### Admin Web App Changes

#### New: i18n Provider
```typescript
// apps/admin-web/src/providers/I18nProvider.tsx
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { getTranslations } from '@/lib/api/i18n';

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children, locale = 'en' }: Props) {
  const [translations, setTranslations] = useState<AppTranslations | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getTranslations(locale)
      .then(data => setTranslations(data.translations))
      .finally(() => setIsLoading(false));
  }, [locale]);

  return (
    <I18nContext.Provider value={{ t: translations, locale, isLoading }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used within I18nProvider');
  return context;
}
```

#### New: useAdminLanguage hook
```typescript
// apps/admin-web/src/hooks/useAdminLanguage.ts
export function useAdminLanguage() {
  const { t, locale, isLoading } = useI18n();

  return {
    t: t ?? fallbackTranslations,
    locale,
    isLoading,
    isRTL: locale === 'ar',
    dir: locale === 'ar' ? 'rtl' : 'ltr',
  };
}
```

---

## Migration Strategy

### Phase 1: API & Storage Setup (API-side)
1. Create i18n endpoints in `api-videos`
2. Migrate static translations to R2 `global_settings` bucket
3. Implement caching headers (ETag, Cache-Control)
4. Add admin endpoints in `admin-api`

### Phase 2: Web App Integration
1. Add `@tanstack/react-query` or use existing SWR
2. Create API client for i18n endpoints
3. Update `useLanguage` hook to fetch from API
4. Keep static translations as fallback
5. Implement localStorage caching

### Phase 3: Admin App Integration
1. Create I18nProvider for admin-web
2. Add language switcher to admin UI
3. Implement translation management UI (optional)
4. Update all hardcoded strings to use translations

### Phase 4: Cleanup & Optimization
1. Remove static translation files (or keep as fallback)
2. Add service worker caching
3. Implement incremental updates (section-level)
4. Add translation validation/completeness checks

---

## Shared Types

```typescript
// packages/shared-types/src/i18n.ts

export interface LocaleConfig {
  code: string;
  name: string;
  englishName: string;
  isRTL: boolean;
  isDefault?: boolean;
  isComplete?: boolean;
}

export interface TranslationData {
  version: string;
  locale: string;
  updatedAt: string;
  translations: AppTranslations;
}

export interface I18nMetadata {
  version: string;
  locales: string[];
  defaultLocale: string;
  updatedAt: string;
  checksums: Record<string, string>;
}

export interface I18nConfig {
  locales: LocaleConfig[];
  fallbackLocale: string;
  cacheMaxAge: number;
}

// Re-export existing AppTranslations type
export type { AppTranslations } from './app-translations';
```

---

## File Changes Summary

### New Files

```
apps/api-videos/src/
├── endpoints/i18n/
│   ├── TranslationsGet.ts      # GET /api/i18n/translations/:locale
│   ├── TranslationsSectionGet.ts # GET /api/i18n/translations/:locale/:section
│   ├── ConfigGet.ts            # GET /api/i18n/config
│   └── MetadataGet.ts          # GET /api/i18n/metadata
├── routers/i18n.router.ts      # Router registration
└── lib/i18n/
    └── translationsRepo.ts     # R2 repository for translations

apps/admin-api/src/
├── endpoints/i18n/
│   ├── TranslationsUpdate.ts   # PUT /api/i18n/translations/:locale
│   └── TranslationsSync.ts     # POST /api/i18n/sync
└── routers/i18n.router.ts

apps/web/src/
├── lib/api/i18n.ts             # API client
├── lib/i18n/cache.ts           # Client-side caching
└── hooks/useTranslationsQuery.ts

apps/admin-web/src/
├── providers/I18nProvider.tsx
├── hooks/useAdminLanguage.ts
└── lib/api/i18n.ts

packages/shared-types/src/
└── i18n.ts                     # Shared types
```

### Modified Files

```
apps/web/src/hooks/useLanguage.ts  # Use API instead of static imports
apps/web/src/lib/i18n/index.ts     # Export API functions
apps/admin-web/src/app/layout.tsx  # Wrap with I18nProvider
```

---

## Performance Considerations

### Caching Layers

1. **CDN/Edge Cache**: Cache-Control headers (1 hour default)
2. **Next.js Cache**: `next: { revalidate: 3600 }` for fetch
3. **React Query/SWR**: In-memory cache with stale-while-revalidate
4. **localStorage**: Persistent cache for offline/fast loading
5. **Service Worker**: Optional, for PWA support

### Initial Load Strategy

```typescript
// Option A: Server-side fetch (recommended for SSR)
// In layout.tsx or page.tsx
export async function generateMetadata({ params }) {
  const translations = await getTranslations(params.locale);
  // Pre-populate cache
}

// Option B: Static fallback + hydration
// Use static translations initially, then hydrate from API
const t = isLoading ? staticTranslations[locale] : apiTranslations;
```

### Bundle Size Impact

- Static translations: ~150KB (both languages)
- API approach: 0KB in bundle, ~75KB per language fetched
- Net benefit: Smaller initial bundle, lazy-loaded translations

---

## Security Considerations

1. **Public Endpoints**: Translation fetch is public (no auth required)
2. **Admin Endpoints**: Require admin role for updates
3. **Rate Limiting**: Apply rate limits to prevent abuse
4. **Validation**: Validate translation structure on upload
5. **Audit Log**: Log all translation changes with admin ID

---

## Testing Strategy

1. **Unit Tests**: Translation key completeness check
2. **Integration Tests**: API endpoint responses
3. **E2E Tests**: Language switching, RTL rendering
4. **Performance Tests**: Cache hit rates, load times

---

## Rollback Plan

If issues arise:
1. Static translations remain as fallback
2. `useLanguage` hook can switch between API and static
3. Feature flag to toggle API-based i18n
4. R2 data can be regenerated from static files

---

## Estimated Effort

| Phase | Tasks | Estimate |
|-------|-------|----------|
| Phase 1 | API endpoints, R2 setup | 4-6 hours |
| Phase 2 | Web app integration | 3-4 hours |
| Phase 3 | Admin app integration | 4-6 hours |
| Phase 4 | Optimization, cleanup | 2-3 hours |
| **Total** | | **13-19 hours** |

---

## Decisions Made

1. **Fetch strategy**: Full locale at once (~75KB per language, single request)
2. **Admin UI**: Yes, build full translation editor in admin app
3. **Caching library**: React Query (@tanstack/react-query)
4. **Caching duration**: 1 hour (configurable)

---

## Implementation Order

### Step 1: Shared Types
- Add i18n types to `packages/shared-types`
- Build shared-types package

### Step 2: API Endpoints (api-videos)
- Create translations repository for R2
- Implement GET endpoints (translations, config, metadata)
- Migrate static translations to R2

### Step 3: Admin API Endpoints
- Implement PUT endpoints for translation updates
- Add validation and audit logging

### Step 4: Web App Integration
- Install React Query
- Create i18n API client
- Update useLanguage hook
- Add localStorage caching

### Step 5: Admin Web i18n Support
- Add I18nProvider
- Create useAdminLanguage hook
- Update all components to use translations

### Step 6: Admin Translation Editor UI
- Create translations management page
- Build translation key editor component
- Add search/filter functionality
- Implement save/publish workflow
