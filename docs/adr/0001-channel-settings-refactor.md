# ADR-001: Channel Settings Navigation Architecture Refactoring

## Status
Proposed

## Context
The current Channel Settings implementation in the Al Ummah Now platform has several architectural issues that impact user experience, maintainability, and scalability:

1. **Inconsistent Navigation**: The edit page (`/edit`) is a sibling route but serves as the main content for "General Settings"
2. **No Shared Layout**: Each settings page implements its own header and navigation independently
3. **Mixed Rendering Patterns**: Server components mixed with client components without clear strategy
4. **Duplicate Data Fetching**: Channel data is fetched separately in each page
5. **Missing Breadcrumbs**: No clear navigation hierarchy for users
6. **Confusing URL Structure**: `/edit` doesn't clearly indicate it's the general settings page

These issues lead to:
- Poor user experience with unclear navigation paths
- Code duplication across settings pages
- Unnecessary API calls and loading states
- Maintenance overhead when updating navigation
- Difficulty adding new settings sections

## Decision
We will refactor the Channel Settings architecture with the following changes:

### 1. Restructure Routes with Clear Hierarchy
```
/settings/channel/[id]/
├── layout.tsx          # Shared layout with tab navigation
├── page.tsx           # Redirects to /general
├── general/          # General settings (rename from /edit)
├── videos/           # Video management
├── tabs/             # Channel tabs config
├── sections/         # Channel sections
└── community/        # Community settings
```

### 2. Implement Shared Layout Component
Create a layout that provides:
- Consistent header with channel info
- Tab-based navigation
- Breadcrumb trail
- Shared data fetching via React Server Components
- Consistent loading/error states

### 3. Standardize on Server Components
- Use Server Components for all settings pages
- Fetch channel data once in layout
- Pass data down via React context or props
- Use Client Components only for interactive elements

### 4. Create Reusable Components
- `ChannelSettingsHeader`: Channel avatar, name, stats
- `SettingsNavigation`: Tab navigation with active state
- `SettingsBreadcrumbs`: Contextual breadcrumb trail
- `SettingsCard`: Consistent card layout for settings sections
- `SettingsFormWrapper`: Shared form validation and submission

### 5. Implement Data Caching Strategy
- Cache channel data at layout level
- Use React Server Components data streaming
- Implement optimistic updates for settings changes
- Add proper cache invalidation

## Consequences

### Positive
- **Improved UX**: Clear navigation hierarchy with breadcrumbs
- **Better Performance**: Single data fetch, shared across pages
- **Maintainability**: DRY principle, single source of truth for navigation
- **Scalability**: Easy to add new settings sections
- **Type Safety**: Shared types across all settings pages
- **Consistency**: Uniform UI/UX across settings
- **SEO Friendly**: Server-rendered content with proper URLs

### Negative
- **Migration Effort**: Need to refactor existing pages
- **URL Changes**: Breaking change for existing bookmarks/links
- **Learning Curve**: Team needs to understand new structure
- **Testing Updates**: E2E tests need updating for new routes

### Mitigation Strategies
1. **Redirects**: Add redirects from old URLs to new structure
2. **Gradual Migration**: Implement new structure alongside old, deprecate gradually
3. **Documentation**: Create migration guide for developers
4. **Feature Flag**: Use feature flag to toggle between old/new structure

## Alternatives Considered

### 1. Keep Current Structure with Minor Fixes
- **Pros**: No breaking changes, quick implementation
- **Cons**: Doesn't address fundamental architecture issues
- **Rejected**: Technical debt would compound over time

### 2. Single Page Application (SPA) Approach
- **Pros**: No page refreshes, smooth transitions
- **Cons**: Complex state management, poor SEO, larger bundle
- **Rejected**: Goes against Next.js 15 best practices

### 3. Modal-Based Settings
- **Pros**: Everything in one page, no navigation needed
- **Cons**: Poor accessibility, limited screen space, hard to deep-link
- **Rejected**: Not suitable for complex settings with multiple sections

## Implementation Notes

### Phase 1: Create New Structure (Week 1)
1. Create layout.tsx with shared navigation
2. Implement general settings page (move edit content)
3. Add breadcrumb component
4. Setup data fetching in layout

### Phase 2: Migrate Existing Pages (Week 2)
1. Update videos page to use new layout
2. Move other settings to new structure
3. Add redirects from old routes
4. Update all internal links

### Phase 3: Enhancement (Week 3)
1. Add loading skeletons
2. Implement optimistic updates
3. Add keyboard navigation
4. Create settings search

### File Structure Example

```typescript
// apps/web/src/app/[locale]/settings/channel/[id]/layout.tsx
export default async function ChannelSettingsLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: { id: string; locale: string };
}) {
  const channel = await getChannelById(params.id);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <ChannelSettingsHeader channel={channel} />
      <SettingsNavigation channelId={params.id} locale={params.locale} />
      <SettingsBreadcrumbs />
      <main className="container mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
```

### Migration Checklist
- [ ] Create new route structure
- [ ] Implement shared layout
- [ ] Move edit content to /general
- [ ] Update videos page
- [ ] Add other settings pages
- [ ] Setup redirects
- [ ] Update documentation
- [ ] Update tests
- [ ] Deploy with feature flag
- [ ] Monitor metrics
- [ ] Remove old structure

## Related Issues
- #123: Users confused by channel settings navigation
- #124: Duplicate API calls in settings pages
- #125: Add breadcrumbs to improve navigation

## References
- [Next.js 15 Layouts Documentation](https://nextjs.org/docs/app/building-your-application/routing/pages-and-layouts)
- [React Server Components Best Practices](https://nextjs.org/docs/app/building-your-application/rendering/server-components)
- [Information Architecture Principles](https://www.nngroup.com/articles/ia-vs-navigation/)