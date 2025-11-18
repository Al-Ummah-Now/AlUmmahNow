# Channel Sections API Documentation

**Complete REST API design for managing channel sections in Al Ummah Now video platform.**

---

## Quick Navigation

| Document | Purpose | Audience |
|----------|---------|----------|
| **[API Design](./CHANNEL_SECTIONS_API_DESIGN.md)** | Complete specification | Architects, Lead Developers |
| **[Quick Reference](./CHANNEL_SECTIONS_QUICK_REFERENCE.md)** | Developer guide | Implementers, API Consumers |
| **[Implementation Example](./CHANNEL_SECTIONS_IMPLEMENTATION_EXAMPLE.ts)** | Working code | Developers |
| **[Summary](./CHANNEL_SECTIONS_SUMMARY.md)** | Executive overview | Product Managers, Stakeholders |

---

## What Are Channel Sections?

Channel sections allow content creators to organize their channel homepage with curated collections of videos, playlists, and channels. Similar to YouTube's channelSections feature.

### Example Use Cases

1. **Featured Videos** - Showcase best content
2. **Recent Uploads** - Latest videos automatically
3. **Popular Uploads** - Most viewed content
4. **Playlists** - Curated series or topics
5. **Subscribed Channels** - Community recommendations

---

## Documentation Overview

### 1. API Design Specification
**File:** [CHANNEL_SECTIONS_API_DESIGN.md](./CHANNEL_SECTIONS_API_DESIGN.md)

**~12,000 words | 6 endpoints | Complete OpenAPI 3.1 schemas**

**Contents:**
- Data models (business, view, input)
- 6 REST endpoints with full specifications:
  - GET `/api/channels/:channelId/sections` - List sections
  - GET `/api/channels/:channelId/sections/:sectionId` - Get single section
  - POST `/api/channels/:channelId/sections` - Create section
  - PUT `/api/channels/:channelId/sections/:sectionId` - Update section
  - DELETE `/api/channels/:channelId/sections/:sectionId` - Delete section
  - PATCH `/api/channels/:channelId/sections/reorder` - Reorder sections
- Request/response examples
- Error handling patterns
- Implementation guide
- Queue events specification
- Testing scenarios

**Best for:** Understanding complete API design, OpenAPI integration, data models.

---

### 2. Quick Reference Guide
**File:** [CHANNEL_SECTIONS_QUICK_REFERENCE.md](./CHANNEL_SECTIONS_QUICK_REFERENCE.md)

**~3,500 words | Tables, checklists, examples**

**Contents:**
- Endpoint summary table
- Section types reference
- Validation rules
- Authorization rules
- Error response examples
- R2 storage structure
- Queue events
- **Implementation checklist (40+ tasks)**
- Testing scenarios
- Performance considerations
- Security guidelines
- Bilingual support

**Best for:** Day-to-day development, quick lookups, implementation planning.

---

### 3. Implementation Examples
**File:** [CHANNEL_SECTIONS_IMPLEMENTATION_EXAMPLE.ts](./CHANNEL_SECTIONS_IMPLEMENTATION_EXAMPLE.ts)

**~800 lines | Working TypeScript code**

**Contents:**
- Complete shared type definitions
- Transformation helper functions
- 4 full endpoint implementations:
  - List sections (GET with pagination)
  - Create section (POST with validation)
  - Update section (PUT with partial updates)
  - Reorder sections (PATCH with atomicity)
- Router registration examples
- Queue event integration
- Authorization helpers

**Best for:** Copy-paste implementation, understanding patterns, code structure.

---

### 4. Executive Summary
**File:** [CHANNEL_SECTIONS_SUMMARY.md](./CHANNEL_SECTIONS_SUMMARY.md)

**~4,000 words | Design decisions, roadmap**

**Contents:**
- Design decisions with rationale
- Alternatives considered
- Implementation roadmap (11-16 hours)
- Testing strategy
- Performance characteristics
- Security considerations
- Future enhancements
- YouTube API compatibility
- Q&A section

**Best for:** Understanding "why" decisions were made, planning, stakeholder review.

---

## API at a Glance

### Endpoints

```http
# Public (optional auth)
GET    /api/channels/:channelId/sections
GET    /api/channels/:channelId/sections/:sectionId

# Authenticated (channel owner only)
POST   /api/channels/:channelId/sections
PUT    /api/channels/:channelId/sections/:sectionId
DELETE /api/channels/:channelId/sections/:sectionId
PATCH  /api/channels/:channelId/sections/reorder
```

### Section Types

