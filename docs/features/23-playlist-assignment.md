# Playlist Assignment During Upload - Implementation Plan

**Feature ID**: 23
**Priority**: MEDIUM
**Status**: PLANNED
**Created**: 2025-01-20
**Target Release**: Phase 2 (Q2 2025)

## Executive Summary

Implement the ability for users to assign videos to playlists during the upload process, including the ability to create new playlists on-the-fly and assign videos to multiple playlists simultaneously. This feature brings Al Ummah Now closer to YouTube's upload workflow parity.

## Feature Requirements

### Functional Requirements

1. **Playlist Selection During Upload**
   - Display user's existing playlists in upload form
   - Allow selection of multiple playlists
   - Show playlist preview (thumbnail, video count)
   - Search/filter playlists by name

2. **Create New Playlist Option**
   - "Create new playlist" button in playlist selector
   - Modal dialog for quick playlist creation
   - Minimal fields: name, description, privacy
   - Immediate availability after creation

3. **Multiple Playlist Assignment**
   - Checkbox selection for multiple playlists
   - Visual indication of selected playlists
   - No limit on number of playlists per video
   - Order preservation (first selected = primary playlist)

### Non-Functional Requirements

- **Performance**: Playlist loading < 500ms
- **Scalability**: Support users with 100+ playlists
- **Accessibility**: WCAG 2.1 AA compliant
- **Localization**: Full RTL support for Arabic

## Architecture Design

### Data Model Updates

#### Video Model Extension
```typescript
// packages/shared-types/src/video.ts
export interface VideoObject {
  // ... existing fields
  playlistIds?: string[];  // Array of playlist IDs
  primaryPlaylistId?: string;  // First assigned playlist
}
```

#### Upload Initiation Request
```typescript
// Update in uploadInitiate endpoint
interface UploadInitiateRequest {
  // ... existing fields
  playlistIds?: string[];  // Playlist assignments
}
```

### API Design

#### 1. Get User Playlists (Existing - Enhance)
```
GET /api/playlists
Headers:
  Authorization: Bearer {token}
Query Parameters:
  userId: string
  limit: number (default: 50)
  cursor?: string
  sortBy: 'dateCreated' | 'name' | 'videosCount'
Response:
  {
    success: true,
    result: {
      playlists: PlaylistView[],
      cursor: string | null
    }
  }
```

#### 2. Create Playlist (Existing - Enhance for Quick Create)
```
POST /api/playlists
Headers:
  Authorization: Bearer {token}
Body:
  {
    title: string,
    description?: string,
    isPublic: boolean,
    returnSimplified?: boolean  // For quick create response
  }
Response:
  {
    success: true,
    result: {
      playlist: PlaylistView | SimplifiedPlaylist
    }
  }
```

#### 3. Add Video to Playlists (New Batch Endpoint)
```
POST /api/videos/{videoId}/playlists
Headers:
  Authorization: Bearer {token}
Body:
  {
    playlistIds: string[]
  }
Response:
  {
    success: true,
    result: {
      added: string[],  // Successfully added playlist IDs
      failed: Array<{playlistId: string, reason: string}>
    }
  }
```

### Component Architecture

```
VideoUpload/
├── index.tsx                    # Main upload component
├── PlaylistSelector/            # New component
│   ├── index.tsx               # Playlist selector container
│   ├── PlaylistList.tsx        # List of playlists with checkboxes
│   ├── PlaylistSearch.tsx      # Search/filter component
│   ├── CreatePlaylistModal.tsx # Quick create dialog
│   └── types.ts                # Component types
└── rtl/                         # RTL variants
    └── PlaylistSelector/
        └── index.tsx
```

## Implementation Plan

### Phase 1: Backend Foundation (3 days)

#### Day 1: API Updates
- [ ] Update `uploadInitiate` endpoint to accept `playlistIds`
- [ ] Create batch playlist assignment endpoint
- [ ] Update video model in shared-types
- [ ] Add playlist assignment to upload complete flow

