# Manual Test Scenarios - Dashboard Videos Ownership

## Overview

This document provides step-by-step manual test scenarios for validating the dashboard videos page ownership and filtering features. These tests complement the automated E2E tests and cover user-facing behaviors.

---

## Test Environment Setup

### Prerequisites
- Web app running at: http://localhost:3001
- API running at: http://127.0.0.1:3086
- Browser: Chrome/Firefox with DevTools
- Test users created with channels and videos

### Required Test Data

**User 1 (Single Channel):**
- Email: single@test.com
- Channels: 1 channel ("My Channel")
- Videos: 10 videos (5 public, 5 private, mixed durations)

**User 2 (Multiple Channels):**
- Email: multi@test.com
- Channels: 3 channels ("Channel A", "Channel B", "Channel C")
- Videos: 20 videos across all channels (10 public, 10 private)

**User 3 (No Channels):**
- Email: none@test.com
- Channels: 0 channels
- Videos: 0 videos

---

## Test Case 1: Basic Dashboard Functionality

### Objective
Verify basic dashboard loads and displays user's videos correctly.

### Steps

1. **Login as User 1 (single channel)**
   - Navigate to http://localhost:3001/en
   - Click "Login" button
   - Enter credentials: single@test.com
   - Verify successful login

2. **Navigate to Dashboard**
   - Click user menu (top-right)
   - Select "Dashboard" → "Videos"
   - Verify URL: `/en/dashboard/videos`

3. **Verify Videos Displayed**
   - Wait for page to load (should be < 3 seconds)
   - Verify video grid displayed
   - Count total videos shown
   - **Expected:** 10 videos (public + private)

4. **Verify Video Card Information**
   - Check each video card has:
     - Thumbnail image
     - Title
     - View count
     - Date created
     - Privacy badge (Public/Private)
     - Action buttons (View, Edit, Delete)

5. **Open DevTools Network Tab**
   - Press F12 → Network tab
   - Filter: "videos"
   - Verify exactly **1 API request** to `/api/videos`
   - Check request URL includes:
     - `isOwner=true`
     - `channelIds=<your-channel-id>`
     - `limit=100`

### Expected Results
✅ All 10 videos displayed (public + private)
✅ Single API call made
✅ Page loads within 3 seconds
✅ Video cards show correct information

---

## Test Case 2: Duration Filtering

### Objective
Verify duration filter works correctly for short, standard, and long videos.

### Steps

1. **Login and Navigate to Dashboard**
   - Login as User 1
   - Go to `/en/dashboard/videos`

2. **Test "All Videos" Filter (Default)**
   - Verify dropdown shows "All Videos"
   - Count videos displayed
   - **Expected:** All 10 videos shown

3. **Test "Short (≤3 min)" Filter**
   - Click duration filter dropdown
   - Select "Short (≤3 min)"
   - Wait for results to update
   - Count videos shown
   - Verify all shown videos have duration ≤ 3 minutes
   - Check DevTools: verify `durationFilter=short` in API request

4. **Test "Standard (3-20 min)" Filter**
   - Select "Standard (3-20 min)"
   - Wait for results
   - Verify only videos with 3 min < duration ≤ 20 min shown
   - Check DevTools: verify `durationFilter=medium`

5. **Test "Long (>20 min)" Filter**
   - Select "Long (>20 min)"
   - Wait for results
   - Verify only videos with duration > 20 min shown
   - Check DevTools: verify `durationFilter=long`

6. **Test Filter Reset**
   - Select "All Videos" again
   - Verify all 10 videos shown again

### Expected Results
✅ Each filter shows correct subset of videos
✅ API called with correct `durationFilter` parameter
✅ Filter changes trigger new API request
✅ Video counts match expected durations

---

## Test Case 3: Privacy Filtering

### Objective
Verify privacy filter correctly shows public/private videos.

### Steps

1. **Login and Navigate to Dashboard**
   - Login as User 1
   - Go to `/en/dashboard/videos`

2. **Test "All" Privacy Filter (Default)**
   - Verify privacy dropdown shows "Filter by Privacy"
   - Count videos displayed
   - **Expected:** All 10 videos (5 public + 5 private)

3. **Test "Public" Filter**
   - Click privacy filter dropdown
   - Select "Public"
   - Wait for results
   - Count videos shown
   - Verify all shown videos have "Public" badge
   - **Expected:** 5 public videos

4. **Test "Private" Filter**
   - Select "Private"
   - Wait for results
   - Count videos shown
   - Verify all shown videos have "Private" badge
   - **Expected:** 5 private videos

