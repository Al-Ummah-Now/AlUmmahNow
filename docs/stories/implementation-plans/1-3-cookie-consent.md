# Implementation Plan: Cookie Consent Implementation

**Story**: 1.3 Implement GDPR-Compliant Data Storage  
**Task Group**: 1.3.6 Implement proper cookie consent implementation  
**Priority**: High  
**Estimated Time**: 2-3 days  

## Overview

This implementation plan focuses on creating a comprehensive cookie consent management system that complies with GDPR and ePrivacy Directive requirements. The system will provide granular control over different types of cookies, clear consent mechanisms, and proper cookie categorization.

## Prerequisites

- Completion of data storage audit (1.3.1)
- Encrypted storage implementation (1.3.2)
- Consent management system (1.3.3)
- Data access/export functionality (1.3.4)
- Transparent processing implementation (1.3.5)

## Detailed Implementation Steps

### Step 1: Create Cookie Management Types

**File**: `packages/shared-types/src/cookies.ts`

```typescript
export interface CookieCategory {
  id: string;
  name: string;
  description: string;
  required: boolean;
  cookies: CookieDefinition[];
}

export interface CookieDefinition {
  name: string;
  domain: string;
  purpose: string;
  expiration: string;
  type: 'http' | 'javascript';
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface CookieConsent {
  id: string;
  userId?: string;
  timestamp: Date;
  version: string;
  categories: {
    [categoryId: string]: {
      consented: boolean;
      timestamp: Date;
    };
  };
  ipAddress: string;
  userAgent: string;
  preferences: {
    analytics: boolean;
    marketing: boolean;
    functional: boolean;
    essential: boolean;
  };
}

export interface CookieAuditLog {
  id: string;
  userId?: string;
  action: 'cookie_set' | 'cookie_read' | 'cookie_deleted' | 'consent_given' | 'consent_withdrawn';
  cookieName: string;
  category: string;
  purpose: string;
  timestamp: Date;
  metadata: {
    domain: string;
    expiration?: string;
    consentVersion?: string;
  };
}

export interface CookiePolicy {
  version: string;
  lastUpdated: Date;
  categories: CookieCategory[];
  thirdPartyServices: ThirdPartyService[];
}

export interface ThirdPartyService {
  id: string;
  name: string;
  description: string;
  privacyPolicyUrl: string;
  cookieCategories: string[];
  required: boolean;
}
```

### Step 2: Implement Cookie Consent Manager

**File**: `apps/web/src/lib/cookies/cookie-consent-manager.ts`

