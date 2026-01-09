# Draft System Implementation Plan

**Feature ID**: 22
**Priority**: MEDIUM
**Estimated Effort**: 2 weeks
**Team Size**: 1-2 developers

## Executive Summary

The Draft System allows creators to save partially completed video uploads and metadata, resuming the upload process at a later time. This feature addresses the pain point of having to complete all video information in one session and provides resilience against browser crashes, network interruptions, or time constraints.

## Requirements from YouTube Feature Comparison

From `docs/YOUTUBE_FEATURE_COMPARISON.md`:
- **Save upload as draft**: Store partial upload state
- **Continue later**: Resume upload from where user left off
- **Partial metadata saved**: Title, description, tags, settings preserved
- **Resume upload progress**: Continue file upload from last byte position (TUS protocol)

## System Architecture

### High-Level Design

```
┌─────────────────┐
│   Web Client    │
│  (Next.js App)  │
└────────┬────────┘
         │
         │ 1. Save Draft / Resume Draft
         ▼
┌─────────────────┐
│  Next.js Server │
│  Server Actions │
└────────┬────────┘
         │
         │ 2. API Calls with JWT
         ▼
┌─────────────────────────────┐
│   API Videos Service        │
│  (Cloudflare Worker)        │
│                             │
│  ┌───────────────────────┐  │
│  │ Draft Endpoints       │  │
│  │ - createDraft        │  │
│  │ - updateDraft        │  │
│  │ - getDrafts          │  │
│  │ - resumeDraft        │  │
│  │ - deleteDraft        │  │
│  └───────────────────────┘  │
└──────────────┬──────────────┘
               │
               │ 3. Store/Retrieve
               ▼
         ┌──────────────┐
         │ R2 Storage   │
         │              │
         │ ┌──────────┐ │
         │ │ drafts   │ │
         │ │ bucket   │ │
         │ └──────────┘ │
         └──────────────┘
```

### Draft Lifecycle

```
                    ┌─────────┐
                    │  START  │
                    └────┬────┘
                         │
                         ▼
                ┌─────────────────┐
                │  Create Draft   │
                │  (Auto-save)    │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │  User Edits     │◄─────┐
                │  Metadata       │      │
                └────────┬────────┘      │
                         │               │
                         ▼               │
                ┌─────────────────┐      │
                │  Auto-save      │      │
                │  (Every 30s)    │──────┘
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │  User Actions   │
                └─┬───┬───┬───┬──┘
                  │   │   │   │
        Resume    │   │   │   │ Delete
        Later     │   │   │   │
                  ▼   │   │   ▼
           ┌──────┐   │   │  ┌─────────┐
           │ Save │   │   │  │ Delete  │
           │Draft │   │   │  │ Draft   │
           └──────┘   │   │  └─────────┘
                      │   │
            Publish   │   │ Cancel
                      ▼   ▼
              ┌──────────────┐
              │  Complete    │
              │  Upload      │
              └──────────────┘
                      │
                      ▼
              ┌──────────────┐
              │ Delete Draft │
              │ (Auto)       │
              └──────────────┘
```

## Data Models

### 1. Draft Entity

