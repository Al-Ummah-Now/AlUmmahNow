# Task 1.7: /ar/live Page with RTL Layout

## Goal
Create the Arabic version of the live streaming browse page with complete RTL layout, Arabic translations, and proper right-to-left interactions.

## Architecture Pattern
**Pattern**: Server Component with RTL Client Islands
**Type**: Next.js 15 Page (App Router) - RTL variant

## Page Structure

### File Locations
- **Page**: `/apps/web/src/app/ar/live/page.tsx`
- **RTL Components**: `/apps/web/src/components/live-streaming/*/rtl/`
- **Layout**: `/apps/web/src/app/ar/layout.tsx` (with dir="rtl")

### RTL Page Implementation
```typescript
export default async function LivePageAR({
  searchParams
}: {
  searchParams: { tab?: string; category?: string }
}) {
  const initialStreams = await liveStreamsApi.getStreams({
    status: searchParams.tab || 'live',
    lang: 'ar'
  });

  return (
    <div dir="rtl" lang="ar">
      <LivePageClientRTL
        initialStreams={initialStreams}
        initialTab={searchParams.tab}
      />
    </div>
  );
}
```

## Implementation

### RTL Layout Differences
- Text alignment: Right-aligned
- Flex direction: Reversed
- Icons: Some mirrored (arrows), some not (play)
- Grid: Same structure, RTL flow
- Margins/Padding: Mirrored

### Client Component (RTL)
```typescript
'use client';

export function LivePageClientRTL({
  initialStreams,
  initialTab = 'live'
}: Props) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl" dir="rtl">
      <PageHeaderRTL title="البث المباشر" />

      <TabNavigationRTL
        activeTab={activeTab}
        tabs={[
          { value: 'live', label: 'مباشر الآن' },
          { value: 'scheduled', label: 'المجدول' },
          { value: 'ended', label: 'السابق' }
        ]}
      />

      <FilterBarRTL
        category={category}
        onCategoryChange={setCategory}
      />

      <div className="grid gap-4 sm:gap-6 
        grid-cols-1 
        sm:grid-cols-2 
        lg:grid-cols-3 
        xl:grid-cols-4"
        dir="rtl">
        {streams.map((stream) => (
          <LiveStreamCardRTL
            key={stream.id}
            stream={stream}
            lang="ar"
          />
        ))}
      </div>
    </div>
  );
}
```

## Dependencies
- Same as English version
- `date-fns/locale/ar` for date formatting
- RTL-specific components

## Related Tasks
- **Task 1.4**: LiveStreamCard RTL (displayed in grid)
- **Task 1.6**: /en/live Page (LTR equivalent)
- All RTL component variants

## Acceptance Criteria
- [ ] Complete RTL layout mirroring
- [ ] Arabic text displays correctly
- [ ] Arabic numerals formatted properly
- [ ] Tab order follows RTL flow
- [ ] All interactions feel natural in RTL
- [ ] Same functionality as English version
- [ ] Pixel-perfect match with designs

## References
- [UX Specifications: Task 1.7](/docs/live-streaming/ux-specifications-phase1.md#task-17-arlive-page-with-rtl-layout)
- [RTL Web Development](https://rtlstyling.com/)