```typescript
import { CookieConsent, CookieCategory, CookiePolicy, CookieAuditLog } from '@al-ummah/shared-types';

export class CookieConsentManager {
  private static instance: CookieConsentManager;
  private consent: CookieConsent | null = null;
  private policy: CookiePolicy;
  private auditLogs: CookieAuditLog[] = [];
  private readonly CONSENT_KEY = 'alummah_cookie_consent';
  private readonly AUDIT_KEY = 'alummah_cookie_audit';

  constructor(policy: CookiePolicy) {
    this.policy = policy;
    this.loadConsent();
    this.loadAuditLogs();
  }

  static getInstance(policy?: CookiePolicy): CookieConsentManager {
    if (!CookieConsentManager.instance) {
      if (!policy) {
        throw new Error('Policy required for first initialization');
      }
      CookieConsentManager.instance = new CookieConsentManager(policy);
    }
    return CookieConsentManager.instance;
  }

  // Check if consent is required
  isConsentRequired(): boolean {
    return !this.consent || this.consent.version !== this.policy.version;
  }

  // Get current consent
  getConsent(): CookieConsent | null {
    return this.consent;
  }

  // Check if user has consented to specific category
  hasConsent(categoryId: string): boolean {
    if (!this.consent) return false;
    
    const category = this.policy.categories.find(c => c.id === categoryId);
    if (category?.required) return true;
    
    return this.consent.categories[categoryId]?.consented || false;
  }

  // Save consent
  saveConsent(
    categoryConsents: { [categoryId: string]: boolean },
    userId?: string
  ): void {
    const consent: CookieConsent = {
      id: `consent_${Date.now()}`,
      userId,
      timestamp: new Date(),
      version: this.policy.version,
      categories: {},
      ipAddress: this.getClientIP(),
      userAgent: navigator.userAgent,
      preferences: {
        analytics: categoryConsents.analytics || false,
        marketing: categoryConsents.marketing || false,
        functional: categoryConsents.functional || false,
        essential: true // Essential cookies are always allowed
      }
    };

    // Process category consents
    Object.entries(categoryConsents).forEach(([categoryId, consented]) => {
      const category = this.policy.categories.find(c => c.id === categoryId);
      if (category && !category.required) {
        consent.categories[categoryId] = {
          consented,
          timestamp: new Date()
        };
      }
    });

    this.consent = consent;
    this.persistConsent();
    this.logConsentAction('consent_given', userId);
  }

  // Withdraw consent for specific category
  withdrawConsent(categoryId: string, userId?: string): void {
    if (!this.consent) return;

    const category = this.policy.categories.find(c => c.id === categoryId);
    if (category?.required) {
      throw new Error(`Cannot withdraw consent for required category: ${categoryId}`);
    }

    this.consent.categories[categoryId] = {
      consented: false,
      timestamp: new Date()
    };

    // Update preferences
    if (categoryId === 'analytics') this.consent.preferences.analytics = false;
    if (categoryId === 'marketing') this.consent.preferences.marketing = false;
    if (categoryId === 'functional') this.consent.preferences.functional = false;

    this.persistConsent();
    this.logConsentAction('consent_withdrawn', userId);
    
    // Trigger cleanup of non-consented cookies
    this.cleanupNonConsentedCookies(categoryId);
  }

  // Get all cookie categories
  getCategories(): CookieCategory[] {
    return this.policy.categories;
  }

  // Get required categories
  getRequiredCategories(): CookieCategory[] {
    return this.policy.categories.filter(category => category.required);
  }

  // Get optional categories
  getOptionalCategories(): CookieCategory[] {
    return this.policy.categories.filter(category => !category.required);
  }

  // Check if cookie can be set
  canSetCookie(cookieName: string, category?: string): boolean {
    if (!category) {
      // Try to determine category from cookie name
      category = this.determineCookieCategory(cookieName);
    }

    return this.hasConsent(category);
  }

  // Set cookie with consent check
  setCookie(
    name: string,
    value: string,
    options: {
      expires?: Date;
      maxAge?: number;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: 'Strict' | 'Lax' | 'None';
      category?: string;
    } = {}
  ): boolean {
    const category = options.category || this.determineCookieCategory(name);
    
    if (!this.canSetCookie(name, category)) {
      console.warn(`Cookie ${name} cannot be set without consent for category ${category}`);
      return false;
    }

    // Build cookie string
    let cookieString = `${name}=${encodeURIComponent(value)}`;
    
    if (options.expires) {
      cookieString += `; expires=${options.expires.toUTCString()}`;
    }
    
    if (options.maxAge) {
      cookieString += `; max-age=${options.maxAge}`;
    }
    
    if (options.domain) {
      cookieString += `; domain=${options.domain}`;
    }
    
    if (options.path) {
      cookieString += `; path=${options.path}`;
    }
    
    if (options.secure) {
      cookieString += '; secure';
    }
    
    if (options.httpOnly) {
      cookieString += '; httponly';
    }
    
    if (options.sameSite) {
      cookieString += `; samesite=${options.sameSite}`;
    }

    document.cookie = cookieString;

    // Log cookie setting
    this.logCookieAction('cookie_set', name, category);

    return true;
  }

  // Get cookie value
  getCookie(name: string): string | null {
    const cookies = document.cookie.split(';');
    
    for (const cookie of cookies) {
      const [cookieName, cookieValue] = cookie.trim().split('=');
      if (cookieName === name) {
        const value = decodeURIComponent(cookieValue);
        this.logCookieAction('cookie_read', name, this.determineCookieCategory(name));
        return value;
      }
    }
    
    return null;
  }

  // Delete cookie
  deleteCookie(name: string, path = '/', domain?: string): void {
    const category = this.determineCookieCategory(name);
    
    let cookieString = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
    
    if (domain) {
      cookieString += `; domain=${domain}`;
    }
    
    document.cookie = cookieString;
    
    this.logCookieAction('cookie_deleted', name, category);
  }

  // Get all cookies
  getAllCookies(): { name: string; value: string; category: string }[] {
    const cookies: { name: string; value: string; category: string }[] = [];
    const cookieStrings = document.cookie.split(';');
    
    for (const cookieString of cookieStrings) {
      const [name, value] = cookieString.trim().split('=');
      if (name && value) {
        cookies.push({
          name,
          value: decodeURIComponent(value),
          category: this.determineCookieCategory(name)
        });
      }
    }
    
    return cookies;
  }

  // Cleanup non-consented cookies
  private cleanupNonConsentedCookies(withdrawnCategory: string): void {
    const allCookies = this.getAllCookies();
    
    allCookies.forEach(cookie => {
      if (cookie.category === withdrawnCategory && !this.hasConsent(withdrawnCategory)) {
        this.deleteCookie(cookie.name);
      }
    });
  }

  // Determine cookie category from name
  private determineCookieCategory(cookieName: string): string {
    const name = cookieName.toLowerCase();
    
    // Essential cookies
    if (name.includes('session') || name.includes('csrf') || name.includes('auth')) {
      return 'essential';
    }
    
    // Analytics cookies
    if (name.includes('ga') || name.includes('analytics') || name.includes('tracking')) {
      return 'analytics';
    }
    
    // Marketing cookies
    if (name.includes('ad') || name.includes('marketing') || name.includes('pixel')) {
      return 'marketing';
    }
    
    // Functional cookies
    if (name.includes('pref') || name.includes('theme') || name.includes('lang')) {
      return 'functional';
    }
    
    return 'essential'; // Default to essential for safety
  }

  // Load consent from storage
  private loadConsent(): void {
    try {
      const stored = localStorage.getItem(this.CONSENT_KEY);
      if (stored) {
        this.consent = JSON.parse(stored);
        this.consent.timestamp = new Date(this.consent.timestamp);
        
        // Convert category timestamps back to Date objects
        Object.values(this.consent.categories).forEach(category => {
          category.timestamp = new Date(category.timestamp);
        });
      }
    } catch (error) {
      console.error('Failed to load cookie consent:', error);
    }
  }

  // Persist consent to storage
  private persistConsent(): void {
    try {
      localStorage.setItem(this.CONSENT_KEY, JSON.stringify(this.consent));
    } catch (error) {
      console.error('Failed to persist cookie consent:', error);
    }
  }

  // Load audit logs
  private loadAuditLogs(): void {
    try {
      const stored = localStorage.getItem(this.AUDIT_KEY);
      if (stored) {
        const logs = JSON.parse(stored);
        this.auditLogs = logs.map((log: any) => ({
          ...log,
          timestamp: new Date(log.timestamp)
        }));
      }
    } catch (error) {
      console.error('Failed to load cookie audit logs:', error);
    }
  }

  // Persist audit logs
  private persistAuditLogs(): void {
    try {
      // Keep only last 1000 logs
      const logsToStore = this.auditLogs.slice(-1000);
      localStorage.setItem(this.AUDIT_KEY, JSON.stringify(logsToStore));
    } catch (error) {
      console.error('Failed to persist cookie audit logs:', error);
    }
  }

  // Log consent action
  private logConsentAction(action: string, userId?: string): void {
    const log: CookieAuditLog = {
      id: `log_${Date.now()}`,
      userId,
      action: action as any,
      cookieName: 'consent',
      category: 'consent_management',
      purpose: 'Cookie consent management',
      timestamp: new Date(),
      metadata: {
        domain: window.location.hostname,
        consentVersion: this.policy.version
      }
    };

    this.auditLogs.push(log);
    this.persistAuditLogs();
  }

  // Log cookie action
  private logCookieAction(action: string, cookieName: string, category: string): void {
    const log: CookieAuditLog = {
      id: `log_${Date.now()}`,
      action: action as any,
      cookieName,
      category,
      purpose: this.getCookiePurpose(cookieName),
      timestamp: new Date(),
      metadata: {
        domain: window.location.hostname
      }
    };

    this.auditLogs.push(log);
    this.persistAuditLogs();
  }

  // Get cookie purpose
  private getCookiePurpose(cookieName: string): string {
    const category = this.determineCookieCategory(cookieName);
    const categoryObj = this.policy.categories.find(c => c.id === category);
    return categoryObj?.cookies.find(c => c.name === cookieName)?.purpose || 'Unknown purpose';
  }

  // Get client IP (simplified - in production, use server-side detection)
  private getClientIP(): string {
    return 'client'; // Would be detected server-side
  }

  // Get audit logs
  getAuditLogs(limit = 100): CookieAuditLog[] {
    return this.auditLogs
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // Reset all consent
  resetConsent(): void {
    this.consent = null;
    localStorage.removeItem(this.CONSENT_KEY);
    
    // Delete all non-essential cookies
    const allCookies = this.getAllCookies();
    allCookies.forEach(cookie => {
      if (cookie.category !== 'essential') {
        this.deleteCookie(cookie.name);
      }
    });
  }
}
```

