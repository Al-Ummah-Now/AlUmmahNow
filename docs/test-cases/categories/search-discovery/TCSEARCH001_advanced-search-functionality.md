# TC-SEARCH-001: Advanced Search Functionality

## Test Case Information

- **Test ID**: TC-SEARCH-001
- **Title**: Advanced Search Functionality
- **Priority**: High
- **Type**: Search
- **Category**: Search and Discovery
- **Estimated Duration**: 20 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that advanced search functionality works correctly including complex queries, filters, sorting, and search operators with accurate and relevant results.

## Test Prerequisites

- Search service configured and running
- Test data indexed in search engine
- Search UI components implemented
- Search analytics and logging
- Various content types for testing

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: 3G, 4G, WiFi, Ethernet
- **Languages**: English (LTR), Arabic (RTL)

## Test Data Setup

```typescript
interface SearchTestData {
  id: string;
  title: string;
  description: string;
  tags: string[];
  category: string;
  duration: number;
  uploadDate: Date;
  viewCount: number;
  language: string;
  quality: string;
  creator: string;
}

const searchTestData: SearchTestData[] = [
  {
    id: 'video-001',
    title: 'Introduction to Islamic History',
    description: 'A comprehensive overview of Islamic history from the beginning to modern times',
    tags: ['islam', 'history', 'education', 'beginner'],
    category: 'Education',
    duration: 1800,
    uploadDate: new Date('2024-01-15'),
    viewCount: 15000,
    language: 'en',
    quality: '1080p',
    creator: 'Scholar1'
  },
  {
    id: 'video-002',
    title: 'مقدمة في تاريخ الإسلام',
    description: 'نظرة شاملة لتاريخ الإسلام من البداية إلى العصر الحديث',
    tags: ['إسلام', 'تاريخ', 'تعليم', 'مبتدئ'],
    category: 'Education',
    duration: 2100,
    uploadDate: new Date('2024-02-20'),
    viewCount: 8500,
    language: 'ar',
    quality: '720p',
    creator: 'Scholar2'
  }
];
```

## Test Scenarios

### Scenario 1: Basic Text Search

**Test Steps:**

1. **Perform Simple Search**
   ```typescript
   // Navigate to search page
   await page.goto('/en/search');
   
   // Enter search query
   await page.fill('[data-testid="search-input"]', 'Islamic history');
   await page.click('[data-testid="search-button"]');
   
   // Wait for results
   await page.waitForSelector('[data-testid="search-results"]', { timeout: 10000 });
   ```

2. **Verify Search Results**
   ```typescript
   // Get search results
   const results = await page.$$eval('[data-testid="search-result"]', els => 
     els.map(el => ({
       title: el.querySelector('[data-testid="result-title"]')?.textContent,
       description: el.querySelector('[data-testid="result-description"]')?.textContent,
       relevance: el.getAttribute('data-relevance-score')
     }))
   );
   
   // Verify results contain search terms
   expect(results.length).toBeGreaterThan(0);
   results.forEach(result => {
     const text = `${result.title} ${result.description}`.toLowerCase();
     expect(text).toContain('islamic');
     expect(text).toContain('history');
   });
   
   // Verify relevance scoring
   results.forEach(result => {
     expect(parseFloat(result.relevance || '0')).toBeGreaterThan(0);
   });
   
   // Verify results are sorted by relevance
   for (let i = 1; i < results.length; i++) {
     expect(parseFloat(results[i].relevance || '0'))
       .toBeLessThanOrEqual(parseFloat(results[i - 1].relevance || '0'));
   }
   ```

### Scenario 2: Advanced Search with Filters

**Test Steps:**

