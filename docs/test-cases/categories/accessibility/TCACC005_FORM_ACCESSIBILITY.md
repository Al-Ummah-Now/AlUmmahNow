# TCACC005: Form Accessibility

## Test Case Information

- **Test Case ID**: TCACC005
- **Category**: Accessibility
- **Sub-category**: Form Accessibility
- **Priority**: High
- **Estimated Time**: 60 minutes
- **Target Browsers**: Chrome, Firefox, Safari, Edge
- **Target Devices**: Desktop, Tablet, Mobile
- **Accessibility Standards**: WCAG 2.1 Level AA, Section 508

## Test Description

This test case validates the accessibility of all forms throughout the Al Ummah Now platform, ensuring that users with disabilities can complete form-based interactions successfully. It covers form structure, labeling, validation, error handling, and submission processes.

## Test Objectives

1. Verify all form controls have proper labels and descriptions
2. Validate form structure and semantic markup
3. Test form validation and error handling accessibility
4. Ensure keyboard navigation works for all form elements
5. Test form submission and feedback mechanisms
6. Validate complex form patterns (multi-step, conditional logic)
7. Test form accessibility across different devices and screen readers
8. Verify form error prevention and recovery

## Prerequisites

- Screen reader software (NVDA, JAWS, VoiceOver, TalkBack)
- Browser developer tools with accessibility inspector
- Axe DevTools extension
- Keyboard-only navigation capability
- Various input devices (mouse, keyboard, touch, switch)
- Form testing accounts and test data

## Test Steps

### 1. Form Structure and Semantic Markup

**1.1 Basic Form Structure**
- Navigate to any page containing forms (login, registration, video upload, etc.)
- Inspect HTML structure using developer tools
- Verify proper use of `<form>` element with appropriate attributes
- Check for semantic form elements: `<fieldset>`, `<legend>`, `<label>`

**1.2 Field Grouping**
- Identify related form fields that should be grouped
- Verify use of `<fieldset>` and `<legend>` for related controls
- Test screen reader announcement of field groups and legends
- Check that legends are descriptive and concise

**1.3 Form Labels**
- Verify every form control has an associated label:
  - Explicit `<label>` elements with `for` attribute
  - `aria-label` for controls without visible labels
  - `aria-labelledby` for controls labeled by other elements
- Test label association using screen reader
- Verify labels are descriptive and unique within the form

### 2. Input Field Accessibility

**2.1 Text Input Fields**
- Test all text input types: text, email, password, search, url, tel
- Verify proper `type` attributes for semantic meaning
- Check `autocomplete` attributes for appropriate fields
- Test `placeholder` usage (supplementary, not replacement for labels)
- Verify `required` fields are properly marked

**2.2 Select Elements**
- Test dropdown menus and multi-select boxes
- Verify `<optgroup>` usage for logical grouping
- Check that selected options are properly announced
- Test keyboard navigation through options
- Verify multi-select announcements

**2.3 Checkbox and Radio Groups**
- Test checkbox groups with proper fieldset/legend structure
- Verify radio button groups have shared name attribute
- Check individual labels for each option
- Test keyboard navigation between options
- Verify selected state announcements

**2.4 File Upload Fields**
- Test file input accessibility
- Verify custom file upload implementations are accessible
- Check file selection announcements
- Test error handling for invalid file types
- Verify multiple file selection if supported

### 3. Form Validation and Error Handling

**3.1 Client-Side Validation**
- Test required field validation
- Verify format validation (email, phone, etc.)
- Check character limit validation
- Test validation timing (inline vs. on submit)
- Verify validation messages are accessible

**3.2 Error Message Accessibility**
- Trigger validation errors intentionally
- Verify error messages are properly associated with fields:
  - `aria-describedby` linking to error message
  - `aria-invalid="true"` on invalid fields
  - Error messages in correct reading order
- Test screen reader announcement of errors
- Check error message visibility and persistence

