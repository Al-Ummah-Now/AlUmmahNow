# Channel Sections API - Quick Reference

## API Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/channels/:channelId/sections` | GET | Optional | List all sections for a channel |
| `/api/channels/:channelId/sections/:sectionId` | GET | Optional | Get single section details |
| `/api/channels/:channelId/sections` | POST | Required | Create new section |
| `/api/channels/:channelId/sections/:sectionId` | PUT | Required | Update existing section |
| `/api/channels/:channelId/sections/:sectionId` | DELETE | Required | Delete section |
| `/api/channels/:channelId/sections/reorder` | PATCH | Required | Reorder all sections (bulk) |

## Section Types

| Type | Description | Required Fields | Auto-Populated |
|------|-------------|-----------------|----------------|
| `featured_videos` | Manually curated videos | `videoIds` (1-20) | No |
| `recent_uploads` | Latest channel videos | None | Yes |
| `popular_uploads` | Most viewed videos | None | Yes |
| `single_playlist` | Videos from one playlist | `playlistId` | No |
| `multiple_playlists` | Multiple playlists showcase | `playlistIds` (1-10) | No |
| `subscribed_channels` | Channels user subscribes to | None | Yes |
| `liked_videos` | User's liked videos | None | Yes |

## Display Styles

| Style | Description | Best For |
|-------|-------------|----------|
| `horizontal_row` | Single row of thumbnails | Featured content, playlists |
| `vertical_list` | Vertical list with details | Long lists, detailed info |

## Request/Response Examples

### Create Featured Videos Section

**Request:**
```bash
POST /api/channels/{channelId}/sections
Authorization: Bearer {token}
Content-Type: application/json

{
  "type": "featured_videos",
  "title": "Featured Lectures",
  "titleLocalized": {
    "en": "Featured Lectures",
    "ar": "المحاضرات المميزة"
  },
  "videoIds": ["video-1", "video-2", "video-3"],
  "itemCount": 12,
  "showTimestamp": true
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "result": {
    "section": {
      "id": "section-id",
      "channelId": "channel-id",
      "type": "featured_videos",
      "title": "Featured Lectures",
      "position": 0,
      "content": {
        "videoIds": ["video-1", "video-2", "video-3"]
      },
      "dateCreated": "2025-01-18T12:00:00.000Z"
    }
  }
}
```

### List Sections

**Request:**
```bash
GET /api/channels/{channelId}/sections?limit=10
```

**Response (200 OK):**
```json
{
  "success": true,
  "result": {
    "sections": [
      {
        "id": "section-1",
        "type": "featured_videos",
        "title": "Featured Lectures",
        "position": 0
      },
      {
        "id": "section-2",
        "type": "recent_uploads",
        "title": "Recent Uploads",
        "position": 1
      }
    ],
    "pagination": {
      "cursor": "",
      "hasMore": false,
      "total": 2
    }
  }
}
```

### Reorder Sections

**Request:**
```bash
PATCH /api/channels/{channelId}/sections/reorder
Authorization: Bearer {token}
Content-Type: application/json

{
  "sectionIds": ["section-2", "section-1", "section-3"]
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "result": {
    "message": "Sections reordered successfully",
    "sections": [
      { "id": "section-2", "position": 0 },
      { "id": "section-1", "position": 1 },
      { "id": "section-3", "position": 2 }
    ]
  }
}
```

## Error Responses

| Status | Error | When |
|--------|-------|------|
| 400 | Validation failed | Missing required fields, invalid types |
| 401 | Unauthorized | Missing/invalid JWT token |
| 403 | Forbidden | Not channel owner |
| 404 | Not found | Channel/section doesn't exist |
| 409 | Conflict | Duplicate section |
| 422 | Unprocessable | Semantic validation errors |
| 500 | Internal error | Server error |

### Common Error Examples

**Missing required field:**
```json
{
  "success": false,
  "error": "Validation failed",
  "details": [
    {
      "field": "videoIds",
      "message": "featured_videos type requires at least one video ID"
    }
  ]
}
```