#### Day 2: Repository & Queue Updates
- [ ] Update R2Repository for batch playlist operations
- [ ] Add queue message type for playlist assignments
- [ ] Update processor to handle playlist assignment events
- [ ] Add error handling for invalid playlist IDs

#### Day 3: Testing & Documentation
- [ ] Write API tests for new endpoints
- [ ] Update OpenAPI documentation
- [ ] Test batch operations with multiple playlists
- [ ] Verify permission checks (user owns playlists)

### Phase 2: Frontend UI Components (5 days)

#### Day 4-5: Playlist Selector Component
- [ ] Create `PlaylistSelector` component structure
- [ ] Implement playlist loading with pagination
- [ ] Add checkbox selection with state management
- [ ] Implement search/filter functionality
- [ ] Add loading states and error handling

#### Day 6: Create Playlist Modal
- [ ] Design and implement `CreatePlaylistModal`
- [ ] Add form validation (Zod schemas)
- [ ] Integrate with playlist creation API
- [ ] Update parent selector on successful creation
- [ ] Add success/error notifications

#### Day 7: RTL Support
- [ ] Create RTL variant of PlaylistSelector
- [ ] Create RTL variant of CreatePlaylistModal
- [ ] Test Arabic text alignment and layout
- [ ] Verify checkbox positioning in RTL mode

#### Day 8: Integration with Upload Form
- [ ] Add PlaylistSelector to upload form
- [ ] Position after metadata fields, before visibility
- [ ] Wire up state management
- [ ] Pass selected playlists to upload initiation
- [ ] Update form validation

### Phase 3: Polish & Testing (2 days)

#### Day 9: UI Polish
- [ ] Add animations for modal open/close
- [ ] Implement skeleton loading for playlists
- [ ] Add tooltips for playlist info
- [ ] Optimize for mobile responsive design
- [ ] Add keyboard navigation support

#### Day 10: End-to-End Testing
- [ ] Test complete upload flow with playlists
- [ ] Test playlist creation during upload
- [ ] Test multiple playlist selection
- [ ] Test error scenarios (network, permissions)
- [ ] Performance testing with many playlists

## Detailed Component Specifications

### PlaylistSelector Component

```typescript
interface PlaylistSelectorProps {
  userId: string;
  selectedPlaylists: string[];
  onPlaylistsChange: (playlistIds: string[]) => void;
  disabled?: boolean;
  className?: string;
}

interface PlaylistItemProps {
  playlist: PlaylistView;
  isSelected: boolean;
  onToggle: (playlistId: string) => void;
  disabled?: boolean;
}
```

**Features:**
- Virtualized list for performance (100+ playlists)
- Lazy loading with intersection observer
- Local search filtering (instant)
- Sort options: Recent, Alphabetical, Video Count
- Thumbnail preview on hover
- Video count badge

### CreatePlaylistModal Component

```typescript
interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (playlist: PlaylistView) => void;
  userId: string;
  channelId: string;
}

interface CreatePlaylistFormData {
  title: string;
  titleAr?: string;
  description?: string;
  descriptionAr?: string;
  isPublic: boolean;
}
```

**Features:**
- Minimal form for quick creation
- Bilingual support with tabs
- Auto-focus on title field
- Enter key to submit
- Escape key to cancel
- Loading state during creation

### Upload Form Integration

```typescript
// Update VideoMetadata interface
interface VideoMetadata {
  // ... existing fields
  playlistIds: string[];  // Selected playlist IDs
}

// Update uploadInitiate call
const initiateResult = await initiateVideoUpload(
  {
    // ... existing fields
    playlistIds: metadata.playlistIds,
  },
  userId,
  channelId
);
```

## UI/UX Design