**3.3 Error Recovery**
- Test correcting invalid entries
- Verify error messages clear when corrected
- Check that `aria-invalid` updates to "false"
- Test resubmission after error correction
- Verify focus management during error recovery

### 4. Form Submission and Feedback

**4.1 Submit Buttons**
- Verify submit buttons have descriptive labels
- Test button states (enabled/disabled)
- Check `aria-disabled` for disabled submit buttons
- Verify submit button is keyboard accessible
- Test form submission via Enter key

**4.2 Submission Feedback**
- Submit forms successfully and test feedback:
  - Success messages are announced
  - Confirmation dialogs are accessible
  - Page redirects maintain context
  - Loading states are indicated
- Verify error handling for submission failures

**4.3 Multi-Step Forms**
- Test multi-step form processes:
  - Progress indicators are accessible
  - Step navigation works via keyboard
  - Data persistence between steps
  - Back/forward navigation maintains state
- Verify step validation and error handling

### 5. Complex Form Patterns

**5.1 Conditional Logic**
- Test forms with conditional field visibility
- Verify dynamic field announcements
- Check that hidden fields are properly excluded
- Test keyboard navigation through conditional content
- Verify ARIA attributes update correctly

**5.2 Autocomplete and Suggestions**
- Test autocomplete functionality:
  - Suggestions are announced
  - Keyboard navigation through suggestions
  - Selection mechanisms are accessible
  - ARIA attributes for combobox patterns
- Verify custom autocomplete implementations

**5.3 Rich Text Editors**
- Test rich text editor accessibility:
  - Toolbar button accessibility
  - Keyboard shortcuts and navigation
  - Content announcements
  - Format change notifications
- Verify editor focus management

### 6. Mobile and Touch Accessibility

**6.1 Touch Target Sizes**
- Verify touch targets meet minimum size requirements (44x44px)
- Test spacing between interactive elements
- Check for accidental activation prevention
- Verify touch feedback is accessible

**6.2 Mobile Input Types**
- Test appropriate mobile input types:
  - `type="email"` brings up email keyboard
  - `type="tel"` brings up phone keypad
  - `type="number"` brings up numeric keypad
- Verify input mode attributes for better mobile experience

**6.3 Orientation and Responsive Forms**
- Test form layout in portrait and landscape
- Verify form usability across viewport sizes
- Check that labels remain associated with controls
- Test zoom functionality (200% zoom)

### 7. Screen Reader Testing

**7.1 Form Navigation**
- Use screen reader to navigate through forms
- Test all navigation methods:
  - Tab/Shift+Tab between controls
  - Virtual cursor navigation
  - Form control shortcuts
  - Landmark navigation to forms
- Verify reading order matches visual order

**7.2 State Announcements**
- Test announcement of form states:
  - Required field indicators
  - Validation errors
  - Success/completion messages
  - Loading/processing states
- Verify announcements are timely and informative

**7.3 Context and Instructions**
- Verify form instructions are accessible:
  - General form instructions
  - Field-specific help text
  - Format requirements
  - Error recovery guidance
- Test help text association with controls

## Expected Results

### 1. Form Structure
- All forms use proper semantic HTML elements
- Related fields are grouped with fieldset/legend
- Every control has an accessible label
- Form structure is logical and predictable

### 2. Input Accessibility
- All input types are properly implemented
- Labels are descriptive and correctly associated
- Required fields are clearly indicated
- Autocomplete attributes enhance usability

### 3. Validation and Errors
- Validation errors are clearly announced
- Error messages are linked to invalid fields
- Error recovery is straightforward
- No loss of data during validation

### 4. Submission Process
- Submit buttons are clearly labeled and accessible
- Submission feedback is timely and informative
- Multi-step forms maintain progress and context
- Loading states are properly indicated