1. **Setup Advanced Search**
   ```typescript
   await page.goto('/en/search');
   await page.click('[data-testid="advanced-search-toggle"]');
   
   // Fill advanced search fields
   await page.fill('[data-testid="search-query"]', 'education');
   await page.selectOption('[data-testid="category-filter"]', 'Education');
   await page.selectOption('[data-testid="language-filter"]', 'English');
   await page.selectOption('[data-testid="quality-filter"]', '1080p');
   await page.fill('[data-testid="duration-min"]', '10');
   await page.fill('[data-testid="duration-max"]', '60');
   await page.fill('[data-testid="date-from"]', '2024-01-01');
   await page.fill('[data-testid="date-to"]', '2024-12-31');
   
   await page.click('[data-testid="advanced-search-button"]');
   ```

2. **Verify Filtered Results**
   ```typescript
   await page.waitForSelector('[data-testid="search-results"]');
   
   const filteredResults = await page.$$eval('[data-testid="search-result"]', els => 
     els.map(el => ({
       title: el.querySelector('[data-testid="result-title"]')?.textContent,
       category: el.querySelector('[data-testid="result-category"]')?.textContent,
       language: el.querySelector('[data-testid="result-language"]')?.textContent,
       quality: el.querySelector('[data-testid="result-quality"]')?.textContent,
       duration: el.querySelector('[data-testid="result-duration"]')?.textContent,
       uploadDate: el.querySelector('[data-testid="result-upload-date"]')?.textContent
     }))
   );
   
   // Verify all filters applied
   filteredResults.forEach(result => {
     expect(result.category).toBe('Education');
     expect(result.language).toBe('English');
     expect(result.quality).toBe('1080p');
     
     // Verify duration range (10-60 minutes)
     const duration = parseInt(result.duration?.replace('min', '') || '0');
     expect(duration).toBeGreaterThanOrEqual(10);
     expect(duration).toBeLessThanOrEqual(60);
     
     // Verify date range
     const uploadDate = new Date(result.uploadDate || '');
     expect(uploadDate.getFullYear()).toBe(2024);
   });
   ```

### Scenario 3: Search Operators

**Test Steps:**

1. **Test Boolean Operators**
   ```typescript
   // AND operator
   await page.goto('/en/search');
   await page.fill('[data-testid="search-input"]', 'islamic AND history');
   await page.click('[data-testid="search-button"]');
   
   await page.waitForSelector('[data-testid="search-results"]');
   const andResults = await page.$$eval('[data-testid="search-result"]', els => els.length);
   
   // OR operator
   await page.fill('[data-testid="search-input"]', 'islamic OR education');
   await page.click('[data-testid="search-button"]');
   
   await page.waitForSelector('[data-testid="search-results"]');
   const orResults = await page.$$eval('[data-testid="search-result"]', els => els.length);
   
   // NOT operator
   await page.fill('[data-testid="search-input"]', 'history NOT modern');
   await page.click('[data-testid="search-button"]');
   
   await page.waitForSelector('[data-testid="search-results"]');
   const notResults = await page.$$eval('[data-testid="search-result"]', els => els.length);
   
   // Verify operator behavior
   expect(orResults).toBeGreaterThanOrEqual(andResults);
   expect(notResults).toBeLessThanOrEqual(andResults);
   ```

2. **Test Phrase and Wildcard Search**
   ```typescript
   // Exact phrase
   await page.fill('[data-testid="search-input"]', '"Islamic history"');
   await page.click('[data-testid="search-button"]');
   
   await page.waitForSelector('[data-testid="search-results"]');
   const phraseResults = await page.$$eval('[data-testid="search-result"]', els => els.length);
   
   // Wildcard
   await page.fill('[data-testid="search-input"]', 'histor*');
   await page.click('[data-testid="search-button"]');
   
   await page.waitForSelector('[data-testid="search-results"]');
   const wildcardResults = await page.$$eval('[data-testid="search-result"]', els => els.length);
   
   // Verify wildcard returns more results
   expect(wildcardResults).toBeGreaterThanOrEqual(phraseResults);
   ```

### Scenario 4: Search Suggestions and Autocomplete

**Test Steps:**

