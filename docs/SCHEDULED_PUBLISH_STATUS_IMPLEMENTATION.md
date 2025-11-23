# Scheduled Publish Status Implementation Plan

## Executive Summary

This document outlines the plan for enabling the `scheduledPublishStatus` field in video filtering within the Al Ummah Now platform. While the field already exists in the shared types (`VideoObject` interface), it's not consistently populated in the API layer's Video schema, causing the schedule filter in `videoSearch.ts` to be commented out. This implementation will ensure all videos have proper scheduling status tracking and enable filtering by scheduled vs published status.

## Current State Analysis

### ✅ What Already Works

1. **Shared Types Schema** (`packages/shared-types/src/video.ts`):
   - `scheduledPublishStatus` field is defined in `VideoObject` interface (line 95)
   - `ScheduledPublishStatus` type is defined with values: 'scheduled', 'publishing', 'published', 'failed', 'cancelled'
   - Related scheduling fields exist: `scheduledPublishDate`, `scheduledPublishTimezone`, `scheduledBy`, `scheduledAt`
   - `VideoScheduleFilter` type exists with values: 'all', 'scheduled', 'published'
   - `VideoListParams` includes `scheduleFilter` property

2. **Scheduling Endpoints** (`apps/api-videos/src/endpoints/video/`):
   - `scheduleCreate.ts` properly sets `scheduledPublishStatus = 'scheduled'` when scheduling videos
   - `scheduleUpdate.ts`, `scheduleDelete.ts`, `scheduleFetch.ts`, `scheduleList.ts` handle scheduled videos
   - Scheduled videos are stored in a separate R2 bucket (`SCHEDULED_VIDEOS`)

3. **Search Endpoint** (`videoSearch.ts`):
   - Schedule filter parameter is accepted and documented
   - Filter logic is written but commented out (lines 184-198)
   - Analytics tracking includes `scheduleFilter` parameter

### ❌ What's Missing

1. **API Layer Video Schema** (`apps/api-videos/src/lib/types.ts`):
   - The `Video` Zod schema doesn't include any scheduling fields
   - No `scheduledPublishStatus`, `scheduledPublishDate`, etc.

2. **Video Creation** (`videoCreate.ts`):
   - Doesn't set `scheduledPublishStatus` field when creating new videos
   - Should default to `undefined` or `null` for regular videos

3. **Video Transformation** (`transformations.ts`):
   - `transformVideoToView` doesn't explicitly handle scheduling fields
   - Fields are passed through via spread operator but not documented

4. **Existing Videos**:
   - Videos created before scheduling implementation won't have `scheduledPublishStatus`
   - Need migration strategy for backward compatibility

## Schema Changes

### 1. Update API Video Schema

**File**: `apps/api-videos/src/lib/types.ts`

```typescript
export const Video = z.object({
    id: Str(),
    title: Str(),
    titleLocalized: z.record(z.string()).optional(),
    description: Str().optional(),
    descriptionLocalized: z.record(z.string()).optional(),
    thumbnailUrl: Str().optional(),
    videoUrl: Str().optional(),
    userId: Str(),
    channelId: Str(),
    dateCreated: DateTime(),
    dateModified: DateTime(),
    views: z.number().default(0),

    // ... existing fields ...

    // Add scheduling fields
    scheduledPublishDate: DateTime().optional(),
    scheduledPublishTimezone: Str().optional(),
    scheduledPublishStatus: z.enum([
        'scheduled',
        'publishing',
        'published',
        'failed',
        'cancelled'
    ]).optional(),
    scheduledBy: Str().optional(),
    scheduledAt: DateTime().optional(),
    publishedViaSchedule: z.boolean().optional(),
    publishedAt: DateTime().optional(),

    // ... rest of fields ...
});
```

### 2. Update VideoView Schema

**File**: `apps/api-videos/src/lib/model/view.ts`

Ensure VideoView includes scheduling fields for client display:

```typescript
export const VideoView = BusinessVideo.extend({
    // ... existing fields ...

    // Ensure scheduling fields are exposed
    scheduledPublishStatus: z.enum([
        'scheduled',
        'publishing',
        'published',
        'failed',
        'cancelled'
    ]).optional(),
    scheduledPublishDate: DateTime().optional(),
    scheduledPublishTimezone: Str().optional(),
});
```

## Step-by-Step Implementation Guide

### Phase 1: Schema Updates (Immediate)

1. **Update API Video Schema** (`src/lib/types.ts`)
   - Add scheduling fields to match shared types
   - Make fields optional for backward compatibility

2. **Update VideoInput Schema** (`src/lib/model/input.ts`)
   - Ensure scheduling fields can be accepted in create/update operations

3. **Build Shared Types**
   ```bash
   pnpm --filter @al-ummah/shared-types build
   ```

