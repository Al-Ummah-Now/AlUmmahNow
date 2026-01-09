# TC-SEARCH-003: Search Result Relevance

## Test Case Information

- **Test ID**: TC-SEARCH-003
- **Title**: Search Result Relevance
- **Priority**: High
- **Type**: Quality
- **Category**: Search and Discovery
- **Estimated Duration**: 20 minutes
- **Last Updated**: 2025-11-18

## Test Objective

Verify that search results are ranked by relevance with accurate scoring, proper weighting of factors, and meaningful result ordering.

## Test Prerequisites

- Search relevance algorithms implemented
- Test data with known relevance patterns
- Relevance scoring metrics
- User behavior simulation
- A/B testing framework

## Test Environment

- **Browsers**: Chrome, Firefox, Safari, Edge
- **Devices**: Desktop, Tablet, Mobile
- **Network**: 3G, 4G, WiFi, Ethernet
- **Languages**: English (LTR), Arabic (RTL)

## Test Scenarios

### Scenario 1: Title vs Content Relevance

**Test Steps:**

1. **Search with Title Match**
   ```typescript
   await page.goto('/en/search');
   await page.fill('[data-testid="search-input"]', 'Islamic History Complete');
   await page.click('[data-testid="search-button"]');
   
   await page.waitForSelector('[data-testid="search-results"]');
   
   const results = await page.$$eval('[data-testid="search-result"]', els => 
     els.map(el => ({
       title: el.querySelector('[data-testid="result-title"]')?.textContent,
       description: el.querySelector('[data-testid="result-description"]')?.textContent,
       relevanceScore: parseFloat(el.getAttribute('data-relevance-score') || '0'),
       matchType: el.getAttribute('data-match-type')
     }))
   );
   
   // Title matches should rank higher
   const titleMatches = results.filter(r => r.matchType === 'title');
   const contentMatches = results.filter(r => r.matchType === 'content');
   
   if (titleMatches.length > 0 && contentMatches.length > 0) {
     expect(titleMatches[0].relevanceScore).toBeGreaterThan(contentMatches[0].relevanceScore);
   }
   ```

### Scenario 2: Multi-factor Relevance Scoring

**Test Steps:**

1. **Test Relevance Factors**
   ```typescript
   // Search with multiple potential matches
   await page.fill('[data-testid="search-input"]', 'Islamic education video');
   await page.click('[data-testid="search-button"]');
   
   await page.waitForSelector('[data-testid="search-results"]');
   
   const detailedResults = await page.$$eval('[data-testid="search-result"]', els => 
     els.map(el => ({
       title: el.querySelector('[data-testid="result-title"]')?.textContent,
       relevanceScore: parseFloat(el.getAttribute('data-relevance-score') || '0'),
       factors: JSON.parse(el.getAttribute('data-relevance-factors') || '{}'),
       viewCount: parseInt(el.getAttribute('data-view-count') || '0'),
       uploadDate: el.getAttribute('data-upload-date'),
       creator: el.querySelector('[data-testid="result-creator"]')?.textContent
     }))
   );
   
   // Verify relevance factors are applied
   detailedResults.forEach(result => {
     expect(result.factors).toBeDefined();
     expect(Object.keys(result.factors).length).toBeGreaterThan(0);
     
     // Common factors should be present
     expect(result.factors.textMatch).toBeDefined();
     expect(result.factors.popularity).toBeDefined();
     expect(result.factors.recency).toBeDefined();
   });
   
   // Higher relevance scores should have better factor combinations
   const sortedByScore = [...detailedResults].sort((a, b) => b.relevanceScore - a.relevanceScore);
   for (let i = 0; i < Math.min(5, sortedByScore.length - 1); i++) {
     const current = sortedByScore[i];
     const next = sortedByScore[i + 1];
     
     // Top results should have good text matching
     expect(current.factors.textMatch).toBeGreaterThan(0.5);
   }
   ```

### Scenario 3: Personalized Relevance

**Test Steps:**

