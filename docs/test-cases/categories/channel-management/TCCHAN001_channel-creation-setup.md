# TC-CHAN-001: Channel Creation and Setup

## Test Case Information

**Test ID**: TC-CHAN-001  
**Title**: Channel Creation and Setup  
**Priority**: High  
**Type**: E2E  
**Category**: Channel Management  
**Estimated Duration**: 5 minutes  
**Last Updated**: 2025-11-20  

## Test Description

This test case verifies the complete channel creation workflow, including form validation, data persistence, and proper setup of default channel configurations.

## Prerequisites

1. User must be logged in with a verified account
2. User must not have an existing channel
3. Required permissions for channel creation must be granted
4. API endpoints must be accessible and functional

## Test Data

```typescript
const validChannelData = {
  name: "Test Channel " + Date.now(),
  handle: "testchannel" + Date.now(),
  description: "This is a test channel for E2E testing",
  category: "education",
  language: "en",
  visibility: "public"
};

const invalidChannelData = {
  name: "", // Empty name
  handle: "invalid@handle", // Invalid characters
  description: "",
  category: "",
  language: ""
};
```

## Test Steps

### 1. Navigate to Channel Creation

```bash
# English version
GET /en/channels/create

# Arabic version  
GET /ar/channels/create
```

**Expected Results:**
- Channel creation form loads successfully
- All form fields are present and labeled correctly
- Form is in the correct language (EN/AR)
- RTL layout is applied for Arabic version

### 2. Fill Valid Channel Data

**Actions:**
1. Enter channel name: `validChannelData.name`
2. Enter channel handle: `validChannelData.handle`
3. Enter description: `validChannelData.description`
4. Select category: `validChannelData.category`
5. Select language: `validChannelData.language`
6. Set visibility: `validChannelData.visibility`

**Expected Results:**
- All fields accept valid input
- Real-time validation shows success indicators
- Handle availability check runs successfully
- Character counters work correctly

### 3. Submit Valid Form

**Actions:**
1. Click "Create Channel" button
2. Wait for API response
3. Monitor loading states

**Expected Results:**
- Form submission is successful
- Loading indicator appears during processing
- User is redirected to new channel page
- Success notification is displayed
- Channel data is persisted in database

### 4. Verify Channel Creation

**Actions:**
1. Navigate to created channel: `/en/channels/{channelId}`
2. Verify channel information
3. Check default settings

**Expected Results:**
- Channel page loads with correct information
- Channel name, handle, and description are displayed
- Default channel sections are created
- Channel tabs are properly configured
- Analytics tracking is initialized

### 5. Test Form Validation (Negative Case)

**Actions:**
1. Navigate back to creation page
2. Submit form with `invalidChannelData`
3. Test each validation rule individually

**Expected Results:**
- Form validation errors are displayed
- Submission is blocked for invalid data
- Error messages are localized correctly
- Field-specific validation indicators appear

## Test Automation (Playwright)

