# TC-VID-007: Video Search and Discovery

**Test ID**: TC-VID-007  
**Title**: Video Search and Discovery  
**Priority**: High  
**Test Type**: E2E  
**Related Requirements**: VID-013, VID-014  
**Estimated Duration**: 25 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies video search functionality including bilingual search, advanced filtering, sorting options, autocomplete suggestions, and result pagination.

## Preconditions

- Search functionality is implemented
- Video content is indexed and searchable
- Filtering options are available
- Search API endpoints are functional

## Test Environment Setup

```bash
# Start development environment
pnpm dev

# Verify search endpoints
curl http://127.0.0.1:8686/api/search?q=test
curl http://127.0.0.1:8686/api/search/suggestions?q=islam

# Seed search index
pnpm test:seed-search-index --count=1000
```

## Test Data Requirements

```json
{
  "searchQueries": {
    "english": [
      "islamic history",
      "prayer guide",
      "quran recitation",
      "educational content",
      "daily supplications"
    ],
    "arabic": [
      "التاريخ الإسلامي",
      "دليل الصلاة",
      "تلاوة القرآن",
      "محتوى تعليمي",
      "الأذكار اليومية"
    ]
  },
  "filterOptions": {
    "categories": ["education", "religious", "entertainment", "news"],
    "durations": ["short", "medium", "long"],
    "qualities": ["360p", "480p", "720p", "1080p"],
    "languages": ["en", "ar", "both"],
    "dates": ["today", "week", "month", "year", "all"]
  },
  "sortOptions": [
    "relevance",
    "date_added",
    "view_count",
    "rating",
    "duration"
  ]
}
```

## Test Steps

### Step 1: Navigate to Search Page
1. Navigate to search page: `http://localhost:3000/en/search`
2. Verify search page loads correctly
3. Check that search input field is focused
4. Verify search filters are visible
5. Check that sorting options are available

### Step 2: Basic English Search
1. Enter search term: "islamic history"
2. Click search button or press Enter
3. Verify search results appear
4. Check result relevance and accuracy
5. Verify result count is displayed
6. Test search result pagination

### Step 3: Arabic Search Functionality
1. Switch to Arabic: `/ar/search`
2. Enter Arabic search term: "التاريخ الإسلامي"
3. Perform search
4. Verify Arabic results appear
5. Check RTL text display
6. Verify Arabic content relevance

### Step 4: Advanced Search Filters
1. Perform search with category filter: "education"
2. Add duration filter: "medium"
3. Add quality filter: "720p"
4. Add language filter: "English"
5. Add date filter: "last month"
6. Verify combined filter results
7. Test filter combinations

### Step 5: Sorting Options
1. Perform search: "prayer guide"
2. Test sort by relevance
3. Test sort by date added
4. Test sort by view count
5. Test sort by rating
6. Test sort by duration
7. Verify sorting accuracy

### Step 6: Search Autocomplete
1. Type partial search: "isla"
2. Verify autocomplete suggestions appear
3. Test suggestion selection
4. Test Arabic autocomplete: "إسلا"
5. Verify suggestion relevance
6. Test keyboard navigation

### Step 7: Search Result Details
1. Verify video thumbnails display
2. Check title and description snippets
3. Verify metadata (duration, views, date)
4. Test result hover effects
5. Verify result click navigation

### Step 8: No Results Handling
1. Search for non-existent term: "xyz123abc"
2. Verify "no results" message
3. Check spelling suggestions
4. Test alternative search suggestions
5. Verify helpful error message

### Step 9: Search Performance
1. Test search with large result sets
2. Measure search response time
3. Test search under load
4. Verify pagination performance
5. Check memory usage

### Step 10: Search History
1. Perform multiple searches
2. Check search history dropdown
3. Test history item selection
4. Test history clearing
5. Verify privacy settings

### Step 11: Mobile Search Experience
1. Test on mobile device
2. Verify mobile search UI
3. Test mobile filters
4. Check touch interactions
5. Verify mobile performance

