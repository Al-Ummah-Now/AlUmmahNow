# Upload Defaults / Templates Implementation Plan

**Document Version**: 1.0
**Created**: 2025-01-20
**Status**: Proposed
**Priority**: CRITICAL ⭐⭐⭐⭐⭐
**Estimated Effort**: 2 weeks (2 developers)
**Author**: System Architect

---

## Executive Summary

This document outlines the comprehensive implementation plan for the Upload Defaults/Templates feature for Al Ummah Now platform. This feature will allow content creators to save and reuse upload metadata templates, significantly reducing repetitive data entry and improving upload workflow efficiency.

**Key Benefits**:
- 60-80% reduction in upload time for regular creators
- Consistent metadata across video series
- Multiple template profiles for different content types
- Per-user and per-channel customization
- Bilingual support (English/Arabic)

---

## Table of Contents

1. [Requirements Analysis](#requirements-analysis)
2. [Architecture Design](#architecture-design)
3. [Database Schema](#database-schema)
4. [API Specifications](#api-specifications)
5. [Frontend Implementation](#frontend-implementation)
6. [Integration Points](#integration-points)
7. [Technical Implementation Details](#technical-implementation-details)
8. [Files to Create/Modify](#files-to-createmodify)
9. [Testing Strategy](#testing-strategy)
10. [Rollout Plan](#rollout-plan)
11. [Migration & Backward Compatibility](#migration--backward-compatibility)
12. [Performance Considerations](#performance-considerations)
13. [Security Considerations](#security-considerations)
14. [Monitoring & Analytics](#monitoring--analytics)

---

## Requirements Analysis

### Functional Requirements

Based on YouTube feature comparison analysis, the system must support:

1. **Template Management**
   - Create, update, delete upload templates
   - Multiple template profiles per user/channel
   - Template naming and descriptions
   - Default template selection

2. **Template Fields**
   - Pre-filled title patterns (with variables)
   - Description templates (multiline, rich text)
   - Default tags list (comma-separated)
   - Category selection
   - Visibility settings (public/private/unlisted)
   - Language preferences
   - Comment settings
   - Age restrictions (future)
   - Location data (future)

3. **Template Application**
   - Auto-populate upload form with template
   - Allow override of template values
   - Template variables (e.g., {{date}}, {{episode_number}})
   - Quick template switcher in upload UI

4. **Bilingual Support**
   - Templates for English and Arabic content
   - Separate title/description for each language
   - RTL support for Arabic templates

### Non-Functional Requirements

1. **Performance**
   - Template loading < 200ms
   - Template switching < 100ms
   - No impact on upload performance

2. **Scalability**
   - Support up to 20 templates per user
   - Templates up to 10KB each
   - Handle concurrent template updates

3. **Usability**
   - Intuitive template management UI
   - Clear template preview
   - One-click template application
   - Inline editing capabilities

---

## Architecture Design

### System Architecture

```
┌──────────────────────────────────────────────────┐
│                   Frontend (Web)                  │
│  ┌────────────────────────────────────────────┐  │
│  │         Upload Component w/ Templates       │  │
│  └────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────┐  │
│  │        Settings: Template Manager           │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────┐
│              API Layer (api-videos)               │
│  ┌────────────────────────────────────────────┐  │
│  │       Upload Defaults Endpoints             │  │
│  │  • GET    /api/upload-defaults              │  │
│  │  • GET    /api/upload-defaults/:id          │  │
│  │  • POST   /api/upload-defaults              │  │
│  │  • PUT    /api/upload-defaults/:id          │  │
│  │  • DELETE /api/upload-defaults/:id          │  │
│  │  • PUT    /api/upload-defaults/:id/default  │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────┐
│            Storage Layer (R2 Buckets)             │
│  ┌────────────────────────────────────────────┐  │
│  │    upload-defaults bucket (JSON objects)    │  │
│  │    Key: {userId}_{templateId}               │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### Data Flow

1. **Template Creation**:
   - User creates template in settings page
   - API validates and stores in R2 bucket
   - Template becomes available in upload form

2. **Template Usage**:
   - Upload form fetches user's templates on load
   - User selects template from dropdown
   - Form fields auto-populate with template values
   - User can override any field before upload

3. **Template Updates**:
   - Changes to templates don't affect existing videos
   - Templates are snapshots, not live references
   - Updates apply to future uploads only

---

## Database Schema

### R2 Storage Structure

Since Al Ummah Now uses R2 (object storage) instead of a traditional database, we'll store upload defaults as JSON objects in a dedicated R2 bucket.

#### Bucket: `upload-defaults` (and `upload-defaults-preview` for dev)

#### Object Key Pattern:
```
{userId}/{templateId}
```

#### Object Schema (TypeScript):

```typescript
// packages/shared-types/src/upload-defaults.ts

export interface UploadTemplate {
  id: string;                    // UUID
  userId: string;                 // Owner's user ID
  channelId?: string;            // Optional channel-specific template
  name: string;                  // Template name
  nameLocalized?: {
    en: string;
    ar: string;
  };
  description?: string;          // Template description
  isDefault: boolean;            // Is this the default template?
  isActive: boolean;             // Is template active/enabled?

  // Template Fields
  template: {
    // Title template with variables
    title?: string;
    titleLocalized?: {
      en: string;
      ar: string;
    };

    // Description template
    description?: string;
    descriptionLocalized?: {
      en: string;
      ar: string;
    };

    // Tags (array of strings)
    tags?: string[];

    // Category (from predefined list)
    category?: VideoCategory;

    // Visibility
    visibility?: 'public' | 'private' | 'unlisted';

    // Language
    language?: 'en' | 'ar' | 'ur' | 'fr';

    // Comment settings
    commentSettings?: {
      enabled: boolean;
      moderation?: 'all' | 'none' | 'hold_all' | 'hold_inappropriate';
    };

    // Age restriction
    ageRestricted?: boolean;
    madeForKids?: boolean;

    // Location (future)
    location?: {
      latitude?: number;
      longitude?: number;
      city?: string;
      country?: string;
    };

    // Advanced settings
    license?: 'standard' | 'creative_commons';
    recordingDate?: string;
    paidPromotion?: boolean;

    // Scheduled publishing defaults
    scheduleDefaults?: {
      publishTime?: string;  // Default time of day (e.g., "14:00")
      timezone?: string;     // User's timezone
      premiereEnabled?: boolean;
    };
  };

  // Metadata
  createdAt: string;            // ISO 8601
  updatedAt: string;            // ISO 8601
  usageCount: number;           // Times this template has been used
  lastUsedAt?: string;          // ISO 8601
}

// Video categories specific to Islamic content
export enum VideoCategory {
  QURAN_RECITATION = 'quran_recitation',
  QURAN_TAFSIR = 'quran_tafsir',
  HADITH_STUDIES = 'hadith_studies',
  ISLAMIC_HISTORY = 'islamic_history',
  FIQH = 'fiqh',
  AQEEDAH = 'aqeedah',
  DAWAH = 'dawah',
  KHUTBAH = 'khutbah',
  ISLAMIC_LECTURES = 'islamic_lectures',
  ISLAMIC_NASHEED = 'islamic_nasheed',
  ISLAMIC_KIDS = 'islamic_kids',
  ISLAMIC_NEWS = 'islamic_news',
  HAJJ_UMRAH = 'hajj_umrah',
  RAMADAN = 'ramadan',
  ISLAMIC_LIFESTYLE = 'islamic_lifestyle',
}

// Request/Response types
export interface CreateTemplateRequest {
  name: string;
  nameLocalized?: { en: string; ar: string; };
  description?: string;
  isDefault?: boolean;
  template: Partial<UploadTemplate['template']>;
}

export interface UpdateTemplateRequest {
  name?: string;
  nameLocalized?: { en: string; ar: string; };
  description?: string;
  isDefault?: boolean;
  isActive?: boolean;
  template?: Partial<UploadTemplate['template']>;
}

export interface TemplateListResponse {
  templates: UploadTemplate[];
  defaultTemplateId?: string;
  cursor?: string;
}
```

---

## API Specifications

### OpenAPI Endpoints

All endpoints require JWT authentication.

#### 1. List Templates
```yaml
GET /api/upload-defaults
Headers:
  Authorization: Bearer {token}
  channelId?: string (optional, for channel-specific templates)
Query:
  limit?: number (default: 20, max: 50)
  cursor?: string (pagination cursor)
  includeInactive?: boolean (default: false)
Response:
  200: TemplateListResponse
  401: Unauthorized
```

#### 2. Get Template
```yaml
GET /api/upload-defaults/:id
Headers:
  Authorization: Bearer {token}
Response:
  200: UploadTemplate
  401: Unauthorized
  404: Template not found
```

#### 3. Create Template
```yaml
POST /api/upload-defaults
Headers:
  Authorization: Bearer {token}
  channelId?: string (optional)
Body: CreateTemplateRequest
Response:
  201: UploadTemplate
  400: Validation error
  401: Unauthorized
```

#### 4. Update Template
```yaml
PUT /api/upload-defaults/:id
Headers:
  Authorization: Bearer {token}
Body: UpdateTemplateRequest
Response:
  200: UploadTemplate
  400: Validation error
  401: Unauthorized
  404: Template not found
```

#### 5. Delete Template
```yaml
DELETE /api/upload-defaults/:id
Headers:
  Authorization: Bearer {token}
Response:
  204: No content
  401: Unauthorized
  404: Template not found
```

#### 6. Set Default Template
```yaml
PUT /api/upload-defaults/:id/default
Headers:
  Authorization: Bearer {token}
Response:
  200: { success: true }
  401: Unauthorized
  404: Template not found
```

### API Implementation Example

```typescript
// apps/api-videos/src/endpoints/settings/uploadDefaults.ts

import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { getAuthContext } from "../../middleware/auth";
import R2Repository from "../../lib/r2Repo";
import { UploadTemplate } from "@al-ummah/shared-types";

export class ListUploadDefaultsEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ["Settings"],
    summary: "List Upload Templates",
    description: "Get all upload templates for the authenticated user",
    request: {
      query: z.object({
        limit: z.number().min(1).max(50).optional().default(20),
        cursor: z.string().optional(),
        includeInactive: z.boolean().optional().default(false),
      }),
      headers: z.object({
        channelId: Str({ description: "Channel ID" }).optional(),
      }),
    },
    responses: {
      200: {
        description: "List of upload templates",
        content: {
          "application/json": {
            schema: z.object({
              templates: z.array(UploadTemplate),
              defaultTemplateId: z.string().optional(),
              cursor: z.string().optional(),
            }),
          },
        },
      },
    },
  }, 'required');

  async handle(c) {
    const authContext = getAuthContext(c);
    const userId = authContext?.userId;

    if (!userId) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const { limit, cursor, includeInactive } = c.req.query();
    const channelId = c.req.header('channelId');

    const bucket = c.env['upload-defaults'];
    const repo = new R2Repository<UploadTemplate>(bucket);

    // List templates for user (and optionally channel)
    const prefix = channelId ? `${userId}/${channelId}/` : `${userId}/`;
    const result = await repo.listObjects(limit, cursor, prefix);

    // Filter inactive if needed
    let templates = result.objects;
    if (!includeInactive) {
      templates = templates.filter(t => t.isActive !== false);
    }

    // Find default template
    const defaultTemplate = templates.find(t => t.isDefault);

    return c.json({
      templates,
      defaultTemplateId: defaultTemplate?.id,
      cursor: result.cursor,
    });
  }
}
```

---

## Frontend Implementation

### 1. Settings Page Component

**Location**: `apps/web/src/app/[locale]/settings/upload-defaults/page.tsx`

```typescript
// Settings page for managing upload templates
export default function UploadDefaultsPage() {
  const { t, locale } = useLanguage();
  const [templates, setTemplates] = useState<UploadTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<UploadTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">
        {t('settings.uploadDefaults.title')}
      </h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template List */}
        <div className="lg:col-span-1">
          <TemplateList
            templates={templates}
            onSelect={setSelectedTemplate}
            onCreate={() => setIsCreating(true)}
          />
        </div>

        {/* Template Editor */}
        <div className="lg:col-span-2">
          {isCreating ? (
            <TemplateCreator
              onSave={handleCreateTemplate}
              onCancel={() => setIsCreating(false)}
            />
          ) : selectedTemplate ? (
            <TemplateEditor
              template={selectedTemplate}
              onSave={handleUpdateTemplate}
              onDelete={handleDeleteTemplate}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </div>
    </div>
  );
}
```

### 2. Template Editor Component

**Location**: `apps/web/src/components/settings/TemplateEditor.tsx`

```typescript
interface TemplateEditorProps {
  template: UploadTemplate;
  onSave: (template: UploadTemplate) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function TemplateEditor({ template, onSave, onDelete }: TemplateEditorProps) {
  const [formData, setFormData] = useState(template);
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
      <h2 className="text-xl font-semibold mb-4">
        {formData.name}
      </h2>

      {/* Template Name */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Template Name
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-3 py-2 border rounded-md"
        />
      </div>

      {/* Language Tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setActiveTab('en')}
          className={activeTab === 'en' ? 'btn-primary' : 'btn-secondary'}
        >
          English
        </button>
        <button
          onClick={() => setActiveTab('ar')}
          className={activeTab === 'ar' ? 'btn-primary' : 'btn-secondary'}
        >
          العربية
        </button>
      </div>

      {/* Title Template */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Title Template
        </label>
        <input
          type="text"
          value={activeTab === 'en'
            ? formData.template.titleLocalized?.en
            : formData.template.titleLocalized?.ar}
          onChange={(e) => updateLocalizedField('title', e.target.value)}
          placeholder={activeTab === 'en'
            ? "e.g., Surah {{surah}} - Episode {{episode}}"
            : "سورة {{surah}} - الحلقة {{episode}}"}
          className="w-full px-3 py-2 border rounded-md"
          dir={activeTab === 'ar' ? 'rtl' : 'ltr'}
        />
        <p className="text-xs text-gray-500 mt-1">
          Variables: {{date}}, {{episode}}, {{surah}}, {{topic}}
        </p>
      </div>

      {/* Description Template */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Description Template
        </label>
        <textarea
          rows={6}
          value={activeTab === 'en'
            ? formData.template.descriptionLocalized?.en
            : formData.template.descriptionLocalized?.ar}
          onChange={(e) => updateLocalizedField('description', e.target.value)}
          className="w-full px-3 py-2 border rounded-md"
          dir={activeTab === 'ar' ? 'rtl' : 'ltr'}
        />
      </div>

      {/* Tags */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Default Tags
        </label>
        <TagInput
          tags={formData.template.tags || []}
          onChange={(tags) => updateTemplateField('tags', tags)}
        />
      </div>

      {/* Category */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Default Category
        </label>
        <CategorySelector
          value={formData.template.category}
          onChange={(category) => updateTemplateField('category', category)}
        />
      </div>

      {/* Visibility */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Default Visibility
        </label>
        <select
          value={formData.template.visibility || 'public'}
          onChange={(e) => updateTemplateField('visibility', e.target.value)}
          className="w-full px-3 py-2 border rounded-md"
        >
          <option value="public">Public</option>
          <option value="private">Private</option>
          <option value="unlisted">Unlisted</option>
        </select>
      </div>

      {/* Comment Settings */}
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Comment Settings
        </label>
        <select
          value={formData.template.commentSettings?.moderation || 'all'}
          onChange={(e) => updateCommentSettings('moderation', e.target.value)}
          className="w-full px-3 py-2 border rounded-md"
        >
          <option value="all">Allow all comments</option>
          <option value="hold_all">Hold all for review</option>
          <option value="hold_inappropriate">Hold potentially inappropriate</option>
          <option value="none">Disable comments</option>
        </select>
      </div>

      {/* Set as Default */}
      <div className="mb-6">
        <label className="flex items-center">
          <input
            type="checkbox"
            checked={formData.isDefault}
            onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
            className="mr-2"
          />
          <span className="text-sm">Set as default template</span>
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between">
        <button
          onClick={() => onDelete(template.id)}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
        >
          Delete Template
        </button>
        <button
          onClick={() => onSave(formData)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}
```

### 3. Upload Form Integration

**Modify**: `apps/web/src/components/videoUpload/index.tsx`

Add template selection and application:

```typescript
// Add to VideoUpload component
const [templates, setTemplates] = useState<UploadTemplate[]>([]);
const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

// Fetch templates on mount
useEffect(() => {
  fetchUploadTemplates().then(setTemplates);
}, []);

// Apply template when selected
const applyTemplate = (templateId: string) => {
  const template = templates.find(t => t.id === templateId);
  if (!template) return;

  // Apply template values with variable replacement
  const processedTitle = processTemplateVariables(template.template.title);

  setMetadata({
    title: processedTitle,
    titleEn: processTemplateVariables(template.template.titleLocalized?.en),
    titleAr: processTemplateVariables(template.template.titleLocalized?.ar),
    description: processTemplateVariables(template.template.description),
    descriptionEn: processTemplateVariables(template.template.descriptionLocalized?.en),
    descriptionAr: processTemplateVariables(template.template.descriptionLocalized?.ar),
    tags: template.template.tags || [],
    isPublic: template.template.visibility === 'public',
    category: template.template.category,
    // ... other fields
  });
};

// Template variable processor
const processTemplateVariables = (text?: string): string => {
  if (!text) return '';

  const variables = {
    date: new Date().toLocaleDateString(),
    time: new Date().toLocaleTimeString(),
    day: new Date().toLocaleDateString('en', { weekday: 'long' }),
    month: new Date().toLocaleDateString('en', { month: 'long' }),
    year: new Date().getFullYear(),
    // Add more variables as needed
  };

  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] || match;
  });
};

// Add template selector UI
<div className="mb-4">
  <label className="block text-sm font-medium mb-1">
    Use Template
  </label>
  <select
    value={selectedTemplateId}
    onChange={(e) => {
      setSelectedTemplateId(e.target.value);
      if (e.target.value) applyTemplate(e.target.value);
    }}
    className="w-full px-3 py-2 border rounded-md"
  >
    <option value="">None - Start fresh</option>
    {templates.map(template => (
      <option key={template.id} value={template.id}>
        {template.name} {template.isDefault ? '(Default)' : ''}
      </option>
    ))}
  </select>
  <a
    href="/settings/upload-defaults"
    className="text-sm text-blue-600 hover:underline"
  >
    Manage templates
  </a>
</div>
```

---

## Integration Points

### 1. Authentication Middleware
- All template endpoints require JWT authentication
- Templates are user-scoped (userId from JWT)
- Optional channel-scoped templates

### 2. R2 Repository
- Reuse existing `R2Repository` class
- New bucket: `upload-defaults`
- Key pattern: `{userId}/{templateId}`

### 3. Queue Analytics
- Track template usage in analytics
- Send events: template_created, template_used, template_deleted

### 4. Shared Types
- Add new types to `@al-ummah/shared-types`
- Import in both frontend and backend

---

## Technical Implementation Details

### Variable System

Support dynamic variables in templates:

```typescript
const TEMPLATE_VARIABLES = {
  // Date/Time
  'date': () => new Date().toLocaleDateString(),
  'date_iso': () => new Date().toISOString().split('T')[0],
  'time': () => new Date().toLocaleTimeString(),
  'day': () => new Date().toLocaleDateString('en', { weekday: 'long' }),
  'day_ar': () => new Date().toLocaleDateString('ar', { weekday: 'long' }),
  'month': () => new Date().toLocaleDateString('en', { month: 'long' }),
  'month_ar': () => new Date().toLocaleDateString('ar', { month: 'long' }),
  'year': () => new Date().getFullYear(),
  'hijri_date': () => getHijriDate(), // Custom function

  // User input (prompted when applying template)
  'episode': (value?: string) => value || promptUser('Episode number'),
  'surah': (value?: string) => value || promptUser('Surah name'),
  'topic': (value?: string) => value || promptUser('Topic'),
  'speaker': (value?: string) => value || promptUser('Speaker name'),

  // Counters (auto-increment)
  'counter': () => getNextCounter('default'),
  'series_counter': (seriesName: string) => getNextCounter(seriesName),
};
```

### Category Definitions

```typescript
export const VIDEO_CATEGORIES = [
  { value: 'quran_recitation', label: { en: 'Quran Recitation', ar: 'تلاوة القرآن' }},
  { value: 'quran_tafsir', label: { en: 'Quran Tafsir', ar: 'تفسير القرآن' }},
  { value: 'hadith_studies', label: { en: 'Hadith Studies', ar: 'دراسات الحديث' }},
  { value: 'islamic_history', label: { en: 'Islamic History', ar: 'التاريخ الإسلامي' }},
  { value: 'fiqh', label: { en: 'Fiqh', ar: 'الفقه' }},
  { value: 'aqeedah', label: { en: 'Aqeedah', ar: 'العقيدة' }},
  { value: 'dawah', label: { en: 'Dawah', ar: 'الدعوة' }},
  { value: 'khutbah', label: { en: 'Friday Sermon', ar: 'خطبة الجمعة' }},
  { value: 'islamic_lectures', label: { en: 'Islamic Lectures', ar: 'محاضرات إسلامية' }},
  { value: 'islamic_nasheed', label: { en: 'Islamic Nasheed', ar: 'الأناشيد الإسلامية' }},
  { value: 'islamic_kids', label: { en: 'Islamic Kids Content', ar: 'محتوى إسلامي للأطفال' }},
  { value: 'islamic_news', label: { en: 'Islamic News', ar: 'أخبار إسلامية' }},
  { value: 'hajj_umrah', label: { en: 'Hajj & Umrah', ar: 'الحج والعمرة' }},
  { value: 'ramadan', label: { en: 'Ramadan', ar: 'رمضان' }},
  { value: 'islamic_lifestyle', label: { en: 'Islamic Lifestyle', ar: 'نمط الحياة الإسلامي' }},
];
```

### Template Examples

Pre-defined template examples for common use cases:

```typescript
const TEMPLATE_EXAMPLES = [
  {
    name: "Quran Recitation Series",
    template: {
      titleLocalized: {
        en: "Surah {{surah}} - Beautiful Recitation",
        ar: "سورة {{surah}} - تلاوة خاشعة"
      },
      descriptionLocalized: {
        en: "Beautiful recitation of Surah {{surah}}\n\nRecited by: {{speaker}}\nRecorded: {{date}}\n\n#Quran #IslamicContent",
        ar: "تلاوة خاشعة لسورة {{surah}}\n\nالقارئ: {{speaker}}\nالتسجيل: {{date}}\n\n#القرآن #محتوى_إسلامي"
      },
      tags: ["quran", "recitation", "islamic"],
      category: "quran_recitation",
      visibility: "public"
    }
  },
  {
    name: "Friday Khutbah",
    template: {
      titleLocalized: {
        en: "Friday Khutbah - {{topic}} - {{date}}",
        ar: "خطبة الجمعة - {{topic}} - {{date}}"
      },
      descriptionLocalized: {
        en: "Friday Khutbah delivered on {{date}}\n\nTopic: {{topic}}\nSpeaker: {{speaker}}\n\nKey Points:\n• \n• \n• ",
        ar: "خطبة الجمعة بتاريخ {{date}}\n\nالموضوع: {{topic}}\nالخطيب: {{speaker}}\n\nالنقاط الرئيسية:\n• \n• \n• "
      },
      tags: ["khutbah", "friday", "sermon", "islamic"],
      category: "khutbah",
      visibility: "public"
    }
  },
  {
    name: "Islamic Lecture Series",
    template: {
      titleLocalized: {
        en: "{{topic}} - Episode {{episode}} - {{speaker}}",
        ar: "{{topic}} - الحلقة {{episode}} - {{speaker}}"
      },
      descriptionLocalized: {
        en: "Episode {{episode}} of our series on {{topic}}\n\nIn this episode:\n\n",
        ar: "الحلقة {{episode}} من سلسلتنا حول {{topic}}\n\nفي هذه الحلقة:\n\n"
      },
      tags: ["lecture", "series", "islamic", "education"],
      category: "islamic_lectures",
      visibility: "public"
    }
  }
];
```

---

## Files to Create/Modify

### New Files to Create

#### Backend (api-videos)
1. `apps/api-videos/src/endpoints/settings/uploadDefaults.ts` - Main endpoints
2. `apps/api-videos/src/endpoints/settings/uploadDefaultsById.ts` - Single template operations
3. `apps/api-videos/src/lib/templates/variables.ts` - Variable processing
4. `apps/api-videos/src/lib/templates/validator.ts` - Template validation

#### Frontend (web)
5. `apps/web/src/app/[locale]/settings/upload-defaults/page.tsx` - Settings page
6. `apps/web/src/components/settings/TemplateEditor.tsx` - Template editor
7. `apps/web/src/components/settings/TemplateList.tsx` - Template list
8. `apps/web/src/components/settings/TemplateCreator.tsx` - Template creator
9. `apps/web/src/components/upload/TemplateSelector.tsx` - Template selector
10. `apps/web/src/lib/api/upload-defaults.ts` - API client
11. `apps/web/src/lib/templates/processor.ts` - Variable processor

#### Shared Types
12. `packages/shared-types/src/upload-defaults.ts` - Type definitions

### Files to Modify

#### Backend
1. `apps/api-videos/src/index.ts` - Register new endpoints
2. `apps/api-videos/wrangler.jsonc` - Add new R2 bucket bindings

#### Frontend
3. `apps/web/src/components/videoUpload/index.tsx` - Add template integration
4. `apps/web/src/lib/constants/categories.ts` - Add category definitions
5. `apps/web/src/lib/i18n/en/settings.json` - English translations
6. `apps/web/src/lib/i18n/ar/settings.json` - Arabic translations

#### Shared
7. `packages/shared-types/src/index.ts` - Export new types
8. `packages/shared-types/src/video.ts` - Add category enum

---

## Testing Strategy

### Unit Tests

```typescript
// apps/api-videos/src/endpoints/settings/__tests__/uploadDefaults.test.ts

describe('Upload Defaults API', () => {
  test('should create template with valid data', async () => {
    const response = await request('/api/upload-defaults')
      .post()
      .set('Authorization', 'Bearer valid-token')
      .send({
        name: 'Test Template',
        template: {
          title: 'Test Title',
          tags: ['test'],
          visibility: 'public'
        }
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    expect(response.body.name).toBe('Test Template');
  });

  test('should apply template variables correctly', async () => {
    const template = {
      title: 'Episode {{episode}} - {{date}}'
    };

    const processed = processTemplateVariables(template.title, {
      episode: '5'
    });

    expect(processed).toContain('Episode 5');
    expect(processed).toContain(new Date().toLocaleDateString());
  });

  test('should enforce user ownership', async () => {
    // User A creates template
    const templateA = await createTemplate(userA, templateData);

    // User B cannot access it
    const response = await request(`/api/upload-defaults/${templateA.id}`)
      .get()
      .set('Authorization', `Bearer ${userB.token}`);

    expect(response.status).toBe(404);
  });
});
```

### Integration Tests

```typescript
describe('Template Upload Flow', () => {
  test('should apply default template to new upload', async () => {
    // Create default template
    const template = await createDefaultTemplate();

    // Load upload page
    const { getByTestId } = render(<VideoUpload />);

    // Default template should be pre-selected
    const templateSelector = getByTestId('template-selector');
    expect(templateSelector.value).toBe(template.id);

    // Form fields should be populated
    expect(getByTestId('title-input').value).toContain(template.template.title);
    expect(getByTestId('tags-input').value).toContain(template.template.tags[0]);
  });
});
```

### E2E Tests

```typescript
describe('Upload Defaults E2E', () => {
  test('complete template workflow', async () => {
    // Navigate to settings
    await page.goto('/settings/upload-defaults');

    // Create new template
    await page.click('[data-testid="create-template"]');
    await page.fill('[name="name"]', 'My Template');
    await page.fill('[name="title"]', 'Episode {{episode}}');
    await page.click('[data-testid="save-template"]');

    // Navigate to upload
    await page.goto('/upload');

    // Select template
    await page.selectOption('[data-testid="template-selector"]', 'My Template');

    // Verify application
    const title = await page.inputValue('[name="title"]');
    expect(title).toContain('Episode');
  });
});
```

---

## Rollout Plan

### Phase 1: Backend Implementation (Week 1)
**Days 1-3:**
- [ ] Create R2 bucket configuration
- [ ] Implement CRUD endpoints
- [ ] Add validation and error handling
- [ ] Deploy to staging environment

**Days 4-5:**
- [ ] Integration testing
- [ ] Performance testing
- [ ] Security review

### Phase 2: Frontend Implementation (Week 2)
**Days 6-8:**
- [ ] Build settings page components
- [ ] Implement template editor
- [ ] Add template selector to upload form

**Days 9-10:**
- [ ] Bilingual support (RTL for Arabic)
- [ ] Variable processing system
- [ ] UI polish and responsive design

### Phase 3: Testing & Release (Days 11-14)
**Days 11-12:**
- [ ] End-to-end testing
- [ ] User acceptance testing
- [ ] Bug fixes

**Days 13-14:**
- [ ] Documentation
- [ ] Production deployment
- [ ] Monitor initial usage

### Success Metrics
- 50% of regular uploaders use templates within 2 weeks
- Average upload time reduced by 40%
- User satisfaction score > 4.5/5
- Less than 1% error rate

---

## Migration & Backward Compatibility

### Migration Strategy

1. **No Breaking Changes**
   - Upload flow works without templates (optional feature)
   - Existing videos unaffected
   - Gradual adoption possible

2. **Data Migration**
   - No existing data to migrate
   - Feature starts fresh

3. **Feature Flags**
   ```typescript
   const FEATURE_FLAGS = {
     UPLOAD_TEMPLATES_ENABLED: process.env.ENABLE_UPLOAD_TEMPLATES === 'true'
   };
   ```

### Rollback Plan

If issues arise:
1. Disable feature flag
2. Hide UI components
3. Templates remain stored but unused
4. Can re-enable after fixes

---

## Performance Considerations

### Caching Strategy

```typescript
// Cache templates in browser
const TEMPLATE_CACHE_KEY = 'upload-templates';
const TEMPLATE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class TemplateCache {
  static get(): UploadTemplate[] | null {
    const cached = localStorage.getItem(TEMPLATE_CACHE_KEY);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > TEMPLATE_CACHE_TTL) {
      localStorage.removeItem(TEMPLATE_CACHE_KEY);
      return null;
    }

    return data;
  }

  static set(templates: UploadTemplate[]) {
    localStorage.setItem(TEMPLATE_CACHE_KEY, JSON.stringify({
      data: templates,
      timestamp: Date.now()
    }));
  }
}
```

### R2 Optimization

- Use prefix queries for user templates
- Limit templates per user (20 max)
- Paginate template lists
- Use cursor-based pagination

### Bundle Size

- Lazy load template editor components
- Code-split settings pages
- Tree-shake unused variable processors

---

## Security Considerations

### Access Control

```typescript
// Verify user owns template
const verifyTemplateOwnership = async (
  userId: string,
  templateId: string,
  bucket: R2Bucket
): Promise<boolean> => {
  const key = `${userId}/${templateId}`;
  const template = await bucket.get(key);

  if (!template) return false;

  const data = await template.json<UploadTemplate>();
  return data.userId === userId;
};
```

### Input Validation

```typescript
const TemplateSchema = z.object({
  name: z.string().min(1).max(100),
  template: z.object({
    title: z.string().max(500).optional(),
    description: z.string().max(5000).optional(),
    tags: z.array(z.string().max(50)).max(30).optional(),
    // ... other fields
  })
});
```

### XSS Prevention

- Sanitize template variables
- Escape HTML in descriptions
- Use React's built-in XSS protection
- Validate all user input

### Rate Limiting

```typescript
const RATE_LIMITS = {
  CREATE_TEMPLATE: '10/hour',
  UPDATE_TEMPLATE: '30/hour',
  DELETE_TEMPLATE: '10/hour',
};
```

---

## Monitoring & Analytics

### Metrics to Track

```typescript
// Queue events for analytics
await queue.send('template_created', {
  userId,
  templateId,
  templateName,
  hasDefaultTitle: !!template.title,
  hasDefaultDescription: !!template.description,
  tagsCount: template.tags?.length || 0,
  timestamp: new Date().toISOString(),
});

await queue.send('template_used', {
  userId,
  templateId,
  videoId,
  variablesUsed: Object.keys(extractedVariables),
  timestamp: new Date().toISOString(),
});
```

### Dashboard Metrics

1. **Adoption Metrics**
   - Templates created per day
   - Active templates per user
   - Template usage rate
   - Most popular templates

2. **Performance Metrics**
   - Template load time
   - Variable processing time
   - API response times

3. **Error Metrics**
   - Template creation failures
   - Variable processing errors
   - API error rates

### Alerts

- Template storage approaching limit
- High error rate (> 5%)
- Slow API responses (> 1s)

---

## Future Enhancements

### Phase 2 Features (Q2 2025)
1. **Template Sharing**
   - Share templates between channels
   - Public template library
   - Template marketplace

2. **Advanced Variables**
   - Custom variables
   - External data sources
   - Conditional logic

3. **AI-Powered Suggestions**
   - Auto-generate descriptions
   - Tag recommendations
   - Title optimization

### Phase 3 Features (Q3 2025)
1. **Workflow Automation**
   - Auto-apply based on file name
   - Batch upload with templates
   - Schedule templates for time-based content

2. **Template Analytics**
   - Performance tracking per template
   - A/B testing templates
   - Optimization suggestions

---

## Conclusion

The Upload Defaults/Templates feature will significantly improve the content creation workflow for Al Ummah Now creators. By reducing repetitive data entry and ensuring consistency across video series, this feature addresses one of the most critical pain points identified in the YouTube feature comparison.

**Key Success Factors:**
1. Simple, intuitive UI
2. Robust variable system
3. Bilingual support
4. Fast performance
5. Reliable storage

**Next Steps:**
1. Review and approve this implementation plan
2. Allocate development resources (2 developers, 2 weeks)
3. Set up R2 buckets in Cloudflare
4. Begin Phase 1 implementation

**Expected Impact:**
- 60-80% reduction in upload time for series creators
- Improved metadata consistency
- Higher creator satisfaction
- Increased platform retention

---

## Appendices

### Appendix A: API Response Examples

```json
// GET /api/upload-defaults
{
  "templates": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "user123",
      "name": "Quran Recitation Series",
      "nameLocalized": {
        "en": "Quran Recitation Series",
        "ar": "سلسلة تلاوة القرآن"
      },
      "isDefault": true,
      "template": {
        "titleLocalized": {
          "en": "Surah Al-Baqarah - Episode {{episode}}",
          "ar": "سورة البقرة - الحلقة {{episode}}"
        },
        "tags": ["quran", "recitation", "islamic"],
        "category": "quran_recitation",
        "visibility": "public"
      },
      "createdAt": "2025-01-20T10:00:00Z",
      "updatedAt": "2025-01-20T10:00:00Z",
      "usageCount": 45,
      "lastUsedAt": "2025-01-19T15:30:00Z"
    }
  ],
  "defaultTemplateId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Appendix B: Variable Processing Examples

```typescript
// Input
"Surah {{surah}} - Episode {{episode}} - {{date}}"

// With variables
{
  surah: "Al-Baqarah",
  episode: "5"
}

// Output
"Surah Al-Baqarah - Episode 5 - 2025-01-20"
```

### Appendix C: Migration SQL (If moving from SQL in future)

```sql
-- Future migration if moving from R2 to SQL
CREATE TABLE upload_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  channel_id VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  name_en VARCHAR(255),
  name_ar VARCHAR(255),
  description TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  template JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,

  INDEX idx_user_templates (user_id, is_active),
  INDEX idx_channel_templates (channel_id, is_active),
  UNIQUE INDEX idx_default_template (user_id, is_default) WHERE is_default = TRUE
);
```

---

**Document Metadata:**
- Version: 1.0
- Created: 2025-01-20
- Author: System Architect
- Review Status: Pending
- Implementation Status: Not Started