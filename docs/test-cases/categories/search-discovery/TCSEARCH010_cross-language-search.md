# TCSEARCH010: Cross-Language Search

**Test ID**: TCSEARCH010  
**Title**: Cross-Language Search  
**Priority**: Medium  
**Test Type**: E2E  
**Related Requirements**: SEARCH-014, MULTILINGUAL-001, I18N-003

## Test Overview

This test case validates cross-language search functionality, including multilingual content discovery, language detection, translation integration, and bilingual search capabilities.

## Test Preconditions

- Multilingual content is available
- Language detection algorithms are implemented
- Translation services are integrated
- Bilingual search indexing is configured

## Test Steps

### 1. Language Detection and Recognition
1. Search with English query on English interface
2. Verify English content prioritization
3. Search with Arabic query on Arabic interface
4. Verify Arabic content prioritization
5. Search with English query on Arabic interface
6. Verify language detection works
7. Search with Arabic query on English interface
8. Verify language detection works
9. Test mixed-language queries
10. Verify language detection accuracy

### 2. Cross-Language Content Discovery
1. Search for content available in both languages
2. Verify both language versions appear
3. Test language preference weighting
4. Verify language tagging accuracy
5. Test content without language tags
6. Verify fallback language detection
7. Test content with multiple languages
8. Verify language separation in results
9. Test language-specific metadata
10. Verify language-based filtering

### 3. Translation-Enhanced Search
1. Search with English terms
2. Verify Arabic content with translated terms appears
3. Search with Arabic terms
4. Verify English content with translated terms appears
5. Test translation accuracy
6. Verify translation confidence levels
7. Test translation disambiguation
8. Verify translation context awareness
9. Test translation for technical terms
10. Verify translation for religious terms

### 4. Bilingual Result Presentation
1. Perform cross-language search
2. Verify result language indicators
3. Test language labels in results
4. Verify language-specific thumbnails
5. Test bilingual result descriptions
6. Verify language-based sorting
7. Test language grouping in results
8. Verify language filtering options
9. Test language preference controls
10. Verify result language switching

### 5. Interface Language Independence
1. Set interface to English
2. Search with Arabic terms
3. Verify results include Arabic content
4. Set interface to Arabic
5. Search with English terms
6. Verify results include English content
7. Test language switching during search
8. Verify search term preservation
9. Test interface language vs content language
10. Verify language preference persistence

### 6. Mixed-Language Query Handling
1. Search with English and Arabic terms mixed
2. Verify proper language separation
3. Test query language detection
4. Verify mixed-language result relevance
5. Test transliteration queries
6. Verify romanized Arabic search
7. Test Arabic script English words
8. Verify code-switching handling
9. Test proper noun handling
10. Verify named entity recognition

### 7. Content Language Metadata
1. Check content language tagging accuracy
2. Test automatic language detection
3. Verify manual language overrides
4. Test content with multiple languages
5. Verify language confidence scores
6. Test language detection for short content
7. Verify language detection for long content
8. Test language detection for mixed content
9. Verify language metadata updates
10. Test language inheritance from channels

### 8. Cross-Language Filtering and Facets
1. Apply language filters in search
2. Verify filter accuracy
3. Test multiple language selection
4. Verify language combination logic
5. Test language exclusion filters
6. Verify language-based sorting
7. Test language-based categories
8. Verify language-based quality filters
9. Test language-based date filters
10. Verify language-based duration filters

### 9. Search Autocomplete Across Languages
1. Type English search term
2. Verify English suggestions appear
3. Type Arabic search term
4. Verify Arabic suggestions appear
5. Test mixed-language autocomplete
6. Verify transliteration suggestions
7. Test cross-language suggestions
8. Verify language-specific trending
9. Test bilingual recent searches
10. Verify language switching in autocomplete

### 10. Performance Optimization for Multilingual Search
1. Measure cross-language search response time
2. Test search with large multilingual datasets
3. Verify language detection performance
4. Test translation service performance
5. Verify indexing performance for multiple languages
6. Test cache effectiveness for multilingual queries
7. Verify search result ranking performance
8. Test concurrent multilingual searches
9. Verify resource usage optimization
10. Test scalability with language additions

### 11. Quality and Relevance Across Languages
1. Compare result quality between languages
2. Test relevance scoring for different languages
3. Verify content quality assessment
4. Test language-specific relevance factors
5. Verify cultural relevance consideration
6. Test regional dialect handling
7. Verify formality level matching
8. Test content appropriateness filtering
9. Verify language-specific ranking
10. Test cross-language relevance consistency