### 5. Complex Patterns
- Conditional logic works seamlessly
- Autocomplete features are fully accessible
- Rich text editors support assistive technology
- Dynamic content updates are properly announced

### 6. Mobile Experience
- Touch targets meet size requirements
- Mobile keyboards are appropriate for input types
- Forms work across all orientations
- Zoom functionality maintains usability

### 7. Screen Reader Support
- All form elements are properly announced
- Navigation methods work as expected
- State changes are communicated
- Context and help are readily available

## Test Data

### Sample Form Markup for Testing
```html
<form novalidate aria-labelledby="form-title">
  <h2 id="form-title">Video Upload Form</h2>
  
  <fieldset>
    <legend>Video Information</legend>
    
    <div class="form-group">
      <label for="video-title">Video Title *</label>
      <input 
        type="text" 
        id="video-title" 
        name="title" 
        required 
        aria-describedby="title-help title-error"
        maxlength="100"
        autocomplete="off"
      >
      <div id="title-help" class="help-text">
        Enter a descriptive title for your video (max 100 characters)
      </div>
      <div id="title-error" class="error-message" role="alert" aria-live="polite"></div>
    </div>

    <div class="form-group">
      <label for="video-description">Description</label>
      <textarea 
        id="video-description" 
        name="description" 
        rows="4"
        aria-describedby="description-help"
        maxlength="500"
      ></textarea>
      <div id="description-help" class="help-text">
        Optional: Add a description to help viewers understand your content
      </div>
    </div>

    <div class="form-group">
      <label for="video-category">Category *</label>
      <select 
        id="video-category" 
        name="category" 
        required
        aria-describedby="category-error"
      >
        <option value="">Select a category</option>
        <optgroup label="Educational">
          <option value="lectures">Lectures</option>
          <option value="tutorials">Tutorials</option>
        </optgroup>
        <optgroup label="Entertainment">
          <option value="nasheeds">Nasheeds</option>
          <option value="stories">Stories</option>
        </optgroup>
      </select>
      <div id="category-error" class="error-message" role="alert" aria-live="polite"></div>
    </div>
  </fieldset>

  <fieldset>
    <legend>Video Settings</legend>
    
    <div class="form-group">
      <legend class="group-label">Privacy Settings</legend>
      <div class="radio-group">
        <input type="radio" id="privacy-public" name="privacy" value="public" checked>
        <label for="privacy-public">Public - Anyone can view</label>
      </div>
      <div class="radio-group">
        <input type="radio" id="privacy-private" name="privacy" value="private">
        <label for="privacy-private">Private - Only you can view</label>
      </div>
      <div class="radio-group">
        <input type="radio" id="privacy-unlisted" name="privacy" value="unlisted">
        <label for="privacy-unlisted">Unlisted - Anyone with link can view</label>
      </div>
    </div>

    <div class="form-group">
      <div class="checkbox-group">
        <input type="checkbox" id="allow-comments" name="allowComments" checked>
        <label for="allow-comments">Allow comments on this video</label>
      </div>
      <div class="checkbox-group">
        <input type="checkbox" id="allow-downloads" name="allowDownloads">
        <label for="allow-downloads">Allow viewers to download this video</label>
      </div>
    </div>
  </fieldset>

  <fieldset>
    <legend>Upload File</legend>
    
    <div class="form-group">
      <label for="video-file">Video File *</label>
      <input 
        type="file" 
        id="video-file" 
        name="videoFile" 
        accept="video/*"
        required
        aria-describedby="file-help file-error"
      >
      <div id="file-help" class="help-text">
        Supported formats: MP4, WebM, OGG. Maximum file size: 2GB
      </div>
      <div id="file-error" class="error-message" role="alert" aria-live="polite"></div>
    </div>
  </fieldset>

  <div class="form-actions">
    <button type="button" class="btn-secondary">Save as Draft</button>
    <button type="submit" class="btn-primary" aria-describedby="submit-help">
      Upload Video
    </button>
    <div id="submit-help" class="help-text">
      Upload may take several minutes depending on file size and connection speed
    </div>
  </div>
</form>
```

