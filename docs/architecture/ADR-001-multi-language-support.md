# ADR-001: Multi-Language Support for Content Entities

## Status
**Proposed**

## Context
Al Ummah Now needs to support multi-language content for Profile, Channel, and Video entities to serve both English and Arabic speaking audiences. The current implementation has single-language fields which limits content accessibility and user experience for a bilingual platform targeting the Islamic community globally.

**Current State:**
- Single language fields: `title`, `description`, `name`, `bio`, `displayName`
- Route-based localization exists (`/en/*` and `/ar/*`) for UI
- No content-level localization
- R2 object storage as primary datastore (no traditional database)
- Existing data must remain functional (backward compatibility required)

**Business Requirements:**
- Support English and Arabic content
- Graceful fallback when translations are missing
- No breaking changes for existing API consumers
- Enable content creators to provide localized content
- Maintain performance with minimal overhead

## Decision

We will implement a **field-level localization pattern** using nested JSON objects for multi-language fields while maintaining backward compatibility through computed fallback fields.

### Schema Design Pattern

```typescript
// Before (current)
interface VideoObject {
  title: string;
  description: string | null;
  // ...
}

// After (with multi-language support)
interface VideoObject {
  // Backward compatible fields (computed from localized)
  title: string;              // Fallback field
  description: string | null; // Fallback field

  // New localized fields
  titleLocalized?: LocalizedContent;
  descriptionLocalized?: LocalizedContent;

  // Preferred language for fallback
  defaultLanguage?: SupportedLanguage;
  // ...
}

interface LocalizedContent {
  en?: string;
  ar?: string;
}

type SupportedLanguage = 'en' | 'ar';
```

### Fallback Strategy

1. **Read Path (API → Client):**
   ```
   Requested Language → Localized Field → Default Language → Legacy Field → English → Any Available
   ```

2. **Write Path (Client → API):**
   - New content: Write to both localized and legacy fields
   - Updates: Update localized fields, recompute legacy fields
   - Migration: Existing data remains in legacy fields until edited

### Storage Structure in R2

```json
{
  "id": "video-123",
  "title": "Introduction to Islam",  // Legacy/computed field
  "titleLocalized": {
    "en": "Introduction to Islam",
    "ar": "مقدمة في الإسلام"
  },
  "description": "A comprehensive guide...",  // Legacy/computed field
  "descriptionLocalized": {
    "en": "A comprehensive guide to understanding the fundamentals of Islam",
    "ar": "دليل شامل لفهم أساسيات الإسلام"
  },
  "defaultLanguage": "en",
  "dateCreated": "2024-01-15T10:00:00Z",
  "dateModified": "2024-11-17T15:00:00Z"
}
```

## Implementation Architecture

### 1. Shared Types Package Changes

```typescript
// packages/shared-types/src/localization.ts
export interface LocalizedContent {
  en?: string;
  ar?: string;
}

export type SupportedLanguage = 'en' | 'ar';

export interface LocalizableEntity {
  defaultLanguage?: SupportedLanguage;
}

// Utility type for making fields localizable
export type WithLocalization<T, Fields extends keyof T> = T & {
  [K in Fields as `${K & string}Localized`]?: LocalizedContent;
} & LocalizableEntity;
```

### 2. Helper Utilities