### Desktop Layout
```
┌─────────────────────────────────────────┐
│ Video Details                           │
├─────────────────────────────────────────┤
│ Title: [___________________________]    │
│                                         │
│ Description: [_____________________]    │
│              [_____________________]    │
│                                         │
│ Tags: [___________________________]     │
│                                         │
│ ▼ Add to Playlists (Optional)          │
│ ┌─────────────────────────────────┐    │
│ │ 🔍 Search playlists...          │    │
│ ├─────────────────────────────────┤    │
│ │ □ Islamic Lectures              │    │
│ │   12 videos • Public            │    │
│ │ ☑ Ramadan 2024                  │    │
│ │   5 videos • Public             │    │
│ │ □ Private Collection            │    │
│ │   3 videos • Private            │    │
│ │ ─────────────────────────────   │    │
│ │ + Create new playlist           │    │
│ └─────────────────────────────────┘    │
│                                         │
│ □ Make video public                     │
│                                         │
│ [Upload Video] [Cancel]                 │
└─────────────────────────────────────────┘
```

### Mobile Layout
```
┌──────────────────┐
│ Add to Playlists │
├──────────────────┤
│ [+] Create new   │
├──────────────────┤
│ □ Lectures       │
│ ☑ Ramadan 2024   │
│ □ Private        │
│ [Show more...]   │
└──────────────────┘
```

### Create Playlist Modal
```
┌─────────────────────────────────┐
│ Create New Playlist        [X] │
├─────────────────────────────────┤
│ Name *                          │
│ [_____________________________] │
│                                 │
│ Description                     │
│ [_____________________________] │
│ [_____________________________] │
│                                 │
│ Privacy                         │
│ ○ Public                        │
│ ● Private                       │
│                                 │
│ [Create] [Cancel]               │
└─────────────────────────────────┘
```

## Files to Create/Modify

### New Files to Create

```
apps/web/src/components/videoUpload/PlaylistSelector/
├── index.tsx                    # Main selector component
├── PlaylistList.tsx            # Playlist items with checkboxes
├── PlaylistSearch.tsx          # Search/filter bar
├── CreatePlaylistModal.tsx     # Quick create modal
├── PlaylistItem.tsx            # Individual playlist row
├── types.ts                    # Component types
└── utils.ts                    # Helper functions

apps/web/src/components/videoUpload/rtl/PlaylistSelector/
└── index.tsx                   # RTL variant

apps/api-videos/src/endpoints/video/
└── addToPlaylists.ts          # Batch playlist assignment

apps/web/src/lib/api/
└── playlists.ts               # Playlist API client functions
```

### Files to Modify

```
# Shared Types
packages/shared-types/src/video.ts
  - Add playlistIds field to VideoObject
  - Add primaryPlaylistId field

packages/shared-types/src/playlist.ts
  - Add SimplifiedPlaylist type for quick responses

# API Endpoints
apps/api-videos/src/endpoints/video/uploadInitiate.ts
  - Accept playlistIds in request body
  - Store playlist assignments in metadata

apps/api-videos/src/endpoints/video/uploadComplete.ts
  - Process playlist assignments after upload
  - Add videos to specified playlists

apps/api-videos/src/endpoints/playlist/playlistCreate.ts
  - Add returnSimplified option for quick create

# Frontend Components
apps/web/src/components/videoUpload/index.tsx
  - Import and integrate PlaylistSelector
  - Add playlistIds to metadata state
  - Pass playlist IDs to upload initiation

# Translations
apps/web/src/lib/i18n/translations/en.ts
  - Add playlist selector translations
  - Add create playlist modal translations

apps/web/src/lib/i18n/translations/ar.ts
  - Add Arabic translations

# Styles (if needed)
apps/web/src/styles/upload.css
  - Add playlist selector styles
  - Add modal animations
```

## Testing Strategy

### Unit Tests

```typescript
// PlaylistSelector.test.tsx
describe('PlaylistSelector', () => {
  it('loads user playlists on mount');
  it('handles playlist selection/deselection');
  it('filters playlists by search term');
  it('opens create playlist modal');
  it('updates selection after playlist creation');
  it('handles loading and error states');
});

// CreatePlaylistModal.test.tsx
describe('CreatePlaylistModal', () => {
  it('validates required fields');
  it('creates playlist on submit');
  it('closes on success');
  it('shows error messages');
  it('supports keyboard shortcuts');
});
```

### Integration Tests

