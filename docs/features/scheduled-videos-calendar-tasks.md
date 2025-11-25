# Remaining Tasks: Scheduled Videos Calendar Feature

## Status Overview

**Completion**: ~70% complete
**Remaining Work**: 3 major phases + testing/verification

---

## Phase 5: Complete Core Calendar Components

### 5.1 Complete CalendarEvent Component ⚠️ CRITICAL
**File**: `/apps/web/src/components/calendar/CalendarEvent/index.tsx`
**Status**: Structure created, needs full implementation

**Requirements**:
- Display video thumbnail with fallback
- Show video title (truncate if too long)
- Display scheduled time in user's timezone
- Handle click to navigate to edit page: `/${locale}/video/${videoId}/edit`
- Show hover tooltip with full video details
- Loading state when clicking
- Responsive design (mobile/tablet/desktop)
- Support both light and dark themes
- Accessibility (ARIA labels, keyboard navigation)

**Dependencies**:
- Use existing `useLanguage()` hook
- Use Next.js `useRouter()` for navigation
- Use Tailwind CSS for styling
- Follow existing component patterns

**Test Coverage**: Tests already written in `CalendarEvent.test.tsx` (25 tests)

---

### 5.2 Create ScheduledVideoCalendar Component ⚠️ CRITICAL
**Files**:
- `/apps/web/src/components/calendar/ScheduledVideoCalendar/index.tsx` (LTR)
- `/apps/web/src/components/calendar/ScheduledVideoCalendar/rtl/index.tsx` (RTL)

**Status**: Not started (most complex component)

**Requirements**:
- Integrate `react-big-calendar` library
- Support three view modes:
  - Month view (default)
  - Week view
  - Day view
- Display scheduled videos as calendar events using `CalendarEvent` component
- Handle calendar type switching (Gregorian/Hijri)
  - Use utilities from `hijriConverter.ts`
  - Display appropriate month names based on calendar type
- Navigation controls integration
  - Use `CalendarControls` component
  - Navigate between months/weeks/days
  - "Today" button to return to current date
- Handle event click → delegate to `CalendarEvent` component
- Empty state: "No scheduled videos for this period"
- Loading state: Skeleton/spinner while fetching data
- Error state: Error boundary with retry option
- RTL layout for Arabic locale
- Dark/light theme support
- Mobile-responsive design
- Accessibility (keyboard navigation, screen reader support)

**Data Transformation**:
```typescript
interface CalendarEventData {
  id: string;
  title: string;
  start: Date; // Calculated from scheduledPublishDate + timezone
  end: Date; // start + video duration or +1 hour default
  resource: VideoObject; // Original video data
}

// Transform video data to calendar events
const transformVideoToCalendarEvent = (video: VideoObject): CalendarEventData => {
  // Implementation needed
}
```

**Props Interface**:
```typescript
interface ScheduledVideoCalendarProps {
  videos: VideoObject[]; // Scheduled videos data
  calendarType: 'gregorian' | 'hijri';
  viewType: 'month' | 'week' | 'day';
  currentDate: Date;
  onNavigate: (date: Date, view: string, action: string) => void;
  onEventClick: (videoId: string) => void;
  isLoading?: boolean;
  error?: Error | null;
}
```

**Implementation Notes**:
- Use `react-big-calendar` with custom components
- Create custom toolbar using `CalendarControls`
- Custom event component using `CalendarEvent`
- Handle Hijri calendar by transforming dates before rendering
- Use `date-fns` for date manipulation
- Performance: Memoize event transformations
- Test with 50+ videos to ensure smooth performance

**Test Coverage**: Need integration tests for this component

---

## Phase 6: Page Integration & Refactoring

### 6.1 Extract List View Component
**File**: `/apps/web/src/components/scheduled-videos/ScheduledVideosList/index.tsx` (new)
**Status**: Not started

**Requirements**:
- Extract existing list view logic from `scheduled-videos/page.tsx`
- Create standalone component with props:
  ```typescript
  interface ScheduledVideosListProps {
    videos: VideoObject[];
    isLoading: boolean;
    error?: Error | null;
    onVideoClick: (videoId: string) => void;
  }
  ```