### Step 3: Create Cookie Consent Banner Component

**File**: `apps/web/src/components/cookies/cookie-consent-banner.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { CookieConsentManager } from '@/lib/cookies/cookie-consent-manager';
import { CookieCategory } from '@al-ummah/shared-types';

interface CookieConsentBannerProps {
  onConsentGiven?: () => void;
  onConsentRejected?: () => void;
}

export function CookieConsentBanner({ onConsentGiven, onConsentRejected }: CookieConsentBannerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [categories, setCategories] = useState<CookieCategory[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<{ [key: string]: boolean }>({});
  const [consentManager, setConsentManager] = useState<CookieConsentManager | null>(null);

  useEffect(() => {
    // Initialize consent manager
    const initializeConsentManager = async () => {
      try {
        // Load cookie policy
        const policyResponse = await fetch('/api/cookies/policy');
        const policy = await policyResponse.json();
        
        const manager = CookieConsentManager.getInstance(policy);
        setConsentManager(manager);
        
        // Check if consent is required
        if (manager.isConsentRequired()) {
          const allCategories = manager.getCategories();
          setCategories(allCategories);
          
          // Set default selections
          const defaults: { [key: string]: boolean } = {};
          allCategories.forEach(category => {
            defaults[category.id] = category.required;
          });
          setSelectedCategories(defaults);
          
          setIsVisible(true);
        }
      } catch (error) {
        console.error('Failed to initialize cookie consent:', error);
      }
    };

    initializeConsentManager();
  }, []);

  const handleAcceptAll = () => {
    if (!consentManager) return;

    const allConsents: { [key: string]: boolean } = {};
    categories.forEach(category => {
      allConsents[category.id] = true;
    });

    consentManager.saveConsent(allConsents);
    setIsVisible(false);
    onConsentGiven?.();
  };

  const handleAcceptSelected = () => {
    if (!consentManager) return;

    consentManager.saveConsent(selectedCategories);
    setIsVisible(false);
    onConsentGiven?.();
  };

  const handleRejectAll = () => {
    if (!consentManager) return;

    const requiredOnly: { [key: string]: boolean } = {};
    categories.forEach(category => {
      requiredOnly[category.id] = category.required;
    });

    consentManager.saveConsent(requiredOnly);
    setIsVisible(false);
    onConsentRejected?.();
  };

  const handleCategoryToggle = (categoryId: string, enabled: boolean) => {
    setSelectedCategories(prev => ({
      ...prev,
      [categoryId]: enabled
    }));
  };

  if (!isVisible || !consentManager) {
    return null;
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t shadow-lg z-50">
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex flex-col md:flex-row items-start justify-between gap-6">
          {/* Main Content */}
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">Cookie Consent</h3>
            <p className="text-gray-600 mb-4">
              We use cookies to enhance your experience, analyze site traffic, and personalize content. 
              By clicking "Accept All", you consent to our use of cookies.
            </p>
            
            {!showDetails && (
              <button
                onClick={() => setShowDetails(true)}
                className="text-blue-600 hover:text-blue-800 text-sm font-medium"
              >
                Customize Settings →
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleRejectAll}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              Reject All
            </button>
            <button
              onClick={handleAcceptAll}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Accept All
            </button>
          </div>
        </div>

        {/* Detailed Settings */}
        {showDetails && (
          <div className="mt-6 pt-6 border-t">
            <h4 className="font-medium mb-4">Cookie Categories</h4>
            <div className="space-y-4">
              {categories.map(category => (
                <CookieCategoryToggle
                  key={category.id}
                  category={category}
                  enabled={selectedCategories[category.id] || false}
                  onToggle={(enabled) => handleCategoryToggle(category.id, enabled)}
                />
              ))}
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3 mt-6">
              <button
                onClick={() => setShowDetails(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleRejectAll}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
              >
                Reject All
              </button>
              <button
                onClick={handleAcceptSelected}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
              >
                Accept Selected
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface CookieCategoryToggleProps {
  category: CookieCategory;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

function CookieCategoryToggle({ category, enabled, onToggle }: CookieCategoryToggleProps) {
  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <h5 className="font-medium">{category.name}</h5>
          {category.required && (
            <span className="px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded">
              Required
            </span>
          )}
        </div>
        
        {!category.required && (
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        )}
      </div>
      
      <p className="text-sm text-gray-600 mb-3">{category.description}</p>
      
      <div className="text-xs text-gray-500">
        <strong>Cookies:</strong> {category.cookies.map(cookie => cookie.name).join(', ')}
      </div>
    </div>
  );
}
```