1. **Test Personalization**
   ```typescript
   // Setup user preferences and history
   await setupUserProfile({
     interests: ['Islamic History', 'Education'],
     watchHistory: ['islamic-history-intro', 'education-basics'],
     preferredCreators: ['Scholar1', 'Teacher1']
   });
   
   // Perform search
   await page.goto('/en/search');
   await page.fill('[data-testid="search-input"]', 'history');
   await page.click('[data-testid="search-button"]');
   
   await page.waitForSelector('[data-testid="search-results"]');
   
   const personalizedResults = await page.$$eval('[data-testid="search-result"]', els => 
     els.map(el => ({
       title: el.querySelector('[data-testid="result-title"]')?.textContent,
       relevanceScore: parseFloat(el.getAttribute('data-relevance-score') || '0'),
       personalizationScore: parseFloat(el.getAttribute('data-personalization-score') || '0'),
       creator: el.querySelector('[data-testid="result-creator"]')?.textContent,
       category: el.querySelector('[data-testid="result-category"]')?.textContent
     }))
   );
   
   // Personalized results should have higher scores
   const personalizedItems = personalizedResults.filter(r => 
     r.personalizationScore > 0.5
   );
   
   if (personalizedItems.length > 0) {
     const avgPersonalizedScore = personalizedItems.reduce((sum, r) => sum + r.relevanceScore, 0) / personalizedItems.length;
     const avgGeneralScore = personalizedResults.filter(r => r.personalizationScore <= 0.5)
       .reduce((sum, r) => sum + r.relevanceScore, 0) / 
       Math.max(1, personalizedResults.filter(r => r.personalizationScore <= 0.5).length);
     
     expect(avgPersonalizedScore).toBeGreaterThan(avgGeneralScore);
   }
   ```

## Playwright Test Implementation