- Keep all existing functionality:
  - Filter by status (scheduled/published)
  - Sort by date
  - Delete functionality
  - Bulk selection
  - Table view with all columns
- Maintain existing translations
- No breaking changes to current behavior

---

### 6.2 Refactor Scheduled Videos Page ⚠️ CRITICAL
**File**: `/apps/web/src/app/[locale]/scheduled-videos/page.tsx`
**Status**: Needs major refactoring

**Requirements**:

**1. Add View State Management**:
```typescript
const [view, setView] = useState<'list' | 'calendar'>('list');
const [calendarType, setCalendarType] = useState<'gregorian' | 'hijri'>('gregorian');
const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('month');
const [currentDate, setCurrentDate] = useState<Date>(new Date());
```

**2. URL Parameter Persistence**:
- Use `nuqs` or `useSearchParams` for URL state
- Parameters:
  - `?view=list|calendar` (default: list)
  - `?calendarType=gregorian|hijri` (default: gregorian)
  - `?calendarView=month|week|day` (default: month)
- Persist view preference across page reloads
- Update URL when view changes without page reload

**3. Component Structure**:
```tsx
<main>
  <header>
    <h1>Scheduled Videos</h1>
    <ViewSwitcher
      view={view}
      onChange={setView}
    />
  </header>

  {view === 'list' ? (
    <ScheduledVideosList
      videos={scheduledVideos}
      isLoading={isLoading}
      error={error}
      onVideoClick={handleVideoClick}
    />
  ) : (
    <div>
      <CalendarControls
        calendarType={calendarType}
        onCalendarTypeChange={setCalendarType}
        viewType={calendarView}
        onViewTypeChange={setCalendarView}
        currentDate={currentDate}
        onNavigate={handleNavigate}
        onToday={handleToday}
      />

      <ScheduledVideoCalendar
        videos={scheduledVideos}
        calendarType={calendarType}
        viewType={calendarView}
        currentDate={currentDate}
        onNavigate={handleNavigate}
        onEventClick={handleVideoClick}
        isLoading={isLoading}
        error={error}
      />
    </div>
  )}
</main>
```

**4. Data Fetching**:
- Keep existing API call to fetch scheduled videos
- Filter based on `scheduledPublishStatus` (should already work after bug fix)
- Share same data between list and calendar views
- Handle loading and error states for both views

**5. Event Handlers**:
```typescript
const handleVideoClick = (videoId: string) => {
  router.push(`/${locale}/video/${videoId}/edit`);
};

const handleNavigate = (date: Date, view: string, action: string) => {
  setCurrentDate(date);
  // Optional: Refetch videos if navigating to different time period
};

const handleToday = () => {
  setCurrentDate(new Date());
};
```

**6. Lazy Loading** (Performance):
```typescript
const ScheduledVideoCalendar = dynamic(
  () => import('@/components/calendar/ScheduledVideoCalendar'),
  { loading: () => <CalendarSkeleton /> }
);
```

**7. Maintain Existing Features**:
- Authentication check
- Channel filtering
- All existing scheduled videos functionality
- No breaking changes

---

## Phase 7: Testing & Verification

### 7.1 Run Unit Tests
**Command**: `cd apps/web && npm test`

**Expected Results**:
- All date converter tests pass (20+ tests)
- All date formatter tests pass (30+ tests)
- All component tests pass (60+ tests)
- Coverage >80% for new code

**If Tests Fail**:
- Fix implementation to match test expectations
- Update tests if requirements changed
- Add missing tests for uncovered code

---

### 7.2 Run Type Check
**Command**: `pnpm type-check`

**Expected Results**:
- No TypeScript errors in calendar components
- All props properly typed
- No `any` types without justification

**If Type Errors**:
- Fix type mismatches
- Add proper interfaces
- Update shared types if needed

---

### 7.3 Run E2E Tests
**Command**: `cd apps/web && npx playwright test e2e/scheduled-videos-calendar.spec.ts`