```typescript
import { test, expect } from '@playwright/test';

test.describe('Channel Creation and Setup', () => {
  test.beforeEach(async ({ page }) => {
    // Login and navigate to channel creation
    await page.goto('/en/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'password123');
    await page.click('[data-testid="login-button"]');
    await page.waitForURL('/en');
    await page.goto('/en/channels/create');
  });

  test('should create channel with valid data', async ({ page }) => {
    const channelData = {
      name: `Test Channel ${Date.now()}`,
      handle: `testchannel${Date.now()}`,
      description: 'This is a test channel for E2E testing',
      category: 'education',
      language: 'en',
      visibility: 'public'
    };

    // Fill form
    await page.fill('[data-testid="channel-name"]', channelData.name);
    await page.fill('[data-testid="channel-handle"]', channelData.handle);
    await page.fill('[data-testid="channel-description"]', channelData.description);
    await page.selectOption('[data-testid="channel-category"]', channelData.category);
    await page.selectOption('[data-testid="channel-language"]', channelData.language);
    await page.selectOption('[data-testid="channel-visibility"]', channelData.visibility);

    // Submit form
    await page.click('[data-testid="create-channel-button"]');

    // Wait for redirect and verify
    await page.waitForURL(/\/en\/channels\/[a-zA-Z0-9-]+/);
    
    // Verify channel creation
    await expect(page.locator('[data-testid="channel-name"]')).toHaveText(channelData.name);
    await expect(page.locator('[data-testid="channel-handle"]')).toHaveText(`@${channelData.handle}`);
    await expect(page.locator('[data-testid="channel-description"]')).toHaveText(channelData.description);
  });

  test('should validate form inputs correctly', async ({ page }) => {
    // Test empty name
    await page.click('[data-testid="create-channel-button"]');
    await expect(page.locator('[data-testid="name-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="name-error"]')).toContainText('Channel name is required');

    // Test invalid handle
    await page.fill('[data-testid="channel-name"]', 'Test Channel');
    await page.fill('[data-testid="channel-handle"]', 'invalid@handle');
    await page.click('[data-testid="create-channel-button"]');
    await expect(page.locator('[data-testid="handle-error"]')).toBeVisible();
    await expect(page.locator('[data-testid="handle-error"]')).toContainText('Handle can only contain letters, numbers, and hyphens');
  });

  test('should work in Arabic (RTL)', async ({ page }) => {
    await page.goto('/ar/channels/create');
    
    // Verify RTL layout
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    
    const channelData = {
      name: `قناة الاختبار ${Date.now()}`,
      handle: `testchannel${Date.now()}`,
      description: 'هذه قناة اختبار للاختبار الآلي'
    };

    // Fill form in Arabic
    await page.fill('[data-testid="channel-name"]', channelData.name);
    await page.fill('[data-testid="channel-handle"]', channelData.handle);
    await page.fill('[data-testid="channel-description"]', channelData.description);

    // Submit and verify
    await page.click('[data-testid="create-channel-button"]');
    await page.waitForURL(/\/ar\/channels\/[a-zA-Z0-9-]+/);
    
    await expect(page.locator('[data-testid="channel-name"]')).toHaveText(channelData.name);
  });
});
```

## API Endpoints Tested

- `POST /api/channels` - Channel creation
- `GET /api/channels/{id}` - Channel verification
- `GET /api/channels/{id}/tabs` - Default tabs verification
- `GET /api/channels/{id}/sections` - Default sections verification

## Success Criteria

- ✅ Channel creation form loads and functions correctly
- ✅ Form validation works for all required fields
- ✅ Channel is created successfully with valid data
- ✅ User is redirected to the new channel page
- ✅ Channel data persists correctly
- ✅ Default configurations are applied
- ✅ Bilingual support works (EN/AR)
- ✅ RTL layout is correct for Arabic
- ✅ Error handling works appropriately
- ✅ Loading states provide good UX

## Failure Scenarios

1. **API Unavailable**: Display appropriate error message and retry option
2. **Validation Errors**: Show field-specific error messages
3. **Permission Denied**: Redirect to permissions request page
4. **Rate Limiting**: Show rate limit message with retry timing
5. **Network Issues**: Display offline state and retry mechanism

## Test Environment

- **Browser**: Chrome, Firefox, Safari, Mobile Chrome, Mobile Safari
- **Viewport**: Desktop (1920x1080), Mobile (375x667)
- **Network**: 3G, 4G, WiFi
- **Language**: English (en), Arabic (ar)

## Related Test Cases

- [TC-CHAN-002](./TCCHAN002_channel-customization.md) - Channel Customization
- [TC-CHAN-003](./TCCHAN003_channel-content-management.md) - Channel Content Management
- [TC-AUTH-001](../auth/TCAUTH001_UserLoginValid.md) - User Authentication

## Test Execution History

| Date | Environment | Result | Notes |
|------|-------------|--------|-------|
| 2025-11-20 | Staging | ✅ Pass | Initial implementation |
| | | | |

## Test Maintenance

- Update form selectors when UI changes
- Modify validation rules when business logic changes
- Add new test data scenarios as needed
- Update API endpoint references when backend changes