**Not channel owner:**
```json
{
  "success": false,
  "error": "You can only create sections for your own channel"
}
```

**Section count mismatch (reorder):**
```json
{
  "success": false,
  "error": "Section count mismatch",
  "details": {
    "expected": 3,
    "provided": 2,
    "missing": ["section-id-3"]
  }
}
```

## Validation Rules

### Section Type Validation

| Type | Must Have | Cannot Have | Max Count |
|------|-----------|-------------|-----------|
| `featured_videos` | `videoIds` (1+) | - | 20 videos |
| `single_playlist` | `playlistId` | - | - |
| `multiple_playlists` | `playlistIds` (1+) | - | 10 playlists |
| `recent_uploads` | - | Content fields | - |
| `popular_uploads` | - | Content fields | - |
| `subscribed_channels` | - | Content fields | - |
| `liked_videos` | - | Content fields | - |

### Field Constraints

| Field | Type | Min | Max | Default |
|-------|------|-----|-----|---------|
| `title` | string | 1 char | 100 chars | Required |
| `position` | integer | 0 | - | Auto-calculated |
| `itemCount` | integer | 1 | 20 | 12 |
| `videoIds` | array | - | 20 items | [] |
| `playlistIds` | array | - | 10 items | [] |
| `channelIds` | array | - | 20 items | [] |

## Authorization Rules

| Action | Required Permission | Notes |
|--------|-------------------|-------|
| List sections | None (public) or Owner (private) | Public channels visible to all |
| Get section | None (public) or Owner (private) | Same as list |
| Create section | Channel owner | User must own the channel |
| Update section | Channel owner | User must own the channel |
| Delete section | Channel owner | User must own the channel |
| Reorder sections | Channel owner | User must own the channel |

## R2 Storage Structure

```
Bucket: channel-sections (or channel-sections-preview)

Key format: {channelId}/{sectionId}

Examples:
  550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440001
  550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440002

List by channel:
  Prefix: {channelId}/
  Example: 550e8400-e29b-41d4-a716-446655440000/
```

## Queue Events

| Event Type | Triggered By | Payload |
|------------|--------------|---------|
| `channel_section_create` | POST /sections | `{ channelId, sectionId, userId, timestamp }` |
| `channel_section_update` | PUT /sections/:id | `{ channelId, sectionId, userId, timestamp }` |
| `channel_section_delete` | DELETE /sections/:id | `{ channelId, sectionId, userId, timestamp }` |
| `channel_section_reorder` | PATCH /sections/reorder | `{ channelId, userId, sectionCount, timestamp }` |

## Implementation Checklist

### Phase 1: Data Models (shared-types)

- [ ] Create `/packages/shared-types/src/channel-section.ts`
  - [ ] `ChannelSection` type
  - [ ] `ChannelSectionView` type
  - [ ] `ChannelSectionCreateInput` type
  - [ ] `ChannelSectionUpdateInput` type
  - [ ] `ChannelSectionReorderInput` type
- [ ] Export from `/packages/shared-types/src/index.ts`
- [ ] Build shared-types: `pnpm --filter @al-ummah/shared-types build`

### Phase 2: API Endpoints (api-videos)

- [ ] Create `/apps/api-videos/src/endpoints/channel-section/` directory
- [ ] Implement `channelSectionList.ts` (GET list)
- [ ] Implement `channelSectionFetch.ts` (GET single)
- [ ] Implement `channelSectionCreate.ts` (POST)
- [ ] Implement `channelSectionUpdate.ts` (PUT)
- [ ] Implement `channelSectionDelete.ts` (DELETE)
- [ ] Implement `channelSectionReorder.ts` (PATCH)

### Phase 3: Transformations (api-videos)

- [ ] Add to `/apps/api-videos/src/lib/transformations.ts`
  - [ ] `transformSectionToView()`
  - [ ] `transformSectionsToView()`
  - [ ] `validateSectionContent()`

### Phase 4: Router Registration (api-videos)