```typescript
// upload-with-playlists.spec.ts
describe('Video Upload with Playlists', () => {
  it('completes upload with single playlist');
  it('completes upload with multiple playlists');
  it('creates new playlist during upload');
  it('handles playlist assignment failures gracefully');
  it('preserves playlist order');
});
```

### E2E Tests

```typescript
// e2e/upload-playlist-flow.spec.ts
test('Upload video to existing playlist', async ({ page }) => {
  // 1. Navigate to upload page
  // 2. Select video file
  // 3. Fill metadata
  // 4. Select existing playlist
  // 5. Complete upload
  // 6. Verify video appears in playlist
});

test('Create playlist during upload', async ({ page }) => {
  // 1. Navigate to upload page
  // 2. Select video file
  // 3. Click "Create new playlist"
  // 4. Fill playlist details
  // 5. Complete upload
  // 6. Verify new playlist created with video
});
```

## Performance Considerations

### Optimization Strategies

1. **Virtualization**
   - Use react-window for playlist list (100+ items)
   - Render only visible items
   - Estimated improvement: 80% reduction in render time

2. **Lazy Loading**
   - Load playlists in batches of 20
   - Implement infinite scroll
   - Preload next page on scroll

3. **Caching**
   - Cache playlist data in memory
   - Invalidate on playlist CRUD operations
   - Use SWR or React Query for cache management

4. **Debouncing**
   - Debounce search input (300ms)
   - Prevent excessive filtering operations

### Performance Metrics

- **Initial Load**: < 500ms for first 20 playlists
- **Search Response**: < 100ms (local filtering)
- **Create Playlist**: < 1 second
- **Batch Assignment**: < 2 seconds for 10 playlists

## Security Considerations

### Authorization Checks

1. **Playlist Ownership**
   - Verify user owns playlists before assignment
   - Return 403 for unauthorized playlist IDs
   - Log suspicious activity

2. **Rate Limiting**
   - Max 10 playlist creations per hour
   - Max 100 playlist assignments per hour
   - Implement at API Gateway level

3. **Input Validation**
   - Validate all playlist IDs are valid UUIDs
   - Sanitize playlist titles and descriptions
   - Limit description length (1000 chars)

### Data Privacy

- Private playlists only visible to owner
- No playlist information leaked in errors
- Audit log for playlist modifications

## Rollout Strategy

### Feature Flags

```typescript
// Feature flag configuration
const features = {
  playlistAssignmentDuringUpload: {
    enabled: process.env.ENABLE_PLAYLIST_ASSIGNMENT === 'true',
    rolloutPercentage: 10, // Start with 10% of users
  }
};
```

### Phased Rollout

1. **Week 1**: Internal testing (team only)
2. **Week 2**: 10% of users (collect feedback)
3. **Week 3**: 50% of users (monitor metrics)
4. **Week 4**: 100% rollout

### Success Metrics

- **Adoption Rate**: 40% of uploads use playlists within 30 days
- **Creation Rate**: 20% of users create playlists during upload
- **Error Rate**: < 0.1% failed playlist assignments
- **Performance**: 95th percentile < 1 second

## Migration & Backward Compatibility

### Database Migration

No database migration needed (R2 object storage).
Videos uploaded before this feature will have:
- `playlistIds: undefined` or `[]`
- No impact on existing functionality

### API Versioning

- New fields are optional in upload API
- Existing clients continue to work
- No breaking changes to existing endpoints

## Accessibility Requirements

### WCAG 2.1 AA Compliance

1. **Keyboard Navigation**
   - Tab through all playlists
   - Space to select/deselect
   - Enter to create new playlist
   - Escape to close modal

2. **Screen Reader Support**
   - Proper ARIA labels on checkboxes
   - Announce selection changes
   - Modal dialog announcements
   - Error message associations

3. **Visual Indicators**
   - Focus indicators on all interactive elements
   - Selected state clearly visible
   - Loading states announced
   - Error states with icons and color

### RTL Support

- Mirror checkbox positions
- Right-align text in Arabic mode
- Reverse playlist item layout
- Test with Arabic screen readers