### Step 4: Create Cookie Settings Component

**File**: `apps/web/src/components/cookies/cookie-settings.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { CookieConsentManager } from '@/lib/cookies/cookie-consent-manager';
import { CookieCategory, CookieAuditLog } from '@al-ummah/shared-types';

interface CookieSettingsProps {
  userId?: string;
}

export function CookieSettings({ userId }: CookieSettingsProps) {
  const [consentManager, setConsentManager] = useState<CookieConsentManager | null>(null);
  const [categories, setCategories] = useState<CookieCategory[]>([]);
  const [currentConsent, setCurrentConsent] = useState<any>(null);
  const [auditLogs, setAuditLogs] = useState<CookieAuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<'categories' | 'cookies' | 'audit'>('categories');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCookieSettings();
  }, [userId]);

  const loadCookieSettings = async () => {
    try {
      // Load cookie policy
      const policyResponse = await fetch('/api/cookies/policy');
      const policy = await policyResponse.json();
      
      const manager = CookieConsentManager.getInstance(policy);
      setConsentManager(manager);
      
      const [categoriesData, consentData, auditData] = await Promise.all([
        Promise.resolve(manager.getCategories()),
        Promise.resolve(manager.getConsent()),
        Promise.resolve(manager.getAuditLogs(50))
      ]);

      setCategories(categoriesData);
      setCurrentConsent(consentData);
      setAuditLogs(auditData);
    } catch (error) {
      console.error('Failed to load cookie settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConsentUpdate = async (categoryId: string, consented: boolean) => {
    if (!consentManager) return;

    try {
      if (consented) {
        // For granting consent, we need to update all categories
        const currentConsents = consentManager.getConsent();
        const updatedConsents: { [key: string]: boolean } = {};
        
        categories.forEach(category => {
          if (category.id === categoryId) {
            updatedConsents[category.id] = consented;
          } else if (currentConsents?.categories[category.id]) {
            updatedConsents[category.id] = currentConsents.categories[category.id].consented;
          } else {
            updatedConsents[category.id] = category.required;
          }
        });

        consentManager.saveConsent(updatedConsents, userId);
      } else {
        consentManager.withdrawConsent(categoryId, userId);
      }

      await loadCookieSettings();
    } catch (error) {
      console.error('Failed to update consent:', error);
    }
  };

  const handleResetConsent = () => {
    if (!consentManager) return;
    
    if (confirm('Are you sure you want to reset all cookie consent? This will delete all non-essential cookies.')) {
      consentManager.resetConsent();
      loadCookieSettings();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Cookie Settings</h1>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'categories', label: 'Categories' },
            { id: 'cookies', label: 'Active Cookies' },
            { id: 'audit', label: 'Activity Log' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'categories' && (
        <CategoriesTab
          categories={categories}
          currentConsent={currentConsent}
          onConsentUpdate={handleConsentUpdate}
        />
      )}

      {activeTab === 'cookies' && (
        <CookiesTab consentManager={consentManager} />
      )}

      {activeTab === 'audit' && (
        <AuditTab auditLogs={auditLogs} />
      )}

      {/* Actions */}
      <div className="mt-8 pt-6 border-t">
        <button
          onClick={handleResetConsent}
          className="px-4 py-2 text-red-600 border border-red-300 rounded hover:bg-red-50 transition-colors"
        >
          Reset All Consent
        </button>
      </div>
    </div>
  );
}

interface CategoriesTabProps {
  categories: CookieCategory[];
  currentConsent: any;
  onConsentUpdate: (categoryId: string, consented: boolean) => void;
}

function CategoriesTab({ categories, currentConsent, onConsentUpdate }: CategoriesTabProps) {
  return (
    <div className="space-y-4">
      {categories.map(category => {
        const hasConsent = currentConsent?.categories[category.id]?.consented || category.required;
        
        return (
          <div key={category.id} className="border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-medium">{category.name}</h3>
                {category.required && (
                  <span className="inline-block px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded mt-1">
                    Required
                  </span>
                )}
              </div>
              
              {!category.required && (
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hasConsent}
                    onChange={(e) => onConsentUpdate(category.id, e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              )}
            </div>
            
            <p className="text-gray-600 mb-3">{category.description}</p>
            
            <div className="text-sm">
              <div className="font-medium mb-2">Cookies in this category:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {category.cookies.map(cookie => (
                  <div key={cookie.name} className="text-xs text-gray-500">
                    <strong>{cookie.name}:</strong> {cookie.purpose}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface CookiesTabProps {
  consentManager: CookieConsentManager | null;
}

function CookiesTab({ consentManager }: CookiesTabProps) {
  const [cookies, setCookies] = useState<any[]>([]);

  useEffect(() => {
    if (consentManager) {
      setCookies(consentManager.getAllCookies());
    }
  }, [consentManager]);

  return (
    <div>
      <div className="mb-4">
        <p className="text-gray-600">
          These are the cookies currently stored in your browser for this website.
        </p>
      </div>
      
      {cookies.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No cookies found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Category
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Value
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {cookies.map((cookie, index) => (
                <tr key={index}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {cookie.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    <span className="px-2 py-1 text-xs bg-gray-100 rounded">
                      {cookie.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    <div className="max-w-xs truncate">
                      {cookie.value}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface AuditTabProps {
  auditLogs: CookieAuditLog[];
}

function AuditTab({ auditLogs }: AuditTabProps) {
  return (
    <div>
      <div className="mb-4">
        <p className="text-gray-600">
          Recent cookie and consent activity on this website.
        </p>
      </div>
      
      {auditLogs.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No activity logged
        </div>
      ) : (
        <div className="space-y-3">
          {auditLogs.map(log => (
            <div key={log.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">{log.action.replace('_', ' ')}</div>
                <div className="text-sm text-gray-500">
                  {log.timestamp.toLocaleString()}
                </div>
              </div>
              <div className="text-sm text-gray-600">
                <div><strong>Cookie:</strong> {log.cookieName}</div>
                <div><strong>Category:</strong> {log.category}</div>
                <div><strong>Purpose:</strong> {log.purpose}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Step 5: Create Cookie Policy API

**File**: `apps/api-videos/src/endpoints/cookies/policy.ts`

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { CookiePolicy } from '@al-ummah/shared-types';

const app = new OpenAPIHono();

// Mock cookie policy - in production, this would come from a database
const cookiePolicy: CookiePolicy = {
  version: '1.0.0',
  lastUpdated: new Date(),
  categories: [
    {
      id: 'essential',
      name: 'Essential Cookies',
      description: 'These cookies are necessary for the website to function and cannot be switched off in our systems.',
      required: true,
      cookies: [
        {
          name: 'session_id',
          domain: '.alummahnow.net',
          purpose: 'Maintain user session and authentication state',
          expiration: 'Session',
          type: 'http',
          secure: true,
          httpOnly: true,
          sameSite: 'Strict'
        },
        {
          name: 'csrf_token',
          domain: '.alummahnow.net',
          purpose: 'Prevent Cross-Site Request Forgery attacks',
          expiration: 'Session',
          type: 'http',
          secure: true,
          httpOnly: true,
          sameSite: 'Strict'
        }
      ]
    },
    {
      id: 'functional',
      name: 'Functional Cookies',
      description: 'These cookies enable the website to provide enhanced functionality and personalization.',
      required: false,
      cookies: [
        {
          name: 'user_preferences',
          domain: '.alummahnow.net',
          purpose: 'Remember user preferences like language and theme',
          expiration: '365 days',
          type: 'javascript',
          secure: true,
          httpOnly: false,
          sameSite: 'Lax'
        },
        {
          name: 'video_progress',
          domain: '.alummahnow.net',
          purpose: 'Save video watch progress for resuming playback',
          expiration: '30 days',
          type: 'javascript',
          secure: true,
          httpOnly: false,
          sameSite: 'Lax'
        }
      ]
    },
    {
      id: 'analytics',
      name: 'Analytics Cookies',
      description: 'These cookies help us understand how visitors interact with our website.',
      required: false,
      cookies: [
        {
          name: '_ga',
          domain: '.alummahnow.net',
          purpose: 'Google Analytics - distinguish unique users',
          expiration: '2 years',
          type: 'javascript',
          secure: true,
          httpOnly: false,
          sameSite: 'Lax'
        },
        {
          name: '_gid',
          domain: '.alummahnow.net',
          purpose: 'Google Analytics - distinguish users',
          expiration: '24 hours',
          type: 'javascript',
          secure: true,
          httpOnly: false,
          sameSite: 'Lax'
        }
      ]
    },
    {
      id: 'marketing',
      name: 'Marketing Cookies',
      description: 'These cookies are used to track visitors across websites to show relevant ads.',
      required: false,
      cookies: [
        {
          name: 'ad_personalization',
          domain: '.alummahnow.net',
          purpose: 'Personalize advertisements based on user interests',
          expiration: '90 days',
          type: 'javascript',
          secure: true,
          httpOnly: false,
          sameSite: 'Lax'
        }
      ]
    }
  ],
  thirdPartyServices: [
    {
      id: 'google_analytics',
      name: 'Google Analytics',
      description: 'Web analytics service that tracks and reports website traffic',
      privacyPolicyUrl: 'https://policies.google.com/privacy',
      cookieCategories: ['analytics'],
      required: false
    }
  ]
};

// Get cookie policy
const getPolicyRoute = createRoute({
  method: 'get',
  path: '/cookies/policy',
  tags: ['Cookies'],
  summary: 'Get cookie policy',
  description: 'Retrieve the current cookie policy including all categories and third-party services',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            version: z.string(),
            lastUpdated: z.string(),
            categories: z.array(z.any()),
            thirdPartyServices: z.array(z.any())
          })
        }
      },
      description: 'Cookie policy retrieved successfully'
    }
  }
});

app.openapi(getPolicyRoute, (c) => {
  return c.json({
    ...cookiePolicy,
    lastUpdated: cookiePolicy.lastUpdated.toISOString()
  });
});

export default app;
```

