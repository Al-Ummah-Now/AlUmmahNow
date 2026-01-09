# TCAUTH012: Biometric Authentication

## Test Overview
**Test Case ID:** TCAUTH012  
**Category:** Authentication  
**Subcategory:** Biometric Security  
**Test Type:** Functional + Security  
**Priority:** Medium  
**Estimated Duration:** 10 minutes  

## Description
Verify biometric authentication functionality including fingerprint recognition, facial recognition, voice authentication, biometric data security, fallback mechanisms, and cross-device biometric synchronization across both English and Arabic interfaces.

## Preconditions
- Biometric authentication is enabled
- Device supports biometric features
- WebAuthn API is available
- Biometric sensors are functional
- User consent for biometric data

## Test Data
```typescript
const biometricTestData = {
  user: {
    email: 'biometric@alummahnow.net',
    password: 'BioPass123!',
    userId: 'user-bio-001'
  },
  biometrics: {
    fingerprint: {
      credentialId: 'fp_credential_123',
      publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
      signature: 'fp_signature_456'
    },
    face: {
      credentialId: 'face_credential_789',
      template: 'face_template_012',
      confidence: 0.95
    },
    voice: {
      credentialId: 'voice_credential_345',
      voiceprint: 'voiceprint_678',
      confidence: 0.92
    }
  },
  devices: {
    desktop: { supports: ['fingerprint', 'face'] },
    mobile: { supports: ['fingerprint', 'face', 'voice'] },
    tablet: { supports: ['fingerprint'] }
  }
};
```

## Test Steps

### Step 1: Fingerprint Authentication Setup
1. Login with password credentials
2. Navigate to `/en/settings/security/biometrics`
3. Click "Setup Fingerprint Authentication"
4. Verify device fingerprint sensor detection
5. Grant permission for biometric access
6. Scan fingerprint for enrollment
7. Verify fingerprint template creation
8. Test fingerprint authentication
9. Verify successful biometric login
10. Check backup authentication options

### Step 2: Facial Recognition Setup
1. Navigate to biometric settings
2. Click "Setup Facial Recognition"
3. Verify camera access permission
4. Position face for enrollment scan
5. Complete facial recognition setup
6. Test facial recognition authentication
7. Verify liveness detection works
8. Test different lighting conditions
9. Verify successful face login
10. Check anti-spoofing measures

### Step 3: Voice Authentication Setup
1. Navigate to biometric settings
2. Click "Setup Voice Authentication"
3. Grant microphone access permission
4. Record voice passphrase
5. Verify voiceprint creation
6. Test voice authentication
7. Verify voice recognition accuracy
8. Test background noise handling
9. Verify successful voice login
10. Check voice security measures

### Step 4: Biometric Login Testing
1. Logout from current session
2. Navigate to `/en/login`
3. Click "Login with Biometrics"
4. Test fingerprint authentication
5. Test facial recognition
6. Test voice authentication
7. Verify biometric selection options
8. Test biometric authentication speed
9. Verify successful login to dashboard
10. Check session establishment

### Step 5: Biometric Fallback Mechanisms
1. Test biometric authentication failure
2. Verify password fallback option
3. Test multiple biometric failures
4. Verify account lockout protection
5. Test temporary biometric unavailability
6. Verify alternative authentication methods
7. Test emergency access codes
8. Verify recovery process functionality
9. Test biometric sensor malfunction
10. Verify graceful degradation

### Step 6: Biometric Security Validation
1. Test biometric data encryption
2. Verify secure storage on device
3. Test biometric template protection
4. Verify data transmission security
5. Test biometric spoofing prevention
6. Verify liveness detection effectiveness
7. Test biometric data deletion
8. Verify privacy compliance
9. Test biometric audit logging
10. Verify security incident handling

### Step 7: Cross-Device Biometric Sync
1. Setup biometrics on desktop
2. Login on mobile device
3. Verify biometric credential sync
4. Test cross-device authentication
5. Verify biometric data portability
6. Test device-specific biometrics
7. Verify biometric backup/restore
8. Test device removal handling
9. Verify biometric data isolation
10. Check multi-device management