### Form Validation JavaScript Example
```javascript
class FormValidator {
  constructor(form) {
    this.form = form;
    this.setupValidation();
  }

  setupValidation() {
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));
    
    // Real-time validation
    this.form.querySelectorAll('input, select, textarea').forEach(field => {
      field.addEventListener('blur', () => this.validateField(field));
      field.addEventListener('input', () => this.clearError(field));
    });
  }

  validateField(field) {
    const errorElement = document.getElementById(`${field.id}-error`);
    let isValid = true;
    let errorMessage = '';

    // Required validation
    if (field.hasAttribute('required') && !field.value.trim()) {
      isValid = false;
      errorMessage = `${this.getFieldLabel(field)} is required`;
    }

    // Email validation
    if (field.type === 'email' && field.value && !this.isValidEmail(field.value)) {
      isValid = false;
      errorMessage = 'Please enter a valid email address';
    }

    // File validation
    if (field.type === 'file' && field.files.length > 0) {
      const file = field.files[0];
      if (!this.isValidFileType(file)) {
        isValid = false;
        errorMessage = 'Invalid file type. Please upload a video file';
      }
      if (file.size > 2 * 1024 * 1024 * 1024) { // 2GB
        isValid = false;
        errorMessage = 'File size exceeds 2GB limit';
      }
    }

    // Update UI and ARIA attributes
    if (isValid) {
      this.clearError(field);
    } else {
      this.showError(field, errorMessage);
    }

    return isValid;
  }

  showError(field, message) {
    const errorElement = document.getElementById(`${field.id}-error`);
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
    }
    
    field.setAttribute('aria-invalid', 'true');
    field.classList.add('error');
  }

  clearError(field) {
    const errorElement = document.getElementById(`${field.id}-error`);
    if (errorElement) {
      errorElement.textContent = '';
      errorElement.style.display = 'none';
    }
    
    field.setAttribute('aria-invalid', 'false');
    field.classList.remove('error');
  }

  handleSubmit(e) {
    let isFormValid = true;
    
    // Validate all fields
    this.form.querySelectorAll('input, select, textarea').forEach(field => {
      if (!this.validateField(field)) {
        isFormValid = false;
      }
    });

    if (!isFormValid) {
      e.preventDefault();
      
      // Focus first invalid field
      const firstInvalid = this.form.querySelector('[aria-invalid="true"]');
      if (firstInvalid) {
        firstInvalid.focus();
      }
      
      // Announce form errors
      this.announceFormErrors();
    }
  }

  announceFormErrors() {
    const errorFields = this.form.querySelectorAll('[aria-invalid="true"]');
    const errorCount = errorFields.length;
    
    if (errorCount > 0) {
      const announcement = `Form has ${errorCount} error${errorCount > 1 ? 's' : ''}. Please review and correct.`;
      
      // Create or update live region for announcements
      let liveRegion = document.getElementById('form-announcements');
      if (!liveRegion) {
        liveRegion = document.createElement('div');
        liveRegion.id = 'form-announcements';
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        liveRegion.className = 'sr-only';
        document.body.appendChild(liveRegion);
      }
      
      liveRegion.textContent = announcement;
    }
  }

  getFieldLabel(field) {
    // Get label text for accessibility announcements
    const label = document.querySelector(`label[for="${field.id}"]`);
    return label ? label.textContent.trim() : field.name || field.id;
  }

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  isValidFileType(file) {
    const validTypes = ['video/mp4', 'video/webm', 'video/ogg'];
    return validTypes.includes(file.type);
  }
}
```

## Performance Metrics