1. **Test Search Suggestions**
   ```typescript
   await page.goto('/en/search');
   await page.fill('[data-testid="search-input"]', 'isl');
   
   // Wait for suggestions
   await page.waitForSelector('[data-testid="search-suggestions"]', { timeout: 5000 });
   
   const suggestions = await page.$$eval('[data-testid="suggestion-item"]', els => 
     els.map(el => ({
       text: el.textContent,
       type: el.getAttribute('data-suggestion-type'),
       count: el.getAttribute('data-result-count')
     }))
   );
   
   // Verify suggestions
   expect(suggestions.length).toBeGreaterThan(0);
   suggestions.forEach(suggestion => {
     expect(suggestion.text?.toLowerCase()).toContain('isl');
     expect(suggestion.type).toBeDefined();
     expect(parseInt(suggestion.count || '0')).toBeGreaterThan(0);
   });
   
   // Click suggestion
   await page.click('[data-testid="suggestion-item"]:first-child');
   
   // Verify search executed
   await page.waitForSelector('[data-testid="search-results"]');
   const searchValue = await page.inputValue('[data-testid="search-input"]');
   expect(searchValue).toBe(suggestions[0].text);
   ```

### Scenario 5: Search History and Saved Searches

**Test Steps:**

1. **Test Search History**
   ```typescript
   // Perform multiple searches
   const searches = ['islamic history', 'education videos', 'arabic content'];
   
   for (const search of searches) {
     await page.goto('/en/search');
     await page.fill('[data-testid="search-input"]', search);
     await page.click('[data-testid="search-button"]');
     await page.waitForSelector('[data-testid="search-results"]');
     await page.waitForTimeout(1000);
   }
   
   // Check search history
   await page.goto('/en/search');
   await page.click('[data-testid="search-history-toggle"]');
   
   await page.waitForSelector('[data-testid="search-history"]');
   const historyItems = await page.$$eval('[data-testid="history-item"]', els => 
     els.map(el => el.textContent)
   );
   
   // Verify history
   searches.forEach(search => {
     expect(historyItems.some(item => item?.includes(search))).toBe(true);
   });
   ```

