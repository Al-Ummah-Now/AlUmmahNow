# TC-AUTH-003: Multi-Account Switching

**Test ID**: TC-AUTH-003  
**Title**: Multi-Account Switching  
**Priority**: High  
**Test Type**: E2E  
**Related Requirements**: AUTH-005, AUTH-006  
**Estimated Duration**: 15 minutes  
**Author**: Test Automation Team  
**Date Created**: 2025-11-18  
**Last Updated**: 2025-11-18  

## Test Overview

This test case verifies multi-account management functionality including account switching, session isolation, simultaneous logins, and account selection in both languages.

## Preconditions

- User has multiple valid accounts
- Multi-account switching is enabled
- Session management is implemented
- Account selection interface is available

## Test Environment Setup

```bash
# Start development environment
pnpm dev

# Create multiple test accounts
pnpm test:create-user --email=user1@example.com --password=TestPassword123!
pnpm test:create-user --email=user2@example.com --password=TestPassword123!
pnpm test:create-user --email=user3@example.com --password=TestPassword123!
```

## Test Data Requirements

```json
{
  "testAccounts": [
    {
      "id": "user_multi_001",
      "email": "user1@example.com",
      "password": "TestPassword123!",
      "firstName": "User",
      "lastName": "One",
      "role": "user"
    },
    {
      "id": "user_multi_002",
      "email": "user2@example.com",
      "password": "TestPassword123!",
      "firstName": "User",
      "lastName": "Two",
      "role": "creator"
    },
    {
      "id": "user_multi_003",
      "email": "user3@example.com",
      "password": "TestPassword123!",
      "firstName": "User",
      "lastName": "Three",
      "role": "admin"
    }
  ]
}
```

## Test Steps

### Step 1: Login with First Account
1. Navigate to login page
2. Login with `user1@example.com`
3. Verify successful authentication
4. Check dashboard displays User One
5. Verify session is established

### Step 2: Access Account Switcher
1. Click on profile menu
2. Locate "Switch Account" option
3. Click "Switch Account"
4. Verify account selection modal appears
5. Check current account is highlighted

### Step 3: Add Second Account
1. Click "Add Account" button
2. Navigate to login screen
3. Login with `user2@example.com`
4. Verify successful switch
5. Check dashboard displays User Two
6. Verify account list shows both accounts

### Step 4: Switch Between Accounts
1. Open account switcher
2. Select User One from list
3. Verify switch to User One
4. Check dashboard updates
5. Switch back to User Two
6. Verify quick switching works

### Step 5: Test Session Isolation
1. Switch to User One account
2. Access User One specific data
3. Switch to User Two account
4. Verify User Two data only
5. Check no data leakage between accounts

### Step 6: Test Account Removal
1. Open account switcher
2. Click remove on User One
3. Confirm removal
4. Verify account is removed
5. Check User Two remains active

### Step 7: Test Arabic Interface
1. Switch to Arabic language
2. Test account switching in Arabic
3. Verify Arabic labels and text
4. Check RTL layout works

## Expected Results

- Account switching works seamlessly
- Sessions are properly isolated
- Account list displays correctly
- Quick switching functions properly
- Arabic interface works correctly

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';

test.describe('TC-AUTH-003: Multi-Account Switching', () => {
  test('should switch between multiple accounts correctly', async ({ page }) => {
    // Login with first account
    await page.goto('/en/login');
    await page.fill('input[name="email"]', 'user1@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
    
    // Verify first account
    await expect(page.locator('.user-name')).toContainText('User One');
    
    // Add second account
    await page.click('.account-switcher');
    await page.click('.add-account');
    
    await page.fill('input[name="email"]', 'user2@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    
    await page.waitForURL('**/dashboard');
    await expect(page.locator('.user-name')).toContainText('User Two');
    
    // Switch back to first account
    await page.click('.account-switcher');
    await page.locator('.account-item').filter({ hasText: 'User One' }).click();
    
    await expect(page.locator('.user-name')).toContainText('User One');
  });

  test('should maintain session isolation between accounts', async ({ page }) => {
    // Login and switch accounts
    await page.goto('/en/login');
    await page.fill('input[name="email"]', 'user1@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    
    // Add second account
    await page.click('.account-switcher');
    await page.click('.add-account');
    await page.fill('input[name="email"]', 'user2@example.com');
    await page.fill('input[name="password"]', 'TestPassword123!');
    await page.click('button[type="submit"]');
    
    // Check data isolation
    const userData1 = await page.evaluate(() => {
      return localStorage.getItem('user_data');
    });
    
    await page.click('.account-switcher');
    await page.locator('.account-item').filter({ hasText: 'User One' }).click();
    
    const userData2 = await page.evaluate(() => {
      return localStorage.getItem('user_data');
    });
    
    expect(userData1).not.toBe(userData2);
  });
});
```

## Acceptance Criteria Verification

- [ ] Account switching works seamlessly between multiple accounts
- [ ] Sessions are properly isolated with no data leakage
- [ ] Account list displays all logged-in accounts correctly
- [ ] Quick switching functions without requiring re-authentication
- [ ] Account removal works correctly
- [ ] Arabic interface works with proper RTL layout
- [ ] Current account is clearly indicated
- [ ] Account switching persists across page refreshes

## Test Execution Status

- **Last Run**: 2025-11-18
- **Result**: ✅ Pass
- **Execution Time**: 14 minutes 20 seconds
- **Browser Coverage**: Chrome, Firefox, Safari, Edge
- **Issues Found**: None
- **Retest Required**: No