```typescript
// packages/shared-types/src/draft.ts

export interface VideoDraft {
  // Identifiers
  id: string;                    // UUID for draft
  userId: string;                // Owner of the draft
  channelId?: string;             // Target channel

  // Upload State
  videoId?: string;               // Bunny.net video ID (if initiated)
  uploadStatus: DraftUploadStatus;
  uploadProgress?: number;        // 0-100 percentage
  tusUploadUrl?: string;          // TUS resumable upload URL
  tusUploadOffset?: number;       // Last uploaded byte position
  fileMetadata?: {
    name: string;
    size: number;
    type: string;
    lastModified: number;
  };

  // Video Metadata (Partial)
  title?: string;
  titleLocalized?: Record<string, string>;
  description?: string;
  descriptionLocalized?: Record<string, string>;
  tags?: string[];
  category?: string;
  language?: string;

  // Publishing Settings
  visibility?: 'public' | 'private' | 'unlisted';
  scheduledPublishDate?: string;  // ISO 8601
  premiereEnabled?: boolean;

  // Content Settings
  isAgeRestricted?: boolean;
  madeForKids?: boolean;
  paidPromotion?: boolean;

  // Advanced Settings
  license?: 'standard' | 'creative-commons';
  recordingDate?: string;
  recordingLocation?: {
    latitude: number;
    longitude: number;
    locationName?: string;
  };

  // Thumbnail
  thumbnailUrl?: string;
  customThumbnailId?: string;

  // Chapters (Timestamps)
  chapters?: VideoChapter[];

  // End Screen Configuration
  endScreenElements?: EndScreenElement[];

  // Comments Settings
  commentSettings?: {
    enabled: boolean;
    moderation: 'all' | 'held' | 'disabled';
    blockedWords?: string[];
  };

  // Timestamps
  dateCreated: string;           // ISO 8601
  dateModified: string;          // ISO 8601
  expiresAt: string;             // ISO 8601 (30 days from last update)

  // State Flags
  isAutoSave: boolean;           // true if auto-saved, false if manual
  isComplete: boolean;           // Ready for publish
  validationErrors?: ValidationError[];
}

export type DraftUploadStatus =
  | 'not_started'     // No file selected yet
  | 'initiated'       // Upload initiated with Bunny.net
  | 'uploading'       // Currently uploading
  | 'paused'          // Upload paused by user
  | 'interrupted'     // Upload interrupted (network/browser)
  | 'completed'       // File upload complete
  | 'processing'      // Video processing in Bunny.net
  | 'ready';          // Ready to publish

export interface VideoChapter {
  timestamp: number;    // Seconds
  title: string;
  titleLocalized?: Record<string, string>;
}

export interface EndScreenElement {
  type: 'video' | 'playlist' | 'subscribe' | 'channel';
  startTime: number;    // Seconds from end
  endTime: number;      // Seconds from end
  position: {
    x: number;          // 0-100 percentage
    y: number;          // 0-100 percentage
    width: number;      // 0-100 percentage
    height: number;     // 0-100 percentage
  };
  targetId?: string;    // Video/playlist/channel ID
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}
```

### 2. Draft List Response

```typescript
export interface DraftListResponse {
  drafts: VideoDraft[];
  cursor?: string;
  hasMore: boolean;
  total: number;
}
```

## API Endpoints

### 1. Create Draft

**POST** `/api/videos/drafts`

```typescript
// Request
{
  title?: string;
  channelId?: string;
  fileMetadata?: {
    name: string;
    size: number;
    type: string;
  };
  // ... any initial metadata
}

// Response
{
  success: true,
  draft: VideoDraft
}
```

### 2. Update Draft (Auto-save)

**PATCH** `/api/videos/drafts/{draftId}`

```typescript
// Request (partial update)
{
  title?: string;
  description?: string;
  tags?: string[];
  uploadProgress?: number;
  tusUploadOffset?: number;
  // ... any fields to update
}

// Response
{
  success: true,
  draft: VideoDraft
}
```

### 3. List User Drafts

**GET** `/api/videos/drafts`

Query parameters:
- `limit`: Number of drafts (default: 10)
- `cursor`: Pagination cursor
- `channelId`: Filter by channel
- `sortBy`: 'dateModified' | 'dateCreated' | 'title'

### 4. Get Draft Details

**GET** `/api/videos/drafts/{draftId}`

Returns complete draft with all metadata.

### 5. Resume Draft Upload

**POST** `/api/videos/drafts/{draftId}/resume`

Generates new TUS upload configuration for resuming.

```typescript
// Response
{
  success: true,
  draft: VideoDraft,
  tusConfig: {
    tusEndpoint: string;
    tusHeaders: object;
    expiresAt: string;
    uploadOffset: number;  // Resume from this byte
  }
}
```