### 12. Accessibility and Usability for Cross-Language Search
1. Test screen reader support for multilingual results
2. Verify keyboard navigation across languages
3. Test high contrast mode with multiple languages
4. Verify font rendering for different scripts
5. Test text resizing for mixed languages
6. Verify RTL/LTR mixed content handling
7. Test language switching accessibility
8. Verify language indicator accessibility
9. Test translation tooltip accessibility
10. Verify multilingual error messages

## Expected Results

### Functional Requirements
- Cross-language search works accurately
- Language detection is reliable
- Translation enhances search discovery
- Bilingual results are presented clearly
- Performance remains acceptable

### Performance Requirements
- Cross-language search: < 700ms
- Language detection: < 100ms
- Translation lookup: < 200ms
- Result ranking: < 300ms
- Autocomplete: < 150ms

### Usability Requirements
- Language indicators are clear
- Result presentation is intuitive
- Language switching is seamless
- Mixed content is handled well
- Accessibility is maintained

### Quality Requirements
- Translation accuracy: > 90%
- Language detection accuracy: > 95%
- Result relevance consistency: > 85%
- Cross-language coverage: > 80%

## Test Data Requirements

### Multilingual Content
- 500+ English videos with varied topics
- 500+ Arabic videos with varied topics
- 100+ bilingual videos
- Content with mixed languages
- Content with technical and religious terms

### Translation Data
- English-Arabic translation pairs
- Religious terminology translations
- Technical term translations
- Cultural context translations
- Common phrase translations

## Cross-Browser Testing Matrix

| Browser | Version | Language Detection | Translation | RTL Support | Performance |
|---------|---------|-------------------|-------------|-------------|-------------|
| Chrome | Latest+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | Latest+ | ✅ | ✅ | ✅ | ✅ |
| Safari | Latest+ | ✅ | ✅ | ✅ | ✅ |
| Edge | Latest+ | ✅ | ✅ | ✅ | ✅ |

## Mobile Testing Requirements

### Device Coverage
- iOS (iPhone 12, 14, 15)
- Android (Samsung S22, Pixel 7, 8)
- Tablet (iPad Air, Samsung Tab)

### Mobile-Specific Tests
- Mobile language switching
- Touch interaction with multilingual content
- Mobile keyboard language switching
- Performance on mobile networks
- Mobile accessibility for multiple languages

## RTL Testing Requirements

### Arabic Interface Tests
- Arabic search with English results
- Mixed RTL/LTR content display
- Arabic query transliteration
- RTL autocomplete suggestions
- Arabic error messages for English queries