## Testing Strategy

### Unit Tests

**File**: `apps/web/src/lib/cookies/__tests__/cookie-consent-manager.test.ts`

```typescript
import { CookieConsentManager } from '../cookie-consent-manager';
import { CookiePolicy } from '@al-ummah/shared-types';

describe('CookieConsentManager', () => {
  let manager: CookieConsentManager;
  let mockPolicy: CookiePolicy;

  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn()
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });

    mockPolicy = {
      version: '1.0.0',
      lastUpdated: new Date(),
      categories: [
        {
          id: 'essential',
          name: 'Essential',
          description: 'Essential cookies',
          required: true,
          cookies: []
        },
        {
          id: 'analytics',
          name: 'Analytics',
          description: 'Analytics cookies',
          required: false,
          cookies: []
        }
      ],
      thirdPartyServices: []
    };

    manager = CookieConsentManager.getInstance(mockPolicy);
  });

  describe('isConsentRequired', () => {
    it('should return true when no consent exists', () => {
      expect(manager.isConsentRequired()).toBe(true);
    });

    it('should return false when valid consent exists', () => {
      manager.saveConsent({ analytics: true });
      expect(manager.isConsentRequired()).toBe(false);
    });

    it('should return true when policy version changed', () => {
      manager.saveConsent({ analytics: true });
      
      // Update policy version
      mockPolicy.version = '2.0.0';
      const newManager = CookieConsentManager.getInstance(mockPolicy);
      
      expect(newManager.isConsentRequired()).toBe(true);
    });
  });

  describe('hasConsent', () => {
    it('should return true for required categories', () => {
      expect(manager.hasConsent('essential')).toBe(true);
    });

    it('should return false for optional categories without consent', () => {
      expect(manager.hasConsent('analytics')).toBe(false);
    });

    it('should return true for optional categories with consent', () => {
      manager.saveConsent({ analytics: true });
      expect(manager.hasConsent('analytics')).toBe(true);
    });
  });

  describe('setCookie', () => {
    beforeEach(() => {
      // Mock document.cookie
      Object.defineProperty(document, 'cookie', {
        writable: true,
        value: ''
      });
    });

    it('should set cookie for required category', () => {
      const result = manager.setCookie('test_cookie', 'test_value', {
        category: 'essential'
      });
      expect(result).toBe(true);
    });

    it('should not set cookie for non-consented category', () => {
      const result = manager.setCookie('analytics_cookie', 'test_value', {
        category: 'analytics'
      });
      expect(result).toBe(false);
    });

    it('should set cookie for consented category', () => {
      manager.saveConsent({ analytics: true });
      const result = manager.setCookie('analytics_cookie', 'test_value', {
        category: 'analytics'
      });
      expect(result).toBe(true);
    });
  });

  describe('withdrawConsent', () => {
    it('should withdraw consent for optional category', () => {
      manager.saveConsent({ analytics: true });
      manager.withdrawConsent('analytics');
      expect(manager.hasConsent('analytics')).toBe(false);
    });

    it('should throw error for required category', () => {
      expect(() => {
        manager.withdrawConsent('essential');
      }).toThrow('Cannot withdraw consent for required category');
    });
  });
});
```

