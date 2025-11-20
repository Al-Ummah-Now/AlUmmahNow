# ADR-0001: Unified Channel Routing Architecture

## Status
Proposed

## Context

The Al Ummah Now web application currently implements two separate routing systems for channel pages, creating unnecessary complexity and potential maintenance issues:

### Current State
1. **Admin/Owner Route**: `/channel/[id]`
   - Client-side navigation using query parameters (`?tab=videos`, `?tab=playlists`)
   - Full channel management features (edit, settings, tabs management)
   - Redirects non-owners to public view
   - Uses `ChannelProvider` context for state management

2. **Public/Visitor Route**: `/channels/[id]`
   - Server-side route-based navigation (`/channels/[id]/videos`, `/channels/[id]/about`)
   - Read-only public view
   - Standard Next.js App Router patterns
   - No context provider overhead

### Problems
- **Duplication**: Two separate codebases for similar functionality
- **Inconsistent UX**: Different navigation paradigms for owners vs visitors
- **SEO Impact**: Query parameters in admin routes are not SEO-friendly
- **Maintenance Burden**: Changes must be implemented twice
- **Confusing Developer Experience**: Unclear which route to use when
- **State Management Complexity**: Different state patterns for each route

## Decision

Unify both routing systems into a single, route-based architecture under `/channels/[id]/` that serves both public visitors and channel owners with conditional features based on authentication and ownership status.

### Proposed Architecture

```
/channels/[id]/              # Channel home (videos tab)
/channels/[id]/videos        # Videos tab (explicit)
/channels/[id]/playlists     # Playlists tab
/channels/[id]/community     # Community tab
/channels/[id]/about         # About tab
/channels/[id]/live          # Live streams
/channels/[id]/shorts        # Shorts

# Owner-only routes (protected by middleware)
/channels/[id]/edit          # Edit channel profile
/channels/[id]/settings      # Channel settings
/channels/[id]/settings/tabs # Manage tabs
/channels/[id]/analytics     # Channel analytics
/channels/[id]/studio        # Content management
```

### Key Design Principles

1. **Progressive Enhancement**: Base functionality works for all users, enhanced features for owners
2. **Server-First Rendering**: Leverage Next.js 15 App Router for optimal performance
3. **Unified Component Library**: Single set of components with role-based rendering
4. **Consistent Navigation**: All users experience the same navigation paradigm
5. **SEO Optimization**: All public content uses clean, indexable URLs

## Consequences

### Positive
- **Improved SEO**: All channel content becomes properly indexable with clean URLs
- **Simplified Codebase**: Single source of truth for channel functionality
- **Better Performance**: Server-side rendering for initial page loads
- **Consistent UX**: All users navigate channels the same way
- **Easier Testing**: One routing pattern to test instead of two
- **Better Analytics**: Cleaner URL structure for tracking user behavior
- **Future-Proof**: Aligns with Next.js 15 best practices and App Router patterns

### Negative
- **Migration Effort**: Existing links to `/channel/[id]` need redirection
- **Refactoring Required**: Significant code changes to unify components
- **Context Refactoring**: Need to adapt or eliminate `ChannelProvider` pattern
- **Testing Overhead**: Comprehensive testing needed during migration
- **Temporary Duplication**: Both systems must coexist during migration period

## Implementation Plan

### Phase 1: Infrastructure (Week 1)
1. Create unified channel components in `/components/Channel/Unified/`
2. Implement role-based rendering logic using server components
3. Create authentication middleware for owner-only routes
4. Set up server-side data fetching patterns

### Phase 2: Route Implementation (Week 2)
1. Implement new `/channels/[id]/` route structure
2. Port all public tabs (videos, playlists, community, about)
3. Implement owner-only routes (edit, settings, analytics)
4. Add floating action buttons for owners on public routes

### Phase 3: Feature Parity (Week 3)
1. Implement all channel management features in new routes
2. Add tab management functionality
3. Ensure bilingual (EN/AR) support with RTL
4. Implement real-time updates via WebSocket where needed

### Phase 4: Migration (Week 4)
1. Add redirects from old routes to new routes
2. Update all internal links throughout the application
3. Deploy with feature flag for gradual rollout
4. Monitor for issues and performance

### Phase 5: Cleanup (Week 5)
1. Remove old routing code
2. Remove unused components and contexts
3. Update documentation
4. Final testing and optimization