| Type | Description | Content |
|------|-------------|---------|
| `featured_videos` | Manually curated videos | Requires `videoIds` array |
| `recent_uploads` | Latest videos from channel | Auto-populated |
| `popular_uploads` | Most viewed videos | Auto-populated |
| `single_playlist` | Videos from one playlist | Requires `playlistId` |
| `multiple_playlists` | Multiple playlists showcase | Requires `playlistIds` array |
| `subscribed_channels` | Channels user subscribes to | Auto-populated |
| `liked_videos` | User's liked videos | Auto-populated |

---

## Quick Start

### For Architects / Lead Developers

1. Read **[API Design](./CHANNEL_SECTIONS_API_DESIGN.md)** - Complete specification
2. Review **[Summary](./CHANNEL_SECTIONS_SUMMARY.md)** - Design decisions
3. Approve or provide feedback
4. Create implementation task/issue

### For Implementers

1. Read **[Quick Reference](./CHANNEL_SECTIONS_QUICK_REFERENCE.md)** - Implementation guide
2. Follow **Implementation Checklist** (40+ tasks)
3. Reference **[Code Examples](./CHANNEL_SECTIONS_IMPLEMENTATION_EXAMPLE.ts)** - Copy patterns
4. Test with **Testing Scenarios** from Quick Reference

### For API Consumers

1. Read **[API Design](./CHANNEL_SECTIONS_API_DESIGN.md)** - Endpoint documentation
2. Check **[Quick Reference](./CHANNEL_SECTIONS_QUICK_REFERENCE.md)** - Request/response examples
3. Use **Swagger UI** at http://127.0.0.1:8686/ (after implementation)
4. Reference **Error Responses** section for troubleshooting

---

## Key Features

### RESTful Design
- Resource-based URLs
- Proper HTTP methods (GET, POST, PUT, PATCH, DELETE)
- Meaningful status codes (200, 201, 400, 401, 403, 404)
- Idempotent operations

### OpenAPI 3.1 Integration
- Complete chanfana schemas
- Interactive Swagger UI
- Request/response validation
- OAuth2 + Bearer token support

### Bilingual Support
- English/Arabic title localization
- Extensible to more languages
- Fallback to default title
- Client-side locale selection

### Authorization
- JWT-based authentication
- Channel ownership verification
- Public/private channel support
- Rate limiting (100 req/min per user)

### Performance
- Cursor-based pagination
- R2 prefix filtering for efficiency
- Atomic bulk operations (reorder)
- Queue-based analytics

---

## Implementation Roadmap

**Estimated time:** 11-16 hours

1. **Foundation** (2-3 hours) - Types, helpers, queue events
2. **Endpoints** (4-6 hours) - 6 endpoint implementations
3. **Integration** (1-2 hours) - Router, auth, OpenAPI
4. **Infrastructure** (30 min) - R2 buckets, wrangler config
5. **Testing** (2-3 hours) - Swagger UI, validation, edge cases
6. **Documentation** (1 hour) - Update roadmap, technical docs
7. **Deployment** (30 min) - Staging → Production

**See [Summary](./CHANNEL_SECTIONS_SUMMARY.md) for detailed breakdown.**

---

## Testing

### Manual Testing (Swagger UI)
- Available at http://127.0.0.1:8686/ after implementation
- OAuth2 authentication configured
- Test all 6 endpoints interactively
- Verify validation errors
- Test authorization

### Automated Testing (if framework available)
- Unit tests: Validation, transformation helpers
- Integration tests: CRUD operations, reordering
- Authorization tests: Owner vs non-owner
- Edge cases: Empty lists, concurrent updates

**See [Quick Reference](./CHANNEL_SECTIONS_QUICK_REFERENCE.md) for complete testing scenarios.**

---

## Security

### Authentication
- JWT Bearer tokens required for CUD operations
- OpenAuth integration
- Token signature verification in production

### Authorization
- Channel ownership verification
- Private channel protection (404 for non-owners)
- No information leakage in errors

### Validation
- Zod schemas for all inputs
- Type-specific content validation
- Max array sizes enforced

### Rate Limiting
- 100 requests/minute per user
- 1000 requests/hour per IP
- Prevents abuse

**See [Summary](./CHANNEL_SECTIONS_SUMMARY.md) for detailed security considerations.**

---

## Storage

### R2 Bucket Structure

```
Bucket: channel-sections (or channel-sections-preview)

Key format: {channelId}/{sectionId}

Example:
  550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440001
  550e8400-e29b-41d4-a716-446655440000/550e8400-e29b-41d4-a716-446655440002

List by channel:
  Prefix: 550e8400-e29b-41d4-a716-446655440000/
```

### Wrangler Configuration

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

---

## Queue Events

Channel section operations trigger analytics events:

| Event | Triggered By | Payload |
|-------|--------------|---------|
| `channel_section_create` | POST /sections | `{ channelId, sectionId, userId, timestamp }` |
| `channel_section_update` | PUT /sections/:id | `{ channelId, sectionId, userId, timestamp }` |
| `channel_section_delete` | DELETE /sections/:id | `{ channelId, sectionId, userId, timestamp }` |
| `channel_section_reorder` | PATCH /sections/reorder | `{ channelId, userId, sectionCount, timestamp }` |

**Processed by:** `apps/processor` (Cloudflare Queue Consumer)

---

## Examples

### Create Featured Videos Section

```bash
curl -X POST https://videos.api.alummahnow.net/api/channels/{channelId}/sections \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "featured_videos",
    "title": "Featured Lectures",
    "titleLocalized": {
      "en": "Featured Lectures",
      "ar": "المحاضرات المميزة"
    },
    "videoIds": ["video-1", "video-2", "video-3"],
    "itemCount": 12
  }'
```

### List Sections

```bash
curl https://videos.api.alummahnow.net/api/channels/{channelId}/sections
```

### Reorder Sections

```bash
curl -X PATCH https://videos.api.alummahnow.net/api/channels/{channelId}/sections/reorder \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "sectionIds": ["section-2", "section-1", "section-3"]
  }'
```

**More examples in [API Design](./CHANNEL_SECTIONS_API_DESIGN.md) and [Quick Reference](./CHANNEL_SECTIONS_QUICK_REFERENCE.md).**

---

## FAQ

### Q: Why not use a database?
**A:** Al Ummah Now uses R2 as primary storage (no traditional database). Consistent with existing architecture.

### Q: How do sections differ from playlists?
**A:** Playlists are collections of videos. Sections organize channel homepage (can include videos, playlists, or channels).

### Q: Can sections be nested?
**A:** No, single-level only. Keeps UX and API simple.

### Q: How many sections per channel?
**A:** Recommended: 5-10. Technical limit: 50 (enforced in reorder).

### Q: YouTube API compatibility?
**A:** Designed for compatibility with YouTube's channelSections API. Easy migration path.

**More Q&A in [Summary](./CHANNEL_SECTIONS_SUMMARY.md).**

---

## Next Steps

1. **Review Design**
   - Read [API Design](./CHANNEL_SECTIONS_API_DESIGN.md)
   - Review [Summary](./CHANNEL_SECTIONS_SUMMARY.md) design decisions
   - Approve or provide feedback

2. **Create Implementation Task**
   - Use [Quick Reference](./CHANNEL_SECTIONS_QUICK_REFERENCE.md) checklist
   - Estimate: 11-16 hours
   - Assign to developer

3. **Begin Implementation**
   - Follow [Implementation Example](./CHANNEL_SECTIONS_IMPLEMENTATION_EXAMPLE.ts)
   - Use checklist from Quick Reference
   - Test after each endpoint

4. **Deploy**
   - Staging first (test thoroughly)
   - Production after smoke tests pass
   - Monitor logs and errors

---

## Document Index

| Document | Size | Purpose |
|----------|------|---------|
| [CHANNEL_SECTIONS_README.md](./CHANNEL_SECTIONS_README.md) | ~2,000 words | This file (index) |
| [CHANNEL_SECTIONS_API_DESIGN.md](./CHANNEL_SECTIONS_API_DESIGN.md) | ~12,000 words | Complete specification |
| [CHANNEL_SECTIONS_QUICK_REFERENCE.md](./CHANNEL_SECTIONS_QUICK_REFERENCE.md) | ~3,500 words | Developer guide |
| [CHANNEL_SECTIONS_IMPLEMENTATION_EXAMPLE.ts](./CHANNEL_SECTIONS_IMPLEMENTATION_EXAMPLE.ts) | ~800 lines | Code examples |
| [CHANNEL_SECTIONS_SUMMARY.md](./CHANNEL_SECTIONS_SUMMARY.md) | ~4,000 words | Executive summary |

**Total documentation:** ~21,500+ words + 800 lines of code

---

## Design Standards

This API design follows:

- ✅ **RESTful conventions** - Resource-based URLs, HTTP methods
- ✅ **OpenAPI 3.1** - Complete chanfana integration
- ✅ **Al Ummah Now patterns** - Consistent with existing APIs
- ✅ **WCAG accessibility** - Bilingual support, clear errors
- ✅ **Security best practices** - JWT auth, rate limiting
- ✅ **YouTube compatibility** - Easy migration from YouTube API

---

## Contact

**Design Date:** 2025-01-18
**Designer:** Claude Code (API Designer Agent)
**Repository:** https://github.com/meywd/AlUmmahNow
**API Documentation:** https://videos.api.alummahnow.net/

**For questions or feedback:**
- Open GitHub issue
- Review design documents
- Contact project maintainers

---

**Happy coding! 🚀**