### Integration Tests

**File**: `apps/api-videos/src/endpoints/cookies/__tests__/policy.test.ts`

```typescript
import { testClient } from 'hono/testing';
import { app } from '../policy';

describe('Cookie Policy API', () => {
  let client: ReturnType<typeof testClient>;

  beforeEach(() => {
    client = testClient(app);
  });

  describe('GET /cookies/policy', () => {
    it('should return cookie policy', async () => {
      const response = await client.cookies.policy.$get();
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data).toHaveProperty('version');
      expect(data).toHaveProperty('lastUpdated');
      expect(data).toHaveProperty('categories');
      expect(data).toHaveProperty('thirdPartyServices');
      expect(data.categories).toHaveLength(4); // essential, functional, analytics, marketing
    });
  });
});
```

### User Testing

1. **Consent Banner Testing**:
   - Test banner display on first visit
   - Verify accept all, reject all, and customize options
   - Test category selection and consent saving

2. **Settings Page Testing**:
   - Test consent modification in settings
   - Verify cookie listing and categorization
   - Test audit log functionality

3. **Cookie Management Testing**:
   - Test cookie setting with consent checks
   - Verify cookie cleanup on consent withdrawal
   - Test cookie reading and deletion

## Deliverables

### Files to Create
1. `packages/shared-types/src/cookies.ts` - Cookie management types
2. `apps/web/src/lib/cookies/cookie-consent-manager.ts` - Core consent manager
3. `apps/web/src/components/cookies/cookie-consent-banner.tsx` - Consent banner
4. `apps/web/src/components/cookies/cookie-settings.tsx` - Settings page
5. `apps/api-videos/src/endpoints/cookies/policy.ts` - Cookie policy API