- **Form Completion Rate**: 95%+ for users with disabilities
- **Error Recovery Time**: < 10 seconds to identify and fix errors
- **Keyboard Navigation**: 100% of form elements reachable via keyboard
- **Screen Reader Compatibility**: 100% of forms properly announced
- **Touch Target Compliance**: 100% meet 44x44px minimum
- **Validation Response Time**: < 2 seconds for feedback

## Cross-Browser Testing Matrix

| Browser | Version | Form Controls | Validation | Screen Reader | Status |
|---------|---------|---------------|-------------|---------------|--------|
| Chrome | 120+ | ✅ | ✅ | NVDA, JAWS | ✅ |
| Firefox | 119+ | ✅ | ✅ | NVDA, JAWS | ✅ |
| Safari | 17+ | ✅ ✅ | VoiceOver | ✅ |
| Edge | 120+ | ✅ | ✅ | NVDA, JAWS | ✅ |

## Mobile Testing Requirements

### Touch Interface Testing
- **iOS**: VoiceOver navigation and form completion
- **Android**: TalkBack navigation and form completion
- Touch target size verification
- Gesture-based form interactions

### Responsive Form Testing
- Portrait and landscape orientations
- Different screen sizes and resolutions
- Zoom functionality (200%)
- Mobile-specific input types

## RTL Testing Requirements

### Arabic Form Support
- Right-to-left text input and display
- Label positioning in RTL layout
- Error message text direction
- Screen reader announcements in Arabic

### Bilingual Forms
- Language switching maintains form state
- Labels update correctly with language
- Validation messages in appropriate language
- Input methods work for both languages

## Automation Script