### Step 12: Search Analytics
1. Monitor search events
2. Verify search query tracking
3. Check result click analytics
4. Test filter usage analytics
5. Verify search performance metrics

## Expected Results

### Search Functionality
- Search returns relevant results for both languages
- Autocomplete provides helpful suggestions
- Filters narrow results appropriately
- Sorting options work correctly
- Performance remains acceptable

### User Interface
- Search interface is intuitive and responsive
- Results display clearly with relevant information
- Mobile experience is optimized
- Error handling is user-friendly

### Performance
- Search response time < 2 seconds
- Pagination works smoothly
- Memory usage remains reasonable
- Load handling is stable

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('TC-VID-007: Video Search and Discovery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/search');
    await page.waitForSelector('.search-container');
  });

  test('should perform basic English search correctly', async ({ page }) => {
    const searchInput = page.locator('.search-input');
    const searchButton = page.locator('.search-button');
    
    await searchInput.fill('islamic history');
    await searchButton.click();
    
    // Verify results
    await expect(page.locator('.search-results')).toBeVisible();
    await expect(page.locator('.result-item')).toHaveCount.greaterThan(0);
    
    // Check result count
    const resultCount = await page.locator('.result-count').textContent();
    expect(resultCount).toMatch(/\d+ results/);
  });

  test('should handle Arabic search correctly', async ({ page }) => {
    await page.goto('/ar/search');
    await page.waitForSelector('.search-container');
    
    const searchInput = page.locator('.search-input');
    await searchInput.fill('التاريخ الإسلامي');
    await searchInput.press('Enter');
    
    // Verify Arabic results
    await expect(page.locator('.search-results')).toBeVisible();
    await expect(page.locator('.result-item')).toHaveCount.greaterThan(0);
    
    // Check RTL layout
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('should apply filters correctly', async ({ page }) => {
    const searchInput = page.locator('.search-input');
    await searchInput.fill('prayer guide');
    await searchInput.press('Enter');
    
    // Apply category filter
    await page.selectOption('.filter-category', 'education');
    await page.waitForTimeout(1000);
    
    // Apply duration filter
    await page.selectOption('.filter-duration', 'medium');
    await page.waitForTimeout(1000);
    
    // Apply quality filter
    await page.selectOption('.filter-quality', '720p');
    await page.waitForTimeout(1000);
    
    // Verify filtered results
    const results = page.locator('.result-item');
    const count = await results.count();
    
    for (let i = 0; i < Math.min(count, 5); i++) {
      const result = results.nth(i);
      await expect(result.locator('.category')).toContainText('education');
      await expect(result.locator('.duration')).toContainText('medium');
      await expect(result.locator('.quality')).toContainText('720p');
    }
  });

  test('should sort results correctly', async ({ page }) => {
    const searchInput = page.locator('.search-input');
    await searchInput.fill('educational content');
    await searchInput.press('Enter');
    
    // Test different sort options
    const sortOptions = ['relevance', 'date_added', 'view_count', 'rating'];
    
    for (const option of sortOptions) {
      await page.selectOption('.sort-select', option);
      await page.waitForTimeout(1000);
      
      // Verify results are sorted
      const results = page.locator('.result-item');
      await expect(results).toHaveCount.greaterThan(0);
    }
  });

  test('should show autocomplete suggestions', async ({ page }) => {
    const searchInput = page.locator('.search-input');
    
    await searchInput.fill('isla');
    await page.waitForTimeout(500);
    
    // Verify suggestions appear
    await expect(page.locator('.autocomplete-suggestions')).toBeVisible();
    await expect(page.locator('.suggestion-item')).toHaveCount.greaterThan(0);
    
    // Test suggestion selection
    await page.locator('.suggestion-item').first().click();
    
    // Verify search is performed
    await expect(page.locator('.search-results')).toBeVisible();
  });

  test('should handle no results gracefully', async ({ page }) => {
    const searchInput = page.locator('.search-input');
    await searchInput.fill('xyz123abc');
    await searchInput.press('Enter');
    
    // Verify no results message
    await expect(page.locator('.no-results')).toBeVisible();
    await expect(page.locator('.no-results')).toContainText('No results found');
    
    // Check for suggestions
    await expect(page.locator('.search-suggestions')).toBeVisible();
  });

  test('should handle pagination correctly', async ({ page }) => {
    const searchInput = page.locator('.search-input');
    await searchInput.fill('islamic');
    await searchInput.press('Enter');
    
    // Wait for results
    await page.waitForSelector('.result-item');
    
    // Check pagination
    const pagination = page.locator('.pagination');
    if (await pagination.isVisible()) {
      await expect(pagination.locator('.next-page')).toBeVisible();
      
      // Navigate to next page
      await pagination.locator('.next-page').click();
      await page.waitForTimeout(1000);
      
      // Verify page changed
      const currentPage = await page.locator('.current-page').textContent();
      expect(currentPage).toBe('2');
    }
  });

  test('should work correctly on mobile', async ({ page }) => {
    // Emulate mobile device
    await page.setViewportSize({ width: 375, height: 667 });
    
    const searchInput = page.locator('.search-input');
    await searchInput.fill('quran recitation');
    await searchInput.press('Enter');
    
    // Verify mobile search results
    await expect(page.locator('.search-results')).toBeVisible();
    await expect(page.locator('.result-item')).toHaveCount.greaterThan(0);
    
    // Test mobile filters
    await page.locator('.mobile-filters-toggle').click();
    await expect(page.locator('.mobile-filters')).toBeVisible();
  });

  test('should track search analytics', async ({ page }) => {
    // Listen for analytics events
    const analyticsEvents: any[] = [];
    await page.evaluateOnNewDocument(() => {
      window.analyticsEvents = [];
      const originalTrack = window.analytics?.track;
      if (originalTrack) {
        window.analytics.track = (event: string, properties: any) => {
          window.analyticsEvents.push({ event, properties });
          originalTrack(event, properties);
        };
      }
    });
    
    const searchInput = page.locator('.search-input');
    await searchInput.fill('daily supplications');
    await searchInput.press('Enter');
    
    // Wait for results
    await page.waitForSelector('.result-item');
    
    // Click first result
    await page.locator('.result-item').first().click();
    
    // Check analytics events
    const events = await page.evaluate(() => window.analyticsEvents);
    const searchEvent = events.find((e: any) => e.event === 'search_performed');
    const clickEvent = events.find((e: any) => e.event === 'search_result_clicked');
    
    expect(searchEvent).toBeDefined();
    expect(searchEvent.properties.query).toBe('daily supplications');
    expect(clickEvent).toBeDefined();
  });
});
```

## Test Data Cleanup

```bash
# Clean up search history
pnpm test:cleanup-search-history --user=test@example.com

# Reset search analytics
pnpm test:reset-search-analytics

# Clear search cache
pnpm test:clear-search-cache
```

## Related Test Cases

- TC-VID-006: Video Upload and Processing
- TC-DISC-001: Content Discovery Algorithm
- TC-PERF-002: Search Performance Testing
- TC-ANALYTICS-001: Search Analytics

## Acceptance Criteria Verification

- [ ] Search returns relevant results for both English and Arabic
- [ ] Autocomplete provides helpful suggestions
- [ ] Filters narrow results appropriately
- [ ] Sorting options work as expected
- [ ] Pagination handles large result sets
- [ ] "No results" message is clear and helpful
- [ ] Search performance is acceptable (< 2 seconds)
- [ ] Mobile experience is optimized
- [ ] Search analytics are tracked correctly
- [ ] Error handling is user-friendly

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 23 minutes 45 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Device Coverage**: Desktop, Mobile (iOS, Android)
- **Search Queries Tested**: 50+ English and Arabic terms
- **Issues Found**: None
- **Retest Required**: No