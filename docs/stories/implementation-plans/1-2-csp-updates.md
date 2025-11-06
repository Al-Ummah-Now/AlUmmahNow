# Implementation Plan: Content Security Policy Header Updates

**Story**: 1.2 Remove Global Event Listener Security Vulnerabilities  
**Task Group**: 1-2-csp-updates  
**Priority**: Critical  
**Estimated Time**: 10-14 hours  

## Overview

This implementation plan addresses Content Security Policy (CSP) header configuration to prevent XSS attacks and other security vulnerabilities. A properly configured CSP acts as a defense-in-depth mechanism that restricts which resources (scripts, styles, images, etc.) can be loaded and executed, significantly reducing the attack surface for global event listener exploits.

## Prerequisites

- Event listener audit completed (Story 1.2 Task 1)
- Event listener validation middleware implemented (Story 1.2 Task 2)
- Security event logging system active (Story 1.2 Task 3)
- Input sanitization system implemented (Story 1.2 Task 4)
- Cloudflare Workers deployment access

## Implementation Steps

### Step 1: Create CSP Configuration Management

**File**: `apps/web/src/lib/security/csp-config.ts`

```typescript
import type { CSPConfig, CSPDirective, SecurityEvent } from '@al-ummah/shared-types';

/**
 * Content Security Policy configuration manager
 */
export class CSPConfigManager {
  private config: CSPConfig;
  private environment: 'development' | 'staging' | 'production';
  private eventLogger: (event: SecurityEvent) => void;

  constructor(
    environment: 'development' | 'staging' | 'production',
    eventLogger: (event: SecurityEvent) => void
  ) {
    this.environment = environment;
    this.eventLogger = eventLogger;
    this.config = this.buildCSPConfig();
  }

  /**
   * Get current CSP configuration
   */
  getConfig(): CSPConfig {
    return this.config;
  }

  /**
   * Generate CSP header string
   */
  generateCSPHeader(): string {
    const directives = Object.entries(this.config.directives)
      .filter(([_, directive]) => directive.enabled)
      .map(([name, directive]) => this.formatDirective(name, directive))
      .join('; ');

    return `${this.config.version} ${directives}`;
  }

  /**
   * Generate CSP-Report-Only header for testing
   */
  generateReportOnlyHeader(): string {
    const directives = Object.entries(this.config.directives)
      .filter(([_, directive]) => directive.enabled)
      .map(([name, directive]) => this.formatDirective(name, directive))
      .join('; ');

    return `${this.config.version}-Report-Only ${directives}`;
  }

  /**
   * Update CSP directive
   */
  updateDirective(directiveName: string, updates: Partial<CSPDirective>): void {
    const directive = this.config.directives[directiveName];
    if (!directive) {
      this.eventLogger({
        id: `csp-directive-not-found-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'csp-configuration-error',
        severity: 'medium',
        message: `CSP directive '${directiveName}' not found`,
        source: 'csp-config-manager',
        metadata: { directiveName, updates }
      });
      return;
    }

    Object.assign(directive, updates);
    
    this.eventLogger({
      id: `csp-directive-updated-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'csp-configuration-updated',
      severity: 'low',
      message: `CSP directive '${directiveName}' updated`,
      source: 'csp-config-manager',
      metadata: { directiveName, updates, newConfig: directive }
    });
  }

  /**
   * Add source to directive
   */
  addSourceToDirective(directiveName: string, source: string): void {
    const directive = this.config.directives[directiveName];
    if (!directive) return;

    if (!directive.sources.includes(source)) {
      directive.sources.push(source);
      
      this.eventLogger({
        id: `csp-source-added-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'csp-source-added',
        severity: 'low',
        message: `Source '${source}' added to CSP directive '${directiveName}'`,
        source: 'csp-config-manager',
        metadata: { directiveName, source }
      });
    }
  }

  /**
   * Remove source from directive
   */
  removeSourceFromDirective(directiveName: string, source: string): void {
    const directive = this.config.directives[directiveName];
    if (!directive) return;

    const index = directive.sources.indexOf(source);
    if (index > -1) {
      directive.sources.splice(index, 1);
      
      this.eventLogger({
        id: `csp-source-removed-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'csp-source-removed',
        severity: 'low',
        message: `Source '${source}' removed from CSP directive '${directiveName}'`,
        source: 'csp-config-manager',
        metadata: { directiveName, source }
      });
    }
  }

  /**
   * Validate CSP configuration
   */
  validateConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required directives
    const requiredDirectives = ['default-src', 'script-src', 'style-src'];
    for (const directive of requiredDirectives) {
      if (!this.config.directives[directive] || !this.config.directives[directive].enabled) {
        errors.push(`Required directive '${directive}' is missing or disabled`);
      }
    }

    // Check for unsafe sources in production
    if (this.environment === 'production') {
      const unsafeSources = ['unsafe-inline', 'unsafe-eval', 'data:', 'http:'];
      
      for (const [directiveName, directive] of Object.entries(this.config.directives)) {
        for (const unsafeSource of unsafeSources) {
          if (directive.sources.includes(unsafeSource)) {
            errors.push(`Unsafe source '${unsafeSource}' found in production directive '${directiveName}'`);
          }
        }
      }
    }

    // Check script-src for 'unsafe-inline' without nonce or hash
    const scriptSrc = this.config.directives['script-src'];
    if (scriptSrc && scriptSrc.sources.includes("'unsafe-inline'")) {
      const hasNonceOrHash = scriptSrc.sources.some(source => 
        source.startsWith("'nonce-") || source.startsWith("'sha256-") || source.startsWith("'sha384-") || source.startsWith("'sha512-")
      );
      
      if (!hasNonceOrHash) {
        errors.push("'unsafe-inline' in script-src should be replaced with nonces or hashes");
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private buildCSPConfig(): CSPConfig {
    const isDev = this.environment === 'development';
    const isProd = this.environment === 'production';

    return {
      version: 'Content-Security-Policy',
      directives: {
        'default-src': {
          enabled: true,
          sources: isDev 
            ? ["'self'", 'ws:', 'wss:']
            : ["'self'", 'wss:']
        },
        'script-src': {
          enabled: true,
          sources: isDev
            ? [
                "'self'",
                "'unsafe-eval'", // Development only
                "'unsafe-inline'", // Development only
                'https://www.googletagmanager.com',
                'https://www.google-analytics.com',
                'https://cdn.jsdelivr.net',
                'https://cdnjs.cloudflare.com'
              ]
            : [
                "'self'",
                "'nonce-{nonce}'", // Will be replaced with actual nonce
                'https://www.googletagmanager.com',
                'https://www.google-analytics.com',
                'https://cdn.jsdelivr.net',
                'https://cdnjs.cloudflare.com'
              ]
        },
        'style-src': {
          enabled: true,
          sources: [
            "'self'",
            "'unsafe-inline'", // Required for CSS-in-JS and Tailwind
            'https://fonts.googleapis.com',
            'https://cdn.jsdelivr.net'
          ]
        },
        'img-src': {
          enabled: true,
          sources: [
            "'self'",
            'data:', // Required for base64 images
            'blob:', // Required for video thumbnails
            'https://cdn.bunny.net',
            'https://img.bunny.net',
            'https://www.google-analytics.com'
          ]
        },
        'font-src': {
          enabled: true,
          sources: [
            "'self'",
            'data:',
            'https://fonts.gstatic.com',
            'https://cdn.jsdelivr.net'
          ]
        },
        'connect-src': {
          enabled: true,
          sources: [
            "'self'",
            'https://api.alummahnow.net',
            'https://ws.alummahnow.net',
            'https://www.google-analytics.com',
            'https://analytics.google.com'
          ]
        },
        'media-src': {
          enabled: true,
          sources: [
            "'self'",
            'blob:', // Required for video streaming
            'https://cdn.bunny.net',
            'https://video.bunny.net'
          ]
        },
        'object-src': {
          enabled: true,
          sources: ["'none'"] // Block objects for security
        },
        'base-uri': {
          enabled: true,
          sources: ["'self'"]
        },
        'form-action': {
          enabled: true,
          sources: ["'self'"]
        },
        'frame-ancestors': {
          enabled: true,
          sources: ["'none'"] // Prevent clickjacking
        },
        'upgrade-insecure-requests': {
          enabled: isProd, // Only in production
          sources: []
        }
      },
      reportUri: isProd 
        ? 'https://csp-reports.alummahnow.net/api/v1/csp-report'
        : undefined,
      reportOnly: isDev
    };
  }

  private formatDirective(name: string, directive: CSPDirective): string {
    if (directive.sources.length === 0) {
      return `${name} 'none'`;
    }
    return `${name} ${directive.sources.join(' ')}`;
  }
}

/**
 * Create CSP config manager instance
 */
export function createCSPConfigManager(
  environment: 'development' | 'staging' | 'production',
  eventLogger: (event: SecurityEvent) => void
): CSPConfigManager {
  return new CSPConfigManager(environment, eventLogger);
}
```

### Step 2: Create CSP Middleware for Next.js

**File**: `apps/web/src/lib/security/csp-middleware.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { CSPConfigManager, createCSPConfigManager } from './csp-config';
import { useSecurityEvents } from '@/hooks/useSecurityEvents';
import type { SecurityEvent } from '@al-ummah/shared-types';

/**
 * CSP middleware for Next.js
 */
export class CSPMiddleware {
  private cspManager: CSPConfigManager;
  private eventLogger: (event: SecurityEvent) => void;

  constructor(eventLogger: (event: SecurityEvent) => void) {
    this.eventLogger = eventLogger;
    const environment = process.env.NODE_ENV as 'development' | 'staging' | 'production';
    this.cspManager = createCSPConfigManager(environment, eventLogger);
  }

  /**
   * Middleware function for Next.js
   */
  middleware(request: NextRequest): NextResponse {
    const response = NextResponse.next();

    // Add CSP headers
    this.addCSPHeaders(response, request);

    return response;
  }

  /**
   * Add CSP headers to response
   */
  private addCSPHeaders(response: NextResponse, request: NextRequest): void {
    const config = this.cspManager.getConfig();
    
    // Generate nonce for inline scripts
    const nonce = this.generateNonce();
    
    // Replace placeholder with actual nonce
    const cspHeader = this.cspManager.generateCSPHeader().replace('{nonce}', nonce);
    
    // Add CSP header
    if (config.reportOnly) {
      response.headers.set('Content-Security-Policy-Report-Only', cspHeader);
    } else {
      response.headers.set('Content-Security-Policy', cspHeader);
    }

    // Add nonce to response headers for client-side access
    response.headers.set('x-csp-nonce', nonce);

    // Add other security headers
    this.addSecurityHeaders(response);

    // Log CSP application
    this.eventLogger({
      id: `csp-applied-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'csp-applied',
      severity: 'low',
      message: 'CSP headers applied to response',
      source: 'csp-middleware',
      metadata: {
        url: request.url,
        userAgent: request.headers.get('user-agent'),
        reportOnly: config.reportOnly,
        nonce: nonce.substring(0, 8) + '...' // Log partial nonce for security
      }
    });
  }

  /**
   * Add additional security headers
   */
  private addSecurityHeaders(response: NextResponse): void {
    // X-Frame-Options (legacy, but still useful)
    response.headers.set('X-Frame-Options', 'DENY');

    // X-Content-Type-Options
    response.headers.set('X-Content-Type-Options', 'nosniff');

    // Referrer-Policy
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions-Policy
    response.headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
    );

    // Strict-Transport-Security (HTTPS only)
    if (process.env.NODE_ENV === 'production') {
      response.headers.set(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );
    }
  }

  /**
   * Generate cryptographic nonce
   */
  private generateNonce(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array));
  }

  /**
   * Get CSP manager instance
   */
  getCSPManager(): CSPConfigManager {
    return this.cspManager;
  }
}