### Test Files
1. `apps/web/src/lib/cookies/__tests__/cookie-consent-manager.test.ts`
2. `apps/api-videos/src/endpoints/cookies/__tests__/policy.test.ts`

### Documentation
1. Cookie policy documentation
2. User guide for cookie settings
3. Developer guide for cookie management

## Success Criteria

### Functional Requirements
- ✅ Comprehensive cookie consent management
- ✅ Granular category-based consent
- ✅ Real-time cookie control
- ✅ Audit logging for all cookie actions
- ✅ User-friendly consent interface

### Legal Requirements
- ✅ GDPR Article 6 (Lawfulness of processing) compliance
- ✅ GDPR Article 7 (Conditions for consent) compliance
- ✅ ePrivacy Directive compliance
- ✅ Clear consent mechanisms
- ✅ Right to withdraw consent

### Technical Requirements
- ✅ TypeScript implementation with full type safety
- ✅ React components with proper state management
- ✅ API endpoints with OpenAPI documentation
- ✅ Comprehensive test coverage (>90%)
- ✅ Cross-browser compatibility

### UX Requirements
- ✅ Non-intrusive consent banner
- ✅ Clear category explanations
- ✅ Easy consent management
- ✅ Mobile-responsive design
- ✅ Accessibility compliance (WCAG 2.1 AA)