- [ ] Import endpoints in `/apps/api-videos/src/index.ts`
- [ ] Register GET routes (optional auth):
  ```typescript
  openapi.get("/api/channels/:channelId/sections", ChannelSectionsList);
  openapi.get("/api/channels/:channelId/sections/:sectionId", ChannelSectionFetch);
  ```
- [ ] Register auth-required routes:
  ```typescript
  openapi.post("/api/channels/:channelId/sections", ChannelSectionCreate);
  openapi.put("/api/channels/:channelId/sections/:sectionId", ChannelSectionUpdate);
  openapi.delete("/api/channels/:channelId/sections/:sectionId", ChannelSectionDelete);
  openapi.patch("/api/channels/:channelId/sections/reorder", ChannelSectionReorder);
  ```
- [ ] Add auth middleware:
  ```typescript
  app.use('/api/channels/:channelId/sections', (c, next) => {
    if (c.req.method !== 'GET') {
      return authMiddleware(c, next);
    }
    return next();
  });
  ```
- [ ] Add to `authenticatedPaths` array in `/openapi.json` override

### Phase 5: Queue Events (api-videos)

- [ ] Add to `/apps/api-videos/src/lib/queue.ts`:
  ```typescript
  export enum MessageType {
    // ... existing types
    ChannelSectionCreate = 'channel_section_create',
    ChannelSectionUpdate = 'channel_section_update',
    ChannelSectionDelete = 'channel_section_delete',
    ChannelSectionReorder = 'channel_section_reorder',
  }
  ```

### Phase 6: Wrangler Configuration

- [ ] Update `/apps/api-videos/wrangler.jsonc`
  ```jsonc
  {
    "r2_buckets": [
      {
        "binding": "channel_sections",
        "bucket_name": "al-ummah-now-channel-sections",
        "preview_bucket_name": "al-ummah-now-channel-sections-preview"
      }
    ]
  }
  ```

### Phase 7: R2 Bucket Setup (Cloudflare Dashboard)

- [ ] Create production bucket: `al-ummah-now-channel-sections`
- [ ] Create preview bucket: `al-ummah-now-channel-sections-preview`
- [ ] Verify bucket bindings in Cloudflare dashboard

### Phase 8: Testing

- [ ] Test with Swagger UI at http://127.0.0.1:8686/
  - [ ] List sections (public)
  - [ ] Create featured_videos section (auth)
  - [ ] Create recent_uploads section (auth)
  - [ ] Update section (auth)
  - [ ] Reorder sections (auth)
  - [ ] Delete section (auth)
- [ ] Test authorization:
  - [ ] Verify 401 without token
  - [ ] Verify 403 for non-owner
  - [ ] Verify owner can modify
- [ ] Test validation:
  - [ ] Missing required fields
  - [ ] Invalid section types
  - [ ] Empty videoIds for featured_videos
  - [ ] Reorder with missing IDs
- [ ] Test edge cases:
  - [ ] Channel with no sections
  - [ ] Channel with 50+ sections
  - [ ] Reorder single section
  - [ ] Delete last section

### Phase 9: Processor Integration (processor app)

- [ ] Update `/apps/processor/src/handler.ts` to handle new event types:
  ```typescript
  case 'channel_section_create':
  case 'channel_section_update':
  case 'channel_section_delete':
  case 'channel_section_reorder':
    // Save to R2 messages bucket
    break;
  ```
- [ ] Test queue message processing

### Phase 10: Documentation

- [ ] Update `/apps/api-videos/ROADMAP.md`
- [ ] Update `/apps/api-videos/TECHNICAL_DOCUMENTATION.md`
- [ ] Add usage examples to API docs
- [ ] Document queue events in processor README

### Phase 11: Deployment

- [ ] Type check: `npx tsc --noEmit`
- [ ] Dry-run deploy: `npx wrangler deploy --dry-run`
- [ ] Deploy to staging
- [ ] Run smoke tests on staging
- [ ] Deploy to production
- [ ] Monitor logs and errors

## Testing Scenarios

### Scenario 1: Channel Owner Creates Sections

