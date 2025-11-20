# Video Category Selection Feature - Implementation Plan

**Feature ID**: 07-video-categories
**Status**: Proposed
**Priority**: HIGH
**Estimated Effort**: 1 week (2 developers)
**Created**: 2025-11-20
**Author**: System Architect

## Table of Contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Technical Design](#technical-design)
4. [Implementation Details](#implementation-details)
5. [Files to Create/Modify](#files-to-createmodify)
6. [Testing Strategy](#testing-strategy)
7. [Migration Plan](#migration-plan)
8. [Success Metrics](#success-metrics)

---

## Overview

### Problem Statement

Al Ummah Now currently lacks a video categorization system, making it difficult for users to:
- Browse content by type (Quran Recitation, Hadith, Khutbah, etc.)
- Filter search results by category
- Discover relevant content based on their interests
- Organize content effectively for the Islamic community

YouTube has a generic categorization system with 15 categories. Al Ummah Now needs an Islamic-specific categorization system that better serves the Muslim community's content needs.

### Solution Summary

Implement a comprehensive video categorization system with:
1. **15 Islamic-specific categories** tailored for Muslim content
2. **Category selection dropdown** in the video upload form
3. **Browse by category** functionality on the platform
4. **Filter by category** in search and video listings
5. **Category-based recommendations** for content discovery

---

## Requirements

### Functional Requirements

1. **Category Definition**
   - Define 15 Islamic-specific categories
   - Support bilingual category names (English/Arabic)
   - Categories must be immutable once defined (no dynamic creation)

2. **Upload Integration**
   - Category dropdown selector in upload form
   - Optional field (can be left unset)
   - Category saved as part of video metadata

3. **Browse & Filter**
   - Filter videos by category in listings
   - Dedicated category pages (/en/category/[categorySlug])
   - Category filter in search results
   - Show category on video details page

4. **API Support**
   - Add category field to video endpoints
   - Support category filtering in list/search endpoints
   - Validation of category values

### Non-Functional Requirements

- **Performance**: Category filtering should not impact query performance
- **Scalability**: Support millions of videos across categories
- **i18n**: Full bilingual support for all category names
- **Backward Compatibility**: Existing videos without categories should still work

---

## Technical Design

### 1. Category Enum Definition

```typescript
// packages/shared-types/src/video.ts

export enum VideoCategory {
  // Islamic Education & Knowledge
  QURAN_RECITATION = 'quran_recitation',
  QURAN_TAFSIR = 'quran_tafsir',
  HADITH_STUDIES = 'hadith_studies',
  FIQH = 'fiqh',
  AQEEDAH = 'aqeedah',

  // Islamic Content & Practice
  ISLAMIC_HISTORY = 'islamic_history',
  DAWAH = 'dawah',
  KHUTBAH = 'khutbah',
  ISLAMIC_LECTURES = 'islamic_lectures',
  ISLAMIC_NASHEED = 'islamic_nasheed',

  // Special Topics
  ISLAMIC_EDUCATION_CHILDREN = 'islamic_education_children',
  ISLAMIC_NEWS = 'islamic_news',
  HAJJ_UMRAH = 'hajj_umrah',
  RAMADAN = 'ramadan',
  ISLAMIC_LIFESTYLE = 'islamic_lifestyle',
}

// Human-readable labels
export const VideoCategoryLabels = {
  [VideoCategory.QURAN_RECITATION]: {
    en: 'Quran Recitation',
    ar: 'تلاوة القرآن'
  },
  [VideoCategory.QURAN_TAFSIR]: {
    en: 'Quran Tafsir',
    ar: 'تفسير القرآن'
  },
  [VideoCategory.HADITH_STUDIES]: {
    en: 'Hadith Studies',
    ar: 'علوم الحديث'
  },
  [VideoCategory.FIQH]: {
    en: 'Fiqh (Jurisprudence)',
    ar: 'الفقه'
  },
  [VideoCategory.AQEEDAH]: {
    en: 'Aqeedah (Creed)',
    ar: 'العقيدة'
  },
  [VideoCategory.ISLAMIC_HISTORY]: {
    en: 'Islamic History',
    ar: 'التاريخ الإسلامي'
  },
  [VideoCategory.DAWAH]: {
    en: 'Dawah (Outreach)',
    ar: 'الدعوة'
  },
  [VideoCategory.KHUTBAH]: {
    en: 'Khutbah (Sermons)',
    ar: 'الخطب'
  },
  [VideoCategory.ISLAMIC_LECTURES]: {
    en: 'Islamic Lectures',
    ar: 'محاضرات إسلامية'
  },
  [VideoCategory.ISLAMIC_NASHEED]: {
    en: 'Islamic Nasheed',
    ar: 'الأناشيد الإسلامية'
  },
  [VideoCategory.ISLAMIC_EDUCATION_CHILDREN]: {
    en: 'Islamic Education for Children',
    ar: 'التعليم الإسلامي للأطفال'
  },
  [VideoCategory.ISLAMIC_NEWS]: {
    en: 'Islamic News & Events',
    ar: 'الأخبار والفعاليات الإسلامية'
  },
  [VideoCategory.HAJJ_UMRAH]: {
    en: 'Hajj & Umrah',
    ar: 'الحج والعمرة'
  },
  [VideoCategory.RAMADAN]: {
    en: 'Ramadan Content',
    ar: 'محتوى رمضان'
  },
  [VideoCategory.ISLAMIC_LIFESTYLE]: {
    en: 'Islamic Lifestyle & Family',
    ar: 'نمط الحياة الإسلامية والأسرة'
  }
};

// Helper function to get category options for dropdowns
export function getVideoCategoryOptions(locale: 'en' | 'ar'): Array<{value: string, label: string}> {
  return Object.values(VideoCategory).map(category => ({
    value: category,
    label: VideoCategoryLabels[category][locale]
  }));
}
```

### 2. Video Model Schema Changes

Update the existing video types to include the category field:

```typescript
// packages/shared-types/src/video.ts

export interface VideoObject extends Timestamps {
  // ... existing fields ...

  // SEO and categorization
  tags?: string[];
  category?: VideoCategory; // Changed from string to enum
  language?: string;
}

export interface VideoCreateRequest {
  // ... existing fields ...
  category?: VideoCategory;
}

export interface VideoUpdateRequest {
  // ... existing fields ...
  category?: VideoCategory;
}

export interface VideoListParams {
  // ... existing fields ...
  category?: VideoCategory | VideoCategory[];  // Support single or multiple categories
}
```

### 3. API Endpoints

#### A. Upload Initiate Endpoint Update

```typescript
// apps/api-videos/src/endpoints/video/uploadInitiate.ts

// Update schema
schema = {
  request: {
    body: {
      schema: z.object({
        // ... existing fields ...
        category: z.nativeEnum(VideoCategory).optional()
          .describe("Video category from predefined list"),
      }),
    },
  },
};

// Store category in video metadata
const video = {
  // ... existing fields ...
  category: request.body.category || undefined,
};
```

#### B. Video List Endpoint Update

```typescript
// apps/api-videos/src/endpoints/video/videoList.ts

// Update query parameters
request: {
  query: z.object({
    // ... existing fields ...
    category: z.nativeEnum(VideoCategory).optional()
      .describe("Filter videos by category"),
  }),
}

// Apply category filter
const filteredVideos = videos.filter(video => {
  if (category && video.category !== category) {
    return false;
  }
  // ... existing filters ...
});
```

#### C. New Category List Endpoint

```typescript
// apps/api-videos/src/endpoints/video/categoryList.ts

export class CategoryList extends OpenAPIRoute {
  schema = {
    tags: ["Videos"],
    summary: "List Available Video Categories",
    description: "Returns all available video categories with their labels",
    request: {
      query: z.object({
        locale: z.enum(['en', 'ar']).optional().default('en')
          .describe("Language for category labels"),
      }),
    },
    responses: {
      "200": {
        description: "List of categories",
        content: {
          "application/json": {
            schema: z.array(z.object({
              value: z.string(),
              label: z.string(),
              count: z.number().optional(), // Optional: video count per category
            })),
          },
        },
      },
    },
  };

  async handle(c) {
    const { locale } = c.req.query();
    const categories = getVideoCategoryOptions(locale);

    // Optionally: Add video counts per category
    // This would require querying R2 for each category

    return c.json(categories);
  }
}
```

### 4. Upload Form UI Modifications

#### A. Category Dropdown Component

```tsx
// apps/web/src/components/videoUpload/CategorySelector.tsx

import { VideoCategory, VideoCategoryLabels } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

interface CategorySelectorProps {
  value?: VideoCategory;
  onChange: (category: VideoCategory | undefined) => void;
  disabled?: boolean;
}

export function CategorySelector({ value, onChange, disabled }: CategorySelectorProps) {
  const { locale } = useLanguage();

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {locale === 'ar' ? 'الفئة' : 'Category'}
      </label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value as VideoCategory || undefined)}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md"
      >
        <option value="">
          {locale === 'ar' ? 'اختر فئة' : 'Select a category'}
        </option>
        {Object.values(VideoCategory).map(category => (
          <option key={category} value={category}>
            {VideoCategoryLabels[category][locale]}
          </option>
        ))}
      </select>
    </div>
  );
}
```

#### B. Upload Form Integration

```tsx
// apps/web/src/components/videoUpload/index.tsx

// Add to VideoMetadata interface
interface VideoMetadata {
  // ... existing fields ...
  category?: VideoCategory;
}

// Add CategorySelector to the form
<CategorySelector
  value={metadata.category}
  onChange={(category) => setMetadata(prev => ({ ...prev, category }))}
  disabled={uploadProgress?.state === 'uploading'}
/>

// Include category in upload initiation
const initiateResult = await initiateVideoUpload({
  // ... existing fields ...
  category: metadata.category,
});
```

### 5. Browse by Category UI

#### A. Category Browse Page

```tsx
// apps/web/src/app/[locale]/category/[slug]/page.tsx

import { VideoCategory, VideoCategoryLabels } from '@al-ummah/shared-types';
import { VideoGrid } from '@/components/VideoGrid';
import { useLanguage } from '@/hooks/useLanguage';

export default async function CategoryPage({
  params
}: {
  params: { slug: string, locale: string }
}) {
  const category = Object.values(VideoCategory).find(
    cat => cat.replace(/_/g, '-') === params.slug
  );

  if (!category) {
    notFound();
  }

  const videos = await fetchVideosByCategory(category);
  const categoryLabel = VideoCategoryLabels[category][params.locale as 'en' | 'ar'];

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">{categoryLabel}</h1>
      <VideoGrid videos={videos} />
    </div>
  );
}
```

#### B. Category Filter Component

```tsx
// apps/web/src/components/CategoryFilter.tsx

import { VideoCategory, VideoCategoryLabels } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

interface CategoryFilterProps {
  selectedCategory?: VideoCategory;
  onCategoryChange: (category: VideoCategory | undefined) => void;
  showAll?: boolean;
}

export function CategoryFilter({
  selectedCategory,
  onCategoryChange,
  showAll = true
}: CategoryFilterProps) {
  const { locale } = useLanguage();

  return (
    <div className="flex flex-wrap gap-2">
      {showAll && (
        <button
          onClick={() => onCategoryChange(undefined)}
          className={`px-4 py-2 rounded-full ${
            !selectedCategory
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700'
          }`}
        >
          {locale === 'ar' ? 'الكل' : 'All'}
        </button>
      )}
      {Object.values(VideoCategory).map(category => (
        <button
          key={category}
          onClick={() => onCategoryChange(category)}
          className={`px-4 py-2 rounded-full ${
            selectedCategory === category
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          {VideoCategoryLabels[category][locale]}
        </button>
      ))}
    </div>
  );
}
```

### 6. i18n Translations

```typescript
// apps/web/src/lib/i18n/translations/en.ts

video: {
  // ... existing translations ...
  videoCategory: 'Category',
  selectCategory: 'Select a category',
  allCategories: 'All Categories',
  browseByCategory: 'Browse by Category',
  // Category names
  categories: {
    quranRecitation: 'Quran Recitation',
    quranTafsir: 'Quran Tafsir',
    hadithStudies: 'Hadith Studies',
    fiqh: 'Fiqh (Jurisprudence)',
    aqeedah: 'Aqeedah (Creed)',
    islamicHistory: 'Islamic History',
    dawah: 'Dawah (Outreach)',
    khutbah: 'Khutbah (Sermons)',
    islamicLectures: 'Islamic Lectures',
    islamicNasheed: 'Islamic Nasheed',
    islamicEducationChildren: 'Islamic Education for Children',
    islamicNews: 'Islamic News & Events',
    hajjUmrah: 'Hajj & Umrah',
    ramadan: 'Ramadan Content',
    islamicLifestyle: 'Islamic Lifestyle & Family',
  }
}

// apps/web/src/lib/i18n/translations/ar.ts

video: {
  // ... existing translations ...
  videoCategory: 'الفئة',
  selectCategory: 'اختر فئة',
  allCategories: 'جميع الفئات',
  browseByCategory: 'تصفح حسب الفئة',
  // Category names in Arabic
  categories: {
    quranRecitation: 'تلاوة القرآن',
    quranTafsir: 'تفسير القرآن',
    hadithStudies: 'علوم الحديث',
    fiqh: 'الفقه',
    aqeedah: 'العقيدة',
    islamicHistory: 'التاريخ الإسلامي',
    dawah: 'الدعوة',
    khutbah: 'الخطب',
    islamicLectures: 'محاضرات إسلامية',
    islamicNasheed: 'الأناشيد الإسلامية',
    islamicEducationChildren: 'التعليم الإسلامي للأطفال',
    islamicNews: 'الأخبار والفعاليات الإسلامية',
    hajjUmrah: 'الحج والعمرة',
    ramadan: 'محتوى رمضان',
    islamicLifestyle: 'نمط الحياة الإسلامية والأسرة',
  }
}
```

---

## Implementation Details

### Phase 1: Data Model & API (Day 1-2)

**Tasks:**
1. ✅ Define VideoCategory enum in shared-types
2. ✅ Update VideoObject interface with category field
3. ✅ Update upload initiate endpoint to accept category
4. ✅ Update video list endpoint with category filter
5. ✅ Create category list endpoint
6. ✅ Update video update endpoint to support category changes
7. ✅ Add category validation in Zod schemas

**Developer:** Backend Developer

### Phase 2: Upload UI Integration (Day 2-3)

**Tasks:**
1. ✅ Create CategorySelector component
2. ✅ Integrate CategorySelector in upload form
3. ✅ Update upload metadata state and API calls
4. ✅ Add category to video edit form
5. ✅ Test upload with different categories
6. ✅ Ensure bilingual support works

**Developer:** Frontend Developer

### Phase 3: Browse & Filter UI (Day 3-4)

**Tasks:**
1. ✅ Create CategoryFilter component
2. ✅ Add category filter to video list pages
3. ✅ Create dedicated category browse pages
4. ✅ Add category display to video details page
5. ✅ Implement category navigation menu
6. ✅ Add category to search filters

**Developer:** Frontend Developer

### Phase 4: Testing & Polish (Day 5)

**Tasks:**
1. ✅ End-to-end testing of upload with categories
2. ✅ Test category filtering in all views
3. ✅ Verify bilingual support
4. ✅ Performance testing with large datasets
5. ✅ Fix any bugs or issues
6. ✅ Update documentation

**Developer:** Both Developers

---

## Files to Create/Modify

### New Files to Create

```
apps/web/src/components/videoUpload/CategorySelector.tsx     (50 lines)
apps/web/src/components/CategoryFilter.tsx                   (70 lines)
apps/web/src/app/[locale]/category/[slug]/page.tsx           (80 lines)
apps/api-videos/src/endpoints/video/categoryList.ts          (45 lines)
```

### Files to Modify

```
packages/shared-types/src/video.ts                           (+120 lines)
apps/api-videos/src/endpoints/video/uploadInitiate.ts        (+5 lines)
apps/api-videos/src/endpoints/video/videoList.ts             (+10 lines)
apps/api-videos/src/endpoints/video/videoUpdate.ts           (+5 lines)
apps/api-videos/src/endpoints/video/videoSearch.ts           (+10 lines)
apps/api-videos/src/index.ts                                 (+2 lines)
apps/web/src/components/videoUpload/index.tsx                (+15 lines)
apps/web/src/components/videoEdit/index.tsx                  (+15 lines)
apps/web/src/lib/api/videos.ts                               (+5 lines)
apps/web/src/lib/i18n/translations/en.ts                     (+20 lines)
apps/web/src/lib/i18n/translations/ar.ts                     (+20 lines)
apps/web/src/app/[locale]/videos/page.tsx                    (+10 lines)
apps/web/src/app/[locale]/search/page.tsx                    (+10 lines)
```

**Total Lines of Code:** ~500 lines

---

## Testing Strategy

### Unit Tests

1. **Enum Validation Tests**
   - Verify all category values are valid
   - Test category label retrieval in both languages
   - Test helper functions

2. **API Tests**
   - Test upload with valid category
   - Test upload with invalid category (should fail)
   - Test filtering by category
   - Test multiple category filters
   - Test category list endpoint

### Integration Tests

1. **Upload Flow**
   - Upload video with category selection
   - Verify category is saved correctly
   - Edit video and change category
   - Verify category persists

2. **Browse Flow**
   - Navigate to category page
   - Verify correct videos are shown
   - Test category filter on main page
   - Test category in search results

### E2E Tests

```typescript
// Example E2E test scenarios
describe('Video Categories', () => {
  it('should upload video with Quran Recitation category', async () => {
    // Select file
    // Choose "Quran Recitation" from dropdown
    // Upload and verify category is saved
  });

  it('should filter videos by Hadith Studies category', async () => {
    // Go to videos page
    // Click on "Hadith Studies" filter
    // Verify only Hadith videos are shown
  });

  it('should show category in Arabic when locale is ar', async () => {
    // Switch to Arabic locale
    // Verify category labels are in Arabic
    // Upload video and verify Arabic category name
  });
});
```

### Performance Tests

1. **Load Testing**
   - Query 10,000 videos filtered by category
   - Measure response time (target: <500ms)
   - Test concurrent category filters

2. **Stress Testing**
   - Upload 100 videos with different categories
   - Filter with multiple categories simultaneously
   - Monitor R2 query performance

---

## Migration Plan

### For Existing Videos

Since existing videos don't have categories, we need a migration strategy:

1. **Option A: Leave Uncategorized** (Recommended)
   - Existing videos remain without category
   - Show as "Uncategorized" in UI
   - Allow users to edit and add category

2. **Option B: Auto-Categorize**
   - Use AI/ML to suggest categories based on title/description
   - Requires manual review and approval
   - More complex, not recommended for MVP

### Migration Steps

1. **Deploy Backend Changes**
   ```bash
   # Deploy API with category support
   cd apps/api-videos
   pnpm deploy
   ```

2. **Deploy Frontend Changes**
   ```bash
   # Deploy web app with category UI
   cd apps/web
   pnpm deploy:production
   ```

3. **Optional: Bulk Update Script**
   ```typescript
   // Script to add categories to existing videos
   async function migrateVideos() {
     const videos = await getAllVideos();
     for (const video of videos) {
       if (!video.category) {
         // Logic to determine category
         const suggestedCategory = suggestCategory(video);
         if (suggestedCategory) {
           await updateVideo(video.id, { category: suggestedCategory });
         }
       }
     }
   }
   ```

---

## Success Metrics

### KPIs to Track

1. **Adoption Metrics**
   - % of new uploads with category selected (Target: 80%)
   - % of total videos with categories (Target: 60% in 3 months)
   - Average time to select category during upload (Target: <5 seconds)

2. **Discovery Metrics**
   - Category page visits per day (Target: 1000+)
   - Click-through rate on category filters (Target: 15%)
   - Average session time on category pages (Target: 5+ minutes)

3. **User Satisfaction**
   - User feedback on category relevance (Target: 4.5/5 stars)
   - Category search accuracy (Target: 90% relevant results)
   - Support tickets related to categories (Target: <10/month)

### Analytics Implementation

```typescript
// Track category selection during upload
await trackEvent('video_upload', {
  category_selected: metadata.category || 'none',
  upload_duration: uploadTime,
});

// Track category filter usage
await trackEvent('category_filter', {
  category: selectedCategory,
  videos_found: results.length,
  page: 'browse',
});

// Track category page views
await trackEvent('category_page_view', {
  category: category,
  locale: locale,
  videos_shown: videos.length,
});
```

---

## Future Enhancements

### Phase 2 Features (Later)

1. **Sub-Categories**
   - Add sub-categories for more granular organization
   - Example: Quran Recitation → By Surah, By Qari, By Style

2. **Category Recommendations**
   - ML model to suggest category based on title/description
   - Auto-categorization for bulk uploads

3. **Category Analytics**
   - Dashboard showing video distribution by category
   - Popular categories report
   - Category performance metrics

4. **Category Permissions**
   - Restrict certain categories to verified scholars
   - Category-based moderation rules

5. **Category Subscriptions**
   - Users can subscribe to specific categories
   - Notifications for new videos in subscribed categories

---

## Risk Mitigation

### Identified Risks

1. **Risk: Category Mismatch**
   - **Mitigation**: Add reporting feature for wrong categories
   - **Mitigation**: Moderation review for category changes

2. **Risk: Performance Impact**
   - **Mitigation**: Index videos by category in R2
   - **Mitigation**: Cache category queries

3. **Risk: User Confusion**
   - **Mitigation**: Add tooltips explaining each category
   - **Mitigation**: Provide category selection guide

4. **Risk: Category Spam**
   - **Mitigation**: Limit category changes per video
   - **Mitigation**: Log category change history

---

## Appendix

### A. Category Decision Rationale

The 15 Islamic categories were chosen based on:
1. **Content Analysis**: Review of existing Islamic video platforms
2. **Community Needs**: Common content types in Muslim communities
3. **Search Patterns**: Popular Islamic content search queries
4. **Scholar Input**: Consultation with Islamic content creators

### B. Alternative Approaches Considered

1. **Dynamic Categories**: Rejected - Too complex, risk of spam
2. **Hierarchical Categories**: Deferred - Can be added later
3. **Tag-Only System**: Rejected - Less structured, harder to browse
4. **YouTube Categories**: Rejected - Not specific enough for Islamic content

### C. References

- YouTube Category Documentation
- Islamic Content Platform Analysis
- User Research Survey Results
- Technical Architecture Documents

---

## Summary

The Video Category Selection feature will significantly improve content discovery and organization on Al Ummah Now. With 15 Islamic-specific categories, users can easily find and share content relevant to their spiritual needs. The implementation is straightforward, leveraging existing infrastructure while adding minimal complexity.

**Total Estimated Effort**: 5 developer-days
**Expected Impact**: HIGH - Improves discovery for all users
**Risk Level**: LOW - Simple addition to existing systems

---

**Document Status**: Ready for Review
**Next Steps**:
1. Review and approve design
2. Assign developers
3. Begin Phase 1 implementation
4. Schedule deployment for next sprint