```typescript
import { test, expect, Page } from '@playwright/test';

test.describe('TC-SEARCH-003: Search Result Relevance', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
    
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'relevance@test.com');
    await page.fill('[data-testid="password"]', 'testpass123');
    await page.click('[data-testid="login-button"]');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('should rank title matches higher than content matches', async () => {
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'Islamic History Complete');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]');

    const results = await page.$$eval('[data-testid="search-result"]', els => 
      els.map(el => ({
        title: el.querySelector('[data-testid="result-title"]')?.textContent,
        description: el.querySelector('[data-testid="result-description"]')?.textContent,
        relevanceScore: parseFloat(el.getAttribute('data-relevance-score') || '0'),
        matchType: el.getAttribute('data-match-type')
      }))
    );

    expect(results.length).toBeGreaterThan(0);

    const titleMatches = results.filter(r => r.matchType === 'title');
    const contentMatches = results.filter(r => r.matchType === 'content');

    if (titleMatches.length > 0 && contentMatches.length > 0) {
      expect(titleMatches[0].relevanceScore).toBeGreaterThan(contentMatches[0].relevanceScore);
    }

    // Verify results are sorted by relevance
    for (let i = 1; i < results.length; i++) {
      expect(results[i].relevanceScore).toBeLessThanOrEqual(results[i - 1].relevanceScore);
    }
  });

  test('should apply multi-factor relevance scoring', async () => {
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'Islamic education video');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]');

    const detailedResults = await page.$$eval('[data-testid="search-result"]', els => 
      els.map(el => ({
        title: el.querySelector('[data-testid="result-title"]')?.textContent,
        relevanceScore: parseFloat(el.getAttribute('data-relevance-score') || '0'),
        factors: JSON.parse(el.getAttribute('data-relevance-factors') || '{}'),
        viewCount: parseInt(el.getAttribute('data-view-count') || '0'),
        uploadDate: el.getAttribute('data-upload-date')
      }))
    );

    detailedResults.forEach(result => {
      expect(result.factors).toBeDefined();
      expect(Object.keys(result.factors).length).toBeGreaterThan(0);
      expect(result.factors.textMatch).toBeDefined();
      expect(result.factors.popularity).toBeDefined();
      expect(result.factors.recency).toBeDefined();
    });

    // Top results should have good text matching
    const topResults = detailedResults.slice(0, 3);
    topResults.forEach(result => {
      expect(result.factors.textMatch).toBeGreaterThan(0.5);
    });
  });

  test('should provide personalized relevance based on user history', async () => {
    // Setup user profile
    await page.goto('/en/profile/preferences');
    await page.fill('[data-testid="interests"]', 'Islamic History, Education');
    await page.click('[data-testid="save-preferences"]');

    // Add to watch history
    await page.goto('/en/videos/islamic-history-intro');
    await page.waitForSelector('[data-testid="video-player"]');
    await page.waitForTimeout(5000); // Simulate watching

    await page.goto('/en/videos/education-basics');
    await page.waitForSelector('[data-testid="video-player"]');
    await page.waitForTimeout(3000);

    // Perform search
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'history');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]');

    const personalizedResults = await page.$$eval('[data-testid="search-result"]', els => 
      els.map(el => ({
        title: el.querySelector('[data-testid="result-title"]')?.textContent,
        relevanceScore: parseFloat(el.getAttribute('data-relevance-score') || '0'),
        personalizationScore: parseFloat(el.getAttribute('data-personalization-score') || '0'),
        category: el.querySelector('[data-testid="result-category"]')?.textContent
      }))
    );

    const personalizedItems = personalizedResults.filter(r => r.personalizationScore > 0.5);

    if (personalizedItems.length > 0) {
      const avgPersonalizedScore = personalizedItems.reduce((sum, r) => sum + r.relevanceScore, 0) / personalizedItems.length;
      const avgGeneralScore = personalizedResults.filter(r => r.personalizationScore <= 0.5)
        .reduce((sum, r) => sum + r.relevanceScore, 0) / 
        Math.max(1, personalizedResults.filter(r => r.personalizationScore <= 0.5).length);

      expect(avgPersonalizedScore).toBeGreaterThan(avgGeneralScore);
    }
  });

  test('should handle relevance for Arabic content correctly', async () => {
    await page.goto('/ar/search');
    await page.fill('[data-testid="search-input"]', 'تاريخ الإسلام');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]');

    const arabicResults = await page.$$eval('[data-testid="search-result"]', els => 
      els.map(el => ({
        title: el.querySelector('[data-testid="result-title"]')?.textContent,
        description: el.querySelector('[data-testid="result-description"]')?.textContent,
        relevanceScore: parseFloat(el.getAttribute('data-relevance-score') || '0'),
        language: el.getAttribute('data-language')
      }))
    );

    expect(arabicResults.length).toBeGreaterThan(0);

    const arabicContent = arabicResults.filter(r => r.language === 'ar');
    expect(arabicContent.length).toBeGreaterThan(0);

    arabicContent.forEach(result => {
      const text = `${result.title} ${result.description}`;
      expect(text).toContain('تاريخ');
      expect(text).toContain('الإسلام');
      expect(result.relevanceScore).toBeGreaterThan(0);
    });

    // Verify Arabic content is ranked higher for Arabic queries
    const topResults = arabicResults.slice(0, 3);
    topResults.forEach(result => {
      expect(result.language).toBe('ar');
    });
  });

  test('should adjust relevance based on user feedback', async () => {
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'Islamic education');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]');

    // Get initial relevance scores
    const initialResults = await page.$$eval('[data-testid="search-result"]', els => 
      els.map(el => ({
        id: el.getAttribute('data-result-id'),
        relevanceScore: parseFloat(el.getAttribute('data-relevance-score') || '0')
      }))
    );

    // Provide feedback on first result
    await page.click('[data-testid="result-feedback"]:first-child');
    await page.click('[data-testid="feedback-relevant"]');
    await page.click('[data-testid="submit-feedback"]');

    // Provide negative feedback on second result
    await page.click('[data-testid="result-feedback"]:nth-child(2)');
    await page.click('[data-testid="feedback-not-relevant"]');
    await page.click('[data-testid="submit-feedback"]');

    // Search again to see adjusted relevance
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'Islamic education');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]');

    const adjustedResults = await page.$$eval('[data-testid="search-result"]', els => 
      els.map(el => ({
        id: el.getAttribute('data-result-id'),
        relevanceScore: parseFloat(el.getAttribute('data-relevance-score') || '0')
      }))
    );

    // Find the same results
    const firstResultOriginal = initialResults[0];
    const secondResultOriginal = initialResults[1];

    const firstResultAdjusted = adjustedResults.find(r => r.id === firstResultOriginal.id);
    const secondResultAdjusted = adjustedResults.find(r => r.id === secondResultOriginal.id);

    if (firstResultAdjusted && secondResultAdjusted) {
      // The positively rated result should have higher or same relevance
      expect(firstResultAdjusted.relevanceScore).toBeGreaterThanOrEqual(firstResultOriginal.relevanceScore);
      // The negatively rated result should have lower relevance
      expect(secondResultAdjusted.relevanceScore).toBeLessThanOrEqual(secondResultOriginal.relevanceScore);
    }
  });

  test('should provide relevance transparency and explanations', async () => {
    await page.goto('/en/search');
    await page.fill('[data-testid="search-input"]', 'Islamic history education');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="search-results"]');

    // Check relevance explanations
    await page.click('[data-testid="relevance-explanation-toggle"]');

    const explanations = await page.$$eval('[data-testid="relevance-explanation"]', els => 
      els.map(el => ({
        resultId: el.getAttribute('data-result-id'),
        factors: JSON.parse(el.getAttribute('data-factors') || '{}'),
        explanation: el.querySelector('[data-testid="explanation-text"]')?.textContent
      }))
    );

    expect(explanations.length).toBeGreaterThan(0);

    explanations.forEach(explanation => {
      expect(explanation.factors).toBeDefined();
      expect(Object.keys(explanation.factors).length).toBeGreaterThan(0);
      expect(explanation.explanation).toBeDefined();
      expect(explanation.explanation?.length).toBeGreaterThan(0);
    });

    // Verify explanations are user-friendly
    const firstExplanation = explanations[0];
    expect(firstExplanation.explanation).toContain('matched');
    expect(firstExplanation.explanation).not.toContain('algorithm');
    expect(firstExplanation.explanation).not.toContain('score');
  });
});
```

