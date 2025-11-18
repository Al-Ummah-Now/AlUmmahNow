# TCAUTH013: Single Sign-On (SSO) Integration

## Test Overview
**Test Case ID:** TCAUTH013  
**Category:** Authentication  
**Subcategory:** Enterprise Authentication  
**Test Type:** Integration + Security  
**Priority:** Medium  
**Estimated Duration:** 12 minutes  

## Description
Verify comprehensive Single Sign-On (SSO) integration including SAML 2.0, OpenID Connect, LDAP/Active Directory integration, identity provider management, session federation, and enterprise security features across both English and Arabic interfaces.

## Preconditions
- SSO providers are configured
- SAML 2.0 endpoints are available
- OpenID Connect is set up
- LDAP/AD integration is configured
- Identity providers are registered
- Enterprise security policies are in place

## Test Data
```typescript
const ssoTestData = {
  providers: {
    saml: {
      entityId: 'al-ummah-now-saml',
      ssoUrl: 'https://sso.company.com/saml/sso',
      sloUrl: 'https://sso.company.com/saml/slo',
      certificate: '-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----',
      assertion: 'saml_assertion_123'
    },
    oidc: {
      clientId: 'al-ummah-now-oidc',
      clientSecret: 'oidc_client_secret',
      issuer: 'https://oidc.company.com',
      authorizationEndpoint: 'https://oidc.company.com/auth',
      tokenEndpoint: 'https://oidc.company.com/token',
      userInfoEndpoint: 'https://oidc.company.com/userinfo',
      idToken: 'oidc_id_token_456'
    },
    ldap: {
      server: 'ldap://ldap.company.com:389',
      bindDn: 'cn=admin,dc=company,dc=com',
      bindPassword: 'ldap_password',
      userBaseDn: 'ou=users,dc=company,dc=com',
      userFilter: '(uid={username})',
      userId: 'ldap_user_001'
    }
  },
  users: {
    samlUser: {
      email: 'samluser@company.com',
      nameId: 'saml_name_id_001',
      attributes: {
        firstName: 'SAML',
        lastName: 'User',
        email: 'samluser@company.com',
        department: 'Engineering'
      }
    },
    oidcUser: {
      email: 'oidcuser@company.com',
      sub: 'oidc_sub_002',
      profile: {
        name: 'OIDC User',
        email: 'oidcuser@company.com',
        picture: 'https://company.com/avatar.jpg'
      }
    },
    ldapUser: {
      username: 'ldapuser',
      dn: 'uid=ldapuser,ou=users,dc=company,dc=com',
      attributes: {
        cn: 'LDAP User',
        mail: 'ldapuser@company.com',
        department: 'IT'
      }
    }
  },
  sessions: {
    samlSession: 'saml_session_789',
    oidcSession: 'oidc_session_012',
    ldapSession: 'ldap_session_345'
  }
};
```

## Test Steps

### Step 1: SAML 2.0 Integration Setup
1. Navigate to `/en/admin/sso/providers`
2. Click "Add SAML Provider"
3. Enter SAML provider configuration
4. Upload SAML certificate
5. Configure SSO and SLO URLs
6. Test SAML metadata exchange
7. Verify SAML provider registration
8. Test SAML authentication flow
9. Verify attribute mapping
10. Check SAML session management

### Step 2: SAML 2.0 Authentication Flow
1. Navigate to `/en/login`
2. Click "Login with SAML"
3. Verify redirect to SAML IdP
4. Complete SAML authentication
5. Verify SAML assertion processing
6. Check user provisioning
7. Verify attribute mapping
8. Test SAML session creation
9. Verify successful login
10. Check SAML logout functionality

### Step 3: OpenID Connect Integration
1. Navigate to SSO provider settings
2. Click "Add OIDC Provider"
3. Enter OIDC provider configuration
4. Configure client credentials
5. Test OIDC discovery
6. Verify OIDC provider registration
7. Test OIDC authentication flow
8. Verify token validation
9. Check user profile mapping
10. Test OIDC session management

### Step 4: OpenID Connect Authentication Flow
1. Navigate to `/en/login`
2. Click "Login with OIDC"
3. Verify redirect to OIDC provider
4. Complete OIDC authentication
5. Verify authorization code exchange
6. Check ID token validation
7. Verify user profile retrieval
8. Test access token usage
9. Verify successful login
10. Check OIDC logout functionality

