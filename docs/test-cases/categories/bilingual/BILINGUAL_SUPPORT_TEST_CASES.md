# Bilingual Support (EN/AR with RTL) Test Cases

## Test Category Overview

This test suite covers bilingual functionality including language switching, RTL layout support, content translation, and cultural adaptation for English and Arabic languages.

## Test Cases

### TC-BIL-001: Language Switching Functionality

**Test ID**: TC-BIL-001  
**Title**: Language Switching Functionality  
**Priority**: Critical  
**Test Type**: E2E  
**Related Requirements**: BIL-001, BIL-002

**Preconditions**:
- Application is accessible
- Language switcher is available in UI
- Both language versions are deployed

**Test Steps**:
1. Navigate to any page in English (`/en/*`)
2. Locate language switcher in header/navigation
3. Click to switch to Arabic
4. Verify URL changes to `/ar/*` equivalent
5. Verify page content displays in Arabic
6. Verify layout switches to RTL
7. Switch back to English
8. Verify URL changes to `/en/*`
9. Verify content returns to English
10. Verify layout switches back to LTR
11. Test language switching on different page types
12. Test language switching with query parameters

**Expected Results**:
- Language switcher is visible and accessible
- URL structure updates correctly (`/en/*` ↔ `/ar/*`)
- Page content translates completely
- Layout direction changes immediately
- User preferences are maintained
- Query parameters are preserved during switch
- No page reload required (client-side routing)

**Test Data Requirements**:
- Pages with mixed content types
- Pages with query parameters
- Dynamic content pages

**Browser/Device Requirements**:
- All supported browsers
- Mobile devices (iOS/Android)
- Various screen sizes

---

### TC-BIL-002: RTL Layout Validation

**Test ID**: TC-BIL-002  
**Title**: RTL Layout Validation  
**Priority**: Critical  
**Test Type**: Visual Regression  
**Related Requirements**: BIL-003, BIL-004

**Preconditions**:
- Arabic language version is accessible
- RTL CSS is implemented
- Visual regression testing is configured

**Test Steps**:
1. Navigate to homepage in English
2. Capture baseline screenshot
3. Switch to Arabic version
4. Verify text direction is right-to-left
5. Verify navigation menu aligns to right
6. Verify content flows from right to left
7. Test form layouts in RTL
8. Test card/component layouts in RTL
9. Test modal/popup positioning in RTL
10. Test responsive behavior in RTL
11. Compare with expected RTL screenshots
12. Test all major page templates

**Expected Results**:
- All text renders right-to-left in Arabic
- Navigation and UI elements mirror appropriately
- Forms maintain usability in RTL
- Cards and components align correctly
- Modals and popups position properly
- Responsive breakpoints work correctly
- No horizontal overflow or layout breaks
- Visual consistency across RTL pages

**Test Data Requirements**:
- Screenshot baselines for all pages
- Various content lengths and types
- Different viewport sizes

---

### TC-BIL-003: Content Translation Accuracy

**Test ID**: TC-BIL-003  
**Title**: Content Translation Accuracy  
**Priority**: High  
**Test Type**: E2E + Manual  
**Related Requirements**: BIL-005, BIL-006

**Preconditions**:
- Translation files are complete
- Native Arabic speaker available for validation
- Translation management system is in place

**Test Steps**:
1. Navigate through all major pages in English
2. Document key UI text and labels
3. Switch to Arabic version
4. Verify all text is translated (no English remaining)
5. Verify translation accuracy and context
6. Check for proper Arabic grammar and syntax
7. Verify cultural appropriateness of translations
8. Test dynamic content translation
9. Test error message translations
10. Test form validation messages
11. Test date/time formatting in Arabic
12. Test number formatting in Arabic

**Expected Results**:
- 100% of UI text is translated
- Translations are accurate and contextually appropriate
- Arabic grammar and syntax are correct
- Cultural references are appropriate
- Dynamic content translates correctly
- Error messages are clear and translated
- Date/time formats follow Arabic conventions
- Numbers use Arabic-Indic digits where appropriate

**Test Data Requirements**:
- Translation key-value mappings
- Native Arabic speaker for validation
- Various content types (UI, errors, dynamic)

---

### TC-BIL-004: Mixed Language Content Handling

**Test ID**: TC-BIL-004  
**Title**: Mixed Language Content Handling  
**Priority**: Medium  
**Test Type**: E2E  
**Related Requirements**: BIL-007, BIL-008