**Expected Results**:
- All 30+ E2E scenarios pass
- Tests work in both English and Arabic
- Tests work in light and dark themes
- No flaky tests

**If E2E Tests Fail**:
- Check component implementations
- Verify selectors are correct
- Add proper test IDs if needed
- Fix timing/async issues

---

### 7.4 Manual Testing Checklist

**Test in Browser - English (LTR)**:
- [ ] Navigate to `/en/scheduled-videos`
- [ ] Switch from list to calendar view
- [ ] Verify URL updates: `?view=calendar`
- [ ] Switch between Month/Week/Day views
- [ ] Navigate through different months
- [ ] Click "Today" button
- [ ] Switch to Hijri calendar
- [ ] Verify Hijri month names display correctly
- [ ] Click on a calendar event
- [ ] Verify navigation to video edit page
- [ ] Switch back to list view
- [ ] Reload page - verify view persists
- [ ] Test in light and dark themes
- [ ] Test responsive behavior (mobile/tablet)

**Test in Browser - Arabic (RTL)**:
- [ ] Navigate to `/ar/scheduled-videos`
- [ ] Repeat all tests from English
- [ ] Verify RTL layout is correct
- [ ] Verify Arabic translations
- [ ] Verify Hijri calendar works in Arabic
- [ ] Test navigation controls are mirrored

**Edge Cases**:
- [ ] Empty state (no scheduled videos)
- [ ] Loading state while fetching
- [ ] Error state (API failure)
- [ ] Many videos (50+) - test performance
- [ ] Video with very long title
- [ ] Video without thumbnail
- [ ] Scheduled video in distant future
- [ ] Scheduled video in past

**Accessibility**:
- [ ] Keyboard navigation works
- [ ] Tab order is logical
- [ ] Screen reader announces calendar properly
- [ ] Focus states are visible
- [ ] ARIA labels are correct

---

## Phase 8: Documentation & Cleanup

### 8.1 Update Documentation
**Files to Update**:
- `/apps/web/README.md` - Add calendar feature section
- `/.github/CLAUDE.md` - Update with calendar components
- Create component documentation in comments

**Documentation Needs**:
- How to use the calendar view
- How Hijri calendar works
- API integration notes
- Known limitations

---

### 8.2 Code Cleanup
- Remove any console.logs
- Remove commented code
- Ensure all TODOs are addressed or documented
- Format all files with Prettier
- Run linter and fix issues: `pnpm lint`

---

### 8.3 Performance Optimization
- Verify lazy loading works
- Check bundle size impact
- Optimize images if needed
- Memoize expensive calculations
- Add React.memo where beneficial

---

## Success Criteria

✅ All components implemented and working
✅ All unit tests passing (130+ tests)
✅ All E2E tests passing (30+ tests)
✅ Type check passes with no errors
✅ Manual testing completed for all scenarios
✅ Works in both English and Arabic
✅ Works in both LTR and RTL layouts
✅ Works in light and dark themes
✅ Responsive on mobile/tablet/desktop
✅ Accessible (WCAG 2.1 Level AA)
✅ No performance issues with 50+ videos
✅ Documentation updated
✅ Code is clean and maintainable

---

## Estimated Time Remaining

- **Phase 5** (Calendar components): 4-6 hours
- **Phase 6** (Page integration): 2-3 hours
- **Phase 7** (Testing): 2-3 hours
- **Phase 8** (Documentation): 1 hour

**Total**: 9-13 hours of development work

---

## Priority Order

1. ⚠️ **CRITICAL**: Complete `CalendarEvent` component
2. ⚠️ **CRITICAL**: Create `ScheduledVideoCalendar` component
3. ⚠️ **CRITICAL**: Refactor scheduled-videos page
4. **HIGH**: Run and fix all tests
5. **MEDIUM**: Manual testing and bug fixes
6. **LOW**: Documentation and cleanup

---

## Notes

- Follow TDD approach - tests are already written
- Reuse existing components and patterns
- Keep components simple and focused
- Test frequently during implementation
- Ask for help if blocked on anything