### Step 5: LDAP/Active Directory Integration
1. Navigate to SSO provider settings
2. Click "Add LDAP Provider"
3. Enter LDAP server configuration
4. Configure bind credentials
5. Set user search base and filter
6. Test LDAP connection
7. Verify LDAP provider registration
8. Test LDAP authentication
9. Check user attribute mapping
10. Verify LDAP group mapping

### Step 6: LDAP Authentication Flow
1. Navigate to `/en/login`
2. Click "Login with LDAP"
3. Enter LDAP credentials
4. Verify LDAP bind authentication
5. Check user attribute retrieval
6. Verify user provisioning
7. Test group membership mapping
8. Verify successful login
9. Check LDAP session management
10. Test LDAP password policies

### Step 7: Identity Provider Management
1. Navigate to `/en/admin/sso/providers`
2. View configured providers
3. Test provider enable/disable
4. Test provider priority settings
5. Test provider configuration updates
6. Test provider deletion
7. Test provider health checks
8. Verify provider metrics
9. Test provider failover
10. Check provider audit logs

### Step 8: Session Federation
1. Login via SAML provider
2. Navigate to partner application
3. Verify SSO session transfer
4. Test cross-application logout
5. Login via OIDC provider
6. Verify OIDC session federation
7. Test token refresh across apps
8. Login via LDAP provider
9. Verify LDAP session management
10. Test mixed provider scenarios

### Step 9: Enterprise Security Features
1. Test multi-factor authentication with SSO
2. Verify role-based access control
3. Test group-based permissions
4. Check security policy enforcement
5. Test audit logging for SSO
6. Verify compliance reporting
7. Test security incident handling
8. Check data privacy compliance
9. Test security monitoring
10. Verify security analytics

### Step 10: Arabic Interface SSO Testing
1. Repeat key SSO tests in Arabic
2. Verify Arabic SSO provider selection
3. Test Arabic SAML authentication
4. Check Arabic OIDC authentication
5. Verify Arabic LDAP authentication
6. Test Arabic error messages
7. Check Arabic provider management
8. Verify Arabic session federation
9. Test Arabic security features
10. Check Arabic compliance reporting

## Expected Results
- SAML 2.0 integration works correctly
- OpenID Connect authentication functions properly
- LDAP/AD integration is reliable
- Identity provider management is effective
- Session federation works across applications
- Enterprise security features are enforced
- Both language interfaces support SSO
- Compliance requirements are met

## Error Scenarios
- SAML provider unavailability
- OIDC token validation failures
- LDAP connection issues
- Identity provider configuration errors
- Session federation failures

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers for SSO testing
- Different enterprise environments

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';
import { SSOUtils } from '../utils/SSOUtils';
import { SAMLMock } from '../utils/SAMLMock';
import { OIDCMock } from '../utils/OIDCMock';
import { LDAPMock } from '../utils/LDAPMock';

