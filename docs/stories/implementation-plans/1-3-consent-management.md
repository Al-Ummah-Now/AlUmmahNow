# Implementation Plan: Create Consent Management System

**Story**: 1.3 Implement GDPR-Compliant Data Storage  
**Task Group**: 1-3-consent-management  
**Priority**: High  
**Estimated Time**: 14-18 hours  

## Overview

This implementation plan creates a comprehensive consent management system that provides granular consent options, records consent history, integrates with OpenAuth, and maintains an audit trail. The system ensures GDPR compliance by providing informed, specific, and withdrawable consent for all data processing activities.

## Prerequisites

- Data storage audit completed (Story 1.3 Task 1)
- Encrypted storage implementation (Story 1.3 Task 2)
- OpenAuth integration understanding
- GDPR consent requirements knowledge
- React component architecture familiarity

## Implementation Steps

### Step 1: Create Consent Management Core

**File**: `apps/web/src/lib/consent/consent-manager.ts`

```typescript
import type { 
  ConsentRecord, 
  ConsentCategory, 
  ConsentConfiguration,
  ConsentRequest,
  ConsentResponse,
  SecurityEvent 
} from '@al-ummah/shared-types';

/**
 * GDPR-compliant consent management system
 */
export class ConsentManager {
  private config: ConsentConfiguration;
  private consentRecords: Map<string, ConsentRecord[]> = new Map();
  private eventLogger: (event: SecurityEvent) => void;
  private storageKey = 'consent_records';

  constructor(config: ConsentConfiguration, eventLogger: (event: SecurityEvent) => void) {
    this.config = config;
    this.eventLogger = eventLogger;
    this.loadConsentRecords();
  }

  /**
   * Request consent for specific categories
   */
  async requestConsent(request: ConsentRequest): Promise<ConsentResponse> {
    try {
      const consentRecord: ConsentRecord = {
        id: this.generateConsentId(),
        userId: request.userId,
        categories: request.categories,
        purpose: request.purpose,
        legalBasis: request.legalBasis || 'consent',
        status: 'pending',
        requestedAt: new Date().toISOString(),
        expiresAt: this.calculateExpiryDate(request.categories),
        version: this.config.version,
        metadata: {
          ipAddress: await this.getClientIP(),
          userAgent: navigator.userAgent,
          language: navigator.language,
          timestamp: new Date().toISOString()
        }
      };

      // Store pending consent
      this.storeConsentRecord(consentRecord);

      this.logConsentEvent({
        type: 'consent-requested',
        severity: 'low',
        message: `Consent requested for categories: ${request.categories.join(', ')}`,
        metadata: {
          consentId: consentRecord.id,
          userId: request.userId,
          categories: request.categories,
          purpose: request.purpose
        }
      });

      return {
        consentId: consentRecord.id,
        status: 'pending',
        categories: request.categories,
        expiresAt: consentRecord.expiresAt,
        version: this.config.version
      };
    } catch (error) {
      this.logConsentEvent({
        type: 'consent-request-failed',
        severity: 'high',
        message: `Consent request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          userId: request.userId,
          categories: request.categories,
          error: error instanceof Error ? error.stack : String(error)
        }
      });

      throw error;
    }
  }

  /**
   * Record user consent response
   */
  async recordConsent(
    consentId: string, 
    response: 'granted' | 'denied', 
    categories?: string[]
  ): Promise<ConsentRecord> {
    try {
      const consentRecord = this.getConsentRecord(consentId);
      if (!consentRecord) {
        throw new Error('Consent record not found');
      }

      if (consentRecord.status !== 'pending') {
        throw new Error('Consent already processed');
      }

      // Update consent record
      consentRecord.status = response === 'granted' ? 'granted' : 'denied';
      consentRecord.respondedAt = new Date().toISOString();
      
      if (categories) {
        // Update individual category statuses
        consentRecord.categories = consentRecord.categories.map(category => ({
          ...category,
          granted: categories.includes(category.name),
          respondedAt: new Date().toISOString()
        }));
      } else {
        // Apply response to all categories
        consentRecord.categories = consentRecord.categories.map(category => ({
          ...category,
          granted: response === 'granted',
          respondedAt: new Date().toISOString()
        }));
      }

      // Store updated record
      this.storeConsentRecord(consentRecord);

      this.logConsentEvent({
        type: response === 'granted' ? 'consent-granted' : 'consent-denied',
        severity: 'low',
        message: `Consent ${response} for categories: ${consentRecord.categories.map(c => c.name).join(', ')}`,
        metadata: {
          consentId: consentRecord.id,
          userId: consentRecord.userId,
          categories: consentRecord.categories.map(c => ({ name: c.name, granted: c.granted }))
        }
      });

      return consentRecord;
    } catch (error) {
      this.logConsentEvent({
        type: 'consent-recording-failed',
        severity: 'high',
        message: `Consent recording failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          consentId,
          response,
          error: error instanceof Error ? error.stack : String(error)
        }
      });

      throw error;
    }
  }

  /**
   * Check if consent is valid for specific category
   */
  hasConsent(userId: string, category: string): boolean {
    const userConsents = this.getUserConsents(userId);
    
    // Find most recent consent for category
    const relevantConsent = userConsents
      .filter(consent => 
        consent.status === 'granted' &&
        consent.categories.some(cat => cat.name === category && cat.granted)
      )
      .sort((a, b) => new Date(b.respondedAt || b.requestedAt).getTime() - 
                         new Date(a.respondedAt || a.requestedAt).getTime())[0];

    if (!relevantConsent) {
      return false;
    }

    // Check if consent has expired
    const expiryDate = new Date(relevantConsent.expiresAt);
    const now = new Date();
    
    return now < expiryDate;
  }

  /**
   * Withdraw consent for specific categories
   */
  async withdrawConsent(
    userId: string, 
    categories: string[], 
    reason?: string
  ): Promise<ConsentRecord> {
    try {
      // Find active consent records
      const activeConsents = this.getUserConsents(userId).filter(consent =>
        consent.status === 'granted' &&
        consent.categories.some(cat => 
          categories.includes(cat.name) && cat.granted
        )
      );

      if (activeConsents.length === 0) {
        throw new Error('No active consent found for specified categories');
      }

      // Create withdrawal record
      const withdrawalRecord: ConsentRecord = {
        id: this.generateConsentId(),
        userId,
        categories: categories.map(name => ({
          name,
          description: this.getCategoryDescription(name),
          required: this.isCategoryRequired(name),
          granted: false,
          withdrawnAt: new Date().toISOString()
        })),
        purpose: 'consent-withdrawal',
        legalBasis: 'withdrawal',
        status: 'withdrawn',
        requestedAt: new Date().toISOString(),
        respondedAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        version: this.config.version,
        withdrawalReason: reason,
        metadata: {
          originalConsentIds: activeConsents.map(c => c.id),
          withdrawnCategories: categories,
          timestamp: new Date().toISOString()
        }
      };

      // Store withdrawal record
      this.storeConsentRecord(withdrawalRecord);

      this.logConsentEvent({
        type: 'consent-withdrawn',
        severity: 'medium',
        message: `Consent withdrawn for categories: ${categories.join(', ')}`,
        metadata: {
          consentId: withdrawalRecord.id,
          userId,
          categories,
          reason
        }
      });

      return withdrawalRecord;
    } catch (error) {
      this.logConsentEvent({
        type: 'consent-withdrawal-failed',
        severity: 'high',
        message: `Consent withdrawal failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          userId,
          categories,
          error: error instanceof Error ? error.stack : String(error)
        }
      });

      throw error;
    }
  }

  /**
   * Get user's consent history
   */
  getUserConsentHistory(userId: string): ConsentRecord[] {
    return this.getUserConsents(userId).sort((a, b) => 
      new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime()
    );
  }

  /**
   * Get current consent status for user
   */
  getCurrentConsentStatus(userId: string): Record<string, {
    granted: boolean;
    lastUpdated: string;
    expiresAt: string;
  }> {
    const userConsents = this.getUserConsents(userId);
    const status: Record<string, { granted: boolean; lastUpdated: string; expiresAt: string }> = {};

    // Get all categories from configuration
    this.config.categories.forEach(category => {
      const latestConsent = this.getLatestConsentForCategory(userConsents, category.name);
      
      if (latestConsent) {
        status[category.name] = {
          granted: latestConsent.granted && latestConsent.status === 'granted',
          lastUpdated: latestConsent.respondedAt || latestConsent.requestedAt,
          expiresAt: latestConsent.expiresAt
        };
      } else {
        status[category.name] = {
          granted: false,
          lastUpdated: '',
          expiresAt: ''
        };
      }
    });

    return status;
  }

  /**
   * Check for expired consents and trigger renewal
   */
  async checkExpiredConsents(): Promise<string[]> {
    const expiredConsents: string[] = [];
    const now = new Date();

    for (const [userId, consents] of this.consentRecords.entries()) {
      for (const consent of consents) {
        if (consent.status === 'granted' && new Date(consent.expiresAt) < now) {
          expiredConsents.push(consent.id);
          
          this.logConsentEvent({
            type: 'consent-expired',
            severity: 'medium',
            message: `Consent expired for user: ${userId}`,
            metadata: {
              consentId: consent.id,
              userId,
              categories: consent.categories.map(c => c.name),
              expiredAt: consent.expiresAt
            }
          });
        }
      }
    }

    return expiredConsents;
  }

  /**
   * Generate consent report for GDPR compliance
   */
  generateConsentReport(userId: string): {
    userId: string;
    generatedAt: string;
    activeConsents: ConsentRecord[];
    withdrawnConsents: ConsentRecord[];
    expiredConsents: ConsentRecord[];
    summary: {
      totalConsents: number;
      activeConsents: number;
      withdrawnConsents: number;
      expiredConsents: number;
    };
  } {
    const userConsents = this.getUserConsents(userId);
    const now = new Date();

    const activeConsents = userConsents.filter(consent => 
      consent.status === 'granted' && new Date(consent.expiresAt) > now
    );

    const withdrawnConsents = userConsents.filter(consent => 
      consent.status === 'withdrawn'
    );

    const expiredConsents = userConsents.filter(consent => 
      consent.status === 'granted' && new Date(consent.expiresAt) <= now
    );

    return {
      userId,
      generatedAt: new Date().toISOString(),
      activeConsents,
      withdrawnConsents,
      expiredConsents,
      summary: {
        totalConsents: userConsents.length,
        activeConsents: activeConsents.length,
        withdrawnConsents: withdrawnConsents.length,
        expiredConsents: expiredConsents.length
      }
    };
  }

  /**
   * Get consent record by ID
   */
  private getConsentRecord(consentId: string): ConsentRecord | null {
    for (const consents of this.consentRecords.values()) {
      const record = consents.find(consent => consent.id === consentId);
      if (record) {
        return record;
      }
    }
    return null;
  }

  /**
   * Get all consents for user
   */
  private getUserConsents(userId: string): ConsentRecord[] {
    return this.consentRecords.get(userId) || [];
  }

  /**
   * Get latest consent for specific category
   */
  private getLatestConsentForCategory(
    consents: ConsentRecord[], 
    categoryName: string
  ): ConsentCategory | null {
    const categoryConsents = consents
      .filter(consent => 
        consent.categories.some(cat => cat.name === categoryName)
      )
      .sort((a, b) => 
        new Date(b.respondedAt || b.requestedAt).getTime() - 
        new Date(a.respondedAt || a.requestedAt).getTime()
      );

    if (categoryConsents.length === 0) {
      return null;
    }

    const latestConsent = categoryConsents[0];
    return latestConsent.categories.find(cat => cat.name === categoryName) || null;
  }

  /**
   * Store consent record
   */
  private storeConsentRecord(record: ConsentRecord): void {
    const userConsents = this.getUserConsents(record.userId);
    userConsents.push(record);
    this.consentRecords.set(record.userId, userConsents);
    this.saveConsentRecords();
  }

  /**
   * Load consent records from storage
   */
  private loadConsentRecords(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);
        this.consentRecords = new Map(
          Object.entries(data).map(([userId, consents]) => [
            userId,
            consents as ConsentRecord[]
          ])
        );
      }
    } catch (error) {
      console.warn('Failed to load consent records:', error);
      this.consentRecords.clear();
    }
  }

  /**
   * Save consent records to storage
   */
  private saveConsentRecords(): void {
    try {
      const data = Object.fromEntries(this.consentRecords);
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save consent records:', error);
    }
  }

  /**
   * Generate unique consent ID
   */
  private generateConsentId(): string {
    return `consent_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Calculate expiry date for consent
   */
  private calculateExpiryDate(categories: ConsentCategory[]): string {
    const maxExpiryDays = Math.max(...categories.map(cat => cat.validityDays || 365));
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + maxExpiryDays);
    return expiryDate.toISOString();
  }

  /**
   * Get client IP address
   */
  private async getClientIP(): Promise<string> {
    try {
      // In a real implementation, this would use a service to get the client IP
      // For now, return a placeholder
      return 'client-ip-unknown';
    } catch (error) {
      return 'ip-unavailable';
    }
  }

  /**
   * Get category description
   */
  private getCategoryDescription(categoryName: string): string {
    const category = this.config.categories.find(cat => cat.name === categoryName);
    return category?.description || '';
  }

  /**
   * Check if category is required
   */
  private isCategoryRequired(categoryName: string): boolean {
    const category = this.config.categories.find(cat => cat.name === categoryName);
    return category?.required || false;
  }

  /**
   * Log consent event
   */
  private logConsentEvent(event: Partial<SecurityEvent>): void {
    const securityEvent: SecurityEvent = {
      id: `consent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: event.type || 'consent-event',
      severity: event.severity || 'low',
      message: event.message || 'Consent management event',
      source: 'consent-manager',
      metadata: event.metadata || {}
    };

    this.eventLogger(securityEvent);
  }
}