```typescript
// packages/shared-types/src/localization-helpers.ts
export class LocalizationHelper {
  /**
   * Get localized value with fallback chain
   */
  static getValue(
    localized: LocalizedContent | undefined,
    fallback: string | undefined,
    requestedLang: SupportedLanguage,
    defaultLang?: SupportedLanguage
  ): string | undefined {
    // 1. Try requested language
    if (localized?.[requestedLang]) {
      return localized[requestedLang];
    }

    // 2. Try default language
    if (defaultLang && localized?.[defaultLang]) {
      return localized[defaultLang];
    }

    // 3. Try legacy field
    if (fallback) {
      return fallback;
    }

    // 4. Try English
    if (localized?.en) {
      return localized.en;
    }

    // 5. Try Arabic
    if (localized?.ar) {
      return localized.ar;
    }

    return undefined;
  }

  /**
   * Set localized value and update legacy field
   */
  static setValue(
    entity: any,
    fieldName: string,
    value: string,
    lang: SupportedLanguage
  ): void {
    const localizedField = `${fieldName}Localized`;

    // Initialize localized field if not exists
    if (!entity[localizedField]) {
      entity[localizedField] = {};
    }

    // Set localized value
    entity[localizedField][lang] = value;

    // Update legacy field if this is the default language or only value
    if (lang === entity.defaultLanguage || !entity[fieldName]) {
      entity[fieldName] = value;
    }
  }

  /**
   * Migrate legacy field to localized structure
   */
  static migrateLegacyField(
    entity: any,
    fieldName: string,
    detectedLang?: SupportedLanguage
  ): void {
    const localizedField = `${fieldName}Localized`;

    if (entity[fieldName] && !entity[localizedField]) {
      entity[localizedField] = {
        [detectedLang || 'en']: entity[fieldName]
      };

      if (!entity.defaultLanguage) {
        entity.defaultLanguage = detectedLang || 'en';
      }
    }
  }

  /**
   * Transform entity for API response
   */
  static transformForResponse<T>(
    entity: T & LocalizableEntity,
    requestedLang: SupportedLanguage,
    localizedFields: string[]
  ): T {
    const transformed = { ...entity };

    for (const field of localizedFields) {
      const localizedField = `${field}Localized`;
      const value = LocalizationHelper.getValue(
        entity[localizedField],
        entity[field],
        requestedLang,
        entity.defaultLanguage
      );

      if (value !== undefined) {
        transformed[field] = value;
      }
    }

    return transformed;
  }
}
```

### 3. API Layer Changes

```typescript
// apps/api-videos/src/endpoints/video/videoGet.ts
export class VideoGet extends OpenAPIRoute {
  async handle(c) {
    const { id } = c.req.param();
    const lang = c.req.header('Accept-Language')?.split(',')[0]?.split('-')[0] as SupportedLanguage || 'en';

    const video = await videoRepo.getObject(id);

    // Transform for response based on requested language
    const localizedVideo = LocalizationHelper.transformForResponse(
      video,
      lang,
      ['title', 'description']
    );

    return c.json({
      success: true,
      result: { video: localizedVideo }
    });
  }
}
```

### 4. UI Layer Changes

```typescript
// apps/web/src/hooks/useLocalizedContent.ts
export function useLocalizedContent<T extends LocalizableEntity>(
  entity: T,
  fields: string[]
): T {
  const { lang } = useI18n();

  return useMemo(() => {
    return LocalizationHelper.transformForResponse(
      entity,
      lang,
      fields
    );
  }, [entity, lang, fields]);
}

// Usage in components
const localizedVideo = useLocalizedContent(video, ['title', 'description']);
```

### 5. Form Components for Multi-Language Input

```typescript
// apps/web/src/components/forms/LocalizedTextField.tsx
interface LocalizedTextFieldProps {
  name: string;
  value: LocalizedContent;
  onChange: (value: LocalizedContent) => void;
  required?: boolean;
  multiline?: boolean;
}

export function LocalizedTextField({
  name,
  value,
  onChange,
  required,
  multiline
}: LocalizedTextFieldProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SupportedLanguage>('en');

  return (
    <div className="space-y-2">
      <div className="flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setActiveTab('en')}
          className={activeTab === 'en' ? 'border-b-2 border-primary' : ''}
        >
          English
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ar')}
          className={activeTab === 'ar' ? 'border-b-2 border-primary' : ''}
        >
          العربية
        </button>
      </div>

      <div className="relative">
        {activeTab === 'en' && (
          <TextField
            value={value.en || ''}
            onChange={(e) => onChange({ ...value, en: e.target.value })}
            required={required && !value.ar}
            multiline={multiline}
            dir="ltr"
          />
        )}
        {activeTab === 'ar' && (
          <TextField
            value={value.ar || ''}
            onChange={(e) => onChange({ ...value, ar: e.target.value })}
            required={required && !value.en}
            multiline={multiline}
            dir="rtl"
          />
        )}
      </div>

      {required && !value.en && !value.ar && (
        <p className="text-sm text-red-500">
          {t.validation.required}
        </p>
      )}
    </div>
  );
}
```

## Consequences

### Positive
- **Full backward compatibility** - Existing API consumers continue working without changes
- **Progressive enhancement** - Content can be gradually localized over time
- **Flexible fallback chain** - Users always see content in best available language
- **Minimal performance impact** - Simple JSON structure, no complex queries
- **Developer friendly** - Clear separation between legacy and localized fields
- **Reusable patterns** - Helper utilities can be shared across all entities
- **No data migration required** - Existing data remains functional