```typescript
import { test, expect } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';

test.describe('Form Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/upload');
  });

  test('form structure and semantic markup', async ({ page }) => {
    // Check for proper form element
    const form = page.locator('form');
    await expect(form).toBeVisible();
    
    // Check for fieldsets and legends
    const fieldsets = page.locator('fieldset');
    const fieldsetCount = await fieldsets.count();
    
    for (let i = 0; i < fieldsetCount; i++) {
      const fieldset = fieldsets.nth(i);
      const legend = fieldset.locator('legend');
      await expect(legend).toHaveCount(1);
    }

    // Check for labels on all form controls
    const formControls = page.locator('input, select, textarea');
    const controlCount = await formControls.count();
    
    for (let i = 0; i < controlCount; i++) {
      const control = formControls.nth(i);
      const id = await control.getAttribute('id');
      
      if (id) {
        // Check for explicit label
        const label = page.locator(`label[for="${id}"]`);
        const hasLabel = await label.count() > 0;
        
        // Check for aria-label
        const ariaLabel = await control.getAttribute('aria-label');
        
        // Check for aria-labelledby
        const ariaLabelledBy = await control.getAttribute('aria-labelledby');
        
        expect(hasLabel || ariaLabel || ariaLabelledBy).toBeTruthy();
      }
    }
  });

  test('input field accessibility', async ({ page }) => {
    // Test text input fields
    const textInputs = page.locator('input[type="text"], input[type="email"], input[type="password"]');
    const textInputCount = await textInputs.count();
    
    for (let i = 0; i < textInputCount; i++) {
      const input = textInputs.nth(i);
      
      // Check for proper type attribute
      const type = await input.getAttribute('type');
      expect(['text', 'email', 'password', 'search', 'url', 'tel']).toContain(type);
      
      // Check for autocomplete where appropriate
      if (type === 'email') {
        const autocomplete = await input.getAttribute('autocomplete');
        expect(autocomplete).toBe('email');
      }
      
      // Check required fields
      const isRequired = await input.getAttribute('required');
      if (isRequired) {
        const ariaRequired = await input.getAttribute('aria-required');
        expect(ariaRequired).toBe('true');
      }
    }

    // Test select elements
    const selects = page.locator('select');
    const selectCount = await selects.count();
    
    for (let i = 0; i < selectCount; i++) {
      const select = selects.nth(i);
      await expect(select).toBeVisible();
      
      // Check for options
      const options = select.locator('option');
      await expect(options).toHaveCount.greaterThan(0);
    }

    // Test checkbox and radio groups
    const checkboxes = page.locator('input[type="checkbox"]');
    const radios = page.locator('input[type="radio"]');
    
    // Check that all checkboxes and radios have labels
    const allCheckboxesAndRadios = checkboxes.add(radios);
    const checkRadioCount = await allCheckboxesAndRadios.count();
    
    for (let i = 0; i < checkRadioCount; i++) {
      const control = allCheckboxesAndRadios.nth(i);
      const id = await control.getAttribute('id');
      
      if (id) {
        const label = page.locator(`label[for="${id}"]`);
        await expect(label).toHaveCount(1);
      }
    }
  });

  test('form validation and error handling', async ({ page }) => {
    // Test required field validation
    const requiredFields = page.locator('[required]');
    const requiredCount = await requiredFields.count();
    
    for (let i = 0; i < requiredCount; i++) {
      const field = requiredFields.nth(i);
      const fieldId = await field.getAttribute('id');
      
      // Clear field if it has a value
      await field.fill('');
      
      // Trigger validation (blur event)
      await field.blur();
      
      // Check for error message
      if (fieldId) {
        const errorElement = page.locator(`#${fieldId}-error`);
        const hasError = await errorElement.count() > 0;
        
        if (hasError) {
          await expect(errorElement).toBeVisible();
          await expect(errorElement).toHaveAttribute('role', 'alert');
        }
      }
      
      // Check aria-invalid attribute
      const ariaInvalid = await field.getAttribute('aria-invalid');
      expect(ariaInvalid).toBe('true');
    }

    // Test error recovery
    const firstInvalid = page.locator('[aria-invalid="true"]').first();
    if (await firstInvalid.count() > 0) {
      const fieldId = await firstInvalid.getAttribute('id');
      
      // Fill in valid data
      if (await firstInvalid.getAttribute('type') === 'email') {
        await firstInvalid.fill('test@example.com');
      } else {
        await firstInvalid.fill('Test Value');
      }
      
      // Trigger validation
      await firstInvalid.blur();
      
      // Check error is cleared
      if (fieldId) {
        const errorElement = page.locator(`#${fieldId}-error`);
        await expect(errorElement).toHaveText('');
      }
      
      // Check aria-invalid is updated
      const ariaInvalid = await firstInvalid.getAttribute('aria-invalid');
      expect(ariaInvalid).toBe('false');
    }
  });

  test('form submission and feedback', async ({ page }) => {
    // Test submit button accessibility
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
    
    // Check button has descriptive text
    const buttonText = await submitButton.textContent();
    expect(buttonText?.trim()).toBeTruthy();
    
    // Test form submission with invalid data
    await submitButton.click();
    
    // Check for error announcements
    const liveRegion = page.locator('[aria-live="polite"]');
    const liveRegionCount = await liveRegion.count();
    
    let hasErrorAnnouncement = false;
    for (let i = 0; i < liveRegionCount; i++) {
      const region = liveRegion.nth(i);
      const text = await region.textContent();
      if (text && text.includes('error')) {
        hasErrorAnnouncement = true;
        break;
      }
    }
    
    expect(hasErrorAnnouncement).toBeTruthy();
    
    // Test focus management after validation
    const firstInvalid = page.locator('[aria-invalid="true"]').first();
    if (await firstInvalid.count() > 0) {
      const isFocused = await firstInvalid.evaluate(el => document.activeElement === el);
      expect(isFocused).toBeTruthy();
    }
  });

  test('keyboard navigation', async ({ page }) => {
    // Test tab order through form
    await page.keyboard.press('Tab');
    
    let focusedElement = await page.locator(':focus');
    let tabCount = 0;
    const maxTabs = 50; // Prevent infinite loop
    
    while (await focusedElement.count() > 0 && tabCount < maxTabs) {
      const tagName = await focusedElement.evaluate(el => el.tagName.toLowerCase());
      
      // Should be able to navigate to all form controls
      expect(['input', 'select', 'textarea', 'button']).toContain(tagName);
      
      await page.keyboard.press('Tab');
      focusedElement = await page.locator(':focus');
      tabCount++;
    }
    
    // Test Enter key submission
    const submitButton = page.locator('button[type="submit"]');
    await submitButton.focus();
    await page.keyboard.press('Enter');
    
    // Should trigger form validation
    const hasErrors = await page.locator('[aria-invalid="true"]').count() > 0;
    expect(hasErrors).toBeTruthy();
  });

  test('accessibility compliance with axe', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .include('form')
      .analyze();

    expect(accessibilityScanResults.violations).toEqual([]);
  });

  test('mobile form accessibility', async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check touch target sizes
    const formControls = page.locator('input, select, textarea, button');
    const controlCount = await formControls.count();
    
    for (let i = 0; i < controlCount; i++) {
      const control = formControls.nth(i);
      const boundingBox = await control.boundingBox();
      
      if (boundingBox) {
        expect(boundingBox.width).toBeGreaterThanOrEqual(44);
        expect(boundingBox.height).toBeGreaterThanOrEqual(44);
      }
    }
    
    // Test mobile input types
    const emailInput = page.locator('input[type="email"]');
    if (await emailInput.count() > 0) {
      const inputType = await emailInput.getAttribute('type');
      expect(inputType).toBe('email');
    }
    
    const telInput = page.locator('input[type="tel"]');
    if (await telInput.count() > 0) {
      const inputType = await telInput.getAttribute('type');
      expect(inputType).toBe('tel');
    }
  });
});