## Playwright Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('Cross-Language Search', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/search');
  });

  test('english query on english interface', async ({ page }) => {
    // Search with English query
    await page.fill('[data-testid="search-input"]', 'quran recitation');
    await page.click('[data-testid="search-button"]');
    
    // Wait for results
    await page.waitForLoadState('networkidle');
    
    // Verify English content is prioritized
    const results = page.locator('[data-testid="search-result"]');
    let englishCount = 0;
    
    for (let i = 0; i < Math.min(await results.count(), 5); i++) {
      const result = results.nth(i);
      const language = await result.locator('[data-testid="result-language"]').textContent();
      if (language === 'English') {
        englishCount++;
      }
    }
    
    expect(englishCount).toBeGreaterThan(2);
  });

  test('arabic query on arabic interface', async ({ page }) => {
    // Switch to Arabic interface
    await page.click('[data-testid="language-switcher"]');
    await page.click('text=العربية');
    await page.waitForLoadState('networkidle');
    
    // Search with Arabic query
    await page.fill('[data-testid="search-input"]', 'تلاوة القرآن');
    await page.click('[data-testid="search-button"]');
    
    // Wait for results
    await page.waitForLoadState('networkidle');
    
    // Verify Arabic content is prioritized
    const results = page.locator('[data-testid="search-result"]');
    let arabicCount = 0;
    
    for (let i = 0; i < Math.min(await results.count(), 5); i++) {
      const result = results.nth(i);
      const language = await result.locator('[data-testid="result-language"]').textContent();
      if (language === 'العربية') {
        arabicCount++;
      }
    }
    
    expect(arabicCount).toBeGreaterThan(2);
  });

  test('cross-language content discovery', async ({ page }) => {
    // Search for content available in both languages
    await page.fill('[data-testid="search-input"]', 'prophet muhammad');
    await page.click('[data-testid="search-button"]');
    
    // Wait for results
    await page.waitForLoadState('networkidle');
    
    // Verify both languages appear
    const results = page.locator('[data-testid="search-result"]');
    let englishCount = 0;
    let arabicCount = 0;
    
    for (let i = 0; i < Math.min(await results.count(), 10); i++) {
      const result = results.nth(i);
      const language = await result.locator('[data-testid="result-language"]').textContent();
      if (language === 'English') {
        englishCount++;
      } else if (language === 'العربية') {
        arabicCount++;
      }
    }
    
    expect(englishCount).toBeGreaterThan(0);
    expect(arabicCount).toBeGreaterThan(0);
  });

  test('translation-enhanced search', async ({ page }) => {
    // Search with English term that should find Arabic content
    await page.fill('[data-testid="search-input"]', 'prayer');
    await page.click('[data-testid="search-button"]');
    
    // Wait for results
    await page.waitForLoadState('networkidle');
    
    // Should find both English and Arabic content (صلاة)
    const results = page.locator('[data-testid="search-result"]');
    let arabicCount = 0;
    
    for (let i = 0; i < Math.min(await results.count(), 10); i++) {
      const result = results.nth(i);
      const language = await result.locator('[data-testid="result-language"]').textContent();
      if (language === 'العربية') {
        arabicCount++;
      }
    }
    
    expect(arabicCount).toBeGreaterThan(0);
  });

  test('mixed-language query handling', async ({ page }) => {
    // Search with mixed English and Arabic
    await page.fill('[data-testid="search-input"]', 'quran تلاوة');
    await page.click('[data-testid="search-button"]');
    
    // Wait for results
    await page.waitForLoadState('networkidle');
    
    // Should handle mixed query properly
    const results = page.locator('[data-testid="search-result"]');
    await expect(results).toHaveCount.greaterThan(0);
    
    // Check if results are relevant to both parts of query
    const firstResult = results.first();
    const title = await firstResult.locator('[data-testid="result-title"]').textContent();
    const description = await firstResult.locator('[data-testid="result-description"]').textContent();
    
    const combinedText = (title + ' ' + description).toLowerCase();
    expect(combinedText).toMatch(/quran|تلاوة/);
  });

  test('language filtering in cross-language search', async ({ page }) => {
    // Search and then apply language filter
    await page.fill('[data-testid="search-input"]', 'islamic education');
    await page.click('[data-testid="search-button"]');
    
    // Wait for results
    await page.waitForLoadState('networkidle');
    
    // Apply English language filter
    await page.click('[data-testid="language-filter"]');
    await page.click('[data-testid="filter-english"]');
    
    // Wait for filter application
    await page.waitForTimeout(1000);
    
    // Verify only English results
    const results = page.locator('[data-testid="search-result"]');
    for (let i = 0; i < Math.min(await results.count(), 5); i++) {
      const result = results.nth(i);
      const language = await result.locator('[data-testid="result-language"]').textContent();
      expect(language).toBe('English');
    }
  });

  test('bilingual result presentation', async ({ page }) => {
    // Search that returns multilingual results
    await page.fill('[data-testid="search-input"]', 'islam');
    await page.click('[data-testid="search-button"]');
    
    // Wait for results
    await page.waitForLoadState('networkidle');
    
    // Verify language indicators are present
    const results = page.locator('[data-testid="search-result"]');
    for (let i = 0; i < Math.min(await results.count(), 5); i++) {
      const result = results.nth(i);
      await expect(result.locator('[data-testid="result-language"]')).toBeVisible();
      await expect(result.locator('[data-testid="language-indicator"]')).toBeVisible();
    }
  });

  test('cross-language autocomplete', async ({ page }) => {
    // Type English term
    await page.click('[data-testid="search-input"]');
    await page.type('[data-testid="search-input"]', 'quran');
    
    // Wait for suggestions
    await expect(page.locator('[data-testid="suggestion-item"]')).toHaveCount.greaterThan(0);
    
    // Clear and type Arabic term
    await page.fill('[data-testid="search-input"]', '');
    await page.type('[data-testid="search-input"]', 'قرآن');
    
    // Wait for Arabic suggestions
    await expect(page.locator('[data-testid="suggestion-item"]')).toHaveCount.greaterThan(0);
    
    // Check if suggestions are in appropriate language
    const suggestions = page.locator('[data-testid="suggestion-item"]');
    const firstSuggestion = await suggestions.first().textContent();
    expect(firstSuggestion).toMatch(/قرآن|quran/i);
  });

  test('interface language independence', async ({ page }) => {
    // Set interface to Arabic
    await page.click('[data-testid="language-switcher"]');
    await page.click('text=العربية');
    await page.waitForLoadState('networkidle');
    
    // Search with English term
    await page.fill('[data-testid="search-input"]', 'prophet muhammad');
    await page.click('[data-testid="search-button"]');
    
    // Should find English content even on Arabic interface
    const results = page.locator('[data-testid="search-result"]');
    let englishCount = 0;
    
    for (let i = 0; i < Math.min(await results.count(), 5); i++) {
      const result = results.nth(i);
      const language = await result.locator('[data-testid="result-language"]').textContent();
      if (language === 'English') {
        englishCount++;
      }
    }
    
    expect(englishCount).toBeGreaterThan(0);
  });

  test('transliteration search', async ({ page }) => {
    // Search with romanized Arabic
    await page.fill('[data-testid="search-input"]', 'salah');
    await page.click('[data-testid="search-button"]');
    
    // Should find Arabic content (صلاة)
    const results = page.locator('[data-testid="search-result"]');
    let arabicCount = 0;
    
    for (let i = 0; i < Math.min(await results.count(), 10); i++) {
      const result = results.nth(i);
      const language = await result.locator('[data-testid="result-language"]').textContent();
      if (language === 'العربية') {
        arabicCount++;
      }
    }
    
    expect(arabicCount).toBeGreaterThan(0);
  });

  test('cross-language search performance', async ({ page }) => {
    // Measure cross-language search response time
    const startTime = Date.now();
    
    await page.fill('[data-testid="search-input"]', 'islamic content');
    await page.click('[data-testid="search-button"]');
    await page.waitForLoadState('networkidle');
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    // Verify performance requirement
    expect(responseTime).toBeLessThan(700); // 700ms for cross-language search
  });

  test('language switching during search', async ({ page }) => {
    // Perform search in English
    await page.fill('[data-testid="search-input"]', 'quran');
    await page.click('[data-testid="search-button"]');
    await page.waitForLoadState('networkidle');
    
    // Switch language while on results page
    await page.click('[data-testid="language-switcher"]');
    await page.click('text=العربية');
    await page.waitForLoadState('networkidle');
    
    // Verify search term is preserved
    const searchInput = page.locator('[data-testid="search-input"]');
    const searchValue = await searchInput.inputValue();
    expect(searchValue).toBe('quran');
    
    // Verify results are still displayed
    await expect(page.locator('[data-testid="search-result"]')).toHaveCount.greaterThan(0);
  });

  test('cross-language accessibility', async ({ page }) => {
    // Perform cross-language search
    await page.fill('[data-testid="search-input"]', 'islam');
    await page.click('[data-testid="search-button"]');
    await page.waitForLoadState('networkidle');
    
    // Test language indicator accessibility
    const languageIndicators = page.locator('[data-testid="language-indicator"]');
    for (let i = 0; i < Math.min(await languageIndicators.count(), 3); i++) {
      const indicator = languageIndicators.nth(i);
      await expect(indicator).toHaveAttribute('aria-label');
      await expect(indicator).toHaveAttribute('role');
    }
    
    // Test keyboard navigation
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-testid="search-result"]:first-child:focus')).toBeVisible();
  });

  test('mobile cross-language search', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile-only test');
    
    // Search with English term
    await page.fill('[data-testid="search-input"]', 'quran');
    await page.click('[data-testid="search-button"]');
    await page.waitForLoadState('networkidle');
    
    // Verify mobile language indicators
    await expect(page.locator('[data-testid="mobile-language-indicator"]')).toBeVisible();
    
    // Test mobile language switching
    await page.click('[data-testid="mobile-language-switcher"]');
    await expect(page.locator('[data-testid="mobile-language-menu"]')).toBeVisible();
  });

  test('cross-language error handling', async ({ page }) => {
    // Test with unsupported language
    await page.fill('[data-testid="search-input"]', 'test with mixed characters ñüß');
    await page.click('[data-testid="search-button"]');
    
    // Should handle gracefully
    await expect(page.locator('[data-testid="search-results"]')).toBeVisible();
    
    // Test translation service failure simulation
    await page.route('**/api/translate*', route => {
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Translation service unavailable' })
      });
    });
    
    // Should still work without translation
    await page.fill('[data-testid="search-input"]', 'islam');
    await page.click('[data-testid="search-button"]');
    await expect(page.locator('[data-testid="search-results"]')).toBeVisible();
  });
});
```

## Performance Metrics

### Response Time Requirements
- Cross-language search: < 700ms
- Language detection: < 100ms
- Translation lookup: < 200ms
- Result ranking: < 300ms
- Autocomplete: < 150ms

### Quality Metrics
- Translation accuracy: > 90%
- Language detection accuracy: > 95%
- Result relevance consistency: > 85%
- Cross-language coverage: > 80%

## Error Handling

### Test Scenarios
- Translation service failures
- Language detection errors
- Mixed content parsing issues
- Unsupported language characters
- Network connectivity issues

### Expected Behavior
- Graceful degradation
- Fallback to monolingual search
- Clear error messages
- User-friendly error recovery
- Performance preservation

## Success Criteria

- ✅ Cross-language search works accurately
- ✅ Language detection is reliable
- ✅ Translation enhances discovery
- ✅ Performance meets requirements
- ✅ Bilingual results are clear
- ✅ Accessibility is maintained
- ✅ Error handling is robust
- ✅ Mobile experience is optimized