5. **Verify No API Call on Privacy Filter Change**
   - Open DevTools Network tab
   - Clear previous requests
   - Change privacy filter from "Public" to "Private"
   - **Expected:** NO new API call (client-side filtering)

### Expected Results
✅ Public filter shows only public videos
✅ Private filter shows only private videos
✅ Privacy filtering is client-side (no API call)
✅ All filters return to showing all videos when "All" selected

---

## Test Case 4: Multiple Channels - Single API Call

### Objective
Verify dashboard makes only ONE API call for users with multiple channels.

### Steps

1. **Login as User 2 (multiple channels)**
   - Navigate to http://localhost:3001/en
   - Login with: multi@test.com
   - Verify login successful

2. **Open DevTools Before Navigation**
   - Press F12 → Network tab
   - Enable "Preserve log"
   - Clear existing requests

3. **Navigate to Dashboard**
   - Click Dashboard → Videos
   - Wait for page to load

4. **Verify Single API Call**
   - Check Network tab
   - Filter by "videos"
   - Count requests to `/api/videos`
   - **Expected:** Exactly **1 request** (not 3)

5. **Inspect API Request**
   - Click on the API request
   - Go to "Headers" tab → "Query String Parameters"
   - Verify `channelIds` contains all 3 channel IDs:
     ```
     channelIds: ch-a-001,ch-b-002,ch-c-003
     ```
   - Verify `isOwner=true`

6. **Verify Videos from All Channels**
   - Count total videos displayed
   - **Expected:** 20 videos (from all 3 channels)
   - Verify videos from different channels are mixed together
   - Look for channel names in video cards

### Expected Results
✅ Exactly 1 API call for 3 channels
✅ API call includes all channelIds in comma-separated format
✅ All 20 videos from all channels displayed
✅ No duplicate videos

---

## Test Case 5: Combined Filters

### Objective
Verify multiple filters work together correctly.

### Steps

1. **Login and Navigate to Dashboard**
   - Login as User 2 (multiple channels)
   - Go to `/en/dashboard/videos`

2. **Test Duration + Privacy Combination**
   - Select Duration: "Short (≤3 min)"
   - Select Privacy: "Public"
   - Verify results show only:
     - Short videos (≤3 min)
     - AND public videos
   - Count results

3. **Test Duration + Sort Combination**
   - Select Duration: "Standard"
   - Select Sort: "Sort by views"
   - Verify:
     - Only standard duration videos shown
     - Videos sorted by view count (high to low)

4. **Test Search + Duration + Privacy**
   - Type in search box: "islamic"
   - Select Duration: "Short"
   - Select Privacy: "Private"
   - Verify results match all three filters

5. **Test Filter Reset**
   - Clear search box
   - Select Duration: "All Videos"
   - Select Privacy: "All"
   - Verify all 20 videos shown again

### Expected Results
✅ Filters combine correctly (AND logic)
✅ Correct subset of videos shown
✅ Server-side filters (duration) trigger API call
✅ Client-side filters (privacy, search) don't trigger API call

---

## Test Case 6: No Channels User

### Objective
Verify graceful handling of users with no channels.

### Steps

1. **Login as User 3 (no channels)**
   - Navigate to http://localhost:3001/en
   - Login with: none@test.com

2. **Navigate to Dashboard**
   - Click Dashboard → Videos
   - Wait for page to load

3. **Verify Empty State**
   - Check for empty state message
   - **Expected:** "No videos found" or similar message
   - Verify upload button present
   - Verify no video cards shown

4. **Check Network Tab**
   - Open DevTools → Network
   - Verify **NO API call** made
   - (Early return because channelIds.length === 0)

5. **Verify UI Elements Still Work**
   - Try changing filters
   - Verify dropdowns still functional
   - Verify no errors in console

### Expected Results
✅ Empty state message shown
✅ No API call made (performance optimization)
✅ No errors in console
✅ UI remains functional

---

## Test Case 7: Ownership Validation - Security Test

### Objective
Verify users cannot access other users' channels via dashboard.

### Prerequisites
- User 1 owns channel: ch-single-001
- User 2 owns channels: ch-multi-001, ch-multi-002, ch-multi-003

### Steps

1. **Attempt Manual Channel Override (Advanced)**
   - Login as User 1
   - Navigate to dashboard
   - Open DevTools → Console
   - Attempt to manually modify localStorage:
     ```javascript
     const multiUser = JSON.parse(localStorage.getItem('multi_account_user'));
     multiUser.channels.push({
       id: 'ch-multi-001', // User 2's channel
       userId: 'user-multi-002',
       name: 'Unauthorized Channel'
     });
     localStorage.setItem('multi_account_user', JSON.stringify(multiUser));
     ```
   - Reload page