/**
 * Create CSP middleware instance
 */
export function createCSPMiddleware(eventLogger: (event: SecurityEvent) => void): CSPMiddleware {
  return new CSPMiddleware(eventLogger);
}
```

### Step 3: Create CSP Report Handler

**File**: `apps/web/src/app/api/csp-report/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { useSecurityEvents } from '@/hooks/useSecurityEvents';
import type { CSPViolationReport, SecurityEvent } from '@al-ummah/shared-types';

/**
 * API endpoint to receive CSP violation reports
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const reportData = await request.json();
    
    // Handle different report formats
    const violations = extractViolations(reportData);
    
    // Log each violation
    for (const violation of violations) {
      await logCSPViolation(violation, request);
    }

    return NextResponse.json({ 
      success: true, 
      violationsProcessed: violations.length 
    });
  } catch (error) {
    console.error('Error processing CSP report:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to process CSP report' 
      },
      { status: 400 }
    );
  }
}

/**
 * Extract violations from different report formats
 */
function extractViolations(reportData: any): CSPViolationReport[] {
  // Handle CSP Level 3 format
  if (reportData['csp-report']) {
    return [formatCSPViolation(reportData['csp-report'])];
  }

  // Handle multiple reports (array format)
  if (Array.isArray(reportData)) {
    return reportData.map(report => {
      if (report['csp-report']) {
        return formatCSPViolation(report['csp-report']);
      }
      return formatCSPViolation(report);
    });
  }

  // Handle single report format
  return [formatCSPViolation(reportData)];
}