### Phase 2: Video Creation Updates

1. **Update `videoCreate.ts`**:
   ```typescript
   const video = {
       ...inputVideo,
       id: crypto.randomUUID(),
       userId: effectiveUserId,
       channelId,
       dateCreated: new Date().toISOString(),
       dateModified: new Date().toISOString(),
       views: 0,

       // Set default scheduling status for new videos
       scheduledPublishStatus: undefined, // or null, indicating not scheduled
       publishedAt: inputVideo.isPublic ? new Date().toISOString() : undefined,

       // ... rest of fields
   };
   ```

2. **Update Video Publishing Logic**:
   - When a scheduled video is published, update `scheduledPublishStatus` to 'published'
   - Set `publishedAt` timestamp
   - Set `publishedViaSchedule = true`

### Phase 3: Enable Schedule Filter

1. **Uncomment Filter Logic in `videoSearch.ts`** (lines 184-198):
   ```typescript
   // Schedule filter
   const scheduledStatus = video.scheduledPublishStatus;
   if (scheduleFilter === "scheduled") {
       // Show only scheduled/publishing videos
       if (!scheduledStatus || (scheduledStatus !== "scheduled" && scheduledStatus !== "publishing")) {
           return false;
       }
   }
   if (scheduleFilter === "published") {
       // Show only published videos or videos without scheduling
       if (scheduledStatus === "scheduled" || scheduledStatus === "publishing") {
           return false;
       }
   }
   ```

2. **Add Null Check for Backward Compatibility**:
   ```typescript
   // Treat videos without scheduledPublishStatus as published
   const effectiveStatus = video.scheduledPublishStatus ||
       (video.isPublic ? 'published' : undefined);
   ```

### Phase 4: Data Migration Strategy

Since this is R2 storage (not a traditional database), we have two options:

#### Option A: Runtime Migration (Recommended)
- Handle missing `scheduledPublishStatus` at read time
- Treat videos without the field as "published" if `isPublic === true`
- Update videos lazily when they're modified

```typescript
// In repository or transformation layer
function normalizeVideo(video: any): VideoObject {
    return {
        ...video,
        // Default scheduling status based on existing fields
        scheduledPublishStatus: video.scheduledPublishStatus ||
            (video.scheduledPublishDate ? 'scheduled' :
             video.isPublic ? 'published' : undefined)
    };
}
```

#### Option B: Batch Migration Script
Create a one-time migration script to update all existing videos:

```typescript
// scripts/migrate-scheduled-status.ts
async function migrateVideos(env: Env) {
    const videoRepo = new R2Repository<VideoObject>(env.videos);
    const videos = await videoRepo.listObjects(1000);

    for (const video of videos.items) {
        if (!video.scheduledPublishStatus) {
            video.scheduledPublishStatus = video.isPublic ? 'published' : undefined;
            video.dateModified = new Date().toISOString();
            await videoRepo.putObject(video.id, video);
        }
    }
}
```

## API Changes

### Affected Endpoints

1. **GET /api/videos/search**
   - Schedule filter will now work correctly
   - No breaking changes to API contract

2. **POST /api/videos**
   - Will set default `scheduledPublishStatus` for new videos
   - No changes to request/response format

3. **POST /api/videos/{id}/schedule**
   - Already sets `scheduledPublishStatus = 'scheduled'`
   - No changes needed

4. **DELETE /api/videos/{id}/schedule**
   - Should update `scheduledPublishStatus` to 'cancelled' or remove it
   - Verify implementation

5. **GET /api/videos/{id}**
   - Will now return `scheduledPublishStatus` in response
   - Non-breaking addition

### Backward Compatibility

- All scheduling fields are optional
- Videos without `scheduledPublishStatus` are treated as published (if public)
- No breaking changes to existing API contracts
- Clients not aware of scheduling will continue to work

## Testing Plan

### Unit Tests

1. **Schema Validation Tests**:
   ```typescript
   describe('Video Schema', () => {
       it('should accept scheduling fields', () => {
           const video = {
               // ... required fields
               scheduledPublishStatus: 'scheduled',
               scheduledPublishDate: '2025-01-25T10:00:00Z'
           };
           expect(Video.parse(video)).toBeDefined();
       });

       it('should work without scheduling fields', () => {
           const video = { /* ... required fields only */ };
           expect(Video.parse(video)).toBeDefined();
       });
   });
   ```

2. **Filter Logic Tests**:
   ```typescript
   describe('Schedule Filter', () => {
       it('should filter scheduled videos', () => {
           // Test with scheduleFilter = 'scheduled'
       });

       it('should filter published videos', () => {
           // Test with scheduleFilter = 'published'
       });

       it('should handle videos without status', () => {
           // Test backward compatibility
       });
   });
   ```