## Timeline

### Day 1: Core Infrastructure
- Create cookie management types and interfaces
- Implement cookie consent manager core functionality
- Set up basic API endpoints

### Day 2: User Interface
- Develop cookie consent banner component
- Implement cookie settings page
- Create category toggle components

### Day 3: Integration & Testing
- Complete API integration
- Implement comprehensive testing
- Add documentation and user guides

## Risk Assessment

### High Risk
- **Cookie Synchronization**: Ensuring consent state is synchronized across browser tabs
  - **Mitigation**: Use localStorage events for cross-tab communication
- **Third-party Cookie Compliance**: Managing third-party service cookies
  - **Mitigation**: Implement strict third-party cookie management and validation

### Medium Risk
- **Browser Compatibility**: Different browsers handle cookies differently
  - **Mitigation**: Comprehensive cross-browser testing and fallback mechanisms
- **Performance Impact**: Cookie checking on every operation
  - **Mitigation**: Implement efficient caching and batch operations

### Low Risk
- **User Interface Complexity**: Cookie settings may become complex
  - **Mitigation**: Progressive disclosure and clear categorization
- **Audit Log Storage**: LocalStorage may have size limitations
  - **Mitigation**: Implement log rotation and server-side backup

This implementation plan provides a comprehensive cookie consent management system that ensures GDPR compliance while maintaining excellent user experience and technical robustness.