2. **Test Saved Searches**
   ```typescript
   // Save a search
   await page.goto('/en/search');
   await page.fill('[data-testid="search-input"]', 'islamic education');
   await page.click('[data-testid="search-button"]');
   
   await page.waitForSelector('[data-testid="search-results"]');
   await page.click('[data-testid="save-search-button"]');
   await page.fill('[data-testid="saved-search-name"]', 'Islamic Education Videos');
   await page.click('[data-testid="confirm-save-search"]');
   
   // Verify saved search
   await page.goto('/en/profile/saved-searches');
   await page.waitForSelector('[data-testid="saved-searches"]');
   
   const savedSearches = await page.$$eval('[data-testid="saved-search-item"]', els => 
     els.map(el => ({
       name: el.querySelector('[data-testid="search-name"]')?.textContent,
       query: el.querySelector('[data-testid="search-query"]')?.textContent,
       results: el.querySelector('[data-testid="result-count"]')?.textContent
     }))
   );
   
   expect(savedSearches.length).toBeGreaterThan(0);
   const savedSearch = savedSearches.find(s => s.name === 'Islamic Education Videos');
   expect(savedSearch).toBeDefined();
   expect(savedSearch?.query).toBe('islamic education');
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page } from '@playwright/test';
import { SearchTestDataFactory } from '../helpers/search-test-data-factory';

test.describe('TC-SEARCH-001: Advanced Search Functionality', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    
    // Setup test data
    await SearchTestDataFactory.setupTestData();
    
    // Login
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'searchuser@test.com');
    await page.fill('[data-testid="password"]', 'testpass123');
    await page.click('[data-testid="login-button"]');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('should perform basic text search with relevant results', async () => {
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'Islamic history');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]', { timeout: 10000 });

    const results = await page.$$eval('[data-testid="search-result"]', els => 
      els.map(el => ({
        title: el.querySelector('[data-testid="result-title"]')?.textContent,
        description: el.querySelector('[data-testid="result-description"]')?.textContent,
        relevance: el.getAttribute('data-relevance-score')
      }))
    );

    expect(results.length).toBeGreaterThan(0);

    results.forEach(result => {
      const text = `${result.title} ${result.description}`.toLowerCase();
      expect(text).toContain('islamic');
      expect(text).toContain('history');
      expect(parseFloat(result.relevance || '0')).toBeGreaterThan(0);
    });

    // Verify relevance sorting
    for (let i = 1; i < results.length; i++) {
      expect(parseFloat(results[i].relevance || '0'))
        .toBeLessThanOrEqual(parseFloat(results[i - 1].relevance || '0'));
    }
  });

  test('should apply advanced search filters correctly', async () => {
    await page.goto('/en/search');
    await page.click('[data-testid="advanced-search-toggle"]');

    await page.fill('[data-testid="search-query"]', 'education');
    await page.selectOption('[data-testid="category-filter"]', 'Education');
    await page.selectOption('[data-testid="language-filter"]', 'English');
    await page.selectOption('[data-testid="quality-filter"]', '1080p');
    await page.fill('[data-testid="duration-min"]', '10');
    await page.fill('[data-testid="duration-max"]', '60');
    await page.fill('[data-testid="date-from"]', '2024-01-01');
    await page.fill('[data-testid="date-to"]', '2024-12-31');

    await page.click('[data-testid="advanced-search-button"]');

    await page.waitForSelector('[data-testid="search-results"]');

    const filteredResults = await page.$$eval('[data-testid="search-result"]', els => 
      els.map(el => ({
        category: el.querySelector('[data-testid="result-category"]')?.textContent,
        language: el.querySelector('[data-testid="result-language"]')?.textContent,
        quality: el.querySelector('[data-testid="result-quality"]')?.textContent,
        duration: el.querySelector('[data-testid="result-duration"]')?.textContent,
        uploadDate: el.querySelector('[data-testid="result-upload-date"]')?.textContent
      }))
    );

    filteredResults.forEach(result => {
      expect(result.category).toBe('Education');
      expect(result.language).toBe('English');
      expect(result.quality).toBe('1080p');

      const duration = parseInt(result.duration?.replace('min', '') || '0');
      expect(duration).toBeGreaterThanOrEqual(10);
      expect(duration).toBeLessThanOrEqual(60);

      const uploadDate = new Date(result.uploadDate || '');
      expect(uploadDate.getFullYear()).toBe(2024);
    });
  });

  test('should handle search operators correctly', async () => {
    // Test AND operator
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'islamic AND history');
    await page.click('[data-testid="search-button"]');
    await page.waitForSelector('[data-testid="search-results"]');
    const andResults = await page.$$eval('[data-testid="search-result"]', els => els.length);

    // Test OR operator
    await page.fill('[data-testid="search-input"]', 'islamic OR education');
    await page.click('[data-testid="search-button"]');
    await page.waitForSelector('[data-testid="search-results"]');
    const orResults = await page.$$eval('[data-testid="search-result"]', els => els.length);

    // Test NOT operator
    await page.fill('[data-testid="search-input"]', 'history NOT modern');
    await page.click('[data-testid="search-button"]');
    await page.waitForSelector('[data-testid="search-results"]');
    const notResults = await page.$$eval('[data-testid="search-result"]', els => els.length);

    expect(orResults).toBeGreaterThanOrEqual(andResults);
    expect(notResults).toBeLessThanOrEqual(andResults);
  });

  test('should provide search suggestions and autocomplete', async () => {
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'isl');

    await page.waitForSelector('[data-testid="search-suggestions"]', { timeout: 5000 });

    const suggestions = await page.$$eval('[data-testid="suggestion-item"]', els => 
      els.map(el => ({
        text: el.textContent,
        type: el.getAttribute('data-suggestion-type'),
        count: el.getAttribute('data-result-count')
      }))
    );

    expect(suggestions.length).toBeGreaterThan(0);
    suggestions.forEach(suggestion => {
      expect(suggestion.text?.toLowerCase()).toContain('isl');
      expect(suggestion.type).toBeDefined();
      expect(parseInt(suggestion.count || '0')).toBeGreaterThan(0);
    });

    // Test suggestion selection
    await page.click('[data-testid="suggestion-item"]:first-child');
    await page.waitForSelector('[data-testid="search-results"]');

    const searchValue = await page.inputValue('[data-testid="search-input"]');
    expect(searchValue).toBe(suggestions[0].text);
  });

  test('should maintain search history and allow saved searches', async () => {
    // Perform searches
    const searches = ['islamic history', 'education videos', 'arabic content'];
    
    for (const search of searches) {
      await page.goto('/en/search');
      await page.fill('[data-testid="search-input"]', search);
      await page.click('[data-testid="search-button"]');
      await page.waitForSelector('[data-testid="search-results"]');
      await page.waitForTimeout(1000);
    }

    // Check search history
    await page.goto('/en/search');
    await page.click('[data-testid="search-history-toggle"]');
    await page.waitForSelector('[data-testid="search-history"]');

    const historyItems = await page.$$eval('[data-testid="history-item"]', els => 
      els.map(el => el.textContent)
    );

    searches.forEach(search => {
      expect(historyItems.some(item => item?.includes(search))).toBe(true);
    });

    // Save a search
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'islamic education');
    await page.click('[data-testid="search-button"]');
    await page.waitForSelector('[data-testid="search-results"]');

    await page.click('[data-testid="save-search-button"]');
    await page.fill('[data-testid="saved-search-name"]', 'Islamic Education Videos');
    await page.click('[data-testid="confirm-save-search"]');

    // Verify saved search
    await page.goto('/en/profile/saved-searches');
    await page.waitForSelector('[data-testid="saved-searches"]');

    const savedSearches = await page.$$eval('[data-testid="saved-search-item"]', els => 
      els.map(el => ({
        name: el.querySelector('[data-testid="search-name"]')?.textContent,
        query: el.querySelector('[data-testid="search-query"]')?.textContent
      }))
    );

    const savedSearch = savedSearches.find(s => s.name === 'Islamic Education Videos');
    expect(savedSearch).toBeDefined();
    expect(savedSearch?.query).toBe('islamic education');
  });

  test('should handle Arabic search with RTL support', async () => {
    await page.goto('/ar/search');
    await page.fill('[data-testid="search-input"]', 'تاريخ الإسلام');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]', { timeout: 10000 });

    const results = await page.$$eval('[data-testid="search-result"]', els => 
      els.map(el => ({
        title: el.querySelector('[data-testid="result-title"]')?.textContent,
        description: el.querySelector('[data-testid="result-description"]')?.textContent,
        language: el.querySelector('[data-testid="result-language"]')?.textContent
      }))
    );

    expect(results.length).toBeGreaterThan(0);

    // Verify Arabic content
    const arabicResults = results.filter(result => result.language === 'Arabic');
    expect(arabicResults.length).toBeGreaterThan(0);

    arabicResults.forEach(result => {
      const text = `${result.title} ${result.description}`;
      expect(text).toContain('تاريخ');
      expect(text).toContain('الإسلام');
    });

    // Verify RTL layout
    const searchContainer = await page.$('[data-testid="search-container"]');
    expect(await searchContainer?.getAttribute('dir')).toBe('rtl');
  });

  test('should handle search performance under load', async () => {
    const startTime = Date.now();

    // Perform rapid searches
    const searchQueries = [
      'islamic', 'history', 'education', 'arabic', 'video',
      'content', 'learning', 'teaching', 'scholar', 'lecture'
    ];

    for (const query of searchQueries) {
      await page.goto('/en/search');
      await page.fill('[data-testid="search-input"]', query);
      await page.click('[data-testid="search-button"]');
      await page.waitForSelector('[data-testid="search-results"]', { timeout: 5000 });
    }

    const endTime = Date.now();
    const totalTime = endTime - startTime;

    // Verify performance
    expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds
    expect(totalTime / searchQueries.length).toBeLessThan(3000); // Average < 3s per search

    // Verify all searches completed successfully
    const lastResults = await page.$$eval('[data-testid="search-result"]', els => els.length);
    expect(lastResults).toBeGreaterThan(0);
  });

  test('should provide search analytics and insights', async () => {
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'islamic history');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]');

    // Check search analytics
    await page.click('[data-testid="search-analytics-toggle"]');
    await page.waitForSelector('[data-testid="search-analytics"]');

    const analytics = await page.$$eval('[data-testid="analytics-item"]', els => 
      els.map(el => ({
        metric: el.querySelector('[data-testid="metric-name"]')?.textContent,
        value: el.querySelector('[data-testid="metric-value"]')?.textContent
      }))
    );

    expect(analytics.length).toBeGreaterThan(0);

    const relevantMetrics = ['Results Found', 'Search Time', 'Relevance Score'];
    relevantMetrics.forEach(metric => {
      expect(analytics.some(a => a.metric?.includes(metric))).toBe(true);
    });

    // Verify search time is reasonable
    const searchTime = analytics.find(a => a.metric?.includes('Search Time'));
    expect(searchTime).toBeDefined();
    expect(parseFloat(searchTime?.value?.replace('ms', '') || '0')).toBeLessThan(1000);
  });
});
```