/**
 * Format CSP violation data
 */
function formatCSPViolation(report: any): CSPViolationReport {
  return {
    timestamp: new Date().toISOString(),
    blockedURI: report.blockedURI || report['blocked-uri'] || '',
    disposition: report.disposition || 'enforce',
    documentURI: report.documentURI || report['document-uri'] || '',
    effectiveDirective: report.effectiveDirective || report['effective-directive'] || '',
    originalPolicy: report.originalPolicy || report['original-policy'] || '',
    referrer: report.referrer || '',
    sample: report.sample || '',
    sourceFile: report.sourceFile || report['source-file'] || '',
    lineNumber: report.lineNumber || report['line-number'] || 0,
    columnNumber: report.columnNumber || report['column-number'] || 0,
    statusCode: report.statusCode || 0,
    userAgent: report.userAgent || ''
  };
}

/**
 * Log CSP violation as security event
 */
async function logCSPViolation(violation: CSPViolationReport, request: NextRequest): Promise<void> {
  const severity = determineSeverity(violation);
  
  const securityEvent: SecurityEvent = {
    id: `csp-violation-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: violation.timestamp,
    type: 'csp-violation',
    severity,
    message: `CSP violation: ${violation.effectiveDirective} blocked ${violation.blockedURI}`,
    source: 'csp-report-handler',
    metadata: {
      violation,
      requestIP: request.ip || request.headers.get('x-forwarded-for') || 'unknown',
      requestURL: request.url,
      userAgent: request.headers.get('user-agent') || ''
    }
  };

  // Log to security event system
  const { logSecurityEvent } = useSecurityEvents();
  await logSecurityEvent(securityEvent);

  // Also log to console for immediate visibility
  console.warn('CSP Violation:', securityEvent);
}

/**
 * Determine severity of CSP violation
 */
function determineSeverity(violation: CSPViolationReport): 'low' | 'medium' | 'high' {
  const blockedURI = violation.blockedURI.toLowerCase();
  const effectiveDirective = violation.effectiveDirective.toLowerCase();

  // High severity violations
  if (blockedURI.includes('javascript:') || 
      blockedURI.includes('data:') && effectiveDirective === 'script-src' ||
      blockedURI.includes('eval(')) {
    return 'high';
  }

  // Medium severity violations
  if (effectiveDirective === 'script-src' || 
      effectiveDirective === 'object-src' ||
      blockedURI.includes('http:') && !blockedURI.includes('https://')) {
    return 'medium';
  }

  // Low severity violations
  return 'low';
}
```

### Step 4: Create React Hook for CSP Integration

**File**: `apps/web/src/hooks/useCSP.ts`

```typescript
import { useEffect, useState } from 'react';
import { useSecurityEvents } from './useSecurityEvents';
import type { CSPConfig, SecurityEvent } from '@al-ummah/shared-types';

/**
 * React hook for CSP integration
 */
export function useCSP() {
  const { logSecurityEvent } = useSecurityEvents();
  const [nonce, setNonce] = useState<string>('');
  const [cspConfig, setCspConfig] = useState<CSPConfig | null>(null);

  useEffect(() => {
    // Get nonce from server-side headers
    const metaNonce = document.querySelector('meta[name="csp-nonce"]');
    if (metaNonce) {
      setNonce(metaNonce.getAttribute('content') || '');
    }

    // Get CSP config from global variable if available
    if (typeof window !== 'undefined' && (window as any).CSP_CONFIG) {
      setCspConfig((window as any).CSP_CONFIG);
    }

    // Set up CSP violation monitoring
    setupCSPViolationMonitoring();
  }, []);

  /**
   * Set up monitoring for CSP violations
   */
  const setupCSPViolationMonitoring = (): void => {
    // Listen for CSP violation events
    document.addEventListener('securitypolicyviolation', (event) => {
      handleCSPViolation(event);
    });
  };

  /**
   * Handle CSP violation events
   */
  const handleCSPViolation = (event: SecurityPolicyViolationEvent): void => {
    const severity = determineClientSideSeverity(event);

    logSecurityEvent({
      id: `client-csp-violation-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'csp-violation',
      severity,
      message: `Client-side CSP violation: ${event.violatedDirective} blocked ${event.blockedURI}`,
      source: 'client-csp-monitor',
      metadata: {
        blockedURI: event.blockedURI,
        disposition: event.disposition,
        documentURI: event.documentURI,
        effectiveDirective: event.effectiveDirective,
        originalPolicy: event.originalPolicy,
        referrer: event.referrer,
        sample: event.sample,
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        columnNumber: event.columnNumber,
        statusCode: event.statusCode,
        isExternal: event.isExternal
      }
    });
  };

  /**
   * Determine severity for client-side violations
   */
  const determineClientSideSeverity = (event: SecurityPolicyViolationEvent): 'low' | 'medium' | 'high' => {
    const blockedURI = event.blockedURI.toLowerCase();
    const violatedDirective = event.violatedDirective.toLowerCase();

    // High severity
    if (blockedURI.includes('javascript:') || 
        blockedURI.includes('eval(') ||
        violatedDirective === 'script-src' && blockedURI.includes('data:')) {
      return 'high';
    }

    // Medium severity
    if (violatedDirective === 'script-src' || 
        violatedDirective === 'object-src' ||
        blockedURI.includes('http:') && !blockedURI.includes('https://')) {
      return 'medium';
    }

    return 'low';
  };

  /**
   * Get nonce for inline scripts
   */
  const getNonce = (): string => {
    return nonce;
  };

  /**
   * Create nonce attribute for inline scripts
   */
  const createNonceAttribute = (): { nonce: string } => {
    return { nonce };
  };

  /**
   * Check if CSP is active
   */
  const isCSPActive = (): boolean => {
    return !!document.querySelector('meta[http-equiv="Content-Security-Policy"]') ||
           !!document.querySelector('meta[http-equiv="Content-Security-Policy-Report-Only"]');
  };

  /**
   * Get current CSP policy
   */
  const getCurrentPolicy = (): string | null => {
    const metaTag = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (metaTag) {
      return metaTag.getAttribute('content');
    }
    
    const reportOnlyTag = document.querySelector('meta[http-equiv="Content-Security-Policy-Report-Only"]');
    if (reportOnlyTag) {
      return reportOnlyTag.getAttribute('content');
    }
    
    return null;
  };

  /**
   * Validate inline script with nonce
   */
  const validateInlineScript = (scriptContent: string): boolean => {
    if (!nonce) {
      logSecurityEvent({
        id: `no-nonce-available-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'csp-validation-error',
        severity: 'medium',
        message: 'No CSP nonce available for inline script validation',
        source: 'useCSP',
        metadata: { scriptContent: scriptContent.substring(0, 100) }
      });
      return false;
    }

    // In a real implementation, you might want to validate the script content
    // against certain patterns or check if it's safe
    return true;
  };

  /**
   * Create safe inline script element
   */
  const createSafeScript = (scriptContent: string, async: boolean = false): HTMLScriptElement => {
    const script = document.createElement('script');
    
    if (nonce) {
      script.nonce = nonce;
    }
    
    script.textContent = scriptContent;
    
    if (async) {
      script.async = true;
    }
    
    return script;
  };

  return {
    nonce,
    cspConfig,
    getNonce,
    createNonceAttribute,
    isCSPActive,
    getCurrentPolicy,
    validateInlineScript,
    createSafeScript
  };
}

/**
 * Hook for CSP-aware script loading
 */
export function useCSPScriptLoader() {
  const { createSafeScript, validateInlineScript } = useCSP();

  /**
   * Load external script with CSP compliance
   */
  const loadExternalScript = async (src: string, async: boolean = true): Promise<HTMLScriptElement> => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = async;
      
      script.onload = () => resolve(script);
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      
      document.head.appendChild(script);
    });
  };

  /**
   * Execute inline script with CSP compliance
   */
  const executeInlineScript = (scriptContent: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (!validateInlineScript(scriptContent)) {
        reject(new Error('Inline script validation failed'));
        return;
      }

      try {
        const script = createSafeScript(scriptContent);
        
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Inline script execution failed'));
        
        document.head.appendChild(script);
      } catch (error) {
        reject(error);
      }
    });
  };

  return {
    loadExternalScript,
    executeInlineScript
  };
}
```

### Step 5: Update Next.js Configuration

**File**: `apps/web/next.config.js` (Update existing)

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // ... existing configuration ...

  // Add CSP headers via middleware
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()'
          }
        ]
      }
    ];
  },

  // Configure webpack for CSP compatibility
  webpack: (config, { dev, isServer }) => {
    // ... existing webpack config ...

    // Add nonce support for development
    if (dev && !isServer) {
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.env.CSP_NONCE': JSON.stringify('development-nonce')
        })
      );
    }

    return config;
  }
};