**Preconditions**:
- Content may contain mixed languages
- Bidirectional text algorithm is implemented
- Unicode and RTL support is configured

**Test Steps**:
1. Navigate to pages with user-generated content
2. Find content mixing English and Arabic
3. Verify text direction changes appropriately
4. Test Arabic content with English words
5. Test English content with Arabic words
6. Test URLs and email addresses in Arabic text
7. Test numbers and dates in mixed content
8. Test code snippets or technical terms
9. Test social media content with mixed languages
10. Verify readability and clarity

**Expected Results**:
- Bidirectional text algorithm works correctly
- Mixed content is readable and properly formatted
- URLs and emails remain LTR even in Arabic text
- Numbers and dates format correctly
- Technical terms maintain clarity
- Social media content displays properly
- No text overlap or rendering issues

**Test Data Requirements**:
- Mixed language content samples
- Various bidirectional text scenarios
- Special characters and symbols

---

### TC-BIL-005: Font and Typography Support

**Test ID**: TC-BIL-005  
**Title**: Font and Typography Support  
**Priority**: High  
**Test Type**: Visual  
**Related Requirements**: BIL-009, BIL-010

**Preconditions**:
- Arabic fonts are loaded and configured
- Typography system supports both languages
- Font loading strategy is implemented

**Test Steps**:
1. Navigate to Arabic pages
2. Verify Arabic fonts load correctly
3. Test font rendering quality and clarity
4. Verify font sizes are appropriate for Arabic
5. Test line height and spacing for Arabic text
6. Test font weights (bold, regular, light)
7. Test font fallbacks if primary fails
8. Test custom fonts vs system fonts
9. Verify font loading performance
10. Test font rendering across browsers
11. Test Arabic diacritics and special characters
12. Compare with English typography

**Expected Results**:
- Arabic fonts load without errors
- Text rendering is crisp and clear
- Font sizes are readable and appropriate
- Line height supports Arabic script properly
- Font weights display correctly
- Fallback fonts maintain readability
- Font loading doesn't block page rendering
- Cross-browser consistency is maintained
- Special Arabic characters render correctly

**Test Data Requirements**:
- Various Arabic text samples
- Different font weights and sizes
- Special Arabic characters and diacritics

---

### TC-BIL-006: Search Functionality in Both Languages

**Test ID**: TC-BIL-006  
**Title**: Search Functionality in Both Languages  
**Priority**: High  
**Test Type**: E2E  
**Related Requirements**: BIL-011, BIL-012

**Preconditions**:
- Search functionality is implemented
- Search index supports both languages
- Search UI is available in both languages

**Test Steps**:
1. Navigate to search page in English
2. Enter English search terms
3. Verify search results are relevant
4. Switch to Arabic language
5. Enter Arabic search terms
6. Verify search results are relevant
7. Test English terms in Arabic interface
8. Test Arabic terms in English interface
9. Test mixed language search queries
10. Verify search suggestions in both languages
11. Test search filters and sorting
12. Verify search result highlighting

**Expected Results**:
- Search works effectively in both languages
- Results are relevant regardless of interface language
- Mixed language queries are handled appropriately
- Search suggestions appear in correct language
- Filters and sorting work in both languages
- Search highlighting works for both scripts
- No encoding issues with search terms

**Test Data Requirements**:
- Test search terms in both languages
- Mixed language search queries
- Various content types to search

---

### TC-BIL-007: Form Input and Validation

**Test ID**: TC-BIL-007  
**Title**: Form Input and Validation  
**Priority**: High  
**Test Type**: E2E  
**Related Requirements**: BIL-013, BIL-014

**Preconditions**:
- Forms are available in both languages
- Input validation is implemented
- RTL input handling is configured

**Test Steps**:
1. Navigate to registration form in English
2. Fill form with English text
3. Verify validation messages in English
4. Switch to Arabic language
5. Verify form labels are in Arabic
6. Fill form with Arabic text
7. Verify validation messages in Arabic
8. Test text direction in input fields
9. Test cursor behavior in RTL inputs
10. Test password field behavior
11. Test email field validation
12. Test numeric input fields

**Expected Results**:
- Form labels and placeholders translate correctly
- Validation messages appear in correct language
- Text direction is appropriate for each language
- Cursor behavior is natural for RTL input
- Password fields work correctly in RTL
- Email validation works with Arabic interface
- Numeric inputs handle RTL properly
- No layout issues with form elements

**Test Data Requirements**:
- Various form types (registration, login, settings)
- Test data in both languages
- Validation rule test cases

---