test.describe('Single Sign-On (SSO) Integration', () => {
  let ssoUtils: SSOUtils;
  let samlMock: SAMLMock;
  let oidcMock: OIDCMock;
  let ldapMock: LDAPMock;

  test.beforeEach(async ({ page }) => {
    ssoUtils = new SSOUtils(page);
    samlMock = new SAMLMock();
    oidcMock = new OIDCMock();
    ldapMock = new LDAPMock();
  });

  test('TCAUTH013_001: SAML 2.0 integration setup', async ({ page }) => {
    // Step 1: SAML provider setup
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'admin@alummahnow.net');
    await page.fill('input[type="password"]', 'AdminPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/en/dashboard');
    
    // Navigate to SSO provider settings
    await page.goto('/en/admin/sso/providers');
    await expect(page).toHaveURL('/en/admin/sso/providers');
    
    // Add SAML provider
    await page.click('button:has-text("Add SAML Provider")');
    
    // Enter SAML configuration
    await page.fill('input[name="entityId"]', 'al-ummah-now-saml');
    await page.fill('input[name="ssoUrl"]', 'https://sso.company.com/saml/sso');
    await page.fill('input[name="sloUrl"]', 'https://sso.company.com/saml/slo');
    
    // Upload certificate (mock)
    await page.setInputFiles('input[type="file"]', 'test-saml-cert.pem');
    
    // Test SAML metadata exchange
    await page.click('button:has-text("Test Connection")');
    await expect(page.locator('.success-message')).toContainText('SAML provider connected');
    
    // Save configuration
    await page.click('button:has-text("Save Provider")');
    await expect(page.locator('.success-message')).toContainText('SAML provider added');
    
    // Verify provider in list
    await expect(page.locator('text=al-ummah-now-saml')).toBeVisible();
  });

  test('TCAUTH013_002: SAML 2.0 authentication flow', async ({ page }) => {
    // Step 2: SAML authentication
    await page.goto('/en/login');
    
    // Mock SAML IdP
    await samlMock.mockSAMLIdP();
    
    // Click SAML login
    await page.click('button:has-text("Login with SAML")');
    
    // Verify redirect to SAML IdP
    await expect(page).toHaveURL(/.*sso\.company\.com.*/);
    
    // Complete SAML authentication
    await samlMock.completeSAMLAuthentication(page);
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check user profile from SAML attributes
    await page.goto('/en/profile');
    await expect(page.locator('[data-testid="user-name"]')).toContainText('SAML User');
    await expect(page.locator('[data-testid="user-email"]')).toContainText('samluser@company.com');
    
    // Test SAML logout
    await page.goto('/en/logout');
    await expect(page).toHaveURL('/en/login');
    
    // Verify SAML SLO was called
    const samlLogoutCalled = await samlMock.wasSLOCalled();
    expect(samlLogoutCalled).toBe(true);
  });

  test('TCAUTH013_003: OpenID Connect integration', async ({ page }) => {
    // Login as admin
    await ssoUtils.loginAsAdmin();
    
    // Navigate to SSO provider settings
    await page.goto('/en/admin/sso/providers');
    
    // Add OIDC provider
    await page.click('button:has-text("Add OIDC Provider")');
    
    // Enter OIDC configuration
    await page.fill('input[name="clientId"]', 'al-ummah-now-oidc');
    await page.fill('input[name="clientSecret"]', 'oidc_client_secret');
    await page.fill('input[name="issuer"]', 'https://oidc.company.com');
    
    // Test OIDC discovery
    await page.click('button:has-text("Discover Endpoints")');
    await expect(page.locator('.success-message')).toContainText('OIDC discovery successful');
    
    // Verify discovered endpoints
    await expect(page.locator('input[name="authorizationEndpoint"]')).toHaveValue('https://oidc.company.com/auth');
    await expect(page.locator('input[name="tokenEndpoint"]')).toHaveValue('https://oidc.company.com/token');
    
    // Save configuration
    await page.click('button:has-text("Save Provider")');
    await expect(page.locator('.success-message')).toContainText('OIDC provider added');
  });

  test('TCAUTH013_004: OpenID Connect authentication flow', async ({ page }) => {
    // Step 4: OIDC authentication
    await page.goto('/en/login');
    
    // Mock OIDC provider
    await oidcMock.mockOIDCProvider();
    
    // Click OIDC login
    await page.click('button:has-text("Login with OIDC")');
    
    // Verify redirect to OIDC provider
    await expect(page).toHaveURL(/.*oidc\.company\.com.*/);
    
    // Complete OIDC authentication
    await oidcMock.completeOIDCAuthentication(page);
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check user profile from OIDC
    await page.goto('/en/profile');
    await expect(page.locator('[data-testid="user-name"]')).toContainText('OIDC User');
    await expect(page.locator('[data-testid="user-email"]')).toContainText('oidcuser@company.com');
    
    // Test OIDC logout
    await page.goto('/en/logout');
    await expect(page).toHaveURL('/en/login');
    
    // Verify OIDC logout was called
    const oidcLogoutCalled = await oidcMock.wasLogoutCalled();
    expect(oidcLogoutCalled).toBe(true);
  });

  test('TCAUTH013_005: LDAP/Active Directory integration', async ({ page }) => {
    // Login as admin
    await ssoUtils.loginAsAdmin();
    
    // Navigate to SSO provider settings
    await page.goto('/en/admin/sso/providers');
    
    // Add LDAP provider
    await page.click('button:has-text("Add LDAP Provider")');
    
    // Enter LDAP configuration
    await page.fill('input[name="server"]', 'ldap://ldap.company.com:389');
    await page.fill('input[name="bindDn"]', 'cn=admin,dc=company,dc=com');
    await page.fill('input[name="bindPassword"]', 'ldap_password');
    await page.fill('input[name="userBaseDn"]', 'ou=users,dc=company,dc=com');
    await page.fill('input[name="userFilter"]', '(uid={username})');
    
    // Test LDAP connection
    await page.click('button:has-text("Test Connection")');
    await expect(page.locator('.success-message')).toContainText('LDAP connection successful');
    
    // Save configuration
    await page.click('button:has-text("Save Provider")');
    await expect(page.locator('.success-message')).toContainText('LDAP provider added');
  });

  test('TCAUTH013_006: LDAP authentication flow', async ({ page }) => {
    // Step 6: LDAP authentication
    await page.goto('/en/login');
    
    // Mock LDAP server
    await ldapMock.mockLDAPServer();
    
    // Click LDAP login
    await page.click('button:has-text("Login with LDAP")');
    
    // Enter LDAP credentials
    await page.fill('input[name="username"]', 'ldapuser');
    await page.fill('input[name="password"]', 'LdapPass123!');
    await page.click('button[type="submit"]');
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
    
    // Check user profile from LDAP
    await page.goto('/en/profile');
    await expect(page.locator('[data-testid="user-name"]')).toContainText('LDAP User');
    await expect(page.locator('[data-testid="user-email"]')).toContainText('ldapuser@company.com');
    
    // Verify LDAP authentication was called
    const ldapAuthCalled = await ldapMock.wasAuthenticationCalled();
    expect(ldapAuthCalled).toBe(true);
  });

  test('TCAUTH013_007: Identity provider management', async ({ page }) => {
    // Login as admin
    await ssoUtils.loginAsAdmin();
    
    // Navigate to SSO providers
    await page.goto('/en/admin/sso/providers');
    
    // View configured providers
    await expect(page.locator('text=SAML Provider')).toBeVisible();
    await expect(page.locator('text=OIDC Provider')).toBeVisible();
    await expect(page.locator('text=LDAP Provider')).toBeVisible();
    
    // Test provider enable/disable
    const samlProvider = page.locator('tr:has-text("SAML Provider")');
    await samlProvider.locator('button:has-text("Disable")').click();
    await expect(page.locator('.success-message')).toContainText('provider disabled');
    
    // Test provider priority
    await page.click('button:has-text("Configure Priority")');
    await page.dragAndDrop(
      page.locator('text=OIDC Provider'),
      page.locator('text=SAML Provider')
    );
    await page.click('button:has-text("Save Priority")');
    
    // Test provider health checks
    await page.click('button:has-text("Health Check")');
    await expect(page.locator('.health-status')).toBeVisible();
    
    // Test provider deletion
    await samlProvider.locator('button:has-text("Delete")').click();
    await page.click('button:has-text("Confirm Delete")');
    await expect(page.locator('.success-message')).toContainText('provider deleted');
  });

  test('TCAUTH013_008: Session federation', async ({ page }) => {
    // Login via SAML
    await samlMock.mockSAMLIdP();
    await page.goto('/en/login');
    await page.click('button:has-text("Login with SAML")');
    await samlMock.completeSAMLAuthentication(page);
    await expect(page).toHaveURL('/en/dashboard');
    
    // Get session token
    const sessionToken = await page.evaluate(() => localStorage.getItem('auth_token'));
    
    // Navigate to partner application (mock)
    await page.goto('https://partner-app.company.com/dashboard');
    
    // Verify SSO session transfer
    await expect(page.locator('.sso-user')).toContainText('SAML User');
    
    // Test cross-application logout
    await page.goto('/en/logout');
    await page.goto('https://partner-app.company.com/dashboard');
    
    // Should be logged out from partner app
    await expect(page).toHaveURL('/partner-app/login');
  });

  test('TCAUTH013_009: Enterprise security features', async ({ page }) => {
    // Login via SSO with MFA
    await samlMock.mockSAMLWithMFA();
    await page.goto('/en/login');
    await page.click('button:has-text("Login with SAML")');
    await samlMock.completeSAMLAuthentication(page);
    
    // Should prompt for MFA
    await expect(page.locator('[data-testid="mfa-prompt"]')).toBeVisible();
    
    // Complete MFA
    await page.fill('input[name="mfaCode"]', '123456');
    await page.click('button:has-text("Verify")');
    
    // Verify successful login with MFA
    await expect(page).toHaveURL('/en/dashboard');
    
    // Test role-based access control
    await page.goto('/en/admin/users');
    
    // Should have admin access if SAML groups mapped correctly
    await expect(page.locator('[data-testid="users-table"]')).toBeVisible();
    
    // Test audit logging
    await page.goto('/en/admin/audit');
    await expect(page.locator('text=SAML authentication')).toBeVisible();
    await expect(page.locator('text=MFA verification')).toBeVisible();
  });

  test('TCAUTH013_010: Arabic interface SSO testing', async ({ page }) => {
    // Test Arabic interface
    await page.goto('/ar/login');
    
    // Mock Arabic SAML provider
    await samlMock.mockArabicSAMLIdP();
    
    // Click Arabic SAML login
    await page.click('button:has-text("تسجيل الدخول عبر SAML")');
    
    // Complete Arabic SAML authentication
    await samlMock.completeArabicSAMLAuthentication(page);
    
    // Verify Arabic dashboard
    await expect(page).toHaveURL('/ar/dashboard');
    await expect(page.locator('h1')).toContainText('لوحة التحكم');
    
    // Test Arabic provider management
    await ssoUtils.loginAsAdminArabic();
    await page.goto('/ar/admin/sso/providers');
    
    await expect(page.locator('h1')).toContainText('مزودي الخدمة');
    await expect(page.locator('text=مزود SAML')).toBeVisible();
    
    // Test Arabic error messages
    await samlMock.mockSAMLFailure();
    await page.goto('/ar/login');
    await page.click('button:has-text("تسجيل الدخول عبر SAML")');
    await samlMock.completeSAMLFailure(page);
    
    await expect(page.locator('.error-message')).toContainText('فشل مصادقة SAML');
  });
});