module.exports = nextConfig;
```

### Step 6: Create Middleware Configuration

**File**: `apps/web/src/middleware.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createCSPMiddleware } from '@/lib/security/csp-middleware';
import { createSecurityEventLogger } from '@/lib/security/event-logger';

// Create CSP middleware instance
const eventLogger = createSecurityEventLogger();
const cspMiddleware = createCSPMiddleware(eventLogger);

export function middleware(request: NextRequest): NextResponse {
  // Apply CSP middleware
  return cspMiddleware.middleware(request);
}

// Configure middleware to run on all routes except static files
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public (public files)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
};
```

### Step 7: Add CSP Tests

**File**: `apps/web/src/__tests__/security/csp-config.test.ts`

```typescript
import { CSPConfigManager, createCSPConfigManager } from '@/lib/security/csp-config';
import type { SecurityEvent } from '@al-ummah/shared-types';

describe('CSPConfigManager', () => {
  let cspManager: CSPConfigManager;
  let mockEventLogger: jest.MockedFunction<(event: SecurityEvent) => void>;

  beforeEach(() => {
    mockEventLogger = jest.fn();
    cspManager = createCSPConfigManager('test', mockEventLogger);
  });

  describe('CSP Header Generation', () => {
    it('should generate valid CSP header', () => {
      const header = cspManager.generateCSPHeader();
      
      expect(header).toContain('Content-Security-Policy');
      expect(header).toContain('default-src');
      expect(header).toContain('script-src');
      expect(header).toContain('style-src');
    });

    it('should generate report-only header in development', () => {
      const devCspManager = createCSPConfigManager('development', mockEventLogger);
      const config = devCspManager.getConfig();
      
      expect(config.reportOnly).toBe(true);
    });

    it('should generate enforce header in production', () => {
      const prodCspManager = createCSPConfigManager('production', mockEventLogger);
      const config = prodCspManager.getConfig();
      
      expect(config.reportOnly).toBe(false);
    });
  });

  describe('Directive Management', () => {
    it('should add source to directive', () => {
      cspManager.addSourceToDirective('script-src', 'https://trusted.cdn.com');
      
      const config = cspManager.getConfig();
      expect(config.directives['script-src'].sources).toContain('https://trusted.cdn.com');
    });

    it('should remove source from directive', () => {
      cspManager.addSourceToDirective('script-src', 'https://temp.cdn.com');
      cspManager.removeSourceFromDirective('script-src', 'https://temp.cdn.com');
      
      const config = cspManager.getConfig();
      expect(config.directives['script-src'].sources).not.toContain('https://temp.cdn.com');
    });

    it('should update directive properties', () => {
      cspManager.updateDirective('script-src', { enabled: false });
      
      const config = cspManager.getConfig();
      expect(config.directives['script-src'].enabled).toBe(false);
    });
  });

  describe('Configuration Validation', () => {
    it('should validate correct configuration', () => {
      const result = cspManager.validateConfig();
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required directives', () => {
      cspManager.updateDirective('default-src', { enabled: false });
      
      const result = cspManager.validateConfig();
      
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Required directive 'default-src' is missing or disabled");
    });

    it('should detect unsafe sources in production', () => {
      const prodCspManager = createCSPConfigManager('production', mockEventLogger);
      prodCspManager.addSourceToDirective('script-src', "'unsafe-inline'");
      
      const result = prodCspManager.validateConfig();
      
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes("'unsafe-inline'"))).toBe(true);
    });
  });

  describe('Security Event Logging', () => {
    it('should log directive updates', () => {
      cspManager.updateDirective('script-src', { enabled: false });
      
      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'csp-configuration-updated',
          severity: 'low'
        })
      );
    });

    it('should log source additions', () => {
      cspManager.addSourceToDirective('script-src', 'https://example.com');
      
      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'csp-source-added',
          severity: 'low'
        })
      );
    });

    it('should log source removals', () => {
      cspManager.addSourceToDirective('script-src', 'https://temp.com');
      cspManager.removeSourceFromDirective('script-src', 'https://temp.com');
      
      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'csp-source-removed',
          severity: 'low'
        })
      );
    });
  });
});
```

**File**: `apps/web/src/__tests__/security/csp-middleware.test.ts`

```typescript
import { NextRequest } from 'next/server';
import { CSPMiddleware, createCSPMiddleware } from '@/lib/security/csp-middleware';
import type { SecurityEvent } from '@al-ummah/shared-types';