### TC-BIL-008: URL Structure and Navigation

**Test ID**: TC-BIL-008  
**Title**: URL Structure and Navigation  
**Priority**: Critical  
**Test Type**: E2E  
**Related Requirements**: BIL-015, BIL-016

**Preconditions**:
- Bilingual routing is implemented
- URL structure follows language prefix pattern
- Navigation components are language-aware

**Test Steps**:
1. Navigate to homepage (default language)
2. Verify URL structure (`/` or `/en/`)
3. Navigate through various pages
4. Verify URLs maintain language prefix
5. Switch language on different pages
6. Verify URL updates correctly
7. Test direct navigation to language-specific URLs
8. Test browser back/forward buttons
9. Test bookmarking and sharing URLs
10. Test 404 pages in both languages
11. Test redirect handling for old URLs
12. Verify canonical URLs for SEO

**Expected Results**:
- URLs consistently use language prefixes
- Language switching updates URL correctly
- Direct navigation to language URLs works
- Browser navigation maintains language context
- Bookmarked URLs work correctly
- 404 pages are localized
- SEO best practices are followed
- No redirect loops or broken links

**Test Data Requirements**:
- Various page URLs
- Test scenarios for direct URL access
- Edge cases for URL handling

---

### TC-BIL-009: Date, Time, and Number Formatting

**Test ID**: TC-BIL-009  
**Title**: Date, Time, and Number Formatting  
**Priority**: Medium  
**Test Type**: E2E  
**Related Requirements**: BIL-017, BIL-018

**Preconditions**:
- Internationalization library is configured
- Locale-specific formatting is implemented
- Date/time data is available

**Test Steps**:
1. Navigate to pages with date displays
2. Verify date format in English (MM/DD/YYYY)
3. Switch to Arabic language
4. Verify date format follows Arabic conventions
5. Test time formatting in both languages
6. Test relative time displays ("2 hours ago")
7. Test number formatting (thousands separators)
8. Test currency formatting
9. Test percentage displays
10. Test large numbers and statistics
11. Verify calendar widgets in both languages
12. Test date picker functionality

**Expected Results**:
- Dates format according to locale conventions
- Times display appropriately for each language
- Relative time uses correct language
- Numbers use proper separators and digits
- Currency formatting is locale-appropriate
- Percentages display correctly
- Large numbers are readable
- Calendar widgets are fully localized
- Date pickers work in both languages

**Test Data Requirements**:
- Various date/time formats
- Different number ranges
- Currency and percentage values

---

### TC-BIL-010: Accessibility in Bilingual Context

**Test ID**: TC-BIL-010  
**Title**: Accessibility in Bilingual Context  
**Priority**: Critical  
**Test Type**: Accessibility  
**Related Requirements**: BIL-019, A11Y-003

**Preconditions**:
- Accessibility testing tools are configured
- Screen readers support both languages
- WCAG 2.1 AA compliance is required

**Test Steps**:
1. Test screen reader navigation in English
2. Verify proper language announcement
3. Switch to Arabic language
4. Verify screen reader announces Arabic correctly
5. Test ARIA labels in both languages
6. Test form accessibility in RTL
7. Test keyboard navigation in RTL
8. Test focus indicators in both languages
9. Test color contrast in both themes
10. Test high contrast mode support
11. Test reduced motion preferences
12. Verify lang attributes are correct

**Expected Results**:
- Screen readers correctly identify language changes
- ARIA labels are translated and accurate
- Keyboard navigation works in RTL
- Focus indicators are visible in both layouts
- Color contrast meets WCAG standards
- High contrast mode works properly
- Reduced motion is respected
- HTML lang attributes are correct
- All accessibility features work in both languages

**Test Data Requirements**:
- Screen reader software (NVDA, VoiceOver, TalkBack)
- Accessibility testing tools
- Various accessibility scenarios

---

## Test Execution Notes

### Environment Setup
- Configure test environments for both languages
- Set up Arabic keyboard layouts for testing
- Install required fonts and language packs
- Configure screen readers for both languages

### Test Data Management
- Maintain test content in both languages
- Use consistent translation keys
- Prepare mixed language content samples
- Create test data for various formatting scenarios

### Common Issues
- Font loading delays in Arabic
- Bidirectional text algorithm edge cases
- Screen reader language switching
- RTL layout browser inconsistencies

### Success Metrics
- 100% language switching functionality
- Zero untranslated UI elements
- WCAG 2.1 AA compliance in both languages
- < 1 second language switching response time
- 100% RTL layout accuracy