### 6. Convert Draft to Video

**POST** `/api/videos/drafts/{draftId}/publish`

Converts draft to published video.

```typescript
// Request
{
  publishImmediately?: boolean;
  scheduledDate?: string;
}

// Response
{
  success: true,
  videoId: string,
  video: Video
}
```

### 7. Delete Draft

**DELETE** `/api/videos/drafts/{draftId}`

## Storage Implementation

### R2 Bucket Structure

```
drafts/
├── {userId}/
│   ├── {draftId}.json          # Draft metadata
│   └── list.json               # User's draft list (index)
└── thumbnails/
    └── {draftId}/
        └── {thumbnailId}.jpg   # Custom thumbnails
```

### Storage Strategy

1. **Primary Storage**: R2 bucket named `video-drafts`
2. **Key Pattern**: `{userId}/{draftId}.json`
3. **Indexing**: Maintain user draft list at `{userId}/list.json`
4. **Expiration**: Auto-delete drafts after 30 days of inactivity
5. **Thumbnail Storage**: Separate path for draft thumbnails

## Frontend Implementation

### 1. Upload Page Modifications

```typescript
// apps/web/src/components/videoUpload/DraftManager.tsx

export function DraftManager({
  onDraftLoad,
  onDraftSave,
  draftId
}: DraftManagerProps) {
  // Auto-save timer
  useEffect(() => {
    const interval = setInterval(() => {
      if (hasUnsavedChanges) {
        saveDraft();
      }
    }, 30000); // Auto-save every 30 seconds

    return () => clearInterval(interval);
  }, [hasUnsavedChanges]);

  // Save draft on page unload
  useBeforeUnload(() => {
    if (hasUnsavedChanges) {
      saveDraftSync(); // Synchronous save
    }
  });

  return (
    <div className="draft-controls">
      <button onClick={saveDraft}>
        Save Draft
      </button>
      <span className={autoSaveStatus}>
        {lastSaved ? `Last saved: ${formatTime(lastSaved)}` : 'Not saved'}
      </span>
    </div>
  );
}
```

### 2. Draft List Page

```typescript
// apps/web/src/app/[locale]/studio/drafts/page.tsx

export default function DraftsPage() {
  const { drafts, loading } = useDrafts();

  return (
    <div className="drafts-grid">
      {drafts.map(draft => (
        <DraftCard
          key={draft.id}
          draft={draft}
          onResume={() => router.push(`/upload?draft=${draft.id}`)}
          onDelete={() => deleteDraft(draft.id)}
        />
      ))}
    </div>
  );
}
```

### 3. Resume Upload Flow

```typescript
// apps/web/src/components/videoUpload/ResumeUpload.tsx

export function ResumeUpload({ draft }: { draft: VideoDraft }) {
  const { resumeUpload } = useTusResumable();

  const handleResume = async () => {
    // Get new TUS config
    const { tusConfig } = await resumeDraft(draft.id);

    // Resume upload from last position
    await resumeUpload({
      file: selectedFile,
      uploadUrl: tusConfig.tusEndpoint,
      headers: tusConfig.tusHeaders,
      uploadOffset: tusConfig.uploadOffset
    });
  };

  return (
    <div>
      <h3>Resume Upload: {draft.title}</h3>
      <ProgressBar value={draft.uploadProgress} />
      <button onClick={handleResume}>
        Resume from {formatBytes(draft.tusUploadOffset)}
      </button>
    </div>
  );
}
```

## Implementation Tasks

### Phase 1: Backend Infrastructure (Week 1)