### Integration Tests

1. **Create Video → Schedule → Search**:
   - Create a new video
   - Schedule it for future publication
   - Search with `scheduleFilter=scheduled` and verify it appears
   - Search with `scheduleFilter=published` and verify it doesn't appear

2. **Backward Compatibility Test**:
   - Create video without scheduling (simulate old video)
   - Search with filters and verify correct behavior

3. **Schedule Publishing Flow**:
   - Schedule a video
   - Simulate scheduled publication
   - Verify status changes to 'published'
   - Verify video appears in published filter

### E2E Tests

1. **Scheduled Videos Page** (`/en/scheduled`):
   - Should only show videos with status 'scheduled' or 'publishing'
   - Should not show published videos

2. **Main Videos Page**:
   - Default should show all videos
   - Filter options should work correctly

## Documentation Requirements

### API Documentation Updates

1. **OpenAPI Schema**:
   - Update Video schema to include scheduling fields
   - Document field meanings and possible values

2. **Endpoint Documentation**:
   - Update `/api/videos/search` to explain schedule filter behavior
   - Document default behavior for videos without status

### Developer Guide Updates

1. **Add Scheduling Section** to `DEVELOPER_AUTH_GUIDE.md`:
   - Explain scheduling workflow
   - Document status transitions
   - Provide code examples

2. **Update `TECHNICAL_DOCUMENTATION.md`**:
   - Add scheduling fields to Video model documentation
   - Explain filter behavior with examples

### Migration Guide

Create `SCHEDULING_MIGRATION.md`:
- Explain changes for existing integrations
- Document backward compatibility
- Provide migration examples

## Timeline Estimate

### Week 1 (Immediate - 2-3 days)
- [ ] Day 1: Update schemas in API layer
- [ ] Day 2: Update video creation logic
- [ ] Day 3: Enable schedule filter in search

### Week 2 (Testing - 3-4 days)
- [ ] Day 4-5: Write and run unit tests
- [ ] Day 6: Integration testing
- [ ] Day 7: Fix any issues found

### Week 3 (Documentation & Deployment - 2-3 days)
- [ ] Day 8: Update documentation
- [ ] Day 9: Deploy to staging and test
- [ ] Day 10: Production deployment

### Total Estimated Time: 8-10 working days

## Risk Mitigation

1. **Data Inconsistency Risk**:
   - **Mitigation**: Use runtime normalization to handle missing fields
   - **Fallback**: Can run batch migration if issues arise

2. **Breaking Changes Risk**:
   - **Mitigation**: All new fields are optional
   - **Testing**: Extensive backward compatibility testing

3. **Performance Risk**:
   - **Mitigation**: Schedule filter uses in-memory filtering (current approach)
   - **Future**: Consider indexing strategy for large datasets

4. **Schedule Processing Risk**:
   - **Mitigation**: Separate worker handles scheduled publishing
   - **Monitoring**: Add alerts for failed scheduling operations

## Success Criteria

1. ✅ Schedule filter works correctly in video search
2. ✅ All new videos have appropriate `scheduledPublishStatus`
3. ✅ Existing videos continue to work without issues
4. ✅ Scheduled videos page shows only scheduled content
5. ✅ No breaking changes to existing API consumers
6. ✅ All tests pass (unit, integration, E2E)
7. ✅ Documentation is complete and accurate

## Next Steps

1. **Immediate Action**: Update API Video schema to include scheduling fields
2. **Quick Win**: Enable the commented schedule filter (with null checks)
3. **Follow-up**: Implement comprehensive testing
4. **Long-term**: Consider database indexing for performance at scale

## Appendix: Code Locations

### Files to Modify
- `/apps/api-videos/src/lib/types.ts` - Add scheduling fields to Video schema
- `/apps/api-videos/src/lib/model/input.ts` - Update VideoInput if needed
- `/apps/api-videos/src/lib/model/view.ts` - Ensure VideoView includes fields
- `/apps/api-videos/src/endpoints/video/videoCreate.ts` - Set default status
- `/apps/api-videos/src/endpoints/video/videoSearch.ts` - Uncomment filter (lines 184-198)
- `/apps/api-videos/src/endpoints/video/scheduleDelete.ts` - Update status on cancel

### Files to Review
- `/apps/api-videos/src/lib/transformations.ts` - Verify field handling
- `/apps/api-videos/src/endpoints/video/scheduleUpdate.ts` - Check status updates
- All video update endpoints - Ensure they preserve scheduling fields

### Test Files to Create/Update
- `/apps/api-videos/src/__tests__/video-schema.test.ts`
- `/apps/api-videos/src/__tests__/schedule-filter.test.ts`
- `/apps/api-videos/src/__tests__/video-scheduling.integration.test.ts`