## Migration Strategy

### URL Redirection Map
```typescript
// Permanent redirects (301)
/channel/[id] -> /channels/[id]/
/channel/[id]?tab=videos -> /channels/[id]/videos
/channel/[id]?tab=playlists -> /channels/[id]/playlists
/channel/[id]?tab=community -> /channels/[id]/community
/channel/[id]?tab=about -> /channels/[id]/about
/channel/[id]/edit -> /channels/[id]/edit
/channel/[id]/settings -> /channels/[id]/settings
```

### Backward Compatibility
1. Maintain redirects for 6 months minimum
2. Log redirect usage to track migration completion
3. Notify users of URL changes via in-app messaging
4. Update all external documentation and API responses

### Data Migration
- No data migration required (same API backend)
- Update API responses to return new URL formats
- Ensure WebSocket channels use new route structure

## Security Considerations

### Authentication & Authorization
1. **Middleware Protection**: Implement route middleware to check ownership
   ```typescript
   // middleware.ts
   export function middleware(request: NextRequest) {
     const isOwnerRoute = request.nextUrl.pathname.match(
       /^\/channels\/[^\/]+\/(edit|settings|analytics|studio)/
     );

     if (isOwnerRoute) {
       // Verify JWT token and channel ownership
       return validateChannelOwnership(request);
     }
   }
   ```

2. **Server-Side Validation**: Always verify ownership on the server
   ```typescript
   // In server components
   const isOwner = await verifyChannelOwnership(channelId, userId);
   ```

3. **Client-Side Enhancement**: Progressive enhancement for owner features
   ```typescript
   // Show edit button only for owners
   {isOwner && <EditChannelButton />}
   ```

### Data Access Patterns
- Public data: Cached at edge, no authentication required
- Private data: Always requires valid JWT token
- Owner actions: Additional ownership verification via API

### Rate Limiting
- Implement rate limiting on owner-only routes
- Different limits for public vs authenticated users
- Use Cloudflare's built-in rate limiting

## Alternatives Considered

### Alternative 1: Keep Dual System
**Rejected** because it perpetuates maintenance burden and inconsistent UX.

### Alternative 2: Client-Side Only (SPA)
**Rejected** because it sacrifices SEO and initial load performance.

### Alternative 3: Query Parameter Based
**Rejected** because query parameters are not SEO-friendly and create messy URLs.

### Alternative 4: Subdomain Separation (studio.alummahnow.net)
**Rejected** because it fragments the user experience and complicates authentication.

## Implementation Notes

### Component Structure
```
/components/Channel/
├── Unified/
│   ├── ChannelHeader.tsx      # Shared header with conditional controls
│   ├── ChannelTabs.tsx         # Navigation tabs
│   ├── ChannelContent.tsx     # Main content area
│   ├── OwnerControls.tsx      # Floating action buttons for owners
│   └── rtl/                   # RTL variants
├── Videos/
├── Playlists/
├── Community/
└── About/
```

### Data Fetching Strategy
```typescript
// Server component data fetching
async function ChannelPage({ params }: { params: { id: string } }) {
  const [channel, isOwner] = await Promise.all([
    fetchChannel(params.id),
    checkOwnership(params.id)
  ]);

  return (
    <ChannelLayout channel={channel} isOwner={isOwner}>
      {/* Content */}
    </ChannelLayout>
  );
}
```

### Performance Optimizations
1. Static generation for popular public channels
2. Edge caching for channel metadata
3. Streaming SSR for large video lists
4. Optimistic updates for owner actions

## Success Metrics

1. **Performance**: Initial page load < 1s for public channels
2. **SEO**: 50% increase in indexed channel pages within 3 months
3. **Developer Velocity**: 30% reduction in channel-related bug reports
4. **User Satisfaction**: No increase in support tickets during migration
5. **Code Metrics**: 40% reduction in channel-related code lines

## Review and Approval

- **Author**: System Architect
- **Reviewers**: Frontend Team, API Team, DevOps Team
- **Approval Date**: Pending
- **Implementation Start**: Pending approval

## References

- [Next.js 15 App Router Documentation](https://nextjs.org/docs/app)
- [Cloudflare Workers Sites](https://developers.cloudflare.com/workers/sites/)
- [Web.dev SEO Guide](https://web.dev/learn/seo/)
- [WCAG 2.1 Accessibility Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)