### Step 8: Biometric Performance Testing
1. Test authentication speed
2. Verify accuracy rates
3. Test false acceptance rates
4. Verify false rejection rates
5. Test biometric reliability
6. Verify performance under load
7. Test concurrent biometric requests
8. Verify resource usage optimization
9. Test battery impact on mobile
10. Verify performance metrics

### Step 9: Biometric Error Handling
1. Test biometric sensor errors
2. Verify permission denial handling
3. Test biometric timeout scenarios
4. Verify network error handling
5. Test biometric data corruption
6. Verify error message clarity
7. Test biometric service unavailability
8. Verify recovery procedures
9. Test biometric configuration errors
10. Verify user guidance for errors

### Step 10: Arabic Interface Biometric Testing
1. Repeat key biometric tests in Arabic
2. Verify Arabic biometric prompts
3. Test Arabic error messages
4. Check Arabic permission dialogs
5. Verify Arabic biometric settings
6. Test Arabic biometric instructions
7. Verify Arabic fallback options
8. Test Arabic biometric feedback
9. Check Arabic biometric security notices
10. Verify Arabic biometric help content

## Expected Results
- Biometric authentication setup works correctly
- Multiple biometric methods function properly
- Fallback mechanisms provide reliable alternatives
- Biometric data is stored securely
- Cross-device synchronization works
- Performance meets acceptable standards
- Error scenarios are handled gracefully
- Both language interfaces support biometrics

## Error Scenarios
- Biometric sensor unavailability
- Permission denial by user
- Biometric data corruption
- Network connectivity issues
- Device compatibility problems

## Cross-Browser Testing
- Chrome, Firefox, Safari, Edge
- Mobile browsers for biometric testing
- Different device capabilities

## Playwright Test Implementation