// Utility Classes
export class SSOUtils {
  constructor(private page: Page) {}

  async loginAsAdmin() {
    await this.page.goto('/en/login');
    await this.page.fill('input[type="email"]', 'admin@alummahnow.net');
    await this.page.fill('input[type="password"]', 'AdminPass123!');
    await this.page.click('button[type="submit"]');
    await this.page.waitForURL('/en/dashboard');
  }

  async loginAsAdminArabic() {
    await this.page.goto('/ar/login');
    await this.page.fill('input[type="email"]', 'admin@alummahnow.net');
    await this.page.fill('input[type="password"]', 'AdminPass123!');
    await this.page.click('button[type="submit"]');
    await this.page.waitForURL('/ar/dashboard');
  }

  async configureSAMLProvider(config: any) {
    await this.page.goto('/en/admin/sso/providers');
    await this.page.click('button:has-text("Add SAML Provider")');
    
    await this.page.fill('input[name="entityId"]', config.entityId);
    await this.page.fill('input[name="ssoUrl"]', config.ssoUrl);
    await this.page.fill('input[name="sloUrl"]', config.sloUrl);
    
    await this.page.click('button:has-text("Save Provider")');
  }

  async configureOIDCProvider(config: any) {
    await this.page.goto('/en/admin/sso/providers');
    await this.page.click('button:has-text("Add OIDC Provider")');
    
    await this.page.fill('input[name="clientId"]', config.clientId);
    await this.page.fill('input[name="clientSecret"]', config.clientSecret);
    await this.page.fill('input[name="issuer"]', config.issuer);
    
    await this.page.click('button:has-text("Save Provider")');
  }