describe('CSPMiddleware', () => {
  let cspMiddleware: CSPMiddleware;
  let mockEventLogger: jest.MockedFunction<(event: SecurityEvent) => void>;

  beforeEach(() => {
    mockEventLogger = jest.fn();
    cspMiddleware = createCSPMiddleware(mockEventLogger);
  });

  describe('Middleware Application', () => {
    it('should add CSP headers to response', () => {
      const request = new NextRequest('https://example.com');
      const response = cspMiddleware.middleware(request);
      
      expect(response.headers.has('Content-Security-Policy')).toBe(true);
      expect(response.headers.has('x-csp-nonce')).toBe(true);
    });

    it('should add security headers', () => {
      const request = new NextRequest('https://example.com');
      const response = cspMiddleware.middleware(request);
      
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
      expect(response.headers.has('Permissions-Policy')).toBe(true);
    });

    it('should add HSTS header in production', () => {
      // Mock production environment
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const prodCspMiddleware = createCSPMiddleware(mockEventLogger);
      const request = new NextRequest('https://example.com');
      const response = prodCspMiddleware.middleware(request);
      
      expect(response.headers.has('Strict-Transport-Security')).toBe(true);
      
      // Restore environment
      process.env.NODE_ENV = originalEnv;
    });

    it('should generate unique nonces', () => {
      const request1 = new NextRequest('https://example.com');
      const request2 = new NextRequest('https://example.com');
      
      const response1 = cspMiddleware.middleware(request1);
      const response2 = cspMiddleware.middleware(request2);
      
      const nonce1 = response1.headers.get('x-csp-nonce');
      const nonce2 = response2.headers.get('x-csp-nonce');
      
      expect(nonce1).toBeTruthy();
      expect(nonce2).toBeTruthy();
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('Security Event Logging', () => {
    it('should log CSP application', () => {
      const request = new NextRequest('https://example.com');
      cspMiddleware.middleware(request);
      
      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'csp-applied',
          severity: 'low'
        })
      );
    });
  });
});
```

## Testing Strategy

### Unit Testing
- **CSP Configuration**: Test directive management and validation
- **Header Generation**: Test CSP header string generation
- **Middleware Logic**: Test request/response processing
- **Security Event Logging**: Verify proper event logging

### Integration Testing
- **Next.js Integration**: Test middleware with actual Next.js app
- **API Endpoint Testing**: Test CSP report endpoint
- **React Hook Testing**: Test client-side CSP integration

### Security Testing
- **Header Validation**: Verify all security headers are present
- **CSP Bypass Attempts**: Test various XSS bypass techniques
- **Nonce Generation**: Verify nonce uniqueness and security
- **Report Handling**: Test CSP violation report processing

### Performance Testing
- **Header Processing**: Measure middleware overhead
- **Nonce Generation**: Test performance under load
- **Report Processing**: Test handling of high-volume violations

## Deliverables

### New Files
1. **`apps/web/src/lib/security/csp-config.ts`** - CSP configuration management
2. **`apps/web/src/lib/security/csp-middleware.ts`** - Next.js CSP middleware
3. **`apps/web/src/app/api/csp-report/route.ts`** - CSP violation report handler
4. **`apps/web/src/hooks/useCSP.ts`** - React hooks for CSP integration
5. **`apps/web/src/middleware.ts`** - Next.js middleware configuration
6. **`apps/web/src/__tests__/security/csp-config.test.ts`** - CSP config tests
7. **`apps/web/src/__tests__/security/csp-middleware.test.ts`** - CSP middleware tests

### Updated Files
1. **`apps/web/next.config.js`** - Security headers configuration
2. **`apps/web/package.json`** - Add any required dependencies

### Configuration Files
1. **CSP Report Endpoint** - API route for violation reporting
2. **Middleware Configuration** - Route matching and CSP application

## Success Criteria

### Functional Requirements
- ✅ CSP headers are applied to all responses
- ✅ Nonces are generated and used for inline scripts
- ✅ CSP violations are logged and reported
- ✅ Security headers are properly configured
- ✅ Development and production environments have appropriate CSP settings

### Security Requirements
- ✅ XSS attacks are prevented through CSP restrictions
- ✅ Clickjacking is prevented through frame protection
- ✅ Mixed content is blocked in production
- ✅ Unsafe eval and inline scripts are restricted
- ✅ Third-party resource loading is controlled

### Performance Requirements
- ✅ Middleware processing time < 5ms per request
- ✅ Nonce generation is cryptographically secure and fast
- ✅ CSP violation reporting doesn't impact application performance
- ✅ Header size remains reasonable (< 4KB)

### Testing Requirements
- ✅ Unit test coverage > 95% for CSP logic
- ✅ Integration tests for middleware and API endpoints
- ✅ Security tests for common bypass techniques
- ✅ Performance tests under load conditions

## Timeline

### Phase 1: Core CSP Implementation (4-5 hours)
- CSPConfigManager implementation
- Basic directive management and validation
- Unit tests for configuration logic

### Phase 2: Middleware Integration (3-4 hours)
- CSPMiddleware implementation
- Next.js middleware configuration
- Security headers implementation

### Phase 3: Report Handling (2-3 hours)
- CSP violation report API endpoint
- Client-side violation monitoring
- React hooks for CSP integration

### Phase 4: Testing & Validation (2-3 hours)
- Comprehensive test suite
- Security testing and validation
- Performance testing
- Documentation updates

## Risk Assessment

### High Risk
- **Breaking Changes**: CSP might break existing functionality
- **Third-party Dependencies**: External scripts might be blocked

### Medium Risk
- **Configuration Complexity**: CSP configuration can be complex to manage
- **Performance Impact**: Additional header processing overhead

### Low Risk
- **Implementation Risk**: Well-established patterns and libraries
- **Compatibility**: Modern browsers have good CSP support

### Mitigation Strategies
- Start with report-only mode to identify issues
- Maintain comprehensive allowlists for trusted domains
- Implement gradual rollout with monitoring
- Create fallback mechanisms for critical functionality

This implementation plan provides comprehensive CSP protection that significantly reduces the attack surface for XSS and other injection attacks while maintaining application functionality and performance.