## Performance Metrics

### Relevance Requirements
- **Relevance Score Accuracy**: > 85%
- **User Satisfaction Rate**: > 80%
- **Click-through Rate**: > 15%
- **Personalization Accuracy**: > 75%

### Quality Metrics
- **Title Match Weight**: 40%
- **Content Match Weight**: 30%
- **Popularity Weight**: 20%
- **Recency Weight**: 10%

## Cross-Browser Testing Matrix

| Browser | Version | Title Relevance | Multi-factor | Personalization | Arabic Content |
|---------|---------|----------------|-------------|-----------------|----------------|
| Chrome | 120+ | ✅ | ✅ | ✅ | ✅ |
| Firefox | 119+ | ✅ | ✅ | ✅ | ✅ |
| Safari | 17+ | ✅ | ✅ | ✅ | ✅ |
| Edge | 120+ | ✅ | ✅ | ✅ | ✅ |

## Test Execution

### Running Tests
```bash
# Run all relevance tests
pnpm test:e2e --grep "TC-SEARCH-003"

# Run specific scenarios
pnpm test:e2e --grep "should rank title matches higher"
pnpm test:e2e --grep "should apply multi-factor relevance scoring"
```

## Validation Criteria

### Success Criteria
- ✅ Title matches ranked higher
- ✅ Multi-factor scoring working
- ✅ Personalization effective
- ✅ Arabic content relevance accurate
- ✅ User feedback incorporated
- ✅ Relevance explanations provided

### Failure Criteria
- ❌ Irrelevant results ranked high
- ❌ No multi-factor scoring
- ❌ Personalization not working
- ❌ Arabic content poorly ranked
- ❌ User feedback ignored
- ❌ No relevance transparency

## Related Test Cases

- [TC-SEARCH-001](./TCSEARCH001_advanced-search-functionality.md) - Advanced Search Functionality
- [TC-SEARCH-002](./TCSEARCH002_search-performance-optimization.md) - Search Performance Optimization
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