  async configureLDAPProvider(config: any) {
    await this.page.goto('/en/admin/sso/providers');
    await this.page.click('button:has-text("Add LDAP Provider")');
    
    await this.page.fill('input[name="server"]', config.server);
    await this.page.fill('input[name="bindDn"]', config.bindDn);
    await this.page.fill('input[name="bindPassword"]', config.bindPassword);
    
    await this.page.click('button:has-text("Save Provider")');
  }
}

export class SAMLMock {
  private ssoCalled = false;
  private sloCalled = false;

  async mockSAMLIdP() {
    await this.page.evaluate(() => {
      // Mock SAML IdP endpoints
      window.samlMock = {
        authenticate: () => ({
          success: true,
          attributes: {
            firstName: 'SAML',
            lastName: 'User',
            email: 'samluser@company.com',
            department: 'Engineering'
          }
        })
      };
    });
  }

  async mockArabicSAMLIdP() {
    await this.page.evaluate(() => {
      window.samlMock = {
        authenticate: () => ({
          success: true,
          attributes: {
            firstName: 'مستخدم',
            lastName: 'SAML',
            email: 'samluser@company.com',
            department: 'الهندسة'
          }
        })
      };
    });
  }

  async mockSAMLWithMFA() {
    await this.page.evaluate(() => {
      window.samlMock = {
        authenticate: () => ({
          success: true,
          requiresMFA: true,
          attributes: {
            firstName: 'SAML',
            lastName: 'User',
            email: 'samluser@company.com',
            groups: ['admin', 'users']
          }
        })
      };
    });
  }