```typescript
import { test, expect } from '@playwright/test';
import { BiometricUtils } from '../utils/BiometricUtils';
import { WebAuthnMock } from '../utils/WebAuthnMock';

test.describe('Biometric Authentication', () => {
  let biometricUtils: BiometricUtils;
  let webAuthnMock: WebAuthnMock;

  test.beforeEach(async ({ page }) => {
    biometricUtils = new BiometricUtils(page);
    webAuthnMock = new WebAuthnMock();
  });

  test('TCAUTH012_001: Fingerprint authentication setup', async ({ page }) => {
    // Step 1: Login with password first
    await page.goto('/en/login');
    await page.fill('input[type="email"]', 'biometric@alummahnow.net');
    await page.fill('input[type="password"]', 'BioPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/en/dashboard');
    
    // Navigate to biometric settings
    await page.goto('/en/settings/security/biometrics');
    await expect(page).toHaveURL('/en/settings/security/biometrics');
    
    // Setup fingerprint authentication
    await page.click('button:has-text("Setup Fingerprint Authentication")');
    
    // Mock WebAuthn API for fingerprint
    await webAuthnMock.mockFingerprintEnrollment();
    
    // Verify device detection
    await expect(page.locator('[data-testid="fingerprint-detected"]')).toBeVisible();
    
    // Grant permission and complete enrollment
    await page.click('button:has-text("Grant Permission")');
    await page.click('button:has-text("Scan Fingerprint")');
    
    // Verify successful enrollment
    await expect(page.locator('.success-message')).toContainText('fingerprint enrolled');
    
    // Test fingerprint authentication
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    await page.click('button:has-text("Use Fingerprint")');
    
    // Mock fingerprint authentication
    await webAuthnMock.mockFingerprintAuthentication();
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH012_002: Facial recognition setup', async ({ page }) => {
    // Login first
    await biometricUtils.loginWithPassword('biometric@alummahnow.net', 'BioPass123!');
    
    // Navigate to biometric settings
    await page.goto('/en/settings/security/biometrics');
    
    // Setup facial recognition
    await page.click('button:has-text("Setup Facial Recognition")');
    
    // Mock camera access and facial recognition
    await webAuthnMock.mockFacialRecognitionEnrollment();
    
    // Verify camera permission request
    await expect(page.locator('[data-testid="camera-permission"]')).toBeVisible();
    await page.click('button:has-text("Allow Camera Access")');
    
    // Complete facial scan
    await page.click('button:has-text("Start Face Scan")');
    
    // Verify successful enrollment
    await expect(page.locator('.success-message')).toContainText('face enrolled');
    
    // Test facial recognition authentication
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    await page.click('button:has-text("Use Face Recognition")');
    
    // Mock facial authentication
    await webAuthnMock.mockFacialRecognitionAuthentication();
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH012_003: Voice authentication setup', async ({ page }) => {
    // Login first
    await biometricUtils.loginWithPassword('biometric@alummahnow.net', 'BioPass123!');
    
    // Navigate to biometric settings
    await page.goto('/en/settings/security/biometrics');
    
    // Setup voice authentication
    await page.click('button:has-text("Setup Voice Authentication")');
    
    // Mock microphone access and voice recognition
    await webAuthnMock.mockVoiceAuthenticationEnrollment();
    
    // Verify microphone permission request
    await expect(page.locator('[data-testid="microphone-permission"]')).toBeVisible();
    await page.click('button:has-text("Allow Microphone Access")');
    
    // Record voice passphrase
    await page.click('button:has-text("Record Voice")');
    await page.waitForTimeout(3000); // Mock recording time
    await page.click('button:has-text("Stop Recording")');
    
    // Verify successful enrollment
    await expect(page.locator('.success-message')).toContainText('voice enrolled');
    
    // Test voice authentication
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    await page.click('button:has-text("Use Voice")');
    
    // Mock voice authentication
    await webAuthnMock.mockVoiceAuthentication();
    
    // Verify successful login
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH012_004: Biometric login testing', async ({ page }) => {
    // Setup all biometric methods first
    await biometricUtils.setupAllBiometrics('biometric@alummahnow.net', 'BioPass123!');
    
    // Logout and test biometric login options
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    
    // Verify all biometric options are available
    await expect(page.locator('button:has-text("Use Fingerprint")')).toBeVisible();
    await expect(page.locator('button:has-text("Use Face Recognition")')).toBeVisible();
    await expect(page.locator('button:has-text("Use Voice")')).toBeVisible();
    
    // Test fingerprint authentication speed
    const startTime = Date.now();
    await page.click('button:has-text("Use Fingerprint")');
    await webAuthnMock.mockFingerprintAuthentication();
    await expect(page).toHaveURL('/en/dashboard');
    const endTime = Date.now();
    
    // Verify authentication is fast (< 3 seconds)
    expect(endTime - startTime).toBeLessThan(3000);
    
    // Test other biometric methods
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    await page.click('button:has-text("Use Face Recognition")');
    await webAuthnMock.mockFacialRecognitionAuthentication();
    await expect(page).toHaveURL('/en/dashboard');
  });

  test('TCAUTH012_005: Biometric fallback mechanisms', async ({ page }) => {
    // Setup biometrics
    await biometricUtils.setupFingerprint('biometric@alummahnow.net', 'BioPass123!');
    
    // Logout and test biometric failure
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    await page.click('button:has-text("Use Fingerprint")');
    
    // Mock biometric failure
    await webAuthnMock.mockFingerprintFailure();
    
    // Verify fallback option is presented
    await expect(page.locator('[data-testid="biometric-fallback"]')).toBeVisible();
    await expect(page.locator('button:has-text("Use Password")')).toBeVisible();
    
    // Test password fallback
    await page.click('button:has-text("Use Password")');
    await page.fill('input[type="password"]', 'BioPass123!');
    await page.click('button[type="submit"]');
    
    // Verify successful login with password
    await expect(page).toHaveURL('/en/dashboard');
    
    // Test multiple biometric failures
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    
    // Simulate multiple failures
    for (let i = 0; i < 3; i++) {
      await page.click('button:has-text("Use Fingerprint")');
      await webAuthnMock.mockFingerprintFailure();
      await page.waitForTimeout(1000);
    }
    
    // Verify account lockout protection
    await expect(page.locator('.error-message')).toContainText('too many failed attempts');
    await expect(page.locator('button:has-text("Use Password")')).toBeVisible();
  });

  test('TCAUTH012_006: Biometric security validation', async ({ page }) => {
    // Test biometric data encryption
    await biometricUtils.loginWithPassword('biometric@alummahnow.net', 'BioPass123!');
    await page.goto('/en/settings/security/biometrics');
    
    // Check biometric data storage information
    await page.click('button:has-text("View Biometric Security")');
    
    // Verify security information is displayed
    await expect(page.locator('[data-testid="biometric-encryption"]')).toContainText('encrypted');
    await expect(page.locator('[data-testid="biometric-storage"]')).toContainText('secure storage');
    
    // Test biometric spoofing prevention
    await webAuthnMock.mockSpoofingAttempt();
    await page.goto('/en/logout');
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    await page.click('button:has-text("Use Face Recognition")');
    
    // Should detect spoofing attempt
    await expect(page.locator('.error-message')).toContainText('liveness detection failed');
    
    // Test biometric data deletion
    await biometricUtils.loginWithPassword('biometric@alummahnow.net', 'BioPass123!');
    await page.goto('/en/settings/security/biometrics');
    await page.click('button:has-text("Remove Biometric Data")');
    await page.click('button:has-text("Confirm Removal")');
    
    // Verify data deletion
    await expect(page.locator('.success-message')).toContainText('biometric data removed');
  });

  test('TCAUTH012_007: Cross-device biometric sync', async ({ page }) => {
    // Setup biometrics on desktop
    await biometricUtils.setupFingerprint('biometric@alummahnow.net', 'BioPass123!');
    
    // Simulate mobile device context
    const mobileContext = await page.context().browser().newContext({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)'
    });
    const mobilePage = await mobileContext.newPage();
    
    // Test biometric sync on mobile
    await mobilePage.goto('/en/login');
    await mobilePage.click('button:has-text("Login with Biometrics")');
    
    // Verify biometric options are available on mobile
    await expect(mobilePage.locator('button:has-text("Use Fingerprint")')).toBeVisible();
    await expect(mobilePage.locator('button:has-text("Use Face Recognition")')).toBeVisible();
    
    // Test mobile biometric authentication
    await mobilePage.click('button:has-text("Use Fingerprint")');
    await webAuthnMock.mockFingerprintAuthentication();
    await expect(mobilePage).toHaveURL('/en/dashboard');
    
    await mobileContext.close();
  });

  test('TCAUTH012_008: Biometric performance testing', async ({ page }) => {
    // Setup biometrics
    await biometricUtils.setupAllBiometrics('biometric@alummahnow.net', 'BioPass123!');
    
    // Test authentication speed for each method
    const methods = ['fingerprint', 'face', 'voice'];
    const times: number[] = [];
    
    for (const method of methods) {
      await page.goto('/en/logout');
      await page.goto('/en/login');
      await page.click('button:has-text("Login with Biometrics")');
      
      const startTime = Date.now();
      
      switch (method) {
        case 'fingerprint':
          await page.click('button:has-text("Use Fingerprint")');
          await webAuthnMock.mockFingerprintAuthentication();
          break;
        case 'face':
          await page.click('button:has-text("Use Face Recognition")');
          await webAuthnMock.mockFacialRecognitionAuthentication();
          break;
        case 'voice':
          await page.click('button:has-text("Use Voice")');
          await webAuthnMock.mockVoiceAuthentication();
          break;
      }
      
      await expect(page).toHaveURL('/en/dashboard');
      const endTime = Date.now();
      times.push(endTime - startTime);
    }
    
    // Verify all methods are fast (< 3 seconds)
    times.forEach(time => {
      expect(time).toBeLessThan(3000);
    });
    
    // Verify average time is reasonable
    const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
    expect(averageTime).toBeLessThan(2000);
  });

  test('TCAUTH012_009: Biometric error handling', async ({ page }) => {
    // Test biometric sensor errors
    await webAuthnMock.mockSensorError();
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    await page.click('button:has-text("Use Fingerprint")');
    
    // Verify error handling
    await expect(page.locator('.error-message')).toContainText('biometric sensor unavailable');
    await expect(page.locator('button:has-text("Use Password")')).toBeVisible();
    
    // Test permission denial
    await webAuthnMock.mockPermissionDenied();
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    await page.click('button:has-text("Use Face Recognition")');
    
    // Verify permission error handling
    await expect(page.locator('.error-message')).toContainText('permission denied');
    
    // Test timeout scenarios
    await webAuthnMock.mockTimeout();
    await page.goto('/en/login');
    await page.click('button:has-text("Login with Biometrics")');
    await page.click('button:has-text("Use Voice")');
    
    // Verify timeout handling
    await expect(page.locator('.error-message')).toContainText('authentication timeout');
  });

  test('TCAUTH012_010: Arabic interface biometric testing', async ({ page }) => {
    // Test Arabic interface
    await page.goto('/ar/login');
    await page.fill('input[type="email"]', 'biometric@alummahnow.net');
    await page.fill('input[type="password"]', 'BioPass123!');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL('/ar/dashboard');
    
    // Navigate to Arabic biometric settings
    await page.goto('/ar/settings/security/biometrics');
    
    // Setup fingerprint in Arabic
    await page.click('button:has-text("إعداد بصمة الإصبع")');
    await webAuthnMock.mockFingerprintEnrollment();
    await page.click('button:has-text("منح الإذن")');
    await page.click('button:has-text("مسح البصمة")');
    
    // Verify Arabic success message
    await expect(page.locator('.success-message')).toContainText('تم تسجيل البصمة');
    
    // Test Arabic biometric login
    await page.goto('/ar/logout');
    await page.goto('/ar/login');
    await page.click('button:has-text("تسجيل الدخول بالبيومترية")');
    await page.click('button:has-text("استخدام بصمة الإصبع")');
    await webAuthnMock.mockFingerprintAuthentication();
    
    // Verify Arabic dashboard
    await expect(page).toHaveURL('/ar/dashboard');
    await expect(page.locator('h1')).toContainText('لوحة التحكم');
  });
});

// Utility Classes
export class BiometricUtils {
  constructor(private page: Page) {}

  async loginWithPassword(email: string, password: string) {
    await this.page.goto('/en/login');
    await this.page.fill('input[type="email"]', email);
    await this.page.fill('input[type="password"]', password);
    await this.page.click('button[type="submit"]');
    await this.page.waitForURL('/en/dashboard');
  }

  async setupFingerprint(email: string, password: string) {
    await this.loginWithPassword(email, password);
    await this.page.goto('/en/settings/security/biometrics');
    await this.page.click('button:has-text("Setup Fingerprint Authentication")');
    await this.page.click('button:has-text("Grant Permission")');
    await this.page.click('button:has-text("Scan Fingerprint")');
  }

  async setupFacialRecognition(email: string, password: string) {
    await this.loginWithPassword(email, password);
    await this.page.goto('/en/settings/security/biometrics');
    await this.page.click('button:has-text("Setup Facial Recognition")');
    await this.page.click('button:has-text("Allow Camera Access")');
    await this.page.click('button:has-text("Start Face Scan")');
  }

  async setupVoiceAuthentication(email: string, password: string) {
    await this.loginWithPassword(email, password);
    await this.page.goto('/en/settings/security/biometrics');
    await this.page.click('button:has-text("Setup Voice Authentication")');
    await this.page.click('button:has-text("Allow Microphone Access")');
    await this.page.click('button:has-text("Record Voice")');
    await this.page.waitForTimeout(3000);
    await this.page.click('button:has-text("Stop Recording")');
  }

  async setupAllBiometrics(email: string, password: string) {
    await this.setupFingerprint(email, password);
    await this.setupFacialRecognition(email, password);
    await this.setupVoiceAuthentication(email, password);
  }
}

export class WebAuthnMock {
  async mockFingerprintEnrollment() {
    await this.page.evaluate(() => {
      // Mock WebAuthn API for fingerprint enrollment
      (window as any).navigator.credentials = {
        create: async (options: any) => {
          return {
            id: 'fp_credential_123',
            rawId: new Uint8Array([1, 2, 3]),
            response: {
              clientDataJSON: JSON.stringify({ type: 'webauthn.create' }),
              attestationObject: 'mock_attestation'
            }
          };
        }
      };
    });
  }

  async mockFingerprintAuthentication() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        get: async (options: any) => {
          return {
            id: 'fp_credential_123',
            rawId: new Uint8Array([1, 2, 3]),
            response: {
              clientDataJSON: JSON.stringify({ type: 'webauthn.get' }),
              authenticatorData: 'mock_auth_data',
              signature: 'mock_signature',
              userHandle: null
            }
          };
        }
      };
    });
  }

  async mockFingerprintFailure() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        get: async (options: any) => {
          throw new Error('Biometric authentication failed');
        }
      };
    });
  }

  async mockFacialRecognitionEnrollment() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        create: async (options: any) => {
          return {
            id: 'face_credential_789',
            rawId: new Uint8Array([4, 5, 6]),
            response: {
              clientDataJSON: JSON.stringify({ type: 'webauthn.create' }),
              attestationObject: 'mock_face_attestation'
            }
          };
        }
      };
    });
  }

  async mockFacialRecognitionAuthentication() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        get: async (options: any) => {
          return {
            id: 'face_credential_789',
            rawId: new Uint8Array([4, 5, 6]),
            response: {
              clientDataJSON: JSON.stringify({ type: 'webauthn.get' }),
              authenticatorData: 'mock_face_auth_data',
              signature: 'mock_face_signature',
              userHandle: null
            }
          };
        }
      };
    });
  }

  async mockVoiceAuthenticationEnrollment() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        create: async (options: any) => {
          return {
            id: 'voice_credential_345',
            rawId: new Uint8Array([7, 8, 9]),
            response: {
              clientDataJSON: JSON.stringify({ type: 'webauthn.create' }),
              attestationObject: 'mock_voice_attestation'
            }
          };
        }
      };
    });
  }

  async mockVoiceAuthentication() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        get: async (options: any) => {
          return {
            id: 'voice_credential_345',
            rawId: new Uint8Array([7, 8, 9]),
            response: {
              clientDataJSON: JSON.stringify({ type: 'webauthn.get' }),
              authenticatorData: 'mock_voice_auth_data',
              signature: 'mock_voice_signature',
              userHandle: null
            }
          };
        }
      };
    });
  }

  async mockSpoofingAttempt() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        get: async (options: any) => {
          throw new Error('Liveness detection failed - possible spoofing attempt');
        }
      };
    });
  }

  async mockSensorError() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        get: async (options: any) => {
          throw new Error('Biometric sensor not available');
        }
      };
    });
  }

  async mockPermissionDenied() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        get: async (options: any) => {
          throw new Error('Permission denied for biometric access');
        }
      };
    });
  }

  async mockTimeout() {
    await this.page.evaluate(() => {
      (window as any).navigator.credentials = {
        get: async (options: any) => {
          return new Promise((resolve, reject) => {
            setTimeout(() => reject(new Error('Authentication timeout')), 1000);
          });
        }
      };
    });
  }
}
```

## Test Data Management
- Biometric credential templates
- WebAuthn API mocking
- Device capability simulation
- Biometric security test data

## Cleanup Requirements
- Remove biometric credentials after tests
- Clear WebAuthn mocks
- Reset biometric settings
- Clean up test user data

## Success Criteria
- Biometric authentication setup works correctly
- Multiple biometric methods function properly
- Fallback mechanisms provide reliable alternatives
- Biometric data is stored securely
- Cross-device synchronization works
- Performance meets acceptable standards
- Error scenarios are handled gracefully
- Both language interfaces support biometrics