```bash
# 1. Create featured videos section
POST /api/channels/{channelId}/sections
{
  "type": "featured_videos",
  "title": "Featured",
  "videoIds": ["v1", "v2"]
}
# Expected: 201 Created, position = 0

# 2. Create recent uploads section
POST /api/channels/{channelId}/sections
{
  "type": "recent_uploads",
  "title": "Recent"
}
# Expected: 201 Created, position = 1

# 3. List sections
GET /api/channels/{channelId}/sections
# Expected: 200 OK, 2 sections ordered by position
```

### Scenario 2: Non-Owner Attempts Modification

```bash
# 1. Attempt to create section (wrong token)
POST /api/channels/{channelId}/sections
# Expected: 403 Forbidden

# 2. Attempt to delete section (wrong token)
DELETE /api/channels/{channelId}/sections/{sectionId}
# Expected: 403 Forbidden
```

### Scenario 3: Validation Errors

```bash
# 1. Create featured_videos without videoIds
POST /api/channels/{channelId}/sections
{
  "type": "featured_videos",
  "title": "Featured"
}
# Expected: 400 Bad Request, details array with error

# 2. Reorder with wrong count
PATCH /api/channels/{channelId}/sections/reorder
{
  "sectionIds": ["section-1"]
}
# Expected: 400 Bad Request, count mismatch error
```

### Scenario 4: Reorder Sections

```bash
# 1. Create 3 sections
POST /api/channels/{channelId}/sections (3 times)
# Expected: positions 0, 1, 2

# 2. Reorder
PATCH /api/channels/{channelId}/sections/reorder
{
  "sectionIds": ["section-3", "section-1", "section-2"]
}
# Expected: 200 OK, new positions 0, 1, 2

# 3. Verify order
GET /api/channels/{channelId}/sections
# Expected: sections in new order
```

## Performance Considerations

### R2 List Operations

- **Prefix filtering**: Use `{channelId}/` prefix for efficient listing
- **Pagination**: Default limit = 20, max = 50
- **Cursor-based**: Use cursors for large result sets

### Caching Strategy

- **Client-side**: Cache section list for 5 minutes
- **CDN**: Cache public channel sections for 10 minutes
- **Invalidation**: Clear cache on create/update/delete/reorder

### Rate Limiting

- **Per-user**: 100 requests/minute
- **Per-IP**: 1000 requests/hour
- **Burst**: 10 requests/second

## Security Considerations

1. **Authorization**: Always verify channel ownership before modifications
2. **Input validation**: Sanitize all user inputs with Zod schemas
3. **Content validation**: Verify referenced videos/playlists exist
4. **Rate limiting**: Prevent abuse with per-user limits
5. **Privacy**: Respect channel privacy settings (public vs private)
6. **CORS**: Configured for cross-origin requests
7. **JWT validation**: Enforce token signature verification in production

## Bilingual Support

### Title Localization

```typescript
{
  "title": "Featured Videos",           // Default (fallback)
  "titleLocalized": {
    "en": "Featured Videos",            // English
    "ar": "الفيديوهات المميزة"          // Arabic (RTL)
  }
}
```

### Frontend Display Logic

```typescript
// Client-side: Select title based on current locale
const getLocalizedTitle = (section, locale) => {
  return section.titleLocalized?.[locale] || section.title;
};

// Example usage
const title = getLocalizedTitle(section, 'ar'); // Returns Arabic title
```

## Migration from Existing Systems

If migrating from YouTube channelSections API:

| YouTube Field | Al Ummah Field | Notes |
|---------------|----------------|-------|
| `snippet.type` | `type` | Same enum values |
| `snippet.title` | `title` | Direct mapping |
| `snippet.position` | `position` | Direct mapping |
| `contentDetails.playlists` | `playlistIds` | Array of IDs |
| `contentDetails.channels` | `channelIds` | Array of IDs |
| `snippet.localized` | `titleLocalized` | Map to object |

---

**For complete API design documentation, see:** `CHANNEL_SECTIONS_API_DESIGN.md`
