# Description Templates Implementation Plan

**Document Version**: 1.0
**Created**: 2025-01-20
**Status**: Proposed
**Priority**: MEDIUM 🟡⭐⭐⭐
**Estimated Effort**: 1.5 weeks (2 developers)
**Author**: System Architect
**Related Feature**: #2 (Upload Defaults/Templates)

---

## Executive Summary

This document outlines the implementation plan for the Description Templates feature, which allows content creators to save reusable description blocks with dynamic variables for quick insertion during video uploads. This feature complements the Upload Defaults system (#2) but focuses specifically on modular, reusable description snippets rather than full upload templates.

**Key Benefits**:
- 50-70% reduction in description writing time
- Consistent formatting across video descriptions
- Reusable description blocks (intro, outro, links, disclaimers)
- Dynamic variable system ({{date}}, {{channel}}, {{video_title}}, etc.)
- Quick insert functionality with keyboard shortcuts
- Bilingual support (English/Arabic)

**Difference from Upload Defaults (#2)**:
- Upload Defaults provide complete templates for entire upload metadata
- Description Templates provide reusable **snippets** for description field only
- Can combine multiple description templates in one upload
- Drag-and-drop composition interface
- Focus on modular, mix-and-match building blocks

---

## Table of Contents

1. [Requirements Analysis](#requirements-analysis)
2. [Architecture Design](#architecture-design)
3. [Database Schema](#database-schema)
4. [API Specifications](#api-specifications)
5. [Frontend Implementation](#frontend-implementation)
6. [Variable System](#variable-system)
7. [Quick Insert Functionality](#quick-insert-functionality)
8. [Technical Implementation Details](#technical-implementation-details)
9. [Files to Create/Modify](#files-to-createmodify)
10. [Testing Strategy](#testing-strategy)
11. [Rollout Plan](#rollout-plan)
12. [Performance Considerations](#performance-considerations)
13. [Security Considerations](#security-considerations)
14. [Monitoring & Analytics](#monitoring--analytics)
15. [Future Enhancements](#future-enhancements)

---

## Requirements Analysis

### Functional Requirements

Based on YouTube feature comparison analysis, the system must support:

1. **Template Block Management**
   - Create, update, delete description blocks
   - Multiple template blocks per user
   - Block naming and categorization
   - Block ordering and organization
   - Block visibility (private/shared)

2. **Template Block Types**
   - **Introduction Block**: Channel intro, video series intro
   - **Content Block**: Main description, episode notes
   - **Links Block**: Social media, website, resources
   - **Disclaimer Block**: Copyright, legal, content warnings
   - **Call-to-Action Block**: Subscribe, donate, share
   - **Credits Block**: Contributors, references, sources
   - **Chapters Block**: Timestamp-based navigation
   - **Custom Block**: User-defined content

3. **Variable System**
   - Date/time variables ({{date}}, {{time}}, {{hijri_date}})
   - Video metadata ({{title}}, {{category}}, {{tags}})
   - Channel data ({{channel_name}}, {{channel_url}})
   - Episode/series data ({{episode}}, {{season}}, {{series_name}})
   - User input variables (prompted when inserting)
   - Conditional variables (show/hide based on context)

4. **Quick Insert Functionality**
   - Keyboard shortcuts (Ctrl+K or Cmd+K)
   - Search/filter templates by name
   - Preview before insert
   - Insert at cursor position
   - Multi-select and bulk insert
   - Drag-and-drop composition

5. **Bilingual Support**
   - Separate templates for English and Arabic
   - RTL support for Arabic blocks
   - Language-specific variables
   - Mixed-language composition

### Non-Functional Requirements

1. **Performance**
   - Block loading < 100ms
   - Variable processing < 50ms
   - Search results < 200ms
   - No impact on upload performance

2. **Scalability**
   - Support up to 50 blocks per user
   - Blocks up to 5KB each
   - Handle concurrent block updates
   - Efficient search and filtering

3. **Usability**
   - Intuitive block composer UI
   - Real-time preview
   - One-click insertion
   - Undo/redo support
   - Mobile-friendly interface

---

## Architecture Design

### System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Frontend (Web)                       │
│  ┌──────────────────────────────────────────────────┐ │
│  │      Upload Component w/ Description Editor       │ │
│  │  • Rich text editor with template picker         │ │
│  │  • Quick insert modal (Ctrl+K)                   │ │
│  │  • Drag-and-drop composition                     │ │
│  │  • Real-time variable preview                    │ │
│  └──────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────┐ │
│  │      Settings: Description Template Manager       │ │
│  │  • Block library                                 │ │
│  │  • Block editor with variable builder           │ │
│  │  • Block categorization                          │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│              API Layer (api-videos)                    │
│  ┌──────────────────────────────────────────────────┐ │
│  │       Description Templates Endpoints             │ │
│  │  • GET    /api/description-templates             │ │
│  │  • GET    /api/description-templates/:id         │ │
│  │  • POST   /api/description-templates             │ │
│  │  │  • PUT    /api/description-templates/:id         │ │
│  │  • DELETE /api/description-templates/:id         │ │
│  │  • POST   /api/description-templates/render      │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│            Storage Layer (R2 Buckets)                  │
│  ┌──────────────────────────────────────────────────┐ │
│  │  description-templates bucket (JSON objects)      │ │
│  │  Key: {userId}/blocks/{blockId}                   │ │
│  └──────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Block Creation**:
   - User creates template block in settings
   - Define block content with variables
   - Categorize block (intro, links, etc.)
   - API validates and stores in R2 bucket

2. **Quick Insert Workflow**:
   - User typing description in upload form
   - Press Ctrl+K to open template picker
   - Search/filter available blocks
   - Preview block with variables resolved
   - Insert at cursor position
   - Variables auto-populate from context

3. **Composition Workflow**:
   - Drag multiple blocks into composer
   - Arrange in desired order
   - Preview final description
   - Edit variables inline
   - Apply to upload form

---

## Database Schema

### R2 Storage Structure

Since Al Ummah Now uses R2 (object storage), we'll store description templates as JSON objects.

#### Bucket: `description-templates` (and `description-templates-preview` for dev)

#### Object Key Pattern:
```
{userId}/blocks/{blockId}
```

#### Object Schema (TypeScript):

```typescript
// packages/shared-types/src/description-templates.ts

export interface DescriptionBlock {
  id: string;                    // UUID
  userId: string;                 // Owner's user ID
  name: string;                  // Block name (e.g., "Channel Intro")
  nameLocalized?: {
    en: string;
    ar: string;
  };
  description?: string;          // Block description/notes

  // Block metadata
  type: DescriptionBlockType;    // Categorization
  category?: string;             // Custom category
  tags?: string[];               // Searchable tags
  language: 'en' | 'ar' | 'both'; // Language support

  // Block content
  content: string;               // Template content with variables
  contentLocalized?: {
    en: string;
    ar: string;
  };

  // Variables used in this block
  variables: DescriptionVariable[];

  // Usage and organization
  sortOrder: number;             // Display order
  isActive: boolean;             // Enabled/disabled
  isFavorite: boolean;           // Quick access
  usageCount: number;            // Times used

  // Metadata
  createdAt: string;            // ISO 8601
  updatedAt: string;            // ISO 8601
  lastUsedAt?: string;          // ISO 8601
}

export enum DescriptionBlockType {
  INTRODUCTION = 'introduction',      // Channel/series intro
  CONTENT = 'content',               // Main description
  LINKS = 'links',                   // Social media, resources
  DISCLAIMER = 'disclaimer',         // Legal, copyright
  CALL_TO_ACTION = 'call_to_action', // Subscribe, donate
  CREDITS = 'credits',               // Contributors, sources
  CHAPTERS = 'chapters',             // Timestamp list
  CUSTOM = 'custom',                 // User-defined
}

export interface DescriptionVariable {
  name: string;                  // Variable name (e.g., 'date', 'channel_name')
  type: VariableType;            // Type of variable
  label: string;                 // Display name
  defaultValue?: string;         // Default if not provided
  required: boolean;             // Must be provided
  prompt?: string;               // User prompt text
  validation?: VariableValidation;
}

export enum VariableType {
  // Auto-populated (no user input)
  DATE = 'date',                 // Current date
  TIME = 'time',                 // Current time
  HIJRI_DATE = 'hijri_date',     // Islamic calendar date
  CHANNEL_NAME = 'channel_name',
  CHANNEL_URL = 'channel_url',
  VIDEO_TITLE = 'video_title',
  VIDEO_CATEGORY = 'video_category',

  // User input (prompted)
  TEXT = 'text',                 // Free text
  NUMBER = 'number',             // Numeric
  URL = 'url',                   // URL format
  EMAIL = 'email',               // Email format
  CHOICE = 'choice',             // Select from options

  // Conditional
  CONDITIONAL = 'conditional',    // Show/hide based on condition
}

export interface VariableValidation {
  pattern?: string;              // Regex pattern
  minLength?: number;
  maxLength?: number;
  min?: number;                  // For numbers
  max?: number;
  choices?: string[];            // For CHOICE type
}

// Request/Response types
export interface CreateBlockRequest {
  name: string;
  nameLocalized?: { en: string; ar: string; };
  description?: string;
  type: DescriptionBlockType;
  category?: string;
  tags?: string[];
  language: 'en' | 'ar' | 'both';
  content: string;
  contentLocalized?: { en: string; ar: string; };
  variables?: DescriptionVariable[];
  isFavorite?: boolean;
}

export interface UpdateBlockRequest {
  name?: string;
  nameLocalized?: { en: string; ar: string; };
  description?: string;
  type?: DescriptionBlockType;
  category?: string;
  tags?: string[];
  language?: 'en' | 'ar' | 'both';
  content?: string;
  contentLocalized?: { en: string; ar: string; };
  variables?: DescriptionVariable[];
  isActive?: boolean;
  isFavorite?: boolean;
  sortOrder?: number;
}

export interface BlockListResponse {
  blocks: DescriptionBlock[];
  cursor?: string;
  totalCount: number;
}

export interface RenderBlockRequest {
  blockId: string;
  variableValues?: Record<string, string>; // Variable overrides
  context?: {                              // Auto-fill context
    videoTitle?: string;
    channelName?: string;
    channelUrl?: string;
    category?: string;
  };
}

export interface RenderBlockResponse {
  rendered: string;              // Final text with variables resolved
  unresolvedVariables: string[]; // Variables that need user input
}
```

---

## API Specifications

### OpenAPI Endpoints

All endpoints require JWT authentication.

#### 1. List Description Blocks
```yaml
GET /api/description-templates
Headers:
  Authorization: Bearer {token}
Query:
  limit?: number (default: 50, max: 100)
  cursor?: string (pagination cursor)
  type?: DescriptionBlockType (filter by type)
  language?: 'en' | 'ar' | 'both' (filter by language)
  favorites?: boolean (only favorites)
  search?: string (search in name/content)
Response:
  200: BlockListResponse
  401: Unauthorized
```

#### 2. Get Single Block
```yaml
GET /api/description-templates/:id
Headers:
  Authorization: Bearer {token}
Response:
  200: DescriptionBlock
  401: Unauthorized
  404: Block not found
```

#### 3. Create Block
```yaml
POST /api/description-templates
Headers:
  Authorization: Bearer {token}
Body: CreateBlockRequest
Response:
  201: DescriptionBlock
  400: Validation error
  401: Unauthorized
```

#### 4. Update Block
```yaml
PUT /api/description-templates/:id
Headers:
  Authorization: Bearer {token}
Body: UpdateBlockRequest
Response:
  200: DescriptionBlock
  400: Validation error
  401: Unauthorized
  404: Block not found
```

#### 5. Delete Block
```yaml
DELETE /api/description-templates/:id
Headers:
  Authorization: Bearer {token}
Response:
  204: No content
  401: Unauthorized
  404: Block not found
```

#### 6. Render Block with Variables
```yaml
POST /api/description-templates/render
Headers:
  Authorization: Bearer {token}
Body: RenderBlockRequest
Response:
  200: RenderBlockResponse
  400: Validation error
  401: Unauthorized
  404: Block not found
```

### API Implementation Example

```typescript
// apps/api-videos/src/endpoints/description-templates/list.ts

import { OpenAPIRoute, Str, Bool } from "chanfana";
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { getAuthContext } from "../../middleware/auth";
import R2Repository from "../../lib/r2Repo";
import { DescriptionBlock, DescriptionBlockType } from "@al-ummah/shared-types";

export class ListDescriptionBlocksEndpoint extends OpenAPIRoute {
  schema = addAuthToSchema({
    tags: ["Description Templates"],
    summary: "List Description Blocks",
    description: "Get all description template blocks for the authenticated user",
    request: {
      query: z.object({
        limit: z.number().min(1).max(100).optional().default(50),
        cursor: z.string().optional(),
        type: z.nativeEnum(DescriptionBlockType).optional(),
        language: z.enum(['en', 'ar', 'both']).optional(),
        favorites: z.boolean().optional(),
        search: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: "List of description blocks",
        content: {
          "application/json": {
            schema: z.object({
              blocks: z.array(z.any()),
              cursor: z.string().optional(),
              totalCount: z.number(),
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

    const { limit, cursor, type, language, favorites, search } = c.req.query();

    const bucket = c.env['description-templates'];
    const repo = new R2Repository<DescriptionBlock>(bucket);

    // List blocks for user
    const prefix = `${userId}/blocks/`;
    const result = await repo.listObjects(limit, cursor, prefix);

    // Apply filters
    let blocks = result.objects;

    if (type) {
      blocks = blocks.filter(b => b.type === type);
    }

    if (language) {
      blocks = blocks.filter(b => b.language === language || b.language === 'both');
    }

    if (favorites) {
      blocks = blocks.filter(b => b.isFavorite);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      blocks = blocks.filter(b =>
        b.name.toLowerCase().includes(searchLower) ||
        b.content.toLowerCase().includes(searchLower) ||
        b.tags?.some(tag => tag.toLowerCase().includes(searchLower))
      );
    }

    // Sort by sortOrder, then by lastUsedAt
    blocks.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder;
      }
      const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
      const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
      return bTime - aTime;
    });

    return c.json({
      blocks,
      cursor: result.cursor,
      totalCount: blocks.length,
    });
  }
}
```

---

## Frontend Implementation

### 1. Settings Page Component

**Location**: `apps/web/src/app/[locale]/settings/description-templates/page.tsx`

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { DescriptionBlock, DescriptionBlockType } from '@al-ummah/shared-types';
import { BlockLibrary } from '@/components/description-templates/BlockLibrary';
import { BlockEditor } from '@/components/description-templates/BlockEditor';
import { BlockCreator } from '@/components/description-templates/BlockCreator';
import { fetchDescriptionBlocks, createBlock, updateBlock, deleteBlock } from '@/lib/api/description-templates';

export default function DescriptionTemplatesPage() {
  const { t, locale } = useLanguage();
  const [blocks, setBlocks] = useState<DescriptionBlock[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<DescriptionBlock | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [filterType, setFilterType] = useState<DescriptionBlockType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadBlocks();
  }, [filterType, searchQuery]);

  const loadBlocks = async () => {
    const result = await fetchDescriptionBlocks({
      type: filterType === 'all' ? undefined : filterType,
      search: searchQuery || undefined,
      limit: 50,
    });
    setBlocks(result.blocks);
  };

  const handleCreateBlock = async (blockData: CreateBlockRequest) => {
    const newBlock = await createBlock(blockData);
    setBlocks([...blocks, newBlock]);
    setIsCreating(false);
  };

  const handleUpdateBlock = async (blockId: string, updates: UpdateBlockRequest) => {
    const updated = await updateBlock(blockId, updates);
    setBlocks(blocks.map(b => b.id === blockId ? updated : b));
    setSelectedBlock(updated);
  };

  const handleDeleteBlock = async (blockId: string) => {
    await deleteBlock(blockId);
    setBlocks(blocks.filter(b => b.id !== blockId));
    setSelectedBlock(null);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">
          {t('settings.descriptionTemplates.title')}
        </h1>
        <button
          onClick={() => setIsCreating(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          {t('settings.descriptionTemplates.createNew')}
        </button>
      </div>

      {/* Filters */}
      <div className="mb-6 flex gap-4">
        <input
          type="text"
          placeholder={t('common.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 px-3 py-2 border rounded-md"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as DescriptionBlockType | 'all')}
          className="px-3 py-2 border rounded-md"
        >
          <option value="all">{t('common.allTypes')}</option>
          <option value={DescriptionBlockType.INTRODUCTION}>{t('blockTypes.introduction')}</option>
          <option value={DescriptionBlockType.CONTENT}>{t('blockTypes.content')}</option>
          <option value={DescriptionBlockType.LINKS}>{t('blockTypes.links')}</option>
          <option value={DescriptionBlockType.DISCLAIMER}>{t('blockTypes.disclaimer')}</option>
          <option value={DescriptionBlockType.CALL_TO_ACTION}>{t('blockTypes.callToAction')}</option>
          <option value={DescriptionBlockType.CREDITS}>{t('blockTypes.credits')}</option>
          <option value={DescriptionBlockType.CHAPTERS}>{t('blockTypes.chapters')}</option>
          <option value={DescriptionBlockType.CUSTOM}>{t('blockTypes.custom')}</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Block Library (Left) */}
        <div className="lg:col-span-1">
          <BlockLibrary
            blocks={blocks}
            selectedBlockId={selectedBlock?.id}
            onSelect={setSelectedBlock}
            onToggleFavorite={(blockId) => {
              const block = blocks.find(b => b.id === blockId);
              if (block) {
                handleUpdateBlock(blockId, { isFavorite: !block.isFavorite });
              }
            }}
          />
        </div>

        {/* Block Editor (Right) */}
        <div className="lg:col-span-2">
          {isCreating ? (
            <BlockCreator
              onSave={handleCreateBlock}
              onCancel={() => setIsCreating(false)}
            />
          ) : selectedBlock ? (
            <BlockEditor
              block={selectedBlock}
              onSave={(updates) => handleUpdateBlock(selectedBlock.id, updates)}
              onDelete={() => handleDeleteBlock(selectedBlock.id)}
            />
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center">
              <p className="text-gray-500">
                {t('settings.descriptionTemplates.selectOrCreate')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

### 2. Block Editor Component

**Location**: `apps/web/src/components/description-templates/BlockEditor.tsx`

```typescript
import React, { useState } from 'react';
import { DescriptionBlock, DescriptionVariable, VariableType } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { VariableBuilder } from './VariableBuilder';
import { BlockPreview } from './BlockPreview';

interface BlockEditorProps {
  block: DescriptionBlock;
  onSave: (updates: UpdateBlockRequest) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function BlockEditor({ block, onSave, onDelete }: BlockEditorProps) {
  const { t, locale } = useLanguage();
  const [formData, setFormData] = useState(block);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [activeLanguage, setActiveLanguage] = useState<'en' | 'ar'>('en');

  const updateContent = (value: string) => {
    if (formData.language === 'both') {
      setFormData({
        ...formData,
        contentLocalized: {
          ...formData.contentLocalized,
          [activeLanguage]: value,
        }
      });
    } else {
      setFormData({ ...formData, content: value });
    }
  };

  const addVariable = (variable: DescriptionVariable) => {
    const variables = [...(formData.variables || []), variable];
    setFormData({ ...formData, variables });
  };

  const removeVariable = (variableName: string) => {
    const variables = formData.variables?.filter(v => v.name !== variableName) || [];
    setFormData({ ...formData, variables });
  };

  const insertVariableAtCursor = (variableName: string) => {
    // Insert {{variableName}} at cursor in content textarea
    const placeholder = `{{${variableName}}}`;
    // This would interact with a ref to the textarea for cursor position
    // For simplicity, append to end in this example
    const currentContent = formData.language === 'both'
      ? (formData.contentLocalized?.[activeLanguage] || '')
      : formData.content;

    updateContent(currentContent + placeholder);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="text-xl font-semibold bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none"
          />
          <p className="text-sm text-gray-500 mt-1">
            {t(`blockTypes.${formData.type}`)}
          </p>
        </div>
        <button
          onClick={() => setFormData({ ...formData, isFavorite: !formData.isFavorite })}
          className="text-2xl"
        >
          {formData.isFavorite ? '⭐' : '☆'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b">
        <button
          onClick={() => setActiveTab('edit')}
          className={`px-4 py-2 ${activeTab === 'edit' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}
        >
          {t('common.edit')}
        </button>
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-4 py-2 ${activeTab === 'preview' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-600'}`}
        >
          {t('common.preview')}
        </button>
      </div>

      {activeTab === 'edit' ? (
        <>
          {/* Language Selector (if bilingual) */}
          {formData.language === 'both' && (
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setActiveLanguage('en')}
                className={`px-4 py-2 rounded ${activeLanguage === 'en' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
              >
                English
              </button>
              <button
                onClick={() => setActiveLanguage('ar')}
                className={`px-4 py-2 rounded ${activeLanguage === 'ar' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
              >
                العربية
              </button>
            </div>
          )}

          {/* Content Editor */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">
              {t('descriptionTemplates.blockContent')}
            </label>
            <textarea
              value={formData.language === 'both'
                ? (formData.contentLocalized?.[activeLanguage] || '')
                : formData.content}
              onChange={(e) => updateContent(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 border rounded-md font-mono text-sm"
              dir={activeLanguage === 'ar' ? 'rtl' : 'ltr'}
              placeholder={t('descriptionTemplates.contentPlaceholder')}
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('descriptionTemplates.variableHint')}
            </p>
          </div>

          {/* Variables */}
          <div className="mb-6">
            <div className="flex justify-between items-center mb-2">
              <label className="block text-sm font-medium">
                {t('descriptionTemplates.variables')}
              </label>
              <VariableBuilder onAdd={addVariable} />
            </div>

            <div className="space-y-2">
              {formData.variables?.map((variable) => (
                <div
                  key={variable.name}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md"
                >
                  <div className="flex-1">
                    <code className="text-sm font-mono">
                      {'{{' + variable.name + '}}'}
                    </code>
                    <span className="ml-2 text-sm text-gray-600">
                      {variable.label}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      ({variable.type})
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => insertVariableAtCursor(variable.name)}
                      className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                    >
                      {t('common.insert')}
                    </button>
                    <button
                      onClick={() => removeVariable(variable.name)}
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                    >
                      {t('common.remove')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-2">
              {t('common.tags')}
            </label>
            <input
              type="text"
              value={formData.tags?.join(', ') || ''}
              onChange={(e) => setFormData({
                ...formData,
                tags: e.target.value.split(',').map(t => t.trim()).filter(Boolean)
              })}
              className="w-full px-3 py-2 border rounded-md"
              placeholder={t('descriptionTemplates.tagsPlaceholder')}
            />
          </div>
        </>
      ) : (
        <BlockPreview
          block={formData}
          context={{
            videoTitle: 'Sample Video Title',
            channelName: 'Sample Channel',
            channelUrl: 'https://alummahnow.net/@sample',
            category: 'islamic_lectures',
          }}
        />
      )}

      {/* Action Buttons */}
      <div className="flex justify-between mt-6 pt-6 border-t">
        <button
          onClick={onDelete}
          className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
        >
          {t('common.delete')}
        </button>
        <button
          onClick={() => onSave(formData)}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          {t('common.saveChanges')}
        </button>
      </div>
    </div>
  );
}
```

### 3. Quick Insert Modal

**Location**: `apps/web/src/components/description-templates/QuickInsertModal.tsx`

```typescript
import React, { useState, useEffect, useRef } from 'react';
import { DescriptionBlock } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { Search, Star, Clock } from 'lucide-react';

interface QuickInsertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onInsert: (block: DescriptionBlock) => void;
  blocks: DescriptionBlock[];
  cursorPosition?: number;
}

export function QuickInsertModal({
  isOpen,
  onClose,
  onInsert,
  blocks,
}: QuickInsertModalProps) {
  const { t } = useLanguage();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter blocks based on search
  const filteredBlocks = blocks.filter(block =>
    block.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    block.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    block.tags?.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Sort: favorites first, then by last used
  const sortedBlocks = [...filteredBlocks].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) {
      return a.isFavorite ? -1 : 1;
    }
    const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
    const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
    return bTime - aTime;
  });

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, sortedBlocks.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (sortedBlocks[selectedIndex]) {
          onInsert(sortedBlocks[selectedIndex]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, sortedBlocks, onInsert, onClose]);

  // Focus search input when opened
  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-2xl w-full max-w-2xl max-h-[70vh] flex flex-col">
        {/* Search Header */}
        <div className="p-4 border-b dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder={t('descriptionTemplates.searchBlocks')}
              className="w-full pl-10 pr-4 py-2 border rounded-md dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {t('descriptionTemplates.quickInsertHint')}
          </p>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2">
          {sortedBlocks.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              {t('descriptionTemplates.noBlocksFound')}
            </div>
          ) : (
            <div className="space-y-1">
              {sortedBlocks.map((block, index) => (
                <button
                  key={block.id}
                  onClick={() => onInsert(block)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full text-left p-3 rounded-md transition-colors ${
                    index === selectedIndex
                      ? 'bg-blue-100 dark:bg-blue-900'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {block.isFavorite && <Star size={14} className="text-yellow-500" fill="currentColor" />}
                        <span className="font-medium">{block.name}</span>
                        <span className="text-xs text-gray-500">
                          {t(`blockTypes.${block.type}`)}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                        {block.content.substring(0, 100)}...
                      </p>
                      {block.tags && block.tags.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {block.tags.slice(0, 3).map(tag => (
                            <span
                              key={tag}
                              className="text-xs px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {block.lastUsedAt && (
                      <div className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock size={12} />
                        {new Date(block.lastUsedAt).toLocaleDateString()}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 flex justify-between items-center">
          <div className="flex gap-4">
            <span><kbd className="px-2 py-1 bg-white dark:bg-gray-800 rounded border">↑↓</kbd> Navigate</span>
            <span><kbd className="px-2 py-1 bg-white dark:bg-gray-800 rounded border">Enter</kbd> Insert</span>
            <span><kbd className="px-2 py-1 bg-white dark:bg-gray-800 rounded border">Esc</kbd> Close</span>
          </div>
          <span>{sortedBlocks.length} {t('common.results')}</span>
        </div>
      </div>
    </div>
  );
}
```

---

## Variable System

### Variable Processor Implementation

**Location**: `apps/web/src/lib/description-templates/variable-processor.ts`

```typescript
import { DescriptionVariable, VariableType } from '@al-ummah/shared-types';

export interface ProcessingContext {
  // Video metadata
  videoTitle?: string;
  videoCategory?: string;
  videoTags?: string[];

  // Channel metadata
  channelName?: string;
  channelUrl?: string;
  channelId?: string;

  // User-provided values
  variableValues?: Record<string, string>;

  // Auto-generated
  date?: Date;
}

export class VariableProcessor {
  /**
   * Process template content and replace variables
   */
  static process(
    content: string,
    variables: DescriptionVariable[],
    context: ProcessingContext
  ): { rendered: string; unresolvedVariables: string[] } {
    let rendered = content;
    const unresolvedVariables: string[] = [];

    // Replace each variable
    variables.forEach(variable => {
      const placeholder = `{{${variable.name}}}`;
      const value = this.resolveVariable(variable, context);

      if (value !== null) {
        rendered = rendered.replace(new RegExp(placeholder, 'g'), value);
      } else if (variable.required) {
        unresolvedVariables.push(variable.name);
      }
    });

    return { rendered, unresolvedVariables };
  }

  /**
   * Resolve a single variable value
   */
  private static resolveVariable(
    variable: DescriptionVariable,
    context: ProcessingContext
  ): string | null {
    // Check user-provided values first
    if (context.variableValues?.[variable.name]) {
      return context.variableValues[variable.name];
    }

    // Auto-populate based on type
    switch (variable.type) {
      case VariableType.DATE:
        return this.formatDate(context.date || new Date());

      case VariableType.TIME:
        return this.formatTime(context.date || new Date());

      case VariableType.HIJRI_DATE:
        return this.formatHijriDate(context.date || new Date());

      case VariableType.CHANNEL_NAME:
        return context.channelName || null;

      case VariableType.CHANNEL_URL:
        return context.channelUrl || null;

      case VariableType.VIDEO_TITLE:
        return context.videoTitle || null;

      case VariableType.VIDEO_CATEGORY:
        return context.videoCategory || null;

      default:
        // User input required
        return variable.defaultValue || null;
    }
  }

  /**
   * Format date according to user locale
   */
  private static formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  /**
   * Format time
   */
  private static formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Format Hijri (Islamic calendar) date
   */
  private static formatHijriDate(date: Date): string {
    // This would use a library like 'hijri-date' or 'moment-hijri'
    // For now, placeholder implementation
    return date.toLocaleDateString('ar-SA-u-ca-islamic', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  /**
   * Extract all variables from content
   */
  static extractVariables(content: string): string[] {
    const regex = /\{\{(\w+)\}\}/g;
    const matches = content.matchAll(regex);
    return Array.from(matches, m => m[1]);
  }

  /**
   * Validate variable values against validation rules
   */
  static validateValue(
    value: string,
    variable: DescriptionVariable
  ): { valid: boolean; error?: string } {
    const validation = variable.validation;
    if (!validation) return { valid: true };

    // Length validation
    if (validation.minLength && value.length < validation.minLength) {
      return { valid: false, error: `Minimum length is ${validation.minLength}` };
    }
    if (validation.maxLength && value.length > validation.maxLength) {
      return { valid: false, error: `Maximum length is ${validation.maxLength}` };
    }

    // Pattern validation
    if (validation.pattern) {
      const regex = new RegExp(validation.pattern);
      if (!regex.test(value)) {
        return { valid: false, error: 'Invalid format' };
      }
    }

    // Choice validation
    if (validation.choices && !validation.choices.includes(value)) {
      return { valid: false, error: 'Invalid choice' };
    }

    // Numeric validation
    if (variable.type === VariableType.NUMBER) {
      const num = Number(value);
      if (isNaN(num)) {
        return { valid: false, error: 'Must be a number' };
      }
      if (validation.min !== undefined && num < validation.min) {
        return { valid: false, error: `Minimum value is ${validation.min}` };
      }
      if (validation.max !== undefined && num > validation.max) {
        return { valid: false, error: `Maximum value is ${validation.max}` };
      }
    }

    // URL validation
    if (variable.type === VariableType.URL) {
      try {
        new URL(value);
      } catch {
        return { valid: false, error: 'Invalid URL' };
      }
    }

    // Email validation
    if (variable.type === VariableType.EMAIL) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return { valid: false, error: 'Invalid email' };
      }
    }

    return { valid: true };
  }
}
```

---

## Quick Insert Functionality

### Integration in Upload Form

**Modify**: `apps/web/src/components/videoUpload/index.tsx`

```typescript
// Add to VideoUpload component
import { QuickInsertModal } from '@/components/description-templates/QuickInsertModal';
import { DescriptionBlock } from '@al-ummah/shared-types';
import { VariableProcessor } from '@/lib/description-templates/variable-processor';

const [descriptionBlocks, setDescriptionBlocks] = useState<DescriptionBlock[]>([]);
const [showQuickInsert, setShowQuickInsert] = useState(false);
const [descriptionCursorPosition, setDescriptionCursorPosition] = useState(0);
const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

// Fetch blocks on mount
useEffect(() => {
  fetchDescriptionBlocks().then(setDescriptionBlocks);
}, []);

// Handle Ctrl+K keyboard shortcut
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      setShowQuickInsert(true);
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);

// Handle block insertion
const handleInsertBlock = async (block: DescriptionBlock) => {
  const context = {
    videoTitle: metadata.titleEn || metadata.title,
    channelName: auth.user?.email || 'Your Channel',
    channelUrl: `https://alummahnow.net/@${auth.user?.id}`,
    videoCategory: metadata.category,
  };

  // Process variables
  const { rendered, unresolvedVariables } = VariableProcessor.process(
    block.content,
    block.variables || [],
    context
  );

  // If there are unresolved variables, prompt user
  if (unresolvedVariables.length > 0) {
    // Show modal to collect variable values
    const values = await promptForVariables(
      block.variables?.filter(v => unresolvedVariables.includes(v.name)) || []
    );

    // Re-process with user values
    const { rendered: finalRendered } = VariableProcessor.process(
      block.content,
      block.variables || [],
      { ...context, variableValues: values }
    );

    insertTextAtCursor(finalRendered);
  } else {
    insertTextAtCursor(rendered);
  }

  setShowQuickInsert(false);

  // Update block usage statistics
  await updateBlockUsage(block.id);
};

// Insert text at cursor position
const insertTextAtCursor = (text: string) => {
  const textarea = descriptionTextareaRef.current;
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const currentValue = metadata.descriptionEn || '';

  const newValue =
    currentValue.substring(0, start) +
    text +
    currentValue.substring(end);

  setMetadata(prev => ({
    ...prev,
    descriptionEn: newValue,
    description: newValue,
  }));

  // Set cursor position after inserted text
  setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(
      start + text.length,
      start + text.length
    );
  }, 0);
};

// In the description textarea:
<textarea
  ref={descriptionTextareaRef}
  value={metadata.descriptionEn}
  onChange={(e) => setMetadata(prev => ({ ...prev, descriptionEn: e.target.value, description: e.target.value }))}
  onSelect={(e) => setDescriptionCursorPosition(e.currentTarget.selectionStart)}
  rows={6}
  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md"
  placeholder={t('video.descriptionPlaceholder') + ' (Ctrl+K for templates)'}
/>

{/* Quick Insert Modal */}
<QuickInsertModal
  isOpen={showQuickInsert}
  onClose={() => setShowQuickInsert(false)}
  onInsert={handleInsertBlock}
  blocks={descriptionBlocks}
  cursorPosition={descriptionCursorPosition}
/>
```

---

## Technical Implementation Details

### Pre-built Template Examples

```typescript
// apps/web/src/lib/description-templates/examples.ts

export const TEMPLATE_EXAMPLES: Partial<DescriptionBlock>[] = [
  {
    name: "Channel Introduction",
    type: DescriptionBlockType.INTRODUCTION,
    language: 'both',
    content: "Welcome to {{channel_name}}!\n\nFollow us for daily Islamic content.\n\nSubscribe: {{channel_url}}",
    contentLocalized: {
      en: "Welcome to {{channel_name}}!\n\nFollow us for daily Islamic content.\n\nSubscribe: {{channel_url}}",
      ar: "مرحباً بكم في {{channel_name}}!\n\nتابعونا للحصول على محتوى إسلامي يومي.\n\nاشترك: {{channel_url}}"
    },
    variables: [
      {
        name: 'channel_name',
        type: VariableType.CHANNEL_NAME,
        label: 'Channel Name',
        required: true,
        defaultValue: '',
      },
      {
        name: 'channel_url',
        type: VariableType.CHANNEL_URL,
        label: 'Channel URL',
        required: true,
        defaultValue: '',
      }
    ],
    tags: ['intro', 'channel', 'subscribe'],
  },
  {
    name: "Social Media Links",
    type: DescriptionBlockType.LINKS,
    language: 'both',
    content: "Follow us:\n🌐 Website: {{website}}\n📘 Facebook: {{facebook}}\n📷 Instagram: {{instagram}}\n🐦 Twitter: {{twitter}}",
    contentLocalized: {
      en: "Follow us:\n🌐 Website: {{website}}\n📘 Facebook: {{facebook}}\n📷 Instagram: {{instagram}}\n🐦 Twitter: {{twitter}}",
      ar: "تابعونا:\n🌐 الموقع: {{website}}\n📘 فيسبوك: {{facebook}}\n📷 إنستغرام: {{instagram}}\n🐦 تويتر: {{twitter}}"
    },
    variables: [
      { name: 'website', type: VariableType.URL, label: 'Website URL', required: false, defaultValue: '' },
      { name: 'facebook', type: VariableType.URL, label: 'Facebook URL', required: false, defaultValue: '' },
      { name: 'instagram', type: VariableType.URL, label: 'Instagram URL', required: false, defaultValue: '' },
      { name: 'twitter', type: VariableType.URL, label: 'Twitter URL', required: false, defaultValue: '' },
    ],
    tags: ['social', 'links', 'contact'],
  },
  {
    name: "Copyright Disclaimer",
    type: DescriptionBlockType.DISCLAIMER,
    language: 'both',
    content: "© {{year}} {{channel_name}}. All rights reserved.\n\nThis content is for educational purposes only.",
    contentLocalized: {
      en: "© {{year}} {{channel_name}}. All rights reserved.\n\nThis content is for educational purposes only.",
      ar: "© {{year}} {{channel_name}}. جميع الحقوق محفوظة.\n\nهذا المحتوى لأغراض تعليمية فقط."
    },
    variables: [
      { name: 'year', type: VariableType.NUMBER, label: 'Year', required: true, defaultValue: new Date().getFullYear().toString() },
      { name: 'channel_name', type: VariableType.CHANNEL_NAME, label: 'Channel Name', required: true, defaultValue: '' },
    ],
    tags: ['copyright', 'disclaimer', 'legal'],
  },
  {
    name: "Subscribe Call-to-Action",
    type: DescriptionBlockType.CALL_TO_ACTION,
    language: 'both',
    content: "📢 Don't forget to LIKE, SUBSCRIBE, and hit the BELL icon! 🔔\n\n👉 {{channel_url}}",
    contentLocalized: {
      en: "📢 Don't forget to LIKE, SUBSCRIBE, and hit the BELL icon! 🔔\n\n👉 {{channel_url}}",
      ar: "📢 لا تنسوا الإعجاب والاشتراك وتفعيل زر الجرس! 🔔\n\n👉 {{channel_url}}"
    },
    variables: [
      { name: 'channel_url', type: VariableType.CHANNEL_URL, label: 'Channel URL', required: true, defaultValue: '' },
    ],
    tags: ['subscribe', 'cta', 'engagement'],
  },
  {
    name: "Video Chapters Template",
    type: DescriptionBlockType.CHAPTERS,
    language: 'en',
    content: "📑 CHAPTERS:\n0:00 Introduction\n{{chapter_1_time}} {{chapter_1_title}}\n{{chapter_2_time}} {{chapter_2_title}}\n{{chapter_3_time}} {{chapter_3_title}}",
    variables: [
      { name: 'chapter_1_time', type: VariableType.TEXT, label: 'Chapter 1 Time', required: true, defaultValue: '0:00' },
      { name: 'chapter_1_title', type: VariableType.TEXT, label: 'Chapter 1 Title', required: true, defaultValue: '' },
      { name: 'chapter_2_time', type: VariableType.TEXT, label: 'Chapter 2 Time', required: false, defaultValue: '' },
      { name: 'chapter_2_title', type: VariableType.TEXT, label: 'Chapter 2 Title', required: false, defaultValue: '' },
      { name: 'chapter_3_time', type: VariableType.TEXT, label: 'Chapter 3 Time', required: false, defaultValue: '' },
      { name: 'chapter_3_title', type: VariableType.TEXT, label: 'Chapter 3 Title', required: false, defaultValue: '' },
    ],
    tags: ['chapters', 'timestamps', 'navigation'],
  },
  {
    name: "Episode Description (Series)",
    type: DescriptionBlockType.CONTENT,
    language: 'both',
    content: "📺 Episode {{episode}} of {{series_name}}\n\nIn this episode:\n{{episode_summary}}\n\nRecorded: {{date}}",
    contentLocalized: {
      en: "📺 Episode {{episode}} of {{series_name}}\n\nIn this episode:\n{{episode_summary}}\n\nRecorded: {{date}}",
      ar: "📺 الحلقة {{episode}} من {{series_name}}\n\nفي هذه الحلقة:\n{{episode_summary}}\n\nتاريخ التسجيل: {{date}}"
    },
    variables: [
      { name: 'episode', type: VariableType.NUMBER, label: 'Episode Number', required: true, defaultValue: '' },
      { name: 'series_name', type: VariableType.TEXT, label: 'Series Name', required: true, defaultValue: '' },
      { name: 'episode_summary', type: VariableType.TEXT, label: 'Episode Summary', required: true, defaultValue: '' },
      { name: 'date', type: VariableType.DATE, label: 'Recording Date', required: false, defaultValue: '' },
    ],
    tags: ['episode', 'series', 'description'],
  },
];
```

---

## Files to Create/Modify

### New Files to Create

#### Backend (api-videos)
1. `apps/api-videos/src/endpoints/description-templates/list.ts` - List blocks
2. `apps/api-videos/src/endpoints/description-templates/create.ts` - Create block
3. `apps/api-videos/src/endpoints/description-templates/fetch.ts` - Get single block
4. `apps/api-videos/src/endpoints/description-templates/update.ts` - Update block
5. `apps/api-videos/src/endpoints/description-templates/delete.ts` - Delete block
6. `apps/api-videos/src/endpoints/description-templates/render.ts` - Render with variables
7. `apps/api-videos/src/lib/description-templates/validator.ts` - Block validation

#### Frontend (web)
8. `apps/web/src/app/[locale]/settings/description-templates/page.tsx` - Settings page
9. `apps/web/src/components/description-templates/BlockLibrary.tsx` - Block list
10. `apps/web/src/components/description-templates/BlockEditor.tsx` - Block editor
11. `apps/web/src/components/description-templates/BlockCreator.tsx` - Create new block
12. `apps/web/src/components/description-templates/BlockPreview.tsx` - Preview with variables
13. `apps/web/src/components/description-templates/QuickInsertModal.tsx` - Ctrl+K modal
14. `apps/web/src/components/description-templates/VariableBuilder.tsx` - Variable creator
15. `apps/web/src/components/description-templates/VariableInputModal.tsx` - Prompt for variables
16. `apps/web/src/lib/api/description-templates.ts` - API client
17. `apps/web/src/lib/description-templates/variable-processor.ts` - Variable engine
18. `apps/web/src/lib/description-templates/examples.ts` - Pre-built examples

#### Shared Types
19. `packages/shared-types/src/description-templates.ts` - Type definitions

### Files to Modify

#### Backend
1. `apps/api-videos/src/index.ts` - Register new endpoints
2. `apps/api-videos/wrangler.jsonc` - Add R2 bucket bindings

#### Frontend
3. `apps/web/src/components/videoUpload/index.tsx` - Add quick insert integration
4. `apps/web/src/lib/i18n/en/settings.json` - English translations
5. `apps/web/src/lib/i18n/ar/settings.json` - Arabic translations

#### Shared
6. `packages/shared-types/src/index.ts` - Export new types

---

## Testing Strategy

### Unit Tests

```typescript
// apps/web/src/lib/description-templates/__tests__/variable-processor.test.ts

import { VariableProcessor } from '../variable-processor';
import { VariableType } from '@al-ummah/shared-types';

describe('VariableProcessor', () => {
  test('should replace simple variables', () => {
    const content = 'Hello {{name}}, welcome to {{channel_name}}!';
    const variables = [
      { name: 'name', type: VariableType.TEXT, label: 'Name', required: true },
      { name: 'channel_name', type: VariableType.CHANNEL_NAME, label: 'Channel', required: true },
    ];
    const context = {
      channelName: 'Al Ummah Now',
      variableValues: { name: 'Ahmed' },
    };

    const { rendered } = VariableProcessor.process(content, variables, context);

    expect(rendered).toBe('Hello Ahmed, welcome to Al Ummah Now!');
  });

  test('should auto-populate date variables', () => {
    const content = 'Published on {{date}}';
    const variables = [
      { name: 'date', type: VariableType.DATE, label: 'Date', required: true },
    ];
    const testDate = new Date('2025-01-20');
    const context = { date: testDate };

    const { rendered } = VariableProcessor.process(content, variables, context);

    expect(rendered).toContain('January 20, 2025');
  });

  test('should identify unresolved variables', () => {
    const content = 'Episode {{episode}} - {{topic}}';
    const variables = [
      { name: 'episode', type: VariableType.NUMBER, label: 'Episode', required: true },
      { name: 'topic', type: VariableType.TEXT, label: 'Topic', required: true },
    ];
    const context = {};

    const { unresolvedVariables } = VariableProcessor.process(content, variables, context);

    expect(unresolvedVariables).toEqual(['episode', 'topic']);
  });

  test('should extract variables from content', () => {
    const content = 'Title: {{title}}\nDate: {{date}}\nAuthor: {{author}}';

    const extracted = VariableProcessor.extractVariables(content);

    expect(extracted).toEqual(['title', 'date', 'author']);
  });

  test('should validate URL variables', () => {
    const variable = {
      name: 'website',
      type: VariableType.URL,
      label: 'Website',
      required: true,
    };

    expect(VariableProcessor.validateValue('https://example.com', variable).valid).toBe(true);
    expect(VariableProcessor.validateValue('not-a-url', variable).valid).toBe(false);
  });
});
```

### Integration Tests

```typescript
// apps/api-videos/src/endpoints/description-templates/__tests__/api.test.ts

describe('Description Templates API', () => {
  test('should create block with valid data', async () => {
    const response = await request('/api/description-templates')
      .post()
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        name: 'Test Block',
        type: 'introduction',
        language: 'en',
        content: 'Welcome to {{channel_name}}!',
        variables: [
          { name: 'channel_name', type: 'channel_name', label: 'Channel', required: true }
        ]
      });

    expect(response.status).toBe(201);
    expect(response.body.id).toBeDefined();
    expect(response.body.name).toBe('Test Block');
  });

  test('should filter blocks by type', async () => {
    // Create blocks of different types
    await createBlock({ type: 'introduction' });
    await createBlock({ type: 'links' });

    const response = await request('/api/description-templates?type=introduction')
      .get()
      .set('Authorization', `Bearer ${validToken}`);

    expect(response.status).toBe(200);
    expect(response.body.blocks.every(b => b.type === 'introduction')).toBe(true);
  });

  test('should render block with variables', async () => {
    const block = await createBlock({
      content: 'Episode {{episode}} - {{title}}',
      variables: [
        { name: 'episode', type: 'number', required: true },
        { name: 'title', type: 'text', required: true },
      ]
    });

    const response = await request('/api/description-templates/render')
      .post()
      .set('Authorization', `Bearer ${validToken}`)
      .send({
        blockId: block.id,
        variableValues: {
          episode: '5',
          title: 'Introduction to Tafsir'
        }
      });

    expect(response.status).toBe(200);
    expect(response.body.rendered).toBe('Episode 5 - Introduction to Tafsir');
  });
});
```

### E2E Tests

```typescript
describe('Description Templates E2E', () => {
  test('complete workflow: create, save, and use template', async () => {
    // Navigate to settings
    await page.goto('/settings/description-templates');

    // Create new block
    await page.click('[data-testid="create-block"]');
    await page.fill('[name="name"]', 'My Intro Block');
    await page.selectOption('[name="type"]', 'introduction');
    await page.fill('[name="content"]', 'Welcome to {{channel_name}}!');
    await page.click('[data-testid="add-variable"]');
    await page.fill('[name="variable-name"]', 'channel_name');
    await page.selectOption('[name="variable-type"]', 'channel_name');
    await page.click('[data-testid="save-variable"]');
    await page.click('[data-testid="save-block"]');

    // Navigate to upload page
    await page.goto('/upload');

    // Select file
    await page.setInputFiles('[type="file"]', 'test-video.mp4');

    // Open quick insert (Ctrl+K)
    await page.keyboard.press('Control+K');

    // Search and select block
    await page.fill('[placeholder*="Search"]', 'My Intro');
    await page.click('text=My Intro Block');

    // Verify insertion
    const description = await page.inputValue('[name="description"]');
    expect(description).toContain('Welcome to');
  });
});
```

---

## Rollout Plan

### Phase 1: Backend & Core Infrastructure (Week 1, Days 1-4)
**Days 1-2:**
- [ ] Create R2 bucket configuration (`description-templates`)
- [ ] Implement CRUD API endpoints
- [ ] Add Zod validation schemas
- [ ] Deploy to staging environment

**Days 3-4:**
- [ ] Implement render endpoint with variable processor
- [ ] Add search/filter functionality
- [ ] Integration testing
- [ ] Performance testing

### Phase 2: Frontend Components (Week 1-2, Days 5-7)
**Days 5-6:**
- [ ] Build settings page (block library + editor)
- [ ] Implement block editor with variable builder
- [ ] Create block preview component

**Day 7:**
- [ ] Build quick insert modal (Ctrl+K)
- [ ] Keyboard navigation
- [ ] Search functionality

### Phase 3: Integration & Polish (Week 2, Days 8-10)
**Days 8-9:**
- [ ] Integrate quick insert into upload form
- [ ] Implement variable prompting UI
- [ ] Add bilingual support (RTL for Arabic)
- [ ] Create pre-built example templates

**Day 10:**
- [ ] UI polish and responsive design
- [ ] Accessibility improvements (WCAG)
- [ ] Performance optimization

### Phase 4: Testing & Release (Week 2-3, Days 11-14)
**Days 11-12:**
- [ ] End-to-end testing
- [ ] User acceptance testing
- [ ] Bug fixes and refinements

**Days 13-14:**
- [ ] Documentation (user guide)
- [ ] Production deployment
- [ ] Monitor initial usage
- [ ] Gather feedback

### Success Metrics
- 40% of regular uploaders use description templates within 4 weeks
- Average description writing time reduced by 50%
- User satisfaction score > 4.3/5
- Less than 2% error rate

---

## Performance Considerations

### Caching Strategy

```typescript
// Client-side caching
const BLOCK_CACHE_KEY = 'description-blocks';
const BLOCK_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

class BlockCache {
  static get(): DescriptionBlock[] | null {
    const cached = localStorage.getItem(BLOCK_CACHE_KEY);
    if (!cached) return null;

    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp > BLOCK_CACHE_TTL) {
      localStorage.removeItem(BLOCK_CACHE_KEY);
      return null;
    }

    return data;
  }

  static set(blocks: DescriptionBlock[]) {
    localStorage.setItem(BLOCK_CACHE_KEY, JSON.stringify({
      data: blocks,
      timestamp: Date.now()
    }));
  }

  static invalidate() {
    localStorage.removeItem(BLOCK_CACHE_KEY);
  }
}
```

### R2 Optimization

- Use prefix queries for user blocks: `{userId}/blocks/`
- Limit blocks per user (50 max)
- Cursor-based pagination for large lists
- Index by type and tags for fast filtering

### Bundle Size

- Lazy load settings page components
- Code-split variable processor
- Tree-shake unused variable types
- Minify template examples

---

## Security Considerations

### Access Control

```typescript
// Verify user owns block
const verifyBlockOwnership = async (
  userId: string,
  blockId: string,
  bucket: R2Bucket
): Promise<boolean> => {
  const key = `${userId}/blocks/${blockId}`;
  const block = await bucket.get(key);

  if (!block) return false;

  const data = await block.json<DescriptionBlock>();
  return data.userId === userId;
};
```

### Input Validation

```typescript
const BlockSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.nativeEnum(DescriptionBlockType),
  content: z.string().min(1).max(5000),
  variables: z.array(z.object({
    name: z.string().regex(/^[a-z_]+$/), // alphanumeric + underscore only
    type: z.nativeEnum(VariableType),
    label: z.string().max(100),
    required: z.boolean(),
  })).max(20).optional(),
  tags: z.array(z.string().max(30)).max(10).optional(),
});
```

### XSS Prevention

- Sanitize all variable values
- Escape HTML in rendered content
- Use React's built-in protection
- Validate variable placeholders (only `{{word}}` format)

### Rate Limiting

```typescript
const RATE_LIMITS = {
  CREATE_BLOCK: '20/hour',
  UPDATE_BLOCK: '50/hour',
  DELETE_BLOCK: '20/hour',
  RENDER_BLOCK: '100/hour',
};
```

---

## Monitoring & Analytics

### Metrics to Track

```typescript
// Queue events for analytics
await queue.send('template_block_created', {
  userId,
  blockId,
  blockType,
  variableCount: block.variables.length,
  timestamp: new Date().toISOString(),
});

await queue.send('template_block_used', {
  userId,
  blockId,
  blockType,
  videoId,
  variablesResolved: Object.keys(variableValues).length,
  timestamp: new Date().toISOString(),
});
```

### Dashboard Metrics

1. **Adoption Metrics**
   - Blocks created per day
   - Active blocks per user
   - Block usage rate (% of uploads)
   - Most popular block types

2. **Performance Metrics**
   - Block load time (< 100ms target)
   - Variable processing time (< 50ms target)
   - Search latency (< 200ms target)

3. **Error Metrics**
   - Block creation failures
   - Variable resolution errors
   - Validation failures

### Alerts

- Block storage approaching limit (> 45/50)
- High error rate (> 5%)
- Slow API responses (> 500ms)
- Low adoption rate (< 20% after 2 weeks)

---

## Future Enhancements

### Phase 2 Features (Q2 2025)

1. **Block Sharing**
   - Share blocks between channels
   - Public block marketplace
   - Community templates library
   - Import/export functionality

2. **Advanced Variables**
   - Conditional logic (`{{#if category}}...{{/if}}`)
   - Loops for repeated content
   - Math expressions (`{{episode + 1}}`)
   - External data sources (APIs)

3. **AI-Powered Features**
   - Auto-generate descriptions from video
   - Smart variable suggestions
   - Description optimization hints
   - Translation assistance

### Phase 3 Features (Q3 2025)

1. **Workflow Automation**
   - Auto-apply based on video category
   - Rule-based template selection
   - Batch processing for multiple uploads

2. **Template Analytics**
   - Performance tracking per block
   - Engagement metrics (views, clicks)
   - A/B testing capabilities
   - Optimization recommendations

3. **Collaboration Features**
   - Team templates (shared across channel members)
   - Template versioning
   - Change history and rollback
   - Approval workflows

---

## Conclusion

The Description Templates feature will significantly streamline the video upload workflow by providing reusable, variable-powered description blocks. This modular approach complements the Upload Defaults system (#2) and addresses a key pain point for content creators.

**Key Success Factors:**
1. Intuitive quick insert (Ctrl+K)
2. Powerful variable system
3. Modular, mix-and-match design
4. Fast performance
5. Bilingual support

**Expected Impact:**
- 50-70% reduction in description writing time
- Improved consistency across channel content
- Higher creator productivity
- Better metadata quality

**Next Steps:**
1. Review and approve this implementation plan
2. Allocate development resources (2 developers, 1.5 weeks)
3. Set up R2 bucket in Cloudflare
4. Begin Phase 1 implementation
5. Coordinate with Upload Defaults (#2) team for integration

---

**Document Metadata:**
- Version: 1.0
- Created: 2025-01-20
- Author: System Architect
- Review Status: Pending
- Implementation Status: Not Started
- Dependencies: Upload Defaults (#2)
