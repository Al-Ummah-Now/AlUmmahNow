# Tag Suggestions Feature - Implementation Plan

**Feature ID**: 25-tag-suggestions
**Status**: Proposed
**Priority**: MEDIUM
**Estimated Effort**: 1-2 weeks (2 developers)
**Created**: 2025-11-20
**Author**: System Architect

## Table of Contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Technical Design](#technical-design)
4. [Implementation Details](#implementation-details)
5. [API Design](#api-design)
6. [Files to Create/Modify](#files-to-createmodify)
7. [Testing Strategy](#testing-strategy)
8. [Migration Plan](#migration-plan)
9. [Success Metrics](#success-metrics)

---

## Overview

### Problem Statement

Al Ummah Now currently has a basic tags field in the video upload form, but users must manually enter tags without any assistance or suggestions. This leads to:
- Inconsistent tagging across similar content
- Missed opportunities for better SEO and discoverability
- Time-consuming manual tag entry
- Lack of Islamic-specific tag recommendations
- No insights into popular or trending tags

YouTube provides auto-suggestions based on title/description, popular tags in category, and related tags. Al Ummah Now needs a similar but Islamic-focused tag suggestion system.

### Solution Summary

Implement a comprehensive tag suggestion system that provides:
1. **Auto-suggestions** based on video title and description using NLP
2. **Popular tags** tracking and suggestions within each category
3. **Related tags** based on commonly co-occurring tags
4. **Islamic content tags** with a curated database of Islamic terms
5. **Real-time suggestions** as users type in the tags field
6. **Tag analytics** to track usage and popularity

---

## Requirements

### Functional Requirements

1. **Tag Suggestion Sources**
   - Extract keywords from title/description (NLP-based)
   - Popular tags in selected category (top 10-20)
   - Related tags based on already selected tags
   - Islamic terminology database (Quran, Hadith, Fiqh terms)
   - Trending tags (last 30 days)
   - Language-specific suggestions (English/Arabic)

2. **UI/UX Requirements**
   - Tag input with autocomplete dropdown
   - Suggested tags chips below input field
   - Click to add suggested tag
   - Remove tag with X button
   - Show tag popularity indicator (usage count)
   - Limit to 15 tags maximum (YouTube standard)

3. **API Requirements**
   - GET /api/tags/suggestions - Get tag suggestions
   - GET /api/tags/popular - Get popular tags by category
   - GET /api/tags/trending - Get trending tags
   - GET /api/tags/related - Get related tags
   - POST /api/tags/track - Track tag usage (internal)

4. **Data Storage**
   - Tag usage statistics in R2 bucket
   - Popular tags cache in KV store
   - Islamic terms database in static JSON
   - Tag co-occurrence matrix for relationships

### Non-Functional Requirements

- **Performance**: Suggestions within 200ms
- **Scalability**: Support millions of tag queries
- **Accuracy**: 70%+ relevant suggestions
- **i18n**: Support English and Arabic tags
- **Privacy**: No personal data in tag analytics

---

## Technical Design

### 1. Tag Suggestion Algorithm

```typescript
// Core algorithm for generating tag suggestions
interface TagSuggestionEngine {
  // Main suggestion method
  suggestTags(input: TagSuggestionInput): Promise<TagSuggestion[]>;

  // Individual strategies
  extractFromText(text: string, language: 'en' | 'ar'): string[];
  getPopularInCategory(category: VideoCategory): Promise<string[]>;
  getRelatedTags(existingTags: string[]): Promise<string[]>;
  getTrendingTags(limit: number): Promise<string[]>;
  getIslamicTerms(context: string): string[];
}

interface TagSuggestionInput {
  title: string;
  titleLocalized?: { en?: string; ar?: string };
  description?: string;
  descriptionLocalized?: { en?: string; ar?: string };
  category?: VideoCategory;
  existingTags?: string[];
  language: 'en' | 'ar';
}

interface TagSuggestion {
  tag: string;
  score: number;        // Relevance score (0-1)
  source: TagSource;    // Where suggestion came from
  usageCount: number;   // How many times used
  trending: boolean;    // Is currently trending
}

enum TagSource {
  TITLE_EXTRACTION = 'title',
  DESCRIPTION_EXTRACTION = 'description',
  CATEGORY_POPULAR = 'category',
  RELATED_TAGS = 'related',
  TRENDING = 'trending',
  ISLAMIC_TERMS = 'islamic',
}
```

### 2. NLP Text Extraction

```typescript
// Simple keyword extraction without external dependencies
class KeywordExtractor {
  private stopWords: Set<string>;
  private islamicTerms: Map<string, string[]>; // term -> variations

  constructor(language: 'en' | 'ar') {
    this.stopWords = this.loadStopWords(language);
    this.islamicTerms = this.loadIslamicTerms(language);
  }

  extract(text: string): string[] {
    // 1. Tokenize and clean
    const tokens = this.tokenize(text);

    // 2. Remove stop words
    const filtered = tokens.filter(t => !this.stopWords.has(t.toLowerCase()));

    // 3. Identify Islamic terms
    const islamicMatches = this.findIslamicTerms(filtered);

    // 4. Extract n-grams (1-3 words)
    const ngrams = this.extractNGrams(filtered, 3);

    // 5. Score by frequency and position
    const scored = this.scoreTerms(ngrams);

    // 6. Return top keywords
    return [...islamicMatches, ...scored.slice(0, 10)];
  }

  private tokenize(text: string): string[] {
    // Handle Arabic and English tokenization
    return text
      .replace(/[^\w\s\u0600-\u06FF]/g, ' ') // Keep alphanumeric + Arabic
      .split(/\s+/)
      .filter(t => t.length > 2);
  }

  private findIslamicTerms(tokens: string[]): string[] {
    const found = new Set<string>();
    const text = tokens.join(' ').toLowerCase();

    for (const [term, variations] of this.islamicTerms) {
      for (const variant of variations) {
        if (text.includes(variant.toLowerCase())) {
          found.add(term);
        }
      }
    }

    return Array.from(found);
  }

  private extractNGrams(tokens: string[], maxN: number): string[] {
    const ngrams: string[] = [];

    for (let n = 1; n <= maxN; n++) {
      for (let i = 0; i <= tokens.length - n; i++) {
        ngrams.push(tokens.slice(i, i + n).join(' '));
      }
    }

    return ngrams;
  }

  private scoreTerms(terms: string[]): string[] {
    const frequency = new Map<string, number>();

    terms.forEach(term => {
      frequency.set(term, (frequency.get(term) || 0) + 1);
    });

    return Array.from(frequency.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([term]) => term);
  }
}
```

### 3. Tag Analytics Storage

```typescript
// R2 bucket structure for tag analytics
interface TagAnalytics {
  tag: string;
  usageCount: number;
  lastUsed: string;
  categories: Record<VideoCategory, number>; // Usage per category
  coOccurringTags: Array<{ tag: string; count: number }>; // Related tags
  trend: {
    daily: number[];   // Last 30 days
    weekly: number[];  // Last 12 weeks
    monthly: number[]; // Last 12 months
  };
}

// KV store for fast lookups
interface PopularTagsCache {
  global: string[];                           // Top 50 global
  byCategory: Record<VideoCategory, string[]>; // Top 20 per category
  trending: Array<{ tag: string; growth: number }>; // Top 20 trending
  lastUpdated: string;
}
```

### 4. Islamic Terms Database

```typescript
// Static database of Islamic terminology
const ISLAMIC_TERMS_DB = {
  en: {
    quran: {
      terms: ['quran', 'koran', 'holy book', 'mushaf', 'ayah', 'ayat', 'verse', 'surah', 'chapter'],
      surahs: ['al-fatihah', 'al-baqarah', 'ali-imran', /* ... all 114 surah names ... */],
      topics: ['tafsir', 'exegesis', 'interpretation', 'recitation', 'tilawah', 'tajweed', 'memorization', 'hifz'],
    },
    hadith: {
      terms: ['hadith', 'sunnah', 'prophet', 'muhammad', 'pbuh', 'saw', 'tradition', 'saying'],
      collections: ['bukhari', 'muslim', 'tirmidhi', 'abu-dawood', 'nasai', 'ibn-majah'],
      topics: ['sahih', 'authentic', 'chain', 'isnad', 'narrator', 'rawi', 'weak', 'daif'],
    },
    fiqh: {
      terms: ['fiqh', 'jurisprudence', 'law', 'islamic-law', 'sharia', 'ruling', 'fatwa'],
      schools: ['hanafi', 'maliki', 'shafii', 'hanbali'],
      topics: ['halal', 'haram', 'makruh', 'mubah', 'mandub', 'wajib', 'fard', 'sunnah'],
    },
    worship: {
      terms: ['salah', 'prayer', 'namaz', 'zakat', 'charity', 'fasting', 'sawm', 'hajj', 'umrah', 'pilgrimage'],
      topics: ['wudu', 'ablution', 'tahajjud', 'tarawih', 'eid', 'jummah', 'friday-prayer'],
    },
    // ... more categories
  },
  ar: {
    // Arabic equivalents
    quran: {
      terms: ['قرآن', 'كتاب', 'مصحف', 'آية', 'آيات', 'سورة'],
      // ... Arabic terms
    },
    // ... more Arabic categories
  }
};

// Helper to find relevant Islamic terms
function getIslamicTermSuggestions(text: string, language: 'en' | 'ar'): string[] {
  const suggestions = new Set<string>();
  const normalizedText = text.toLowerCase();
  const db = ISLAMIC_TERMS_DB[language];

  for (const category of Object.values(db)) {
    for (const termList of Object.values(category)) {
      if (Array.isArray(termList)) {
        for (const term of termList) {
          if (normalizedText.includes(term) || term.includes(normalizedText)) {
            suggestions.add(term);
          }
        }
      }
    }
  }

  return Array.from(suggestions);
}
```

### 5. Tag Suggestion API Implementation

```typescript
// apps/api-videos/src/endpoints/tags/tagSuggestions.ts

import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import R2Repository from "../../lib/r2Repo";

export class TagSuggestions extends OpenAPIRoute {
  schema = {
    tags: ["Tags"],
    summary: "Get Tag Suggestions",
    description: "Get intelligent tag suggestions based on video metadata",
    request: {
      query: z.object({
        title: z.string().optional().describe("Video title"),
        description: z.string().optional().describe("Video description"),
        category: z.nativeEnum(VideoCategory).optional().describe("Video category"),
        existingTags: z.string().optional().describe("Comma-separated existing tags"),
        language: z.enum(['en', 'ar']).default('en').describe("Language for suggestions"),
        limit: z.number().min(1).max(50).default(20).describe("Maximum suggestions"),
      }),
    },
    responses: {
      "200": {
        description: "Tag suggestions",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              result: z.object({
                suggestions: z.array(z.object({
                  tag: z.string(),
                  score: z.number(),
                  source: z.string(),
                  usageCount: z.number(),
                  trending: z.boolean(),
                })),
                stats: z.object({
                  totalSuggestions: z.number(),
                  sources: z.record(z.number()),
                }),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c) {
    const { title, description, category, existingTags, language, limit } = c.req.query();

    // Initialize suggestion engine
    const engine = new TagSuggestionEngine(c.env);

    // Get suggestions from multiple sources
    const suggestions = await engine.suggestTags({
      title: title || '',
      description: description || '',
      category,
      existingTags: existingTags?.split(',').filter(t => t.trim()) || [],
      language,
    });

    // Sort by score and limit
    const sorted = suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Calculate stats
    const stats = {
      totalSuggestions: sorted.length,
      sources: sorted.reduce((acc, s) => {
        acc[s.source] = (acc[s.source] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    return c.json({
      success: true,
      result: {
        suggestions: sorted,
        stats,
      },
    });
  }
}
```

### 6. Popular Tags Tracking

```typescript
// apps/api-videos/src/endpoints/tags/popularTags.ts

export class PopularTags extends OpenAPIRoute {
  schema = {
    tags: ["Tags"],
    summary: "Get Popular Tags",
    description: "Get most popular tags globally or by category",
    request: {
      query: z.object({
        category: z.nativeEnum(VideoCategory).optional(),
        period: z.enum(['day', 'week', 'month', 'all']).default('all'),
        limit: z.number().min(1).max(100).default(20),
      }),
    },
    responses: {
      "200": {
        description: "Popular tags list",
        content: {
          "application/json": {
            schema: z.array(z.object({
              tag: z.string(),
              count: z.number(),
              growth: z.number(), // Percentage growth
              category: z.string().optional(),
            })),
          },
        },
      },
    },
  };

  async handle(c) {
    const { category, period, limit } = c.req.query();

    // Try cache first
    const cache = await c.env.TAGS_CACHE.get('popular_tags', 'json') as PopularTagsCache;

    if (cache && isRecent(cache.lastUpdated)) {
      const tags = category ? cache.byCategory[category] : cache.global;
      return c.json(tags.slice(0, limit));
    }

    // Calculate from analytics
    const analytics = new TagAnalyticsService(c.env.TAG_ANALYTICS);
    const popular = await analytics.getPopularTags(category, period, limit);

    // Update cache
    await this.updateCache(c.env.TAGS_CACHE, popular);

    return c.json(popular);
  }
}
```

### 7. Frontend Tag Input Component

```tsx
// apps/web/src/components/TagInput/index.tsx

import { useState, useEffect, useCallback } from 'react';
import { X, Hash, TrendingUp, Star } from 'lucide-react';
import { VideoCategory } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { debounce } from '@/lib/utils';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  title?: string;
  description?: string;
  category?: VideoCategory;
  maxTags?: number;
  disabled?: boolean;
}

interface TagSuggestion {
  tag: string;
  score: number;
  source: string;
  usageCount: number;
  trending: boolean;
}

export function TagInput({
  value = [],
  onChange,
  title = '',
  description = '',
  category,
  maxTags = 15,
  disabled = false,
}: TagInputProps) {
  const { t, locale } = useLanguage();
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Fetch suggestions when input changes
  const fetchSuggestions = useCallback(
    debounce(async (query: string) => {
      if (!query && !title && !description) {
        setSuggestions([]);
        return;
      }

      setLoading(true);
      try {
        const params = new URLSearchParams({
          title,
          description,
          ...(category && { category }),
          ...(value.length && { existingTags: value.join(',') }),
          ...(query && { query }),
          language: locale,
          limit: '10',
        });

        const response = await fetch(`/api/tags/suggestions?${params}`);
        const data = await response.json();

        if (data.success) {
          setSuggestions(data.result.suggestions);
        }
      } catch (error) {
        console.error('Failed to fetch tag suggestions:', error);
      } finally {
        setLoading(false);
      }
    }, 300),
    [title, description, category, value, locale]
  );

  useEffect(() => {
    fetchSuggestions(inputValue);
  }, [inputValue, fetchSuggestions]);

  // Fetch initial suggestions based on title/description
  useEffect(() => {
    if ((title || description) && value.length === 0) {
      fetchSuggestions('');
    }
  }, [title, description, fetchSuggestions, value.length]);

  const addTag = (tag: string) => {
    const normalizedTag = tag.trim().toLowerCase();
    if (normalizedTag && !value.includes(normalizedTag) && value.length < maxTags) {
      onChange([...value, normalizedTag]);
      setInputValue('');
      setSuggestions([]);
      setShowDropdown(false);

      // Track tag usage
      fetch('/api/tags/track', {
        method: 'POST',
        body: JSON.stringify({ tag: normalizedTag, category }),
      }).catch(console.error);
    }
  };

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0) {
        addTag(suggestions[0].tag);
      } else if (inputValue) {
        addTag(inputValue);
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value.length - 1);
    }
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'trending': return <TrendingUp size={12} className="text-green-500" />;
      case 'category': return <Hash size={12} className="text-blue-500" />;
      case 'islamic': return <Star size={12} className="text-yellow-500" />;
      default: return null;
    }
  };

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        {t.video.tags} ({value.length}/{maxTags})
      </label>

      {/* Current Tags */}
      <div className="flex flex-wrap gap-2 mb-2">
        {value.map((tag, index) => (
          <span
            key={index}
            className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200"
          >
            <Hash size={14} className="mr-1" />
            {tag}
            {!disabled && (
              <button
                onClick={() => removeTag(index)}
                className="ml-2 hover:text-blue-600 dark:hover:text-blue-400"
                aria-label={`Remove tag ${tag}`}
              >
                <X size={14} />
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Tag Input */}
      <div className="relative">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
          placeholder={value.length >= maxTags ? t.video.maxTagsReached : t.video.addTags}
          disabled={disabled || value.length >= maxTags}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
        />

        {/* Suggestions Dropdown */}
        {showDropdown && suggestions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-lg max-h-60 overflow-auto">
            {loading ? (
              <div className="px-3 py-2 text-gray-500 dark:text-gray-400">
                {t.common.loading}...
              </div>
            ) : (
              suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => addTag(suggestion.tag)}
                  className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between"
                >
                  <div className="flex items-center">
                    {getSourceIcon(suggestion.source)}
                    <span className="ml-2">{suggestion.tag}</span>
                    {suggestion.trending && (
                      <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                        {t.tags.trending}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {suggestion.usageCount} {t.tags.uses}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Suggested Tags Chips */}
      {suggestions.length > 0 && !showDropdown && (
        <div className="mt-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            {t.tags.suggestions}:
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 6).map((suggestion, index) => (
              <button
                key={index}
                onClick={() => addTag(suggestion.tag)}
                disabled={disabled || value.length >= maxTags}
                className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {getSourceIcon(suggestion.source)}
                <span className="ml-1">{suggestion.tag}</span>
                {suggestion.trending && (
                  <TrendingUp size={12} className="ml-1 text-green-500" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        {t.tags.helpText}
      </p>
    </div>
  );
}
```

---

## Implementation Details

### Phase 1: Backend Infrastructure (Days 1-3)

**Tasks:**
1. Create tag analytics R2 bucket structure
2. Implement TagSuggestionEngine class
3. Create KeywordExtractor for NLP
4. Build Islamic terms database
5. Implement tag suggestions API endpoint
6. Create popular tags API endpoint
7. Add trending tags API endpoint
8. Implement tag tracking endpoint
9. Set up KV cache for popular tags
10. Add tag analytics background job

**Developer:** Backend Developer

### Phase 2: Frontend Components (Days 3-5)

**Tasks:**
1. Create TagInput component with autocomplete
2. Build tag suggestion dropdown
3. Implement tag chips display
4. Add trending indicator icons
5. Create tag removal functionality
6. Integrate with upload form
7. Add to video edit form
8. Implement tag tracking on selection
9. Add bilingual support
10. Create loading states

**Developer:** Frontend Developer

### Phase 3: Analytics & Tracking (Days 5-7)

**Tasks:**
1. Implement tag usage tracking
2. Build co-occurrence matrix calculator
3. Create trending tags algorithm
4. Add category-specific popularity
5. Implement analytics dashboard
6. Create tag performance metrics
7. Build cache warming job
8. Add monitoring/alerts
9. Create admin tag management UI
10. Implement tag moderation tools

**Developer:** Backend Developer

### Phase 4: Testing & Optimization (Days 7-9)

**Tasks:**
1. Unit test suggestion algorithms
2. Test NLP extraction accuracy
3. Performance test API endpoints
4. Load test with concurrent requests
5. Test bilingual support
6. Verify Islamic terms matching
7. Test cache invalidation
8. UI/UX testing
9. Edge case testing
10. Documentation updates

**Developer:** Both Developers

---

## API Design

### 1. GET /api/tags/suggestions

**Purpose**: Get intelligent tag suggestions based on video metadata

**Request:**
```http
GET /api/tags/suggestions?title=Surah%20Baqarah%20Tafsir&category=quran_tafsir&language=en&limit=20
```

**Response:**
```json
{
  "success": true,
  "result": {
    "suggestions": [
      {
        "tag": "tafsir",
        "score": 0.95,
        "source": "title",
        "usageCount": 15234,
        "trending": false
      },
      {
        "tag": "surah-baqarah",
        "score": 0.92,
        "source": "islamic",
        "usageCount": 8921,
        "trending": true
      },
      {
        "tag": "quran-explanation",
        "score": 0.87,
        "source": "category",
        "usageCount": 6543,
        "trending": false
      }
    ],
    "stats": {
      "totalSuggestions": 20,
      "sources": {
        "title": 5,
        "category": 8,
        "islamic": 7
      }
    }
  }
}
```

### 2. GET /api/tags/popular

**Purpose**: Get most popular tags globally or by category

**Request:**
```http
GET /api/tags/popular?category=islamic_lectures&period=week&limit=10
```

**Response:**
```json
{
  "success": true,
  "result": [
    {
      "tag": "islamic-lecture",
      "count": 3421,
      "growth": 15.2,
      "rank": 1
    },
    {
      "tag": "ramadan-2025",
      "count": 2854,
      "growth": 125.7,
      "rank": 2
    }
  ]
}
```

### 3. GET /api/tags/trending

**Purpose**: Get currently trending tags

**Request:**
```http
GET /api/tags/trending?period=day&limit=20
```

**Response:**
```json
{
  "success": true,
  "result": [
    {
      "tag": "palestine",
      "growth": 450.2,
      "currentCount": 892,
      "previousCount": 162,
      "velocity": "rapid"
    }
  ]
}
```

### 4. GET /api/tags/related

**Purpose**: Get tags related to provided tags

**Request:**
```http
GET /api/tags/related?tags=hajj,umrah&limit=10
```

**Response:**
```json
{
  "success": true,
  "result": [
    {
      "tag": "mecca",
      "relevance": 0.89,
      "coOccurrenceCount": 1234
    },
    {
      "tag": "pilgrimage",
      "relevance": 0.85,
      "coOccurrenceCount": 987
    }
  ]
}
```

### 5. POST /api/tags/track (Internal)

**Purpose**: Track tag usage for analytics

**Request:**
```json
{
  "tag": "ramadan",
  "videoId": "video123",
  "category": "ramadan",
  "userId": "user456"
}
```

**Response:**
```json
{
  "success": true,
  "result": {
    "tracked": true,
    "newCount": 8922
  }
}
```

---

## Files to Create/Modify

### New Files to Create

```
# API Endpoints
apps/api-videos/src/endpoints/tags/tagSuggestions.ts        (250 lines)
apps/api-videos/src/endpoints/tags/popularTags.ts           (150 lines)
apps/api-videos/src/endpoints/tags/trendingTags.ts          (140 lines)
apps/api-videos/src/endpoints/tags/relatedTags.ts           (130 lines)
apps/api-videos/src/endpoints/tags/trackTag.ts              (80 lines)

# Core Services
apps/api-videos/src/services/TagSuggestionEngine.ts         (400 lines)
apps/api-videos/src/services/KeywordExtractor.ts            (300 lines)
apps/api-videos/src/services/TagAnalyticsService.ts         (350 lines)
apps/api-videos/src/services/IslamicTermsDatabase.ts        (500 lines)

# Frontend Components
apps/web/src/components/TagInput/index.tsx                  (280 lines)
apps/web/src/components/TagInput/TagChip.tsx                (60 lines)
apps/web/src/components/TagInput/TagSuggestion.tsx          (80 lines)
apps/web/src/components/TagInput/styles.module.css          (40 lines)

# Utilities
apps/api-videos/src/lib/nlp/stopwords-en.json              (200 lines)
apps/api-videos/src/lib/nlp/stopwords-ar.json              (200 lines)
apps/api-videos/src/lib/nlp/islamic-terms-en.json          (500 lines)
apps/api-videos/src/lib/nlp/islamic-terms-ar.json          (500 lines)

# Tests
apps/api-videos/src/__tests__/tags/suggestions.test.ts      (200 lines)
apps/api-videos/src/__tests__/tags/extraction.test.ts       (150 lines)
apps/web/src/components/TagInput/__tests__/index.test.tsx   (180 lines)
```

### Files to Modify

```
# Shared Types
packages/shared-types/src/video.ts                          (+30 lines)
packages/shared-types/src/tags.ts (new)                     (+80 lines)

# API Integration
apps/api-videos/src/index.ts                                (+10 lines)
apps/api-videos/wrangler.jsonc                              (+15 lines)

# Frontend Integration
apps/web/src/components/videoUpload/index.tsx               (+25 lines)
apps/web/src/components/videoEdit/index.tsx                 (+25 lines)
apps/web/src/lib/api/tags.ts (new)                         (+120 lines)

# Translations
apps/web/src/lib/i18n/translations/en.ts                    (+30 lines)
apps/web/src/lib/i18n/translations/ar.ts                    (+30 lines)
```

**Total Estimated Lines of Code:** ~4,500 lines

---

## Testing Strategy

### Unit Tests

```typescript
// Example test cases for tag extraction
describe('KeywordExtractor', () => {
  it('should extract Islamic terms from title', () => {
    const extractor = new KeywordExtractor('en');
    const tags = extractor.extract('Tafsir of Surah Al-Baqarah by Sheikh');
    expect(tags).toContain('tafsir');
    expect(tags).toContain('surah-baqarah');
  });

  it('should handle Arabic text', () => {
    const extractor = new KeywordExtractor('ar');
    const tags = extractor.extract('تفسير سورة البقرة');
    expect(tags).toContain('تفسير');
    expect(tags).toContain('البقرة');
  });

  it('should remove stop words', () => {
    const extractor = new KeywordExtractor('en');
    const tags = extractor.extract('The best way to learn Quran');
    expect(tags).not.toContain('the');
    expect(tags).not.toContain('to');
    expect(tags).toContain('learn');
    expect(tags).toContain('quran');
  });
});

describe('TagSuggestionEngine', () => {
  it('should combine suggestions from multiple sources', async () => {
    const engine = new TagSuggestionEngine(mockEnv);
    const suggestions = await engine.suggestTags({
      title: 'Hajj Guide 2025',
      category: VideoCategory.HAJJ_UMRAH,
      language: 'en',
    });

    expect(suggestions.length).toBeGreaterThan(5);
    expect(suggestions.some(s => s.source === 'title')).toBe(true);
    expect(suggestions.some(s => s.source === 'category')).toBe(true);
  });

  it('should score suggestions by relevance', async () => {
    const suggestions = await engine.suggestTags({
      title: 'Ramadan Fasting Rules',
      description: 'Complete guide to fasting in Ramadan',
    });

    expect(suggestions[0].score).toBeGreaterThan(suggestions[1].score);
    expect(suggestions.find(s => s.tag === 'ramadan')?.score).toBeGreaterThan(0.8);
  });
});
```

### Integration Tests

```typescript
describe('Tag Suggestions API', () => {
  it('should return suggestions for video metadata', async () => {
    const response = await fetch('/api/tags/suggestions?title=Islamic History&limit=10');
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.result.suggestions).toHaveLength(10);
    expect(data.result.suggestions[0]).toHaveProperty('tag');
    expect(data.result.suggestions[0]).toHaveProperty('score');
  });

  it('should track tag usage', async () => {
    const response = await fetch('/api/tags/track', {
      method: 'POST',
      body: JSON.stringify({ tag: 'test-tag', videoId: 'video123' }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.result.tracked).toBe(true);
  });
});
```

### Performance Tests

```typescript
describe('Tag Suggestion Performance', () => {
  it('should return suggestions within 200ms', async () => {
    const start = Date.now();
    await fetch('/api/tags/suggestions?title=Test&description=Long text');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(200);
  });

  it('should handle concurrent requests', async () => {
    const requests = Array(100).fill(0).map(() =>
      fetch('/api/tags/suggestions?title=Test')
    );

    const results = await Promise.all(requests);
    expect(results.every(r => r.status === 200)).toBe(true);
  });
});
```

### UI/UX Tests

```typescript
describe('TagInput Component', () => {
  it('should show suggestions dropdown on focus', async () => {
    render(<TagInput value={[]} onChange={jest.fn()} title="Test Video" />);
    const input = screen.getByPlaceholderText(/add tags/i);

    fireEvent.focus(input);
    await waitFor(() => {
      expect(screen.getByText(/suggestions/i)).toBeInTheDocument();
    });
  });

  it('should add tag on click', async () => {
    const onChange = jest.fn();
    render(<TagInput value={[]} onChange={onChange} />);

    const suggestion = await screen.findByText('islamic-lecture');
    fireEvent.click(suggestion);

    expect(onChange).toHaveBeenCalledWith(['islamic-lecture']);
  });

  it('should limit to maxTags', () => {
    const tags = Array(15).fill(0).map((_, i) => `tag${i}`);
    render(<TagInput value={tags} onChange={jest.fn()} maxTags={15} />);

    const input = screen.getByPlaceholderText(/max tags reached/i);
    expect(input).toBeDisabled();
  });
});
```

---

## Migration Plan

### Phase 1: Deploy Backend (No Breaking Changes)

1. Deploy tag analytics infrastructure
2. Deploy suggestion APIs
3. Start collecting tag analytics in background
4. No impact on existing functionality

### Phase 2: Gradual Frontend Rollout

1. Add TagInput component as opt-in feature flag
2. A/B test with 10% of users initially
3. Monitor usage and feedback
4. Gradually increase rollout percentage
5. Full rollout after validation

### Phase 3: Backfill Historical Data

```typescript
// Script to analyze existing videos and populate tag analytics
async function backfillTagAnalytics() {
  const videosRepo = new R2Repository(env.videos);
  const analyticsRepo = new R2Repository(env.TAG_ANALYTICS);

  const videos = await videosRepo.listObjects(1000);

  for (const video of videos.items) {
    if (video.tags && video.tags.length > 0) {
      for (const tag of video.tags) {
        await updateTagAnalytics(analyticsRepo, {
          tag,
          category: video.category,
          timestamp: video.dateCreated,
        });
      }
    }
  }
}
```

---

## Success Metrics

### KPIs to Track

1. **Adoption Metrics**
   - % of uploads using suggested tags (Target: 60%)
   - Average tags per video (Target: 5-8)
   - % of suggested tags accepted (Target: 40%)

2. **Quality Metrics**
   - Tag relevance score (user feedback) (Target: 4.2/5)
   - Search result improvement (Target: 20% better CTR)
   - Tag diversity index (Target: 500+ unique tags/day)

3. **Performance Metrics**
   - API response time (Target: <200ms p95)
   - Suggestion accuracy (Target: 70% relevant)
   - Cache hit rate (Target: 80%)

4. **Engagement Metrics**
   - Videos discovered via tags (Target: 30% of views)
   - Tag click-through rate (Target: 15%)
   - Tag-based subscription rate (Target: 5%)

### Analytics Dashboard

```typescript
// Track tag suggestion usage
interface TagSuggestionMetrics {
  date: string;
  suggestionsShown: number;
  suggestionsAccepted: number;
  acceptanceRate: number;
  topAcceptedTags: string[];
  topRejectedTags: string[];
  averageTagsPerVideo: number;
  uniqueTagsUsed: number;
  sourceBreakdown: {
    title: number;
    description: number;
    category: number;
    islamic: number;
    trending: number;
  };
}
```

---

## Future Enhancements

### Phase 2 Features

1. **AI-Powered Suggestions**
   - Use ML model for better tag predictions
   - Train on Islamic content corpus
   - Context-aware suggestions

2. **Multi-language Tags**
   - Auto-translate tags between languages
   - Cross-language tag linking
   - RTL/LTR tag display optimization

3. **Tag Hierarchies**
   - Parent-child tag relationships
   - Tag synonyms and aliases
   - Canonical tag mapping

4. **Advanced Analytics**
   - Tag performance dashboard
   - Tag trend predictions
   - Tag recommendation engine

5. **Community Features**
   - User-suggested tags
   - Tag voting system
   - Tag moderation queue

6. **SEO Optimization**
   - Tag-based sitemap generation
   - Schema.org markup for tags
   - Tag landing pages

---

## Risk Mitigation

### Identified Risks

1. **Risk: Inappropriate Tag Suggestions**
   - **Mitigation**: Implement bad word filter
   - **Mitigation**: Manual review queue for reported tags
   - **Mitigation**: Islamic content moderation

2. **Risk: Tag Spam**
   - **Mitigation**: Limit tags per video (15)
   - **Mitigation**: Tag quality scoring
   - **Mitigation**: Rate limiting on tag creation

3. **Risk: Performance Degradation**
   - **Mitigation**: Aggressive caching strategy
   - **Mitigation**: Background processing for analytics
   - **Mitigation**: CDN for static tag databases

4. **Risk: Low Adoption**
   - **Mitigation**: Prominent UI placement
   - **Mitigation**: User education/onboarding
   - **Mitigation**: Gamification (tag badges)

---

## Technical Decisions

### Why Not Use External NLP Service?

**Decision**: Build lightweight in-house keyword extraction

**Rationale:**
- External services add latency (200-500ms)
- Cost per API call adds up quickly
- Islamic terminology requires custom logic
- Privacy concerns with sending content externally
- Simple keyword extraction sufficient for MVP

### Why R2 for Analytics Instead of Traditional Database?

**Decision**: Use R2 buckets for tag analytics storage

**Rationale:**
- Consistent with existing architecture
- No need for complex queries (key-value access)
- Cost-effective for append-only analytics
- Easy to implement map-reduce for aggregations
- Can migrate to database later if needed

### Why KV Store for Cache?

**Decision**: Use Cloudflare KV for popular tags cache

**Rationale:**
- Sub-millisecond read performance
- Global distribution included
- Automatic cache invalidation
- No infrastructure to manage
- Perfect for read-heavy workloads

---

## Summary

The Tag Suggestions feature will significantly improve content discoverability and SEO on Al Ummah Now. By providing intelligent, Islamic-focused tag suggestions from multiple sources (NLP extraction, popular tags, trending tags, and Islamic terminology), creators can better categorize their content while viewers can more easily find relevant videos.

**Key Benefits:**
- Improved video discoverability
- Better SEO and search results
- Consistent tagging across platform
- Islamic-specific recommendations
- Real-time trending insights

**Total Estimated Effort**: 9 developer-days
**Expected Impact**: MEDIUM-HIGH - Improves discovery and SEO
**Risk Level**: LOW - Non-breaking addition to existing system

---

**Document Status**: Complete and Ready for Review
**Next Steps:**
1. Review and approve technical design
2. Assign backend and frontend developers
3. Set up R2 buckets and KV namespaces
4. Begin Phase 1 backend implementation
5. Create feature flag for gradual rollout