- [ ] Create draft TypeScript types in `packages/shared-types/src/draft.ts`
- [ ] Set up R2 bucket `video-drafts` in Cloudflare dashboard
- [ ] Add bucket binding to `wrangler.jsonc`
- [ ] Create `DraftRepository` class extending `R2Repository`
- [ ] Implement draft CRUD endpoints in `apps/api-videos/src/endpoints/draft/`
  - [ ] `createDraft.ts`
  - [ ] `updateDraft.ts`
  - [ ] `listDrafts.ts`
  - [ ] `getDraft.ts`
  - [ ] `deleteDraft.ts`
  - [ ] `resumeDraft.ts`
  - [ ] `publishDraft.ts`
- [ ] Add draft endpoints to main router in `apps/api-videos/src/index.ts`
- [ ] Create draft expiration worker (Cloudflare Cron Trigger)
- [ ] Add authentication middleware for all draft endpoints

### Phase 2: Frontend Integration (Week 1)

- [ ] Create draft API client in `apps/web/src/lib/api/drafts.ts`
- [ ] Add draft React hooks:
  - [ ] `useDrafts()` - List user drafts
  - [ ] `useDraft()` - Single draft operations
  - [ ] `useAutoSave()` - Auto-save functionality
- [ ] Create draft UI components:
  - [ ] `DraftManager` - Save/load controls
  - [ ] `DraftCard` - Draft list item
  - [ ] `DraftIndicator` - Status indicator
- [ ] Modify upload page to support drafts:
  - [ ] Add draft parameter handling
  - [ ] Integrate auto-save
  - [ ] Add manual save button
  - [ ] Show last saved timestamp
- [ ] Create drafts list page at `/studio/drafts`
- [ ] Add drafts link to navigation/sidebar

### Phase 3: Resume Upload Implementation (Week 2)

- [ ] Enhance TUS upload client for resume support
- [ ] Store TUS upload state in draft
- [ ] Implement upload resume logic:
  - [ ] HEAD request to get upload offset
  - [ ] PATCH request to continue upload
- [ ] Add upload pause/resume UI controls
- [ ] Handle browser refresh during upload
- [ ] Test upload recovery scenarios

### Phase 4: Advanced Features (Week 2)

- [ ] Add draft validation:
  - [ ] Required fields checker
  - [ ] Show completion percentage
  - [ ] Validation warnings
- [ ] Implement draft templates:
  - [ ] Save draft as template
  - [ ] Create from template
- [ ] Add draft analytics:
  - [ ] Track draft creation
  - [ ] Track abandonment rate
  - [ ] Track resume success rate
- [ ] Add draft notifications:
  - [ ] Expiration warnings
  - [ ] Resume reminders

### Phase 5: Testing & Polish (Week 2)

- [ ] Unit tests for draft repository
- [ ] API endpoint tests
- [ ] Frontend component tests
- [ ] E2E tests for draft workflows:
  - [ ] Create and save draft
  - [ ] Resume from draft
  - [ ] Auto-save functionality
  - [ ] Draft expiration
- [ ] Performance optimization:
  - [ ] Debounce auto-save
  - [ ] Optimize draft list queries
  - [ ] Lazy load draft details
- [ ] Accessibility improvements
- [ ] RTL/i18n support

## Technical Considerations

### 1. Auto-Save Strategy

- **Debounce Period**: 30 seconds between auto-saves
- **Dirty Tracking**: Only save if changes detected
- **Conflict Resolution**: Last-write-wins with version tracking
- **Offline Support**: Queue saves for when online

### 2. Upload Resume Protocol

Using TUS protocol for resumable uploads:
1. Store upload URL and offset in draft
2. On resume, send HEAD request to get server offset
3. Continue upload from server offset position
4. Update draft progress during upload

### 3. Draft Expiration

- **Default TTL**: 30 days from last modification
- **Warning Email**: Send at 25 days (if email available)
- **Soft Delete**: Move to trash for 7 days before permanent deletion
- **Cleanup Job**: Daily Cloudflare Cron trigger

### 4. Security Considerations

- **Authentication**: All draft operations require JWT
- **Authorization**: Users can only access their own drafts
- **Rate Limiting**: Limit draft creation (10 per day)
- **Size Limits**: Cap total draft storage per user (100 drafts)

