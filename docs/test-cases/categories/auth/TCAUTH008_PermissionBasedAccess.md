# TCAUTH008: Permission-Based Access Control

## Test Overview
**Test Case ID:** TCAUTH008  
**Category:** Authentication  
**Subcategory:** Authorization  
**Test Type:** Functional + Security  
**Priority:** High  
**Estimated Duration:** 15 minutes  

## Description
Verify comprehensive permission-based access control (RBAC) including role assignments, permission inheritance, resource-level permissions, dynamic permission checks, and administrative access management across both English and Arabic interfaces.

## Preconditions
- User roles are defined (Admin, Moderator, Creator, User)
- Permission system is configured
- Test users with different roles exist
- Resource permissions are set up
- Administrative interface is available

## Test Data
```typescript
const permissionTestData = {
  roles: {
    admin: {
      name: 'Administrator',
      permissions: [
        'users.create', 'users.read', 'users.update', 'users.delete',
        'content.create', 'content.read', 'content.update', 'content.delete',
        'system.read', 'system.update', 'analytics.read'
      ]
    },
    moderator: {
      name: 'Moderator',
      permissions: [
        'content.read', 'content.update', 'content.delete',
        'users.read', 'users.update',
        'analytics.read'
      ]
    },
    creator: {
      name: 'Content Creator',
      permissions: [
        'content.create', 'content.read', 'content.update',
        'analytics.read'
      ]
    },
    user: {
      name: 'Regular User',
      permissions: [
        'content.read', 'profile.read', 'profile.update'
      ]
    }
  },
  users: {
    admin: {
      email: 'admin@alummahnow.net',
      password: 'AdminPass123!',
      role: 'admin',
      userId: 'user-admin-001'
    },
    moderator: {
      email: 'moderator@alummahnow.net',
      password: 'ModPass123!',
      role: 'moderator',
      userId: 'user-mod-001'
    },
    creator: {
      email: 'creator@alummahnow.net',
      password: 'CreatorPass123!',
      role: 'creator',
      userId: 'user-creator-001'
    },
    user: {
      email: 'user@alummahnow.net',
      password: 'UserPass123!',
      role: 'user',
      userId: 'user-regular-001'
    }
  },
  resources: {
    video: {
      id: 'video-123',
      owner: 'user-creator-001',
      permissions: {
        'user-creator-001': ['read', 'update', 'delete'],
        'user-mod-001': ['read', 'update'],
        'user-admin-001': ['read', 'update', 'delete'],
        'user-regular-001': ['read']
      }
    },
    channel: {
      id: 'channel-456',
      owner: 'user-creator-001',
      permissions: {
        'user-creator-001': ['read', 'update', 'delete'],
        'user-mod-001': ['read', 'update'],
        'user-admin-001': ['read', 'update', 'delete']
      }
    }
  }
};
```

## Test Steps

### Step 1: Admin Role Access Verification
1. Login as admin user
2. Navigate to `/en/admin/dashboard`
3. Verify access to admin dashboard
4. Test access to user management (`/en/admin/users`)
5. Test access to system settings (`/en/admin/settings`)
6. Test access to analytics (`/en/admin/analytics`)
7. Verify all admin permissions work
8. Test admin API endpoints

### Step 2: Moderator Role Access Verification
1. Login as moderator user
2. Navigate to `/en/moderator/dashboard`
3. Verify access to moderator dashboard
4. Test access to content moderation (`/en/moderator/content`)
5. Test access to user management (read-only)
6. Test access to analytics
7. Verify admin areas are blocked
8. Test moderator API endpoints

### Step 3: Creator Role Access Verification
1. Login as creator user
2. Navigate to `/en/creator/dashboard`
3. Verify access to creator dashboard
4. Test video creation (`/en/videos/upload`)
5. Test video editing (own videos only)
6. Test channel management (own channel)
7. Verify admin/moderator areas are blocked
8. Test creator API endpoints