  async mockSAMLFailure() {
    await this.page.evaluate(() => {
      window.samlMock = {
        authenticate: () => ({
          success: false,
          error: 'Authentication failed'
        })
      };
    });
  }

  async completeSAMLAuthentication(page: Page) {
    this.ssoCalled = true;
    await page.evaluate(() => {
      const result = (window as any).samlMock.authenticate();
      if (result.success) {
        // Simulate SAML response
        window.location.href = '/en/auth/saml/callback?success=true';
      }
    });
  }

  async completeArabicSAMLAuthentication(page: Page) {
    this.ssoCalled = true;
    await page.evaluate(() => {
      const result = (window as any).samlMock.authenticate();
      if (result.success) {
        window.location.href = '/ar/auth/saml/callback?success=true';
      }
    });
  }

  async completeSAMLFailure(page: Page) {
    await page.evaluate(() => {
      const result = (window as any).samlMock.authenticate();
      if (!result.success) {
        window.location.href = '/en/auth/saml/callback?error=authentication_failed';
      }
    });
  }

  wasSSOCalled(): boolean {
    return this.ssoCalled;
  }

  wasSLOCalled(): boolean {
    return this.sloCalled;
  }

  reset() {
    this.ssoCalled = false;
    this.sloCalled = false;
  }
}

export class OIDCMock {
  private logoutCalled = false;

  async mockOIDCProvider() {
    await this.page.evaluate(() => {
      window.oidcMock = {
        authenticate: () => ({
          success: true,
          idToken: 'oidc_id_token_456',
          accessToken: 'oidc_access_token_789',
          profile: {
            name: 'OIDC User',
            email: 'oidcuser@company.com',
            picture: 'https://company.com/avatar.jpg'
          }
        })
      };
    });
  }

  async completeOIDCAuthentication(page: Page) {
    await page.evaluate(() => {
      const result = (window as any).oidcMock.authenticate();
      if (result.success) {
        window.location.href = `/en/auth/oidc/callback?code=auth_code_123&state=test_state`;
      }
    });
  }

  wasLogoutCalled(): boolean {
    return this.logoutCalled;
  }

  reset() {
    this.logoutCalled = false;
  }
}

export class LDAPMock {
  private authCalled = false;

  async mockLDAPServer() {
    await this.page.evaluate(() => {
      window.ldapMock = {
        authenticate: (username: string, password: string) => {
          if (username === 'ldapuser' && password === 'LdapPass123!') {
            return {
              success: true,
              attributes: {
                cn: 'LDAP User',
                mail: 'ldapuser@company.com',
                department: 'IT'
              }
            };
          }
          return { success: false, error: 'Invalid credentials' };
        }
      };
    });
  }

  async wasAuthenticationCalled(): boolean {
    return this.authCalled;
  }

  reset() {
    this.authCalled = false;
  }
}
```

## Test Data Management
- SAML provider configurations
- OIDC provider settings
- LDAP server configurations
- Identity provider mock data

## Cleanup Requirements
- Remove SSO providers after tests
- Clear SSO sessions
- Reset identity provider mocks
- Clean up test user accounts

## Success Criteria
- SAML 2.0 integration works correctly
- OpenID Connect authentication functions properly
- LDAP/AD integration is reliable
- Identity provider management is effective
- Session federation works across applications
- Enterprise security features are enforced
- Both language interfaces support SSO
- Compliance requirements are met