test.describe('Form Accessibility - Login Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('login form accessibility', async ({ page }) => {
    // Check form structure
    const loginForm = page.locator('form');
    await expect(loginForm).toBeVisible();
    
    // Check email field
    const emailField = page.locator('input[type="email"]');
    await expect(emailField).toBeVisible();
    
    const emailLabel = page.locator('label[for*="email"], label:has-text("Email")');
    await expect(emailLabel).toBeVisible();
    
    // Check password field
    const passwordField = page.locator('input[type="password"]');
    await expect(passwordField).toBeVisible();
    
    const passwordLabel = page.locator('label[for*="password"], label:has-text("Password")');
    await expect(passwordLabel).toBeVisible();
    
    // Check submit button
    const submitButton = page.locator('button[type="submit"]');
    await expect(submitButton).toBeVisible();
    
    // Test form submission with empty fields
    await submitButton.click();
    
    // Should show validation errors
    const emailError = page.locator('#email-error, [data-testid="email-error"]');
    const passwordError = page.locator('#password-error, [data-testid="password-error"]');
    
    if (await emailError.count() > 0) {
      await expect(emailError).toBeVisible();
      await expect(emailError).toHaveAttribute('role', 'alert');
    }
    
    if (await passwordError.count() > 0) {
      await expect(passwordError).toBeVisible();
      await expect(passwordError).toHaveAttribute('role', 'alert');
    }
    
    // Test successful login
    await emailField.fill('test@example.com');
    await passwordField.fill('password123');
    await submitButton.click();
    
    // Should redirect or show success message
    await page.waitForTimeout(2000);
    
    const currentUrl = page.url();
    const isRedirected = !currentUrl.includes('/login');
    const hasSuccessMessage = await page.locator('[data-testid="success-message"]').count() > 0;
    
    expect(isRedirected || hasSuccessMessage).toBeTruthy();
  });
});
```

## Test Environment Setup

### Required Tools
1. **Screen Readers**:
   - NVDA (Windows)
   - JAWS (Windows)
   - VoiceOver (macOS/iOS)
   - TalkBack (Android)

2. **Browser Extensions**:
   - Axe DevTools
   - WAVE Evaluation Tool
   - Accessibility Insights for Web
   - Form Validation Checker

3. **Testing Frameworks**:
   - Playwright with @axe-core/playwright
   - Custom form validation utilities
   - Mobile device emulators

### Environment Variables
```typescript
// test/config/forms.ts
export const formTestConfig = {
  testUrls: {
    login: '/login',
    register: '/register',
    upload: '/upload',
    profile: '/profile/edit',
    contact: '/contact'
  },
  testAccounts: {
    valid: {
      email: 'test@example.com',
      password: 'TestPassword123!'
    },
    invalid: {
      email: 'invalid-email',
      password: '123'
    }
  },
  validationRules: {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/,
    phone: /^\+?[\d\s-()]+$/
  },
  accessibilityThresholds: {
    touchTargetSize: 44,
    maxFormCompletionTime: 300000, // 5 minutes
    maxErrorRecoveryTime: 10000 // 10 seconds
  }
};
```

## Success Criteria

### Functional Requirements
- ✅ All form controls have accessible labels
- ✅ Form validation errors are properly announced
- ✅ Keyboard navigation works for all form elements
- ✅ Form submission provides clear feedback
- ✅ Complex form patterns are accessible
- ✅ Mobile touch targets meet size requirements
- ✅ No accessibility violations in automated testing

### Technical Requirements
- ✅ 100% compliance with WCAG 2.1 Level AA
- ✅ Proper semantic HTML structure
- ✅ ARIA attributes used correctly
- ✅ Cross-browser compatibility maintained
- ✅ Mobile responsiveness verified
- ✅ Performance impact minimal (< 3% overhead)

### User Experience Requirements
- ✅ Users can complete forms using only keyboard
- ✅ Screen reader users understand form structure
- ✅ Error recovery is intuitive and efficient
- ✅ Form completion time is reasonable
- ✅ Multi-step forms maintain context
- ✅ Consistent behavior across devices

## Bug Reporting Template

### Issue Title
`[Accessibility] Form Issue: [Specific Form/Field]`

### Environment
- **URL**: [Page where form is located]
- **Browser**: [Browser and version]
- **Screen Reader**: [Screen reader and version]
- **Device**: [Desktop/Mobile/Tablet]

### Description
[Detailed description of the form accessibility issue]

### Steps to Reproduce
1. Navigate to [form URL]
2. Attempt to [specific action]
3. Observe [accessibility barrier]

### Expected Behavior
[What should happen with proper form accessibility]

### Actual Behavior
[What actually happens]

### Screen Reader Output
[Exact text announced by screen reader]

### Form Field Details
- **Field Type**: [input/select/textarea/etc.]
- **Label Method**: [explicit label/aria-label/aria-labelledby]
- **Validation**: [client-side/server-side/both]
- **Error Message**: [current error handling]

### Suggested Fix
[Recommended solution for the form accessibility issue]

### Priority
[High/Medium/Low based on impact on form completion]

## Related Test Cases

- **TCACC001**: Keyboard Navigation and Focus Management
- **TCACC002**: Screen Reader Compatibility
- **TCACC004**: ARIA Implementation and Semantic HTML
- **TCACC007**: Mobile Accessibility
- **TCACC008**: Cognitive Accessibility

## Documentation References

- [WCAG 2.1 Form Understanding](https://www.w3.org/WAI/WCAG21/Understanding/identify-input-purpose.html)
- [MDN Form Accessibility Guide](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/forms)
- [ARIA Authoring Practices - Forms](https://www.w3.org/TR/wai-aria-practices-1.2/#forms)
- [HTML5 Form Elements](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/form)
- [Form Validation Best Practices](https://www.smashingmagazine.com/2022/03/form-validation-accessibility/)

---

**Test Case Status**: Ready for Implementation
**Last Updated**: 2024-11-18
**Next Review**: 2024-12-18