## Documentation Updates

### User Documentation

1. **Help Center Article**
   - "How to add videos to playlists during upload"
   - Screenshots for each step
   - Video tutorial

2. **FAQ Updates**
   - "Can I add videos to multiple playlists?"
   - "How do I create a playlist while uploading?"
   - "Why can't I see my playlists?"

### Developer Documentation

1. **API Documentation**
   - Update OpenAPI specs
   - Add playlist assignment examples
   - Document error codes

2. **Component Storybook**
   - Add PlaylistSelector stories
   - Add CreatePlaylistModal stories
   - Interactive examples

## Risk Assessment

### Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Performance degradation with many playlists | High | Medium | Implement virtualization early |
| Race conditions in batch assignment | Medium | Low | Use transactions/locks |
| Modal accessibility issues | Medium | Medium | Thorough testing with screen readers |
| RTL layout bugs | Low | Medium | Dedicated RTL testing phase |

### Business Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Low adoption rate | Medium | Medium | User education, prominent UI |
| Increased support tickets | Low | Low | Comprehensive help docs |
| Feature complexity | Medium | Low | Progressive disclosure, simple defaults |

## Dependencies

### External Dependencies
- None (all functionality self-contained)

### Internal Dependencies
- Existing playlist API endpoints (already implemented)
- Authentication system (already integrated)
- R2 storage (already configured)

## Timeline & Milestones

| Milestone | Duration | Deliverables |
|-----------|----------|--------------|
| Backend Foundation | 3 days | APIs, data models, tests |
| Frontend Components | 5 days | UI components, RTL support |
| Integration | 2 days | Upload form integration, E2E tests |
| Testing & Polish | 2 days | Bug fixes, performance optimization |
| Documentation | 1 day | User docs, API docs |
| **Total** | **13 days** | **Feature complete** |

## Success Criteria

### Definition of Done

- [ ] All API endpoints implemented and tested
- [ ] Frontend components fully functional
- [ ] RTL support complete
- [ ] Accessibility audit passed
- [ ] Performance benchmarks met
- [ ] Documentation complete
- [ ] E2E tests passing
- [ ] Feature flag configured
- [ ] Deployed to staging

### Launch Criteria

- [ ] 0 critical bugs
- [ ] < 5 minor bugs
- [ ] Performance metrics within targets
- [ ] Accessibility compliance verified
- [ ] Documentation published
- [ ] Support team trained
- [ ] Rollback plan ready

## Future Enhancements

### Phase 2 Features (Not in scope)
1. **Smart Playlist Suggestions**
   - ML-based playlist recommendations
   - Auto-categorization based on content

2. **Playlist Templates**
   - Pre-defined playlist structures
   - Series detection and auto-playlist creation

3. **Collaborative Playlists**
   - Multi-user playlist management
   - Contributor permissions

4. **Playlist Analytics**
   - View counts per playlist
   - Engagement metrics
   - Playlist performance dashboard

## Conclusion

The Playlist Assignment During Upload feature is a medium-complexity enhancement that significantly improves the content creator experience on Al Ummah Now. By allowing playlist management during the upload flow, we reduce friction and bring the platform closer to YouTube's functionality while maintaining our Islamic content focus.

The implementation leverages existing playlist infrastructure, minimizing new backend work while focusing on a polished frontend experience. With proper planning, testing, and phased rollout, this feature can be delivered in approximately 2-3 weeks with minimal risk.

## References

- [YouTube Feature Comparison Document](/docs/YOUTUBE_FEATURE_COMPARISON.md)
- [Playlist API Documentation](/apps/api-videos/TECHNICAL_DOCUMENTATION.md#playlists)
- [Upload Architecture](/docs/architecture/video-upload-architecture.md)
- [R2 Repository Pattern](/apps/api-videos/src/lib/r2Repo.ts)

---

**Document Version**: 1.0
**Last Updated**: 2025-01-20
**Author**: System Architect
**Status**: APPROVED FOR IMPLEMENTATION