### Step 4: Regular User Role Access Verification
1. Login as regular user
2. Navigate to `/en/dashboard`
3. Verify access to user dashboard
4. Test profile management (`/en/profile`)
5. Test content viewing (public content only)
6. Verify creation tools are blocked
7. Verify admin areas are blocked
8. Test user API endpoints

### Step 5: Resource-Level Permission Testing
1. Login as creator
2. Create test video
3. Try to edit own video (should succeed)
4. Try to delete own video (should succeed)
5. Logout and login as different creator
6. Try to edit first creator's video (should fail)
7. Login as moderator
8. Try to edit video (should succeed)
9. Login as admin
10. Try to delete video (should succeed)

### Step 6: Permission Inheritance Testing
1. Test role hierarchy (Admin > Moderator > Creator > User)
2. Verify higher roles inherit lower role permissions
3. Test permission escalation scenarios
4. Test permission demotion scenarios
5. Verify permission conflicts are resolved correctly

### Step 7: Dynamic Permission Checks
1. Test time-based permissions
2. Test location-based permissions
3. Test content-based permissions
4. Test conditional permissions
5. Test permission caching
6. Test real-time permission updates

### Step 8: Administrative Permission Management
1. Login as admin
2. Navigate to `/en/admin/permissions`
3. Test role creation
4. Test permission assignment
5. Test role modification
6. Test user role changes
7. Test permission revocation
8. Test permission audit logs

### Step 9: Permission Edge Cases
1. Test permission with no roles assigned
2. Test deleted roles with active users
3. Test permission conflicts
4. Test circular role dependencies
5. Test permission system failures
6. Test database permission sync

### Step 10: Arabic Interface Permission Testing
1. Repeat key permission tests in Arabic
2. Verify Arabic permission messages
3. Test Arabic admin interface
4. Verify Arabic error messages
5. Test Arabic permission management

## Expected Results
- Role-based access control works correctly
- Permissions are enforced at all levels
- Resource-level permissions function properly
- Administrative tools work as expected
- Permission inheritance works correctly
- Both language interfaces support permissions
- Security measures prevent unauthorized access

## Error Scenarios
- Permission system failures
- Database connection issues
- Role assignment conflicts
- Permission caching issues
- Concurrent permission changes

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers for permission testing
- Different user session scenarios

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';
import { PermissionUtils } from '../utils/PermissionUtils';
import { AuthUtils } from '../utils/AuthUtils';