## Performance Metrics

### Latency Requirements
- **Search Response**: < 500ms
- **Autocomplete**: < 200ms
- **Filter Application**: < 300ms
- **Results Rendering**: < 1s

### Throughput Requirements
- **Concurrent Searches**: 1,000/second
- **Search Index Size**: 1M+ documents
- **Autocomplete Requests**: 5,000/second
- **Filter Combinations**: 10,000+

## Error Handling

### Expected Error Scenarios
1. **No Results Found**
   - Helpful suggestions
   - Alternative queries
   - Spelling corrections

2. **Search Timeout**
   - Timeout handling
   - Partial results
   - User notification

3. **Invalid Query**
   - Query validation
   - Error messages
   - Query suggestions

## Cross-Browser Testing Matrix

| Browser | Version | Basic Search | Advanced Filters | Operators | Autocomplete |
|---------|---------|--------------|-------------------|------------|-------------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing

### Mobile Search
- Touch-friendly interface
- Voice search integration
- Mobile autocomplete
- Gesture-based filtering

### Performance
- Search speed on mobile
- Battery usage
- Network efficiency
- Memory optimization

## RTL Testing

### Arabic Search
- RTL query input
- Arabic results display
- Right-aligned filters
- Arabic autocomplete

## Test Execution

### Running Tests
```bash
# Run all search tests
pnpm test:e2e --grep "TC-SEARCH-001"

# Run specific scenarios
pnpm test:e2e --grep "should perform basic text search"
pnpm test:e2e --grep "should apply advanced search filters"
```

## Validation Criteria

### Success Criteria
- ✅ Basic search working
- ✅ Advanced filters functional
- ✅ Search operators working
- ✅ Autocomplete functional
- ✅ Search history maintained
- ✅ Performance within limits

### Failure Criteria
- ❌ Search returns no results
- ❌ Filters not applied
- ❌ Operators not working
- ❌ Autocomplete failures
- ❌ History not maintained
- ❌ Performance degradation

## Related Test Cases

- [TC-SEARCH-002](./TCSEARCH002_search-performance-optimization.md) - Search Performance Optimization
- [TC-SEARCH-003](./TCSEARCH003_search-result-relevance.md) - Search Result Relevance
- [TC-BIL-006](../bilingual/TCBIL006_SearchLocalization.md) - Search Localization

## Document Information

- **Created**: 2025-11-18
- **Last Updated**: 2025-11-18
- **Version**: 1.0
- **Review Date**: 2025-11-25
- **Next Review**: 2025-12-25

---

**Test Team**: test-team@alummahnow.net  
**QA Lead**: qa-lead@alummahnow.net  
**DevOps**: devops@alummahnow.net