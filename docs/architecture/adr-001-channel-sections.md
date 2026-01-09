# ADR-001: Channel Sections Architecture

## Status
Proposed

## Context
Al Ummah Now needs a flexible system for channels to customize their page layout with different content sections, similar to YouTube's channel sections but adapted for Islamic content and our R2-based architecture.

## Decision

### 1. Storage Architecture

**R2 Bucket Structure:**
```
channel-sections/
├── by-channel/
│   └── {channelId}/
│       └── sections.json         # All sections for a channel
└── by-section/
    └── {sectionId}.json         # Individual section (for updates)
```

**Rationale:**
- Store all sections for a channel in a single JSON file for efficient retrieval
- Individual section files enable atomic updates without race conditions
- Dual storage pattern balances read performance with write safety

### 2. Section Types Design

We've defined 15 section types tailored for Islamic content:

**Video Sections:**
- `recent_videos` - Latest channel uploads
- `popular_videos` - Most viewed content
- `featured_video` - Single highlighted video
- `live_streams` - Live and upcoming streams
- `shorts` - Short-form content (<60 seconds)

**Islamic Content Sections:**
- `quran_recitations` - Quran recitation videos
- `islamic_lectures` - Educational content
- `prayer_times` - Prayer-related content
- `ramadan_content` - Seasonal Ramadan videos
- `hajj_umrah_guides` - Pilgrimage guidance

**Community Sections:**
- `featured_channels` - Affiliated/recommended channels
- `community_posts` - Updates and announcements
- `custom_message` - Welcome messages
- `channel_trailer` - Introduction for new visitors

**Playlist Sections:**
- `single_playlist` - Featured playlist
- `multiple_playlists` - Collection of playlists

**Rationale:**
- Covers common Islamic content categories
- Supports both static (curated) and dynamic (filtered) content
- Extensible enum allows future section types

### 3. Content Resolution Strategy

**Two-Phase Loading:**
1. Load channel sections metadata (lightweight)
2. Resolve content references on-demand

```typescript
// Phase 1: Load sections
const sections = await loadChannelSections(channelId);

// Phase 2: Resolve content for visible sections
const resolvedSections = await Promise.all(
  visibleSections.map(section => resolveContent(section))
);
```

**Content Resolution Types:**
- **Static:** Direct references to videos/playlists/channels
- **Dynamic:** Filter-based queries for real-time content
- **Hybrid:** Static with fallback to dynamic

**Rationale:**
- Minimizes initial load time
- Allows lazy loading of content
- Supports both curated and algorithmic content

### 4. Positioning System

**1-Based Positioning:**
- Position 1 appears first
- Gaps are allowed (1, 3, 5)
- Automatic reordering fills gaps

**Reordering Algorithm:**
```typescript
function reorderSections(sections: ChannelSection[]): ChannelSection[] {
  return sections
    .sort((a, b) => a.position - b.position)
    .map((section, index) => ({
      ...section,
      position: index + 1
    }));
}
```

**Rationale:**
- Simple mental model (position 1 = first)
- Handles deletions gracefully
- Easy drag-and-drop implementation

### 5. Localization Strategy

**Multi-Level Localization:**
```typescript
interface LocalizedSection {
  title: string;              // Default (English)
  titleLocalized: {
    ar: "العنوان بالعربية",    // Arabic
    ur: "اردو میں عنوان"      // Urdu
  };
}
```

**Fallback Chain:**
1. User's preferred language
2. Channel's default language
3. English (platform default)

**Rationale:**
- Supports global Islamic audience
- Graceful fallback for missing translations
- Consistent with existing platform localization

### 6. Validation Rules

**Constraints:**
- Max 12 sections per channel
- Max 50 items per section
- Max 100 content references
- Title: 1-100 characters
- Description: 0-500 characters

**Business Rules:**
- New channels get 3 default sections
- At least 1 section must be enabled
- Duplicate section types allowed
- Position must be unique per channel

**Rationale:**
- Prevents abuse and excessive data
- Ensures reasonable page load times
- Allows flexibility within bounds

### 7. Migration Strategy

**Phase 1: Opt-in Beta**
```typescript
// Feature flag in channel settings
if (channel.features?.sectionsEnabled) {
  return renderSectionsLayout();
} else {
  return renderLegacyLayout();
}
```

**Phase 2: Default Sections**
```typescript
async function createDefaultSections(channelId: string) {
  const defaults = [
    { type: 'channel_trailer', position: 1 },
    { type: 'recent_videos', position: 2 },
    { type: 'popular_videos', position: 3 }
  ];
  await createSections(channelId, defaults);
}
```

**Phase 3: Full Migration**
- Batch process all channels
- Create default sections based on content
- Enable for all channels

**Rationale:**
- Gradual rollout minimizes risk
- Allows testing and refinement
- Preserves existing functionality

## Consequences

### Positive
- Channels can customize their page layout
- Supports Islamic content categories natively
- Scalable R2-based architecture
- Bilingual support from day one
- Extensible for future section types

### Negative
- Additional R2 reads for section data
- More complex frontend rendering
- Content resolution adds latency
- Requires migration of existing channels

### Neutral
- Increases data storage slightly
- Adds complexity to channel management
- Requires new API endpoints

## Implementation Plan

1. **Week 1-2:** Core data model and R2 repository
2. **Week 3:** API endpoints (CRUD + reorder)
3. **Week 4:** Content resolution system
4. **Week 5:** Frontend components
5. **Week 6:** Default sections and migration
6. **Week 7:** Testing and optimization
7. **Week 8:** Beta rollout

## Alternatives Considered

### Alternative 1: Single Section Type with Flexible Config
- Pro: Simpler data model
- Con: Less type safety, harder to validate

### Alternative 2: Fixed Layout Templates
- Pro: Easier to implement
- Con: Less flexibility for channels

### Alternative 3: Graph-based Sections
- Pro: More flexible relationships
- Con: Complex for R2 storage

## References
- YouTube Channel Customization: https://support.google.com/youtube/answer/3027787
- Islamic Content Categories Research
- R2 Repository Pattern Documentation