### Negative
- **Increased storage** - Storing multiple translations increases object size (~1.5-2x)
  - *Mitigation:* R2 storage is cheap, and not all content needs translation
- **API payload size** - Responses may include unused localized fields
  - *Mitigation:* Can implement field filtering (`?fields=title,description`)
- **Form complexity** - Multi-language forms require more UI space
  - *Mitigation:* Progressive disclosure with tabs/accordions
- **Translation management** - Need process for managing translations
  - *Mitigation:* Start with manual, can add translation service later

## Alternatives Considered

### 1. Separate Translation Tables/Buckets
Store translations in separate R2 buckets with references to main entities.

**Rejected because:**
- Requires multiple R2 requests (performance impact)
- Complex consistency management
- Harder to maintain referential integrity
- More complex caching strategy needed

### 2. URL Parameter Based (`?lang=ar`)
Use query parameters to specify language instead of field-level storage.

**Rejected because:**
- Still need to store translations somewhere
- Doesn't solve the storage problem, just moves it
- Less flexible for mixed-language content

### 3. Duplicate Entities per Language
Create separate video/channel/profile objects for each language.

**Rejected because:**
- Massive duplication of non-translatable data (IDs, metrics, URLs)
- Complex synchronization of updates
- Confusing for analytics and relationships
- Would require significant API changes

### 4. External Translation Service
Use a third-party service for on-demand translation.

**Rejected because:**
- Latency concerns for real-time translation
- Cost implications for API calls
- Quality concerns for automated translation
- Still need to store human translations

## Implementation Plan

### Phase 1: Foundation (Week 1)
1. Add localization types to shared-types package
2. Implement LocalizationHelper utilities
3. Add comprehensive unit tests
4. Update TypeScript types for all entities

### Phase 2: API Layer (Week 1-2)
1. Update Profile endpoints with localization
2. Update Channel endpoints with localization
3. Update Video endpoints with localization
4. Add Accept-Language header handling
5. Implement backward compatibility layer

### Phase 3: UI Components (Week 2-3)
1. Create LocalizedTextField component
2. Create LocalizedTextArea component
3. Add language switcher to forms
4. Update existing forms to use localized components
5. Implement useLocalizedContent hook

### Phase 4: Migration & Testing (Week 3-4)
1. Create migration script for existing data (optional)
2. Update API tests for multi-language
3. E2E tests for language switching
4. Performance testing with localized content
5. Documentation updates

### Phase 5: Rollout (Week 4)
1. Deploy to staging environment
2. Test with sample bilingual content
3. Gradual rollout to production
4. Monitor performance metrics
5. Gather user feedback

## Migration Strategy

### For Existing Data
1. **No immediate migration required** - Legacy fields continue to work
2. **Lazy migration** - Convert to localized structure when entity is edited
3. **Optional batch migration** - Can run background job to detect language and migrate

### Detection Logic for Existing Content
```typescript
function detectLanguage(text: string): SupportedLanguage {
  // Simple Arabic detection (has Arabic characters)
  const arabicPattern = /[\u0600-\u06FF]/;
  return arabicPattern.test(text) ? 'ar' : 'en';
}
```

## Monitoring & Success Metrics

### Technical Metrics
- API response time (target: <10ms overhead)
- Storage growth rate (expected: 40-60% increase)
- Cache hit rates for localized content
- Fallback usage frequency

### Business Metrics
- % of content with translations
- User engagement by language
- Content creation in non-English languages
- User retention by language preference

## Security Considerations

1. **Input Validation** - Validate both language codes and content
2. **XSS Prevention** - Sanitize all localized content
3. **Language Code Injection** - Whitelist only supported languages
4. **Content Length** - Enforce limits per language to prevent abuse

## Future Enhancements

1. **Additional Languages** - Easy to add more languages (Urdu, Turkish, etc.)
2. **Auto-translation** - Integration with translation APIs for suggestions
3. **Translation Workflow** - Review and approval system for translations
4. **Language Detection** - Auto-detect user's preferred language
5. **SEO Optimization** - Language-specific meta tags and URLs
6. **RTL Improvements** - Better handling of mixed-direction text

## References

- [JSON-LD Internationalization](https://www.w3.org/TR/json-ld11/#language-maps)
- [Accept-Language Header Specification](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Accept-Language)
- [Unicode Bidirectional Algorithm](https://unicode.org/reports/tr9/)
- [OpenAPI Internationalization Patterns](https://swagger.io/docs/specification/data-models/data-types/#string)