2. **Verify API Rejects Request**
   - Check Network tab
   - Verify API request includes unowned channel ID
   - Verify API response: **403 Forbidden**
   - Verify error message: "User does not own channel ch-multi-001"

3. **Verify Dashboard Handles Error**
   - Check for error message displayed to user
   - Verify dashboard doesn't show videos from unowned channel
   - Verify no crash or broken UI

### Expected Results
✅ API validates ownership server-side
✅ 403 Forbidden returned for unowned channels
✅ Dashboard handles error gracefully
✅ Security: No data leakage

---

## Test Case 8: Sorting Functionality

### Objective
Verify all sort options work correctly.

### Steps

1. **Login and Navigate to Dashboard**
   - Login as User 2 (multiple channels)
   - Go to `/en/dashboard/videos`

2. **Test "Sort by Date" (Default)**
   - Verify dropdown shows "Sort by Date"
   - Check video order
   - Verify newest videos first
   - Check API request: `sortBy=date`, `sortOrder=desc`

3. **Test "Sort by Views"**
   - Select "Sort by Views"
   - Verify videos reordered
   - Check first video has highest view count
   - Verify API request: `sortBy=views`

4. **Test "Sort by Title"**
   - Select "Sort by Title"
   - Verify videos in alphabetical order
   - Check API request: `sortBy=title`

5. **Verify Sort Persists with Filters**
   - Select Duration: "Short"
   - Verify sort order maintained
   - Verify filtered AND sorted correctly

### Expected Results
✅ All sort options work
✅ Sort order correct for each option
✅ API receives correct sortBy parameter
✅ Sort persists with other filters

---

## Test Case 9: Video Actions

### Objective
Verify video action buttons (View, Edit, Delete) work correctly.

### Steps

1. **Login and Navigate to Dashboard**
   - Login as User 1
   - Go to `/en/dashboard/videos`

2. **Test "View" Button**
   - Click "View" on first video
   - Verify redirects to video page: `/en/video?vid=<video-id>`
   - Verify video plays
   - Go back to dashboard

3. **Test "Edit" Button**
   - Click "Edit" on first video
   - Verify redirects to edit page: `/en/video/<video-id>/edit`
   - Verify edit form loaded
   - Go back to dashboard

4. **Test "Delete" Button**
   - Count total videos before deletion
   - Click "Delete" on one video
   - Verify confirmation dialog appears
   - Click "Cancel" → verify video NOT deleted
   - Click "Delete" again → Click "Confirm"
   - Wait for deletion
   - Verify video removed from list
   - Verify total count decreased by 1

5. **Test Bulk Selection**
   - Check checkboxes on 3 videos
   - Verify bulk actions bar appears
   - Verify "3 videos selected" message
   - Click "Delete Selected"
   - Confirm deletion
   - Verify all 3 videos removed

### Expected Results
✅ View button navigates to video page
✅ Edit button navigates to edit page
✅ Delete button shows confirmation
✅ Bulk actions work correctly
✅ Video list updates after deletion

---

## Test Case 10: Responsive Design

### Objective
Verify dashboard works on different screen sizes.

### Steps

1. **Desktop View (1920x1080)**
   - Login and navigate to dashboard
   - Verify 4 videos per row (grid layout)
   - Verify all filters visible
   - Verify actions buttons visible

2. **Tablet View (768x1024)**
   - Resize browser to 768px width
   - Verify 2-3 videos per row
   - Verify filters adapt to smaller screen
   - Verify action buttons still accessible

3. **Mobile View (375x667)**
   - Resize to 375px width
   - Verify 1 video per row (stacked)
   - Verify filters accessible (possibly in dropdown)
   - Verify all features still functional

### Expected Results
✅ Grid adapts to screen size
✅ All features accessible on mobile
✅ No horizontal scrolling
✅ Touch-friendly buttons on mobile

---

## Test Case 11: Performance

### Objective
Verify dashboard performs well under load.

### Steps

1. **Measure Page Load Time**
   - Clear browser cache
   - Open DevTools → Performance tab
   - Start recording
   - Navigate to `/en/dashboard/videos`
   - Stop recording when page fully loaded
   - Check total load time
   - **Expected:** < 3 seconds

2. **Measure Filter Change Performance**
   - Start performance recording
   - Change duration filter 5 times rapidly
   - Stop recording
   - Verify UI remains responsive
   - Check if debouncing prevents excessive API calls