test.describe('Permission-Based Access Control', () => {
  let permissionUtils: PermissionUtils;
  let authUtils: AuthUtils;

  test.beforeEach(async ({ page }) => {
    permissionUtils = new PermissionUtils(page);
    authUtils = new AuthUtils();
  });

  test('TCAUTH008_001: Admin role access verification', async ({ page }) => {
    // Step 1: Login as admin
    await authUtils.login(page, 'admin@alummahnow.net', 'AdminPass123!');
    
    // Verify admin dashboard access
    await page.goto('/en/admin/dashboard');
    await expect(page).toHaveURL('/en/admin/dashboard');
    await expect(page.locator('h1')).toContainText('Admin Dashboard');
    
    // Test user management access
    await page.goto('/en/admin/users');
    await expect(page).toHaveURL('/en/admin/users');
    await expect(page.locator('[data-testid="users-table"]')).toBeVisible();
    
    // Test system settings access
    await page.goto('/en/admin/settings');
    await expect(page).toHaveURL('/en/admin/settings');
    await expect(page.locator('[data-testid="settings-form"]')).toBeVisible();
    
    // Test analytics access
    await page.goto('/en/admin/analytics');
    await expect(page).toHaveURL('/en/admin/analytics');
    await expect(page.locator('[data-testid="analytics-dashboard"]')).toBeVisible();
    
    // Test admin API permissions
    const apiResponse = await page.evaluate(async () => {
      const response = await fetch('/api/admin/users', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      return { status: response.status, data: await response.json() };
    });
    
    expect(apiResponse.status).toBe(200);
    expect(apiResponse.data).toHaveProperty('users');
  });

  test('TCAUTH008_002: Moderator role access verification', async ({ page }) => {
    // Login as moderator
    await authUtils.login(page, 'moderator@alummahnow.net', 'ModPass123!');
    
    // Verify moderator dashboard access
    await page.goto('/en/moderator/dashboard');
    await expect(page).toHaveURL('/en/moderator/dashboard');
    await expect(page.locator('h1')).toContainText('Moderator Dashboard');
    
    // Test content moderation access
    await page.goto('/en/moderator/content');
    await expect(page).toHaveURL('/en/moderator/content');
    await expect(page.locator('[data-testid="content-queue"]')).toBeVisible();
    
    // Test user management (read-only)
    await page.goto('/en/admin/users');
    await expect(page).toHaveURL('/en/admin/users');
    await expect(page.locator('[data-testid="users-table"]')).toBeVisible();
    
    // Verify edit/delete buttons are disabled
    const editButtons = page.locator('button:has-text("Edit")');
    await expect(editButtons).toHaveCount(0); // Should not have edit permissions
    
    // Test analytics access
    await page.goto('/en/admin/analytics');
    await expect(page).toHaveURL('/en/admin/analytics');
    
    // Verify admin areas are blocked
    await page.goto('/en/admin/settings');
    await expect(page).toHaveURL('/en/moderator/dashboard'); // Should redirect
    await expect(page.locator('.error-message')).toContainText('access denied');
  });

  test('TCAUTH008_003: Creator role access verification', async ({ page }) => {
    // Login as creator
    await authUtils.login(page, 'creator@alummahnow.net', 'CreatorPass123!');
    
    // Verify creator dashboard access
    await page.goto('/en/creator/dashboard');
    await expect(page).toHaveURL('/en/creator/dashboard');
    await expect(page.locator('h1')).toContainText('Creator Dashboard');
    
    // Test video creation access
    await page.goto('/en/videos/upload');
    await expect(page).toHaveURL('/en/videos/upload');
    await expect(page.locator('[data-testid="upload-form"]')).toBeVisible();
    
    // Test channel management
    await page.goto('/en/channel/manage');
    await expect(page).toHaveURL('/en/channel/manage');
    await expect(page.locator('[data-testid="channel-settings"]')).toBeVisible();
    
    // Verify admin areas are blocked
    await page.goto('/en/admin/users');
    await expect(page).toHaveURL('/en/creator/dashboard');
    await expect(page.locator('.error-message')).toContainText('access denied');
    
    // Test creator API permissions
    const apiResponse = await page.evaluate(async () => {
      const response = await fetch('/api/videos', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: 'Test Video' })
      });
      return { status: response.status };
    });
    
    expect(apiResponse.status).toBe(201); // Should be able to create
  });

  test('TCAUTH008_004: Regular user role access verification', async ({ page }) => {
    // Login as regular user
    await authUtils.login(page, 'user@alummahnow.net', 'UserPass123!');
    
    // Verify user dashboard access
    await page.goto('/en/dashboard');
    await expect(page).toHaveURL('/en/dashboard');
    await expect(page.locator('h1')).toContainText('Dashboard');
    
    // Test profile management
    await page.goto('/en/profile');
    await expect(page).toHaveURL('/en/profile');
    await expect(page.locator('[data-testid="profile-form"]')).toBeVisible();
    
    // Test content viewing
    await page.goto('/en/videos');
    await expect(page).toHaveURL('/en/videos');
    await expect(page.locator('[data-testid="video-grid"]')).toBeVisible();
    
    // Verify creation tools are blocked
    await page.goto('/en/videos/upload');
    await expect(page).toHaveURL('/en/dashboard');
    await expect(page.locator('.error-message')).toContainText('access denied');
    
    // Test user API permissions
    const apiResponse = await page.evaluate(async () => {
      const response = await fetch('/api/videos', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: 'Test Video' })
      });
      return { status: response.status };
    });
    
    expect(apiResponse.status).toBe(403); // Should be forbidden
  });

  test('TCAUTH008_005: Resource-level permission testing', async ({ page }) => {
    // Login as creator and create video
    await authUtils.login(page, 'creator@alummahnow.net', 'CreatorPass123!');
    
    // Create test video
    await page.goto('/en/videos/upload');
    await page.fill('input[name="title"]', 'Test Video for Permissions');
    await page.fill('textarea[name="description"]', 'Test description');
    await page.click('button[type="submit"]');
    
    // Get video ID from URL or response
    const videoUrl = page.url();
    const videoId = videoUrl.split('/').pop() || 'video-123';
    
    // Test editing own video (should succeed)
    await page.goto(`/en/videos/${videoId}/edit`);
    await expect(page).toHaveURL(`/en/videos/${videoId}/edit`);
    await expect(page.locator('[data-testid="video-form"]')).toBeVisible();
    
    // Test deleting own video (should succeed)
    await page.goto(`/en/videos/${videoId}`);
    await page.click('button:has-text("Delete")');
    await page.click('button:has-text("Confirm")');
    await expect(page.locator('.success-message')).toContainText('deleted');
    
    // Logout and login as different creator
    await page.goto('/en/logout');
    await authUtils.login(page, 'user@alummahnow.net', 'UserPass123!');
    
    // Try to access creator's video (should fail)
    await page.goto(`/en/videos/${videoId}/edit`);
    await expect(page).toHaveURL('/en/dashboard');
    await expect(page.locator('.error-message')).toContainText('access denied');
  });

  test('TCAUTH008_006: Permission inheritance testing', async ({ page }) => {
    // Test that admin inherits all lower role permissions
    await authUtils.login(page, 'admin@alummahnow.net', 'AdminPass123!');
    
    // Test creator permissions (should work for admin)
    await page.goto('/en/videos/upload');
    await expect(page).toHaveURL('/en/videos/upload');
    
    // Test moderator permissions (should work for admin)
    await page.goto('/en/moderator/content');
    await expect(page).toHaveURL('/en/moderator/content');
    
    // Test user permissions (should work for admin)
    await page.goto('/en/profile');
    await expect(page).toHaveURL('/en/profile');
    
    // Test permission escalation
    await page.goto('/en/admin/users');
    const userPermissions = await page.evaluate(async () => {
      const response = await fetch('/api/admin/permissions/user-regular-001', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      return await response.json();
    });
    
    expect(userPermissions.permissions).toContain('content.read');
  });

  test('TCAUTH008_007: Dynamic permission checks', async ({ page }) => {
    // Login as admin
    await authUtils.login(page, 'admin@alummahnow.net', 'AdminPass123!');
    
    // Test time-based permissions
    await page.goto('/en/admin/settings');
    await page.fill('input[name="maintenanceMode"]', 'true');
    await page.click('button[type="submit"]');
    
    // Logout and login as regular user
    await page.goto('/en/logout');
    await authUtils.login(page, 'user@alummahnow.net', 'UserPass123!');
    
    // Should have limited access during maintenance
    await page.goto('/en/videos');
    await expect(page.locator('.maintenance-notice')).toBeVisible();
    
    // Test conditional permissions
    const conditionalAccess = await page.evaluate(async () => {
      const response = await fetch('/api/videos/featured', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      return response.status;
    });
    
    expect(conditionalAccess).toBe(200); // Featured content should be accessible
  });

  test('TCAUTH008_008: Administrative permission management', async ({ page }) => {
    // Login as admin
    await authUtils.login(page, 'admin@alummahnow.net', 'AdminPass123!');
    
    // Navigate to permission management
    await page.goto('/en/admin/permissions');
    await expect(page).toHaveURL('/en/admin/permissions');
    
    // Test role creation
    await page.click('button:has-text("Create Role")');
    await page.fill('input[name="roleName"]', 'Test Role');
    await page.check('input[value="content.read"]');
    await page.check('input[value="profile.update"]');
    await page.click('button:has-text("Create")');
    
    // Verify role was created
    await expect(page.locator('.success-message')).toContainText('role created');
    
    // Test permission assignment
    await page.goto('/en/admin/users');
    await page.click('button:has-text("Edit"):first-child');
    await page.selectOption('select[name="role"]', 'Test Role');
    await page.click('button:has-text("Save")');
    
    // Verify role assignment
    await expect(page.locator('.success-message')).toContainText('role updated');
    
    // Test permission audit logs
    await page.goto('/en/admin/audit');
    await expect(page.locator('[data-testid="audit-log"]')).toBeVisible();
    await expect(page.locator('text=role created')).toBeVisible();
  });

  test('TCAUTH008_009: Permission edge cases', async ({ page }) => {
    // Test user with no role
    await authUtils.loginWithNoRole(page, 'norole@alummahnow.net', 'NoRolePass123!');
    
    // Should have minimal access
    await page.goto('/en/dashboard');
    await expect(page.locator('.error-message')).toContainText('no role assigned');
    
    // Test deleted role scenario
    await page.goto('/en/logout');
    await authUtils.loginWithDeletedRole(page, 'deletedrole@alummahnow.net', 'DeletedPass123!');
    
    // Should handle gracefully
    await expect(page.locator('.error-message')).toContainText('role not found');
    
    // Test permission system failure
    await page.goto('/en/logout');
    await authUtils.login(page, 'admin@alummahnow.net', 'AdminPass123!');
    
    // Mock permission system failure
    await page.route('**/api/permissions/**', route => {
      route.fulfill({ status: 500, body: '{"error": "Permission system unavailable"}' });
    });
    
    await page.goto('/en/admin/users');
    await expect(page.locator('.error-message')).toContainText('permission system');
  });

  test('TCAUTH008_010: Arabic interface permission testing', async ({ page }) => {
    // Test Arabic interface
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', 'admin@alummahnow.net');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    
    // Verify Arabic admin dashboard
    await expect(page).toHaveURL('/ar/admin/dashboard');
    await expect(page.locator('h1')).toContainText('لوحة الإدارة');
    
    // Test Arabic permission messages
    await page.goto('/ar/admin/users');
    await expect(page.locator('[data-testid="users-table"]')).toBeVisible();
    
    // Test Arabic error messages
    await page.goto('/ar/videos/upload'); // Should be blocked for admin in Arabic
    await expect(page.locator('.error-message')).toContainText('الوصول مرفوض');
  });
});