### 5. Performance Optimizations

- **Pagination**: List drafts with cursor-based pagination
- **Caching**: Cache draft list in KV for 5 minutes
- **Lazy Loading**: Load draft details on demand
- **Compression**: Gzip draft JSON before R2 storage

## Migration Strategy

1. **Existing Videos**: No migration needed (drafts are new)
2. **Database Schema**: No database (R2 only)
3. **Feature Flag**: Roll out gradually with feature flag
4. **Backward Compatibility**: Upload works without drafts

## Monitoring & Analytics

### Key Metrics

1. **Draft Creation Rate**: Drafts created per day
2. **Draft Completion Rate**: % converted to videos
3. **Average Draft Age**: Time from creation to publish
4. **Resume Success Rate**: % of successful resumes
5. **Auto-Save Performance**: P50/P95/P99 latency
6. **Storage Usage**: Total draft storage size

### Events to Track

```typescript
// Queue events for analytics
{
  type: 'DraftCreated',
  userId: string,
  draftId: string,
  channelId?: string
}

{
  type: 'DraftAutoSaved',
  draftId: string,
  fieldsUpdated: string[]
}

{
  type: 'DraftResumed',
  draftId: string,
  uploadOffset: number
}

{
  type: 'DraftPublished',
  draftId: string,
  videoId: string,
  timeToComplete: number
}

{
  type: 'DraftDeleted',
  draftId: string,
  reason: 'user' | 'expired'
}
```

## Success Criteria

1. **Functional Requirements**:
   - [ ] Users can save video upload as draft
   - [ ] Drafts persist all metadata fields
   - [ ] Upload can be resumed from last byte
   - [ ] Drafts auto-save every 30 seconds
   - [ ] Drafts expire after 30 days

2. **Performance Requirements**:
   - [ ] Auto-save completes in < 500ms (P95)
   - [ ] Draft list loads in < 1 second
   - [ ] Resume upload starts in < 2 seconds

3. **User Experience**:
   - [ ] Clear indication of draft status
   - [ ] Visible last-saved timestamp
   - [ ] Smooth resume experience
   - [ ] No data loss on browser crash

4. **Adoption Metrics**:
   - [ ] 50% of uploads use draft feature
   - [ ] 80% draft completion rate
   - [ ] < 5% draft expiration rate

## Rollback Plan

If issues arise:
1. Disable draft feature flag
2. Hide draft UI components
3. Existing uploads continue normally
4. Preserve draft data for recovery
5. Fix issues and re-enable

## Documentation

### User Documentation
- How to save a draft
- How to resume from draft
- Draft expiration policy
- Auto-save behavior

### Developer Documentation
- Draft API reference
- Draft data model
- TUS resume protocol
- Storage architecture

## Future Enhancements

1. **Collaborative Drafts**: Multiple users edit same draft
2. **Draft Versioning**: History of draft changes
3. **Draft Sharing**: Share draft link for review
4. **Mobile App Support**: Drafts in mobile apps
5. **Bulk Draft Operations**: Select multiple drafts
6. **Draft Analytics Dashboard**: Creator insights
7. **Smart Resume**: Auto-detect file changes
8. **Offline Mode**: Full offline draft support

## References

- TUS Protocol: https://tus.io/protocols/resumable-upload.html
- Bunny.net Stream API: https://docs.bunny.net/reference/video_createvideo
- R2 Storage: https://developers.cloudflare.com/r2/
- Current Upload Architecture: `apps/api-videos/UPLOAD_ARCHITECTURE.md`
- YouTube Feature Comparison: `docs/YOUTUBE_FEATURE_COMPARISON.md`

## Approval

**Prepared By**: System Architect Agent
**Date**: 2025-01-20
**Status**: Ready for Review

---

**Next Steps**:
1. Review and approve implementation plan
2. Create GitHub issues for each task
3. Assign to development team
4. Begin Phase 1 implementation