3. **Test with Many Videos**
   - User with 100+ videos
   - Navigate to dashboard
   - Scroll through video grid
   - Verify smooth scrolling
   - Verify no lag or freezing

### Expected Results
✅ Page loads within 3 seconds
✅ Filter changes responsive
✅ Smooth scrolling with many videos
✅ No memory leaks or performance issues

---

## Test Case 12: Error Handling

### Objective
Verify dashboard handles errors gracefully.

### Steps

1. **Test Network Failure**
   - Navigate to dashboard
   - Open DevTools → Network
   - Enable "Offline" mode
   - Reload page
   - Verify error message shown
   - Verify retry option available

2. **Test API Error (500)**
   - Use DevTools to mock 500 error:
     - Network → right-click request → "Block request URL"
   - Reload page
   - Verify error message: "Failed to load videos"
   - Verify dashboard doesn't crash

3. **Test Timeout**
   - Slow 3G throttling in DevTools
   - Reload dashboard
   - Verify loading spinner shown
   - Wait for timeout
   - Verify appropriate message

### Expected Results
✅ Error messages displayed
✅ Dashboard doesn't crash
✅ Retry/refresh options available
✅ User-friendly error messages

---

## Browser Compatibility

Test on the following browsers:

- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Chrome Mobile (Android)
- [ ] Safari Mobile (iOS)

---

## Accessibility Testing

### Steps

1. **Keyboard Navigation**
   - Tab through all interactive elements
   - Verify focus indicators visible
   - Verify can select filters with keyboard
   - Verify can activate buttons with Enter/Space

2. **Screen Reader (NVDA/JAWS)**
   - Enable screen reader
   - Navigate through dashboard
   - Verify video titles announced
   - Verify filter labels announced
   - Verify button purposes clear

3. **Color Contrast**
   - Use DevTools → Lighthouse
   - Run accessibility audit
   - Verify all text meets WCAG AA standards
   - Check privacy badges readable

### Expected Results
✅ Fully keyboard accessible
✅ Screen reader compatible
✅ WCAG 2.1 AA compliant
✅ Clear focus indicators

---

## Security Checklist

When performing manual tests, verify:

- [ ] Private videos only visible to owner
- [ ] API validates ownership server-side
- [ ] Cannot access other users' channels via URL manipulation
- [ ] Cannot bypass ownership via localStorage modification
- [ ] 403 Forbidden for unauthorized channel access
- [ ] No sensitive data in error messages
- [ ] No SQL injection via channelIds parameter
- [ ] CSRF protection on delete actions

---

## Reporting Issues

When reporting issues found during manual testing, include:

1. **Test Case Number:** (e.g., "Test Case 5: Combined Filters")
2. **Steps to Reproduce:** Exact steps taken
3. **Expected Result:** What should happen
4. **Actual Result:** What actually happened
5. **Screenshots:** Visual evidence of issue
6. **Browser/OS:** Testing environment details
7. **Network Logs:** DevTools Network tab screenshot
8. **Console Errors:** Any JavaScript errors

---

## Manual Test Execution Log

**Tester:** ___________________________
**Date:** ___________________________
**Environment:** ___________________________

| Test Case | Status | Issues Found | Notes |
|-----------|--------|--------------|-------|
| TC1: Basic Functionality | ⬜ Pass / ⬜ Fail | | |
| TC2: Duration Filtering | ⬜ Pass / ⬜ Fail | | |
| TC3: Privacy Filtering | ⬜ Pass / ⬜ Fail | | |
| TC4: Multiple Channels | ⬜ Pass / ⬜ Fail | | |
| TC5: Combined Filters | ⬜ Pass / ⬜ Fail | | |
| TC6: No Channels User | ⬜ Pass / ⬜ Fail | | |
| TC7: Ownership Validation | ⬜ Pass / ⬜ Fail | | |
| TC8: Sorting Functionality | ⬜ Pass / ⬜ Fail | | |
| TC9: Video Actions | ⬜ Pass / ⬜ Fail | | |
| TC10: Responsive Design | ⬜ Pass / ⬜ Fail | | |
| TC11: Performance | ⬜ Pass / ⬜ Fail | | |
| TC12: Error Handling | ⬜ Pass / ⬜ Fail | | |

**Overall Status:** ⬜ All Pass / ⬜ Some Failures / ⬜ Blocked

**Summary of Issues:**
___________________________________________________________________
___________________________________________________________________
___________________________________________________________________