// Utility Classes
export class PermissionUtils {
  constructor(private page: Page) {}

  async getUserPermissions(): Promise<string[]> {
    return await this.page.evaluate(async () => {
      const response = await fetch('/api/auth/permissions', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('auth_token')}` }
      });
      const data = await response.json();
      return data.permissions || [];
    });
  }

  async checkResourcePermission(resourceId: string, action: string): Promise<boolean> {
    return await this.page.evaluate(async ({ id, act }) => {
      const response = await fetch(`/api/permissions/check`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ resource: id, action: act })
      });
      const data = await response.json();
      return data.allowed || false;
    }, { id: resourceId, action: action });
  }

  async assignRole(userId: string, role: string): Promise<boolean> {
    return await this.page.evaluate(async ({ uid, r }) => {
      const response = await fetch(`/api/admin/users/${uid}/role`, {
        method: 'PUT',
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ role: r })
      });
      return response.status === 200;
    }, { uid: userId, r: role });
  }
}

export class AuthUtils {
  async login(page: Page, email: string, password: string) {
    await page.goto('/en/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/dashboard');
  }

  async loginWithNoRole(page: Page, email: string, password: string) {
    await page.goto('/en/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
  }

  async loginWithDeletedRole(page: Page, email: string, password: string) {
    await page.goto('/en/login');
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
  }
}
```

## Test Data Management
- Test users with different roles
- Permission templates
- Role hierarchy definitions
- Resource permission mappings

## Cleanup Requirements
- Reset user roles after tests
- Clean up created roles
- Clear permission caches
- Reset resource permissions

## Success Criteria
- Role-based access control works correctly
- Permissions are enforced at all levels
- Resource-level permissions function properly
- Administrative tools work as expected
- Permission inheritance works correctly
- Both language interfaces support permissions
- Security measures prevent unauthorized access