/**
 * Create consent manager instance
 */
export function createConsentManager(
  config: ConsentConfiguration,
  eventLogger: (event: SecurityEvent) => void
): ConsentManager {
  return new ConsentManager(config, eventLogger);
}
```

### Step 2: Create Consent UI Components

**File**: `apps/web/src/components/consent/ConsentBanner.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { createConsentManager } from '@/lib/consent/consent-manager';
import { useSecurityEvents } from '@/hooks/useSecurityEvents';
import { useEncryptedStorage } from '@/hooks/useEncryptedStorage';
import type { ConsentConfiguration, ConsentCategory } from '@al-ummah/shared-types';

interface ConsentBannerProps {
  config: ConsentConfiguration;
  userId?: string;
  onConsentComplete?: (consentGiven: boolean) => void;
  className?: string;
}

export const ConsentBanner: React.FC<ConsentBannerProps> = ({
  config,
  userId,
  onConsentComplete,
  className = ''
}) => {
  const { logSecurityEvent } = useSecurityEvents();
  const { setItem } = useEncryptedStorage();
  const [isVisible, setIsVisible] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [consentManager] = useState(() => 
    createConsentManager(config, logSecurityEvent)
  );

  useEffect(() => {
    checkConsentRequired();
  }, [userId]);

  const checkConsentRequired = async () => {
    if (!userId) return;

    // Check if user has already given consent
    const hasRequiredConsent = config.categories
      .filter(cat => cat.required)
      .every(cat => consentManager.hasConsent(userId, cat.name));

    if (!hasRequiredConsent) {
      setIsVisible(true);
      // Pre-select required categories
      const requiredCategories = config.categories
        .filter(cat => cat.required)
        .map(cat => cat.name);
      setSelectedCategories(new Set(requiredCategories));
    }
  };

  const handleCategoryToggle = (categoryName: string) => {
    const category = config.categories.find(cat => cat.name === categoryName);
    if (category?.required) return; // Can't toggle required categories

    setSelectedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryName)) {
        newSet.delete(categoryName);
      } else {
        newSet.add(categoryName);
      }
      return newSet;
    });
  };

  const handleAcceptAll = async () => {
    await handleConsentResponse('granted', config.categories.map(cat => cat.name));
  };

  const handleAcceptSelected = async () => {
    await handleConsentResponse('granted', Array.from(selectedCategories));
  };

  const handleRejectAll = async () => {
    await handleConsentResponse('denied', []);
  };

  const handleConsentResponse = async (
    response: 'granted' | 'denied',
    categories: string[]
  ) => {
    if (!userId) return;

    setIsLoading(true);
    try {
      // Request consent
      const consentRequest = await consentManager.requestConsent({
        userId,
        categories: config.categories.map(cat => ({
          name: cat.name,
          description: cat.description,
          required: cat.required,
          granted: response === 'granted' && categories.includes(cat.name)
        })),
        purpose: 'data-processing',
        legalBasis: 'consent'
      });

      // Record consent response
      await consentManager.recordConsent(consentRequest.consentId, response, categories);

      // Store consent preference
      await setItem(`consent_preferences_${userId}`, {
        categories: categories,
        timestamp: new Date().toISOString(),
        version: config.version
      }, {
        level: 'high',
        category: 'personal',
        gdprRelevant: true,
        specialCategories: []
      });

      setIsVisible(false);
      onConsentComplete?.(response === 'granted');

    } catch (error) {
      console.error('Consent handling failed:', error);
      logSecurityEvent({
        id: `consent-banner-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'consent-banner-error',
        severity: 'high',
        message: `Consent banner error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'ConsentBanner',
        metadata: { userId, error: error instanceof Error ? error.stack : String(error) }
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCustomize = () => {
    // Show detailed customization options
    // This could open a modal or expand the banner
  };

  if (!isVisible) return null;

  return (
    <div className={`fixed bottom-0 left-0 right-0 bg-gray-900 text-white p-4 shadow-lg z-50 ${className}`}>
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-lg font-semibold mb-2">
              {config.title || 'Privacy & Cookie Consent'}
            </h3>
            <p className="text-gray-300 text-sm mb-3">
              {config.description || 'We use cookies and similar technologies to help personalize content, tailor and measure ads, and provide a better experience. By clicking accept all you agree to our use of cookies.'}
            </p>
            
            {/* Quick category overview */}
            <div className="flex flex-wrap gap-2 mb-3">
              {config.categories.slice(0, 4).map(category => (
                <span
                  key={category.name}
                  className={`px-2 py-1 text-xs rounded ${
                    category.required 
                      ? 'bg-blue-600 text-white' 
                      : selectedCategories.has(category.name)
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {category.label || category.name}
                  {category.required && ' *'}
                </span>
              ))}
              {config.categories.length > 4 && (
                <span className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded">
                  +{config.categories.length - 4} more
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 flex-shrink-0">
            <button
              onClick={handleCustomize}
              className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              disabled={isLoading}
            >
              Customize
            </button>
            
            <button
              onClick={handleRejectAll}
              className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded transition-colors"
              disabled={isLoading}
            >
              Reject All
            </button>
            
            <button
              onClick={handleAcceptSelected}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded transition-colors"
              disabled={isLoading || selectedCategories.size === 0}
            >
              Accept Selected
            </button>
            
            <button
              onClick={handleAcceptAll}
              className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 rounded transition-colors font-semibold"
              disabled={isLoading}
            >
              {isLoading ? 'Processing...' : 'Accept All'}
            </button>
          </div>
        </div>

        {/* Required categories notice */}
        <div className="mt-3 text-xs text-gray-400">
          * Required categories for basic functionality
        </div>
      </div>
    </div>
  );
};
```

**File**: `apps/web/src/components/consent/ConsentModal.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { createConsentManager } from '@/lib/consent/consent-manager';
import { useSecurityEvents } from '@/hooks/useSecurityEvents';
import type { ConsentConfiguration, ConsentCategory } from '@al-ummah/shared-types';

interface ConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ConsentConfiguration;
  userId?: string;
  onConsentComplete?: (consentGiven: boolean) => void;
}

export const ConsentModal: React.FC<ConsentModalProps> = ({
  isOpen,
  onClose,
  config,
  userId,
  onConsentComplete
}) => {
  const { logSecurityEvent } = useSecurityEvents();
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [consentManager] = useState(() => 
    createConsentManager(config, logSecurityEvent)
  );

  useEffect(() => {
    if (isOpen && userId) {
      // Load current consent preferences
      const currentStatus = consentManager.getCurrentConsentStatus(userId);
      const currentlyGranted = Object.entries(currentStatus)
        .filter(([_, status]) => status.granted)
        .map(([name, _]) => name);
      
      setSelectedCategories(new Set(currentlyGranted));
    }
  }, [isOpen, userId, consentManager]);

  const handleCategoryToggle = (categoryName: string) => {
    const category = config.categories.find(cat => cat.name === categoryName);
    if (category?.required) return; // Can't toggle required categories

    setSelectedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryName)) {
        newSet.delete(categoryName);
      } else {
        newSet.add(categoryName);
      }
      return newSet;
    });
  };

  const handleCategoryExpand = (categoryName: string) => {
    setExpandedCategories(prev => {
      const newSet = new Set(prev);
      if (newSet.has(categoryName)) {
        newSet.delete(categoryName);
      } else {
        newSet.add(categoryName);
      }
      return newSet;
    });
  };

  const handleSave = async () => {
    if (!userId) return;

    setIsLoading(true);
    try {
      // Request consent
      const consentRequest = await consentManager.requestConsent({
        userId,
        categories: config.categories.map(cat => ({
          name: cat.name,
          description: cat.description,
          required: cat.required,
          granted: selectedCategories.has(cat.name)
        })),
        purpose: 'data-processing',
        legalBasis: 'consent'
      });

      // Record consent response
      await consentManager.recordConsent(
        consentRequest.consentId, 
        'granted', 
        Array.from(selectedCategories)
      );

      onConsentComplete?.(selectedCategories.size > 0);
      onClose();

    } catch (error) {
      console.error('Consent saving failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-gray-900">
              {config.title || 'Privacy Preferences'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>
          <p className="mt-2 text-gray-600">
            {config.description || 'Manage your privacy preferences and consent settings.'}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {config.categories.map(category => (
              <ConsentCategoryItem
                key={category.name}
                category={category}
                isSelected={selectedCategories.has(category.name)}
                isExpanded={expandedCategories.has(category.name)}
                onToggle={() => handleCategoryToggle(category.name)}
                onExpand={() => handleCategoryExpand(category.name)}
              />
            ))}
          </div>

          {/* Legal Information */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-2">Legal Information</h3>
            <p className="text-sm text-gray-600 mb-3">
              You have the right to withdraw your consent at any time. 
              Withdrawal of consent shall not affect the lawfulness of processing 
              based on consent before its withdrawal.
            </p>
            <div className="text-sm text-gray-500">
              <p>• Consent valid for: {config.defaultValidityDays || 365} days</p>
              <p>• Last updated: {config.lastUpdated || new Date().toISOString()}</p>
              <p>• Version: {config.version}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 bg-gray-50">
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-600">
              {selectedCategories.size} of {config.categories.length} categories selected
            </div>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                disabled={isLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors font-semibold"
                disabled={isLoading}
              >
                {isLoading ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface ConsentCategoryItemProps {
  category: ConsentCategory;
  isSelected: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onExpand: () => void;
}

const ConsentCategoryItem: React.FC<ConsentCategoryItemProps> = ({
  category,
  isSelected,
  isExpanded,
  onToggle,
  onExpand
}) => {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="p-4 bg-white">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3 flex-1">
            <button
              onClick={onToggle}
              disabled={category.required}
              className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                category.required
                  ? 'bg-blue-600 border-blue-600 cursor-not-allowed'
                  : isSelected
                    ? 'bg-blue-600 border-blue-600'
                    : 'border-gray-300 hover:border-gray-400'
              }`}
            >
              {isSelected && (
                <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
            
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-gray-900">
                  {category.label || category.name}
                </h3>
                {category.required && (
                  <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                    Required
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-600 mt-1">
                {category.description}
              </p>
              
              {category.purposes && category.purposes.length > 0 && (
                <div className="mt-2">
                  <button
                    onClick={onExpand}
                    className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
                  >
                    <svg 
                      className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    View purposes
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {isExpanded && category.purposes && (
          <div className="mt-4 pl-8 border-t border-gray-100 pt-4">
            <h4 className="font-medium text-gray-900 mb-2">Purposes:</h4>
            <ul className="space-y-1">
              {category.purposes.map((purpose, index) => (
                <li key={index} className="text-sm text-gray-600 flex items-start gap-2">
                  <span className="text-blue-600 mt-0.5">•</span>
                  <span>{purpose}</span>
                </li>
              ))}
            </ul>
            
            {category.retention && (
              <div className="mt-3 text-sm text-gray-500">
                <strong>Retention:</strong> {category.retention}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
```

### Step 3: Create React Hook for Consent Management

**File**: `apps/web/src/hooks/useConsentManagement.ts`

```typescript
import { useState, useEffect, useCallback } from 'react';
import { createConsentManager } from '@/lib/consent/consent-manager';
import { useSecurityEvents } from './useSecurityEvents';
import { useEncryptedStorage } from './useEncryptedStorage';
import type { 
  ConsentConfiguration, 
  ConsentRecord, 
  ConsentCategory 
} from '@al-ummah/shared-types';

/**
 * React hook for consent management
 */
export function useConsentManagement(config: ConsentConfiguration, userId?: string) {
  const { logSecurityEvent } = useSecurityEvents();
  const { getItem, setItem } = useEncryptedStorage();
  const [consentManager] = useState(() => 
    createConsentManager(config, logSecurityEvent)
  );
  const [currentConsent, setCurrentConsent] = useState<Record<string, any>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [consentHistory, setConsentHistory] = useState<ConsentRecord[]>([]);

  useEffect(() => {
    if (userId) {
      loadCurrentConsent();
      loadConsentHistory();
    } else {
      setIsLoading(false);
    }
  }, [userId, config]);

  /**
   * Load current consent status
   */
  const loadCurrentConsent = async () => {
    try {
      if (!userId) return;

      const status = consentManager.getCurrentConsentStatus(userId);
      setCurrentConsent(status);
    } catch (error) {
      console.error('Failed to load current consent:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Load consent history
   */
  const loadConsentHistory = async () => {
    try {
      if (!userId) return;

      const history = consentManager.getUserConsentHistory(userId);
      setConsentHistory(history);
    } catch (error) {
      console.error('Failed to load consent history:', error);
    }
  };

  /**
   * Check if consent is given for specific category
   */
  const hasConsent = useCallback((category: string): boolean => {
    if (!userId) return false;
    return consentManager.hasConsent(userId, category);
  }, [userId, consentManager]);

  /**
   * Request consent for categories
   */
  const requestConsent = useCallback(async (categories: ConsentCategory[]) => {
    if (!userId) throw new Error('User ID required for consent request');

    try {
      const response = await consentManager.requestConsent({
        userId,
        categories,
        purpose: 'data-processing',
        legalBasis: 'consent'
      });

      await loadCurrentConsent();
      await loadConsentHistory();

      return response;
    } catch (error) {
      logSecurityEvent({
        id: `consent-request-failed-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'consent-request-failed',
        severity: 'high',
        message: `Consent request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'useConsentManagement',
        metadata: { userId, categories: categories.map(c => c.name) }
      });
      throw error;
    }
  }, [userId, consentManager, logSecurityEvent, loadCurrentConsent, loadConsentHistory]);

  /**
   * Record consent response
   */
  const recordConsent = useCallback(async (
    consentId: string, 
    response: 'granted' | 'denied', 
    categories?: string[]
  ) => {
    try {
      const record = await consentManager.recordConsent(consentId, response, categories);
      
      await loadCurrentConsent();
      await loadConsentHistory();

      return record;
    } catch (error) {
      logSecurityEvent({
        id: `consent-recording-failed-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'consent-recording-failed',
        severity: 'high',
        message: `Consent recording failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'useConsentManagement',
        metadata: { consentId, response, categories }
      });
      throw error;
    }
  }, [consentManager, logSecurityEvent, loadCurrentConsent, loadConsentHistory]);

  /**
   * Withdraw consent
   */
  const withdrawConsent = useCallback(async (
    categories: string[], 
    reason?: string
  ) => {
    if (!userId) throw new Error('User ID required for consent withdrawal');

    try {
      const record = await consentManager.withdrawConsent(userId, categories, reason);
      
      await loadCurrentConsent();
      await loadConsentHistory();

      return record;
    } catch (error) {
      logSecurityEvent({
        id: `consent-withdrawal-failed-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'consent-withdrawal-failed',
        severity: 'high',
        message: `Consent withdrawal failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        source: 'useConsentManagement',
        metadata: { userId, categories, reason }
      });
      throw error;
    }
  }, [userId, consentManager, logSecurityEvent, loadCurrentConsent, loadConsentHistory]);

  /**
   * Get consent report
   */
  const getConsentReport = useCallback(() => {
    if (!userId) return null;
    return consentManager.generateConsentReport(userId);
  }, [userId, consentManager]);

  /**
   * Check for expired consents
   */
  const checkExpiredConsents = useCallback(async () => {
    try {
      const expiredIds = await consentManager.checkExpiredConsents();
      
      if (expiredIds.length > 0) {
        await loadCurrentConsent();
        await loadConsentHistory();
      }

      return expiredIds;
    } catch (error) {
      console.error('Failed to check expired consents:', error);
      return [];
    }
  }, [consentManager, loadCurrentConsent, loadConsentHistory]);

  /**
   * Save consent preferences
   */
  const saveConsentPreferences = useCallback(async (preferences: any) => {
    if (!userId) return;

    try {
      await setItem(`consent_preferences_${userId}`, preferences, {
        level: 'high',
        category: 'personal',
        gdprRelevant: true,
        specialCategories: []
      });
    } catch (error) {
      console.error('Failed to save consent preferences:', error);
    }
  }, [userId, setItem]);

  /**
   * Load consent preferences
   */
  const loadConsentPreferences = useCallback(async () => {
    if (!userId) return null;

    try {
      return await getItem(`consent_preferences_${userId}`);
    } catch (error) {
      console.error('Failed to load consent preferences:', error);
      return null;
    }
  }, [userId, getItem]);

  return {
    // State
    currentConsent,
    consentHistory,
    isLoading,
    
    // Methods
    hasConsent,
    requestConsent,
    recordConsent,
    withdrawConsent,
    getConsentReport,
    checkExpiredConsents,
    saveConsentPreferences,
    loadConsentPreferences,
    
    // Refresh methods
    refreshConsent: loadCurrentConsent,
    refreshHistory: loadConsentHistory
  };
}

/**
 * Hook for managing consent UI state
 */
export function useConsentUI(config: ConsentConfiguration, userId?: string) {
  const [isBannerVisible, setIsBannerVisible] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  
  const { hasConsent, currentConsent, isLoading } = useConsentManagement(config, userId);

  useEffect(() => {
    if (!userId || isLoading) return;

    // Check if consent is needed
    const requiredCategories = config.categories.filter(cat => cat.required);
    const hasAllRequiredConsent = requiredCategories.every(cat => 
      hasConsent(cat.name)
    );

    if (!hasAllRequiredConsent && !hasInteracted) {
      setIsBannerVisible(true);
    }
  }, [userId, config, hasConsent, hasInteracted, isLoading]);

  /**
   * Show consent modal
   */
  const showModal = () => {
    setIsModalVisible(true);
    setIsBannerVisible(false);
    setHasInteracted(true);
  };

  /**
   * Hide consent modal
   */
  const hideModal = () => {
    setIsModalVisible(false);
  };

  /**
   * Handle consent completion
   */
  const handleConsentComplete = (consentGiven: boolean) => {
    setIsBannerVisible(false);
    setIsModalVisible(false);
    setHasInteracted(true);
  };

  /**
   * Reset interaction state (for testing)
   */
  const resetInteraction = () => {
    setHasInteracted(false);
    setIsBannerVisible(false);
    setIsModalVisible(false);
  };

  return {
    // UI State
    isBannerVisible,
    isModalVisible,
    hasInteracted,
    
    // UI Actions
    showModal,
    hideModal,
    handleConsentComplete,
    resetInteraction,
    
    // Consent State
    currentConsent,
    isLoading
  };
}
```

### Step 4: Create Consent Configuration

**File**: `apps/web/src/config/consent-config.ts`

```typescript
import type { ConsentConfiguration } from '@al-ummah/shared-types';

/**
 * GDPR-compliant consent configuration
 */
export const consentConfig: ConsentConfiguration = {
  version: '1.0.0',
  lastUpdated: new Date().toISOString(),
  defaultValidityDays: 365,
  categories: [
    {
      name: 'essential',
      label: 'Essential Cookies',
      description: 'These cookies are necessary for the website to function and cannot be switched off in our systems. They are usually only set in response to actions made by you which amount to a request for services.',
      required: true,
      purposes: [
        'Authentication and security',
        'Shopping cart and e-commerce',
        'Remembering your preferences',
        'Load balancing and fraud prevention'
      ],
      retention: 'Session or persistent as required',
      validityDays: 365
    },
    {
      name: 'analytics',
      label: 'Analytics Cookies',
      description: 'These cookies allow us to count visits and traffic sources so we can measure and improve the performance of our site. They help us to know which pages are the most and least popular and see how visitors move around the site.',
      required: false,
      purposes: [
        'Website analytics and performance monitoring',
        'User behavior analysis',
        'A/B testing and optimization',
        'Error reporting and debugging'
      ],
      retention: '26 months',
      validityDays: 365
    },
    {
      name: 'personalization',
      label: 'Personalization Cookies',
      description: 'These cookies enable the website to provide enhanced functionality and personalization. They may be set by us or by third party providers whose services we have added to our pages.',
      required: false,
      purposes: [
        'Remembering your preferences and settings',
        'Personalized content recommendations',
        'Language and region preferences',
        'Theme and display preferences'
      ],
      retention: '365 days',
      validityDays: 365
    },
    {
      name: 'advertising',
      label: 'Advertising Cookies',
      description: 'These cookies may be set through our site by our advertising partners to build a profile of your interests and show you relevant adverts on other sites.',
      required: false,
      purposes: [
        'Personalized advertising',
        'Ad frequency capping',
        'Cross-site behavioral tracking',
        'Ad performance measurement'
      ],
      retention: '13 months',
      validityDays: 180
    },
    {
      name: 'social_media',
      label: 'Social Media Cookies',
      description: 'These cookies are set by a range of social media services that we have added to the site to enable you to share our content with your friends and networks.',
      required: false,
      purposes: [
        'Social media sharing',
        'Social media login',
        'Social media widgets',
        'Social media analytics'
      ],
      retention: '365 days',
      validityDays: 365
    }
  ],
  legalTexts: {
    title: 'Privacy & Cookie Consent',
    description: 'We use cookies and similar technologies to help personalize content, tailor and measure ads, and provide a better experience. By clicking accept all you agree to our use of cookies.',
    privacyPolicy: 'https://alummahnow.net/privacy',
    cookiePolicy: 'https://alummahnow.net/cookies',
    imprint: 'https://alummahnow.net/imprint'
  },
  gdprCompliance: {
    dataController: 'Al Ummah Now',
    contactEmail: 'privacy@alummahnow.net',
    dpoContact: 'dpo@alummahnow.net',
    legalBasis: ['consent', 'legitimate_interest', 'contractual_necessity'],
    dataRetention: {
      analytics: '26 months',
      advertising: '13 months',
      personalization: '365 days',
      essential: 'as_required'
    },
    userRights: [
      'right_to_access',
      'right_to_rectification',
      'right_to_erasure',
      'right_to_portability',
      'right_to_object',
      'right_to_withdraw_consent'
    ]
  }
};

/**
 * Create consent configuration for specific environment
 */
export function createConsentConfig(
  environment: 'development' | 'staging' | 'production'
): ConsentConfiguration {
  const baseConfig = { ...consentConfig };

  if (environment === 'development') {
    // Shorter validity for testing
    baseConfig.categories = baseConfig.categories.map(cat => ({
      ...cat,
      validityDays: 7
    }));
    baseConfig.defaultValidityDays = 7;
  }

  return baseConfig;
}
```

### Step 5: Add Consent Tests

**File**: `apps/web/src/__tests__/consent/consent-manager.test.ts`

```typescript
import { ConsentManager, createConsentManager } from '@/lib/consent/consent-manager';
import type { ConsentConfiguration, SecurityEvent } from '@al-ummah/shared-types';

describe('ConsentManager', () => {
  let consentManager: ConsentManager;
  let mockEventLogger: jest.MockedFunction<(event: SecurityEvent) => void>;
  let testConfig: ConsentConfiguration;

  beforeEach(() => {
    mockEventLogger = jest.fn();
    
    testConfig = {
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      defaultValidityDays: 365,
      categories: [
        {
          name: 'essential',
          label: 'Essential',
          description: 'Essential cookies',
          required: true,
          purposes: ['Authentication'],
          retention: '1 year',
          validityDays: 365
        },
        {
          name: 'analytics',
          label: 'Analytics',
          description: 'Analytics cookies',
          required: false,
          purposes: ['Website analytics'],
          retention: '26 months',
          validityDays: 365
        }
      ],
      legalTexts: {
        title: 'Privacy Consent',
        description: 'Privacy description',
        privacyPolicy: 'https://example.com/privacy',
        cookiePolicy: 'https://example.com/cookies',
        imprint: 'https://example.com/imprint'
      },
      gdprCompliance: {
        dataController: 'Test Company',
        contactEmail: 'privacy@example.com',
        dpoContact: 'dpo@example.com',
        legalBasis: ['consent'],
        dataRetention: {},
        userRights: []
      }
    };

    consentManager = createConsentManager(testConfig, mockEventLogger);
  });

  describe('Consent Request', () => {
    it('should create consent request', async () => {
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const response = await consentManager.requestConsent(request);

      expect(response).toBeDefined();
      expect(response.status).toBe('pending');
      expect(response.categories).toHaveLength(2);
      expect(response.consentId).toBeDefined();
      expect(response.expiresAt).toBeDefined();
    });

    it('should log consent request event', async () => {
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      await consentManager.requestConsent(request);

      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'consent-requested',
          severity: 'low'
        })
      );
    });
  });

  describe('Consent Recording', () => {
    it('should record granted consent', async () => {
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const consentResponse = await consentManager.requestConsent(request);
      const record = await consentManager.recordConsent(
        consentResponse.consentId,
        'granted',
        ['essential', 'analytics']
      );

      expect(record.status).toBe('granted');
      expect(record.categories.every(cat => cat.granted)).toBe(true);
      expect(record.respondedAt).toBeDefined();
    });

    it('should record denied consent', async () => {
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const consentResponse = await consentManager.requestConsent(request);
      const record = await consentManager.recordConsent(
        consentResponse.consentId,
        'denied'
      );

      expect(record.status).toBe('denied');
      expect(record.categories.every(cat => !cat.granted)).toBe(true);
    });

    it('should handle partial consent', async () => {
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const consentResponse = await consentManager.requestConsent(request);
      const record = await consentManager.recordConsent(
        consentResponse.consentId,
        'granted',
        ['essential'] // Only essential, not analytics
      );

      expect(record.status).toBe('granted');
      expect(record.categories[0].granted).toBe(true); // essential
      expect(record.categories[1].granted).toBe(false); // analytics
    });
  });

  describe('Consent Checking', () => {
    beforeEach(async () => {
      // Set up initial consent
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const consentResponse = await consentManager.requestConsent(request);
      await consentManager.recordConsent(
        consentResponse.consentId,
        'granted',
        ['essential', 'analytics']
      );
    });

    it('should return true for granted consent', () => {
      const hasEssential = consentManager.hasConsent('user123', 'essential');
      const hasAnalytics = consentManager.hasConsent('user123', 'analytics');

      expect(hasEssential).toBe(true);
      expect(hasAnalytics).toBe(true);
    });

    it('should return false for non-existent consent', () => {
      const hasNonExistent = consentManager.hasConsent('user123', 'nonexistent');
      expect(hasNonExistent).toBe(false);
    });

    it('should return false for different user', () => {
      const hasConsent = consentManager.hasConsent('otheruser', 'essential');
      expect(hasConsent).toBe(false);
    });
  });

  describe('Consent Withdrawal', () => {
    beforeEach(async () => {
      // Set up initial consent
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const consentResponse = await consentManager.requestConsent(request);
      await consentManager.recordConsent(
        consentResponse.consentId,
        'granted',
        ['essential', 'analytics']
      );
    });

    it('should withdraw consent for specific categories', async () => {
      const withdrawal = await consentManager.withdrawConsent(
        'user123',
        ['analytics'],
        'User no longer wants analytics'
      );

      expect(withdrawal.status).toBe('withdrawn');
      expect(withdrawal.categories[0].granted).toBe(false); // analytics
      expect(withdrawal.withdrawalReason).toBe('User no longer wants analytics');
    });

    it('should update consent status after withdrawal', async () => {
      await consentManager.withdrawConsent('user123', ['analytics']);

      const hasEssential = consentManager.hasConsent('user123', 'essential');
      const hasAnalytics = consentManager.hasConsent('user123', 'analytics');

      expect(hasEssential).toBe(true); // Still has essential
      expect(hasAnalytics).toBe(false); // Analytics withdrawn
    });
  });

  describe('Consent History', () => {
    it('should track consent history', async () => {
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const consentResponse = await consentManager.requestConsent(request);
      await consentManager.recordConsent(consentResponse.consentId, 'granted');

      const history = consentManager.getUserConsentHistory('user123');

      expect(history).toHaveLength(1);
      expect(history[0].userId).toBe('user123');
      expect(history[0].status).toBe('granted');
    });

    it('should return empty history for non-existent user', () => {
      const history = consentManager.getUserConsentHistory('nonexistent');
      expect(history).toHaveLength(0);
    });
  });

  describe('Current Consent Status', () => {
    it('should return current consent status', async () => {
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const consentResponse = await consentManager.requestConsent(request);
      await consentManager.recordConsent(
        consentResponse.consentId,
        'granted',
        ['essential']
      );

      const status = consentManager.getCurrentConsentStatus('user123');

      expect(status.essential.granted).toBe(true);
      expect(status.analytics.granted).toBe(false);
      expect(status.essential.lastUpdated).toBeDefined();
      expect(status.essential.expiresAt).toBeDefined();
    });
  });

  describe('Consent Report', () => {
    it('should generate consent report', async () => {
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const consentResponse = await consentManager.requestConsent(request);
      await consentManager.recordConsent(consentResponse.consentId, 'granted');

      const report = consentManager.generateConsentReport('user123');

      expect(report.userId).toBe('user123');
      expect(report.generatedAt).toBeDefined();
      expect(report.activeConsents).toHaveLength(1);
      expect(report.summary.totalConsents).toBe(1);
      expect(report.summary.activeConsents).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid consent ID', async () => {
      await expect(
        consentManager.recordConsent('invalid-id', 'granted')
      ).rejects.toThrow('Consent record not found');
    });

    it('should handle duplicate consent recording', async () => {
      const request = {
        userId: 'user123',
        categories: testConfig.categories,
        purpose: 'data-processing',
        legalBasis: 'consent' as const
      };

      const consentResponse = await consentManager.requestConsent(request);
      await consentManager.recordConsent(consentResponse.consentId, 'granted');

      await expect(
        consentManager.recordConsent(consentResponse.consentId, 'granted')
      ).rejects.toThrow('Consent already processed');
    });
  });
});
```

## Testing Strategy

### Unit Testing
- **Consent Manager**: Test all consent operations and state management
- **Consent Validation**: Test consent checking and expiry logic
- **Error Handling**: Test error scenarios and edge cases
- **Data Persistence**: Test storage and retrieval of consent records

### Integration Testing
- **React Hooks**: Test hook functionality with consent manager
- **UI Components**: Test consent banner and modal interactions
- **Storage Integration**: Test encrypted storage integration
- **Event Logging**: Test security event logging

### User Testing
- **Consent Flow**: Test complete user consent journey
- **UI Usability**: Test consent interface usability
- **Accessibility**: Test WCAG compliance of consent UI
- **Multi-language**: Test consent UI in different languages

## Deliverables

### New Files
1. **`apps/web/src/lib/consent/consent-manager.ts`** - Core consent management
2. **`apps/web/src/components/consent/ConsentBanner.tsx`** - Consent banner component
3. **`apps/web/src/components/consent/ConsentModal.tsx`** - Detailed consent modal
4. **`apps/web/src/hooks/useConsentManagement.ts`** - React hooks for consent
5. **`apps/web/src/config/consent-config.ts`** - Consent configuration
6. **`apps/web/src/__tests__/consent/consent-manager.test.ts`** - Consent tests

### Updated Files
1. **Type definitions** - Update shared types for consent management
2. **App layout** - Integrate consent banner/modal
3. **Security logging** - Add consent event types

### Configuration
1. **Consent categories** - GDPR-compliant category definitions
2. **Legal texts** - Privacy policy and cookie policy links
3. **User interface** - Consent UI text and styling

## Success Criteria

### Functional Requirements
- ✅ Granular consent options for all data categories
- ✅ Consent recording with audit trail
- ✅ Consent withdrawal functionality
- ✅ Integration with OpenAuth for user identification
- ✅ GDPR-compliant consent management

### Legal Requirements
- ✅ Informed consent with clear descriptions
- ✅ Granular consent options (not all-or-nothing)
- ✅ Right to withdraw consent at any time
- ✅ Consent expiry and renewal mechanisms
- ✅ Detailed consent history and reporting

### Technical Requirements
- ✅ Encrypted storage of consent records
- ✅ Security event logging for all consent operations
- ✅ Integration with existing authentication system
- ✅ Responsive and accessible consent UI
- ✅ Multi-language support capability

### User Experience Requirements
- ✅ Clear and understandable consent language
- ✅ Easy-to-use consent interface
- ✅ Minimal disruption to user experience
- ✅ Accessible design for all users
- ✅ Mobile-friendly consent interface

## Timeline

### Phase 1: Core Consent Management (5-6 hours)
- ConsentManager class implementation
- Consent request and recording logic
- Consent checking and validation
- Basic unit tests

### Phase 2: React Integration (4-5 hours)
- React hooks implementation
- Consent banner component
- Consent modal component
- Integration tests

### Phase 3: Configuration & UI (3-4 hours)
- Consent configuration setup
- Legal text integration
- UI styling and responsiveness
- Accessibility improvements

### Phase 4: Testing & Validation (3-4 hours)
- Comprehensive test suite
- User acceptance testing
- GDPR compliance validation
- Documentation updates

## Risk Assessment

### High Risk
- **GDPR Compliance**: Complex legal requirements that must be met exactly
- **User Experience**: Consent prompts could frustrate users if poorly designed
- **Data Protection**: Consent records are sensitive and must be protected

### Medium Risk
- **Integration Complexity**: Integration with existing systems could be challenging
- **Maintenance Overhead**: Ongoing maintenance of consent system
- **Cross-border Compliance**: Different jurisdictions may have different requirements

### Low Risk
- **Implementation**: Well-defined requirements and patterns
- **Testing**: Comprehensive test coverage possible
- **Performance**: Minimal performance impact expected

### Mitigation Strategies
- Consult legal experts for GDPR compliance
- Conduct user testing for consent interface design
- Implement strong encryption and security measures
- Create comprehensive documentation and maintenance procedures
- Design flexible system for different jurisdiction requirements

This implementation plan provides a comprehensive, GDPR-compliant consent management system that protects user privacy while maintaining a good user experience and ensuring legal compliance.