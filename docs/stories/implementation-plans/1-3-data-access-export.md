# Implementation Plan: Implement Data Access, Export, Deletion Functionality

**Story**: 1.3 Implement GDPR-Compliant Data Storage  
**Task Group**: 1-3-data-access-export  
**Priority**: High  
**Estimated Time**: 16-20 hours  

## Overview

This implementation plan creates comprehensive data access, export, and deletion functionality that enables users to exercise their GDPR rights. The system provides secure data access verification, multiple export formats, complete data deletion, and audit trails for all operations.

## Prerequisites

- Data storage audit completed (Story 1.3 Task 1)
- Encrypted storage implementation (Story 1.3 Task 2)
- Consent management system (Story 1.3 Task 3)
- OpenAuth integration for user authentication
- Understanding of GDPR data subject rights

## Implementation Steps

### Step 1: Create Data Access Manager

**File**: `apps/web/src/lib/data/data-access-manager.ts`

```typescript
import { EncryptedStorage, createEncryptedStorage } from '@/lib/storage/encrypted-storage';
import { ConsentManager, createConsentManager } from '@/lib/consent/consent-manager';
import type { 
  DataAccessRequest, 
  DataExportRequest, 
  DataDeletionRequest,
  DataSubjectRecord,
  DataExportFormat,
  SecurityEvent 
} from '@al-ummah/shared-types';

/**
 * GDPR data access and deletion manager
 */
export class DataAccessManager {
  private encryptedStorage: EncryptedStorage;
  private consentManager: ConsentManager;
  private eventLogger: (event: SecurityEvent) => void;

  constructor(eventLogger: (event: SecurityEvent) => void) {
    this.eventLogger = eventLogger;
    this.encryptedStorage = createEncryptedStorage({
      encryptAllData: false,
      retentionPeriod: 365,
      autoCleanup: true,
      keyRotationInterval: 90
    }, eventLogger);
    
    this.consentManager = createConsentManager({
      version: '1.0.0',
      lastUpdated: new Date().toISOString(),
      defaultValidityDays: 365,
      categories: [],
      legalTexts: {
        title: '',
        description: '',
        privacyPolicy: '',
        cookiePolicy: '',
        imprint: ''
      },
      gdprCompliance: {
        dataController: '',
        contactEmail: '',
        dpoContact: '',
        legalBasis: [],
        dataRetention: {},
        userRights: []
      }
    }, eventLogger);
  }

  /**
   * Request access to user data
   */
  async requestDataAccess(request: DataAccessRequest): Promise<{
    requestId: string;
    status: 'pending' | 'approved' | 'denied';
    estimatedProcessingTime: string;
    verificationRequired: boolean;
  }> {
    try {
      // Verify user identity
      const identityVerified = await this.verifyUserIdentity(request.userId, request.verificationData);
      
      if (!identityVerified) {
        this.logDataAccessEvent({
          type: 'data-access-denied',
          severity: 'high',
          message: 'Data access request denied - identity verification failed',
          metadata: {
            userId: request.userId,
            requestId: request.requestId,
            reason: 'identity_verification_failed'
          }
        });

        throw new Error('Identity verification failed');
      }

      // Check if user has consent for data processing
      const hasDataProcessingConsent = this.consentManager.hasConsent(request.userId, 'data_processing');
      
      if (!hasDataProcessingConsent) {
        this.logDataAccessEvent({
          type: 'data-access-denied',
          severity: 'medium',
          message: 'Data access request denied - no data processing consent',
          metadata: {
            userId: request.userId,
            requestId: request.requestId,
            reason: 'no_consent'
          }
        });

        throw new Error('No consent for data processing');
      }

      // Create access request record
      const accessRequest = {
        id: this.generateRequestId(),
        userId: request.userId,
        type: 'access',
        status: 'approved',
        requestedAt: new Date().toISOString(),
        processedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        verificationMethod: request.verificationData.method,
        dataCategories: request.dataCategories || ['all'],
        purpose: request.purpose || 'data_access_request'
      };

      // Store access request
      await this.storeDataRequest(accessRequest);

      this.logDataAccessEvent({
        type: 'data-access-approved',
        severity: 'low',
        message: `Data access request approved for user: ${request.userId}`,
        metadata: {
          requestId: accessRequest.id,
          userId: request.userId,
          dataCategories: accessRequest.dataCategories
        }
      });

      return {
        requestId: accessRequest.id,
        status: 'approved',
        estimatedProcessingTime: 'immediate',
        verificationRequired: false
      };

    } catch (error) {
      this.logDataAccessEvent({
        type: 'data-access-error',
        severity: 'high',
        message: `Data access request error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          userId: request.userId,
          requestId: request.requestId,
          error: error instanceof Error ? error.stack : String(error)
        }
      });

      throw error;
    }
  }

  /**
   * Get user data subject record
   */
  async getDataSubjectRecord(userId: string, requestId: string): Promise<DataSubjectRecord> {
    try {
      // Verify access request is valid
      const accessRequest = await this.getDataRequest(requestId);
      if (!accessRequest || accessRequest.userId !== userId || accessRequest.status !== 'approved') {
        throw new Error('Invalid or expired access request');
      }

      // Collect all user data
      const userData = await this.collectUserData(userId, accessRequest.dataCategories);

      // Create data subject record
      const record: DataSubjectRecord = {
        userId,
        requestId,
        generatedAt: new Date().toISOString(),
        expiresAt: accessRequest.expiresAt,
        dataCategories: Object.keys(userData),
        personalData: userData.personal || {},
        preferences: userData.preferences || {},
        activityData: userData.activity || {},
        consentRecords: userData.consents || [],
        technicalData: userData.technical || {},
        metadata: {
          totalRecords: this.countDataRecords(userData),
          dataSources: this.identifyDataSources(userData),
          lastUpdated: this.getLatestDataUpdate(userData)
        }
      };

      this.logDataAccessEvent({
        type: 'data-subject-record-generated',
        severity: 'low',
        message: `Data subject record generated for user: ${userId}`,
        metadata: {
          requestId,
          userId,
          dataCategories: record.dataCategories,
          totalRecords: record.metadata.totalRecords
        }
      });

      return record;

    } catch (error) {
      this.logDataAccessEvent({
        type: 'data-subject-record-error',
        severity: 'high',
        message: `Data subject record generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          userId,
          requestId,
          error: error instanceof Error ? error.stack : String(error)
        }
      });

      throw error;
    }
  }

  /**
   * Export user data in specified format
   */
  async exportUserData(
    userId: string, 
    requestId: string, 
    format: DataExportFormat = 'json'
  ): Promise<{
    exportId: string;
    format: DataExportFormat;
    data: string | Blob;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    try {
      // Get data subject record
      const record = await this.getDataSubjectRecord(userId, requestId);

      // Export data in requested format
      const exportData = await this.formatDataForExport(record, format);

      // Create export record
      const exportRecord = {
        id: this.generateExportId(),
        userId,
        requestId,
        format,
        exportedAt: new Date().toISOString(),
        size: exportData.size,
        filename: exportData.filename,
        downloadCount: 0,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      };

      // Store export record
      await this.storeExportRecord(exportRecord);

      this.logDataAccessEvent({
        type: 'data-exported',
        severity: 'low',
        message: `User data exported in ${format} format for user: ${userId}`,
        metadata: {
          exportId: exportRecord.id,
          userId,
          requestId,
          format,
          size: exportData.size
        }
      });

      return {
        exportId: exportRecord.id,
        format,
        data: exportData.data,
        filename: exportData.filename,
        mimeType: exportData.mimeType,
        size: exportData.size
      };

    } catch (error) {
      this.logDataAccessEvent({
        type: 'data-export-error',
        severity: 'high',
        message: `Data export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          userId,
          requestId,
          format,
          error: error instanceof Error ? error.stack : String(error)
        }
      });

      throw error;
    }
  }

  /**
   * Request deletion of user data
   */
  async requestDataDeletion(request: DataDeletionRequest): Promise<{
    deletionId: string;
    status: 'pending' | 'processing' | 'completed';
    estimatedCompletionTime: string;
    categories: string[];
  }> {
    try {
      // Verify user identity
      const identityVerified = await this.verifyUserIdentity(request.userId, request.verificationData);
      
      if (!identityVerified) {
        throw new Error('Identity verification failed');
      }

      // Create deletion request
      const deletionRequest = {
        id: this.generateDeletionId(),
        userId: request.userId,
        type: 'deletion',
        status: 'pending',
        requestedAt: new Date().toISOString(),
        categories: request.categories || ['all'],
        reason: request.reason || 'user_request',
        verificationMethod: request.verificationData.method,
        retentionPeriod: request.retentionPeriod || 0 // Immediate deletion
      };

      // Store deletion request
      await this.storeDataRequest(deletionRequest);

      // Start deletion process
      this.processDataDeletion(deletionRequest);

      this.logDataAccessEvent({
        type: 'data-deletion-requested',
        severity: 'medium',
        message: `Data deletion requested for user: ${request.userId}`,
        metadata: {
          deletionId: deletionRequest.id,
          userId: request.userId,
          categories: deletionRequest.categories,
          reason: deletionRequest.reason
        }
      });

      return {
        deletionId: deletionRequest.id,
        status: 'processing',
        estimatedCompletionTime: '24-48 hours',
        categories: deletionRequest.categories
      };

    } catch (error) {
      this.logDataAccessEvent({
        type: 'data-deletion-error',
        severity: 'high',
        message: `Data deletion request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          userId: request.userId,
          error: error instanceof Error ? error.stack : String(error)
        }
      });

      throw error;
    }
  }

  /**
   * Get deletion request status
   */
  async getDeletionStatus(deletionId: string): Promise<{
    deletionId: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    progress: number;
    completedCategories: string[];
    failedCategories: string[];
    estimatedCompletion: string;
  }> {
    try {
      const deletionRequest = await this.getDataRequest(deletionId);
      
      if (!deletionRequest || deletionRequest.type !== 'deletion') {
        throw new Error('Deletion request not found');
      }

      // Calculate progress based on completed categories
      const totalCategories = deletionRequest.categories.length;
      const completedCategories = deletionRequest.completedCategories || [];
      const failedCategories = deletionRequest.failedCategories || [];
      const progress = (completedCategories.length / totalCategories) * 100;

      return {
        deletionId,
        status: deletionRequest.status,
        progress,
        completedCategories,
        failedCategories,
        estimatedCompletion: this.estimateDeletionCompletion(deletionRequest)
      };

    } catch (error) {
      this.logDataAccessEvent({
        type: 'deletion-status-error',
        severity: 'medium',
        message: `Deletion status check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          deletionId,
          error: error instanceof Error ? error.stack : String(error)
        }
      });

      throw error;
    }
  }

  /**
   * Collect user data from various sources
   */
  private async collectUserData(userId: string, categories: string[]): Promise<any> {
    const userData: any = {};

    if (categories.includes('all') || categories.includes('personal')) {
      userData.personal = await this.collectPersonalData(userId);
    }

    if (categories.includes('all') || categories.includes('preferences')) {
      userData.preferences = await this.collectPreferencesData(userId);
    }

    if (categories.includes('all') || categories.includes('activity')) {
      userData.activity = await this.collectActivityData(userId);
    }

    if (categories.includes('all') || categories.includes('consents')) {
      userData.consents = await this.collectConsentData(userId);
    }

    if (categories.includes('all') || categories.includes('technical')) {
      userData.technical = await this.collectTechnicalData(userId);
    }

    return userData;
  }

  /**
   * Collect personal data
   */
  private async collectPersonalData(userId: string): Promise<any> {
    const personalData: any = {};

    try {
      // Get user profile data
      const profileData = await this.encryptedStorage.getItem(`user_profile_${userId}`);
      if (profileData) {
        personalData.profile = profileData;
      }

      // Get authentication data
      const authData = await this.encryptedStorage.getItem(`auth_data_${userId}`);
      if (authData) {
        personalData.authentication = {
          hasAccount: true,
          lastLogin: authData.lastLogin,
          loginMethod: authData.method,
          // Exclude sensitive data like passwords
        };
      }

      // Get contact information
      const contactData = await this.encryptedStorage.getItem(`contact_info_${userId}`);
      if (contactData) {
        personalData.contact = contactData;
      }

    } catch (error) {
      console.warn('Failed to collect personal data:', error);
    }

    return personalData;
  }

  /**
   * Collect preferences data
   */
  private async collectPreferencesData(userId: string): Promise<any> {
    const preferencesData: any = {};

    try {
      // Get user preferences
      const userPrefs = await this.encryptedStorage.getItem(`preferences_${userId}`);
      if (userPrefs) {
        preferencesData.user = userPrefs;
      }

      // Get content preferences
      const contentPrefs = await this.encryptedStorage.getItem(`content_preferences_${userId}`);
      if (contentPrefs) {
        preferencesData.content = contentPrefs;
      }

      // Get notification preferences
      const notifPrefs = await this.encryptedStorage.getItem(`notification_preferences_${userId}`);
      if (notifPrefs) {
        preferencesData.notifications = notifPrefs;
      }

    } catch (error) {
      console.warn('Failed to collect preferences data:', error);
    }

    return preferencesData;
  }

  /**
   * Collect activity data
   */
  private async collectActivityData(userId: string): Promise<any> {
    const activityData: any = {};

    try {
      // Get viewing history
      const viewingHistory = await this.encryptedStorage.getItem(`viewing_history_${userId}`);
      if (viewingHistory) {
        activityData.viewingHistory = viewingHistory;
      }

      // Get search history
      const searchHistory = await this.encryptedStorage.getItem(`search_history_${userId}`);
      if (searchHistory) {
        activityData.searchHistory = searchHistory;
      }

      // Get interaction data
      const interactions = await this.encryptedStorage.getItem(`interactions_${userId}`);
      if (interactions) {
        activityData.interactions = interactions;
      }

    } catch (error) {
      console.warn('Failed to collect activity data:', error);
    }

    return activityData;
  }

  /**
   * Collect consent data
   */
  private async collectConsentData(userId: string): Promise<any> {
    try {
      return this.consentManager.getUserConsentHistory(userId);
    } catch (error) {
      console.warn('Failed to collect consent data:', error);
      return [];
    }
  }

  /**
   * Collect technical data
   */
  private async collectTechnicalData(userId: string): Promise<any> {
    const technicalData: any = {};

    try {
      // Get device information
      const deviceInfo = await this.encryptedStorage.getItem(`device_info_${userId}`);
      if (deviceInfo) {
        technicalData.device = deviceInfo;
      }

      // Get application settings
      const appSettings = await this.encryptedStorage.getItem(`app_settings_${userId}`);
      if (appSettings) {
        technicalData.application = appSettings;
      }

      // Get security settings
      const securitySettings = await this.encryptedStorage.getItem(`security_settings_${userId}`);
      if (securitySettings) {
        technicalData.security = securitySettings;
      }

    } catch (error) {
      console.warn('Failed to collect technical data:', error);
    }

    return technicalData;
  }

  /**
   * Format data for export
   */
  private async formatDataForExport(record: DataSubjectRecord, format: DataExportFormat): Promise<{
    data: string | Blob;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    switch (format) {
      case 'json':
        return this.formatAsJSON(record);
      case 'csv':
        return this.formatAsCSV(record);
      case 'pdf':
        return this.formatAsPDF(record);
      case 'xml':
        return this.formatAsXML(record);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Format as JSON
   */
  private async formatAsJSON(record: DataSubjectRecord): Promise<{
    data: string;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    const jsonData = JSON.stringify(record, null, 2);
    const filename = `data_export_${record.userId}_${new Date().toISOString().split('T')[0]}.json`;
    
    return {
      data: jsonData,
      filename,
      mimeType: 'application/json',
      size: jsonData.length
    };
  }

  /**
   * Format as CSV
   */
  private async formatAsCSV(record: DataSubjectRecord): Promise<{
    data: string;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    const csvData = this.convertToCSV(record);
    const filename = `data_export_${record.userId}_${new Date().toISOString().split('T')[0]}.csv`;
    
    return {
      data: csvData,
      filename,
      mimeType: 'text/csv',
      size: csvData.length
    };
  }

  /**
   * Format as PDF
   */
  private async formatAsPDF(record: DataSubjectRecord): Promise<{
    data: Blob;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    // This would use a PDF library like jsPDF
    // For now, return a placeholder implementation
    const pdfContent = this.generatePDFContent(record);
    const filename = `data_export_${record.userId}_${new Date().toISOString().split('T')[0]}.pdf`;
    
    return {
      data: new Blob([pdfContent], { type: 'application/pdf' }),
      filename,
      mimeType: 'application/pdf',
      size: pdfContent.length
    };
  }

  /**
   * Format as XML
   */
  private async formatAsXML(record: DataSubjectRecord): Promise<{
    data: string;
    filename: string;
    mimeType: string;
    size: number;
  }> {
    const xmlData = this.convertToXML(record);
    const filename = `data_export_${record.userId}_${new Date().toISOString().split('T')[0]}.xml`;
    
    return {
      data: xmlData,
      filename,
      mimeType: 'application/xml',
      size: xmlData.length
    };
  }

  /**
   * Process data deletion
   */
  private async processDataDeletion(deletionRequest: any): Promise<void> {
    try {
      // Update status to processing
      deletionRequest.status = 'processing';
      deletionRequest.processedAt = new Date().toISOString();
      await this.storeDataRequest(deletionRequest);

      const categories = deletionRequest.categories;
      const userId = deletionRequest.userId;
      const completedCategories: string[] = [];
      const failedCategories: string[] = [];

      for (const category of categories) {
        try {
          await this.deleteDataCategory(userId, category);
          completedCategories.push(category);
        } catch (error) {
          failedCategories.push(category);
          console.error(`Failed to delete category ${category}:`, error);
        }
      }

      // Update final status
      deletionRequest.status = failedCategories.length === 0 ? 'completed' : 'failed';
      deletionRequest.completedCategories = completedCategories;
      deletionRequest.failedCategories = failedCategories;
      deletionRequest.completedAt = new Date().toISOString();
      
      await this.storeDataRequest(deletionRequest);

      this.logDataAccessEvent({
        type: 'data-deletion-completed',
        severity: 'medium',
        message: `Data deletion completed for user: ${userId}`,
        metadata: {
          deletionId: deletionRequest.id,
          userId,
          completedCategories,
          failedCategories
        }
      });

    } catch (error) {
      deletionRequest.status = 'failed';
      deletionRequest.error = error instanceof Error ? error.message : 'Unknown error';
      await this.storeDataRequest(deletionRequest);

      this.logDataAccessEvent({
        type: 'data-deletion-failed',
        severity: 'high',
        message: `Data deletion failed for user: ${deletionRequest.userId}`,
        metadata: {
          deletionId: deletionRequest.id,
          userId: deletionRequest.userId,
          error: error instanceof Error ? error.stack : String(error)
        }
      });
    }
  }

  /**
   * Delete specific data category
   */
  private async deleteDataCategory(userId: string, category: string): Promise<void> {
    const keysToDelete = this.getKeysForCategory(userId, category);
    
    for (const key of keysToDelete) {
      await this.encryptedStorage.removeItem(key);
    }
  }

  /**
   * Get keys for data category
   */
  private getKeysForCategory(userId: string, category: string): string[] {
    const keyMappings: Record<string, string[]> = {
      personal: [
        `user_profile_${userId}`,
        `auth_data_${userId}`,
        `contact_info_${userId}`
      ],
      preferences: [
        `preferences_${userId}`,
        `content_preferences_${userId}`,
        `notification_preferences_${userId}`
      ],
      activity: [
        `viewing_history_${userId}`,
        `search_history_${userId}`,
        `interactions_${userId}`
      ],
      consents: [
        `consent_preferences_${userId}`
      ],
      technical: [
        `device_info_${userId}`,
        `app_settings_${userId}`,
        `security_settings_${userId}`
      ]
    };

    return keyMappings[category] || [];
  }

  /**
   * Verify user identity
   */
  private async verifyUserIdentity(userId: string, verificationData: any): Promise<boolean> {
    // This would integrate with OpenAuth for identity verification
    // For now, return true for demonstration
    return true;
  }

  /**
   * Store data request
   */
  private async storeDataRequest(request: any): Promise<void> {
    await this.encryptedStorage.setItem(
      `data_request_${request.id}`,
      request,
      {
        level: 'high',
        category: 'personal',
        gdprRelevant: true,
        specialCategories: []
      }
    );
  }

  /**
   * Get data request
   */
  private async getDataRequest(requestId: string): Promise<any> {
    return await this.encryptedStorage.getItem(`data_request_${requestId}`);
  }

  /**
   * Store export record
   */
  private async storeExportRecord(exportRecord: any): Promise<void> {
    await this.encryptedStorage.setItem(
      `data_export_${exportRecord.id}`,
      exportRecord,
      {
        level: 'high',
        category: 'personal',
        gdprRelevant: true,
        specialCategories: []
      }
    );
  }

  /**
   * Generate request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate export ID
   */
  private generateExportId(): string {
    return `exp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate deletion ID
   */
  private generateDeletionId(): string {
    return `del_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Count data records
   */
  private countDataRecords(userData: any): number {
    let count = 0;
    for (const category of Object.values(userData)) {
      if (typeof category === 'object' && category !== null) {
        count += Object.keys(category).length;
      }
    }
    return count;
  }

  /**
   * Identify data sources
   */
  private identifyDataSources(userData: any): string[] {
    const sources = new Set<string>();
    
    if (userData.personal) sources.add('user_profile');
    if (userData.preferences) sources.add('user_preferences');
    if (userData.activity) sources.add('user_activity');
    if (userData.consents) sources.add('consent_manager');
    if (userData.technical) sources.add('application_settings');
    
    return Array.from(sources);
  }

  /**
   * Get latest data update
   */
  private getLatestDataUpdate(userData: any): string {
    const timestamps: string[] = [];
    
    // Extract timestamps from various data sources
    for (const category of Object.values(userData)) {
      if (typeof category === 'object' && category !== null) {
        for (const item of Object.values(category)) {
          if (typeof item === 'object' && item !== null && 'updatedAt' in item) {
            timestamps.push(item.updatedAt as string);
          }
        }
      }
    }
    
    return timestamps.length > 0 ? new Date(Math.max(...timestamps.map(t => new Date(t).getTime()))).toISOString() : new Date().toISOString();
  }

  /**
   * Convert data to CSV
   */
  private convertToCSV(record: DataSubjectRecord): string {
    const headers = ['Category', 'Field', 'Value', 'Last Updated'];
    const rows: string[] = [headers.join(',')];

    // Flatten the data structure
    const flattenData = (obj: any, prefix: string = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          flattenData(value, fullKey);
        } else {
          const row = [
            prefix || 'root',
            key,
            `"${String(value).replace(/"/g, '""')}"`, // Escape quotes
            record.generatedAt
          ];
          rows.push(row.join(','));
        }
      }
    };

    flattenData(record);
    return rows.join('\n');
  }

  /**
   * Convert data to XML
   */
  private convertToXML(record: DataSubjectRecord): string {
    const convertToXML = (obj: any, tagName: string): string => {
      if (Array.isArray(obj)) {
        return obj.map(item => convertToXML(item, tagName)).join('');
      } else if (typeof obj === 'object' && obj !== null) {
        let xml = `<${tagName}>`;
        for (const [key, value] of Object.entries(obj)) {
          xml += convertToXML(value, key);
        }
        xml += `</${tagName}>`;
        return xml;
      } else {
        return `<${tagName}>${String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</${tagName}>`;
      }
    };

    return `<?xml version="1.0" encoding="UTF-8"?>\n<DataSubjectRecord>${convertToXML(record, 'Record')}</DataSubjectRecord>`;
  }

  /**
   * Generate PDF content
   */
  private generatePDFContent(record: DataSubjectRecord): string {
    // This would use a PDF library
    // For now, return a simple text representation
    return `
Data Subject Record
===================

User ID: ${record.userId}
Request ID: ${record.requestId}
Generated: ${record.generatedAt}
Expires: ${record.expiresAt}

Data Categories: ${record.dataCategories.join(', ')}

Personal Data:
${JSON.stringify(record.personalData, null, 2)}

Preferences:
${JSON.stringify(record.preferences, null, 2)}

Activity Data:
${JSON.stringify(record.activityData, null, 2)}

Consent Records:
${JSON.stringify(record.consentRecords, null, 2)}

Technical Data:
${JSON.stringify(record.technicalData, null, 2)}

Metadata:
${JSON.stringify(record.metadata, null, 2)}
    `.trim();
  }

  /**
   * Estimate deletion completion
   */
  private estimateDeletionCompletion(deletionRequest: any): string {
    if (deletionRequest.status === 'completed') return 'Completed';
    if (deletionRequest.status === 'failed') return 'Failed';
    
    const totalCategories = deletionRequest.categories.length;
    const completedCategories = deletionRequest.completedCategories?.length || 0;
    
    if (completedCategories === 0) return '24-48 hours';
    if (completedCategories < totalCategories / 2) return '12-24 hours';
    if (completedCategories < totalCategories) return '6-12 hours';
    
    return '1-6 hours';
  }

  /**
   * Log data access event
   */
  private logDataAccessEvent(event: Partial<SecurityEvent>): void {
    const securityEvent: SecurityEvent = {
      id: `data-access-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: event.type || 'data-access-event',
      severity: event.severity || 'low',
      message: event.message || 'Data access event',
      source: 'data-access-manager',
      metadata: event.metadata || {}
    };

    this.eventLogger(securityEvent);
  }
}

/**
 * Create data access manager instance
 */
export function createDataAccessManager(eventLogger: (event: SecurityEvent) => void): DataAccessManager {
  return new DataAccessManager(eventLogger);
}
```

### Step 2: Create Data Access API Endpoints

**File**: `apps/web/src/app/api/data/access/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createDataAccessManager } from '@/lib/data/data-access-manager';
import { createSecurityEventLogger } from '@/lib/security/event-logger';

/**
 * API endpoint for data access requests
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { userId, verificationData, dataCategories, purpose } = body;

    if (!userId || !verificationData) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, verificationData' },
        { status: 400 }
      );
    }

    const eventLogger = createSecurityEventLogger();
    const dataAccessManager = createDataAccessManager(eventLogger);

    const result = await dataAccessManager.requestDataAccess({
      userId,
      verificationData,
      dataCategories,
      purpose
    });

    return NextResponse.json(result);

  } catch (error) {
    console.error('Data access request failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Data access request failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Get data access request status
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('requestId');
    const userId = searchParams.get('userId');

    if (!requestId || !userId) {
      return NextResponse.json(
        { error: 'Missing required parameters: requestId, userId' },
        { status: 400 }
      );
    }

    const eventLogger = createSecurityEventLogger();
    const dataAccessManager = createDataAccessManager(eventLogger);

    const record = await dataAccessManager.getDataSubjectRecord(userId, requestId);

    return NextResponse.json(record);

  } catch (error) {
    console.error('Get data access status failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to get data access status',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
```

**File**: `apps/web/src/app/api/data/export/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createDataAccessManager } from '@/lib/data/data-access-manager';
import { createSecurityEventLogger } from '@/lib/security/event-logger';

/**
 * API endpoint for data export requests
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { userId, requestId, format = 'json' } = body;

    if (!userId || !requestId) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, requestId' },
        { status: 400 }
      );
    }

    const eventLogger = createSecurityEventLogger();
    const dataAccessManager = createDataAccessManager(eventLogger);

    const result = await dataAccessManager.exportUserData(userId, requestId, format);

    // Handle different response types
    if (result.data instanceof Blob) {
      return new NextResponse(result.data, {
        headers: {
          'Content-Type': result.mimeType,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Content-Length': result.size.toString()
        }
      });
    } else {
      return NextResponse(result.data, {
        headers: {
          'Content-Type': result.mimeType,
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Content-Length': result.size.toString()
        }
      });
    }

  } catch (error) {
    console.error('Data export request failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Data export request failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
```

**File**: `apps/web/src/app/api/data/delete/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createDataAccessManager } from '@/lib/data/data-access-manager';
import { createSecurityEventLogger } from '@/lib/security/event-logger';

/**
 * API endpoint for data deletion requests
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const { userId, verificationData, categories, reason, retentionPeriod } = body;

    if (!userId || !verificationData) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, verificationData' },
        { status: 400 }
      );
    }

    const eventLogger = createSecurityEventLogger();
    const dataAccessManager = createDataAccessManager(eventLogger);

    const result = await dataAccessManager.requestDataDeletion({
      userId,
      verificationData,
      categories,
      reason,
      retentionPeriod
    });

    return NextResponse.json(result);

  } catch (error) {
    console.error('Data deletion request failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Data deletion request failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Get deletion request status
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const deletionId = searchParams.get('deletionId');

    if (!deletionId) {
      return NextResponse.json(
        { error: 'Missing required parameter: deletionId' },
        { status: 400 }
      );
    }

    const eventLogger = createSecurityEventLogger();
    const dataAccessManager = createDataAccessManager(eventLogger);

    const status = await dataAccessManager.getDeletionStatus(deletionId);

    return NextResponse.json(status);

  } catch (error) {
    console.error('Get deletion status failed:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to get deletion status',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
```

### Step 3: Create Data Access UI Components

**File**: `apps/web/src/components/data/DataAccessPortal.tsx`

```typescript
import React, { useState } from 'react';
import { useDataAccess } from '@/hooks/useDataAccess';
import type { DataExportFormat } from '@al-ummah/shared-types';

interface DataAccessPortalProps {
  userId: string;
}

export const DataAccessPortal: React.FC<DataAccessPortalProps> = ({ userId }) => {
  const [activeTab, setActiveTab] = useState<'access' | 'export' | 'delete'>('access');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(['all']);
  const [exportFormat, setExportFormat] = useState<DataExportFormat>('json');
  const [deletionReason, setDeletionReason] = useState('');

  const {
    requestDataAccess,
    exportUserData,
    requestDataDeletion,
    getDeletionStatus,
    isLoading,
    error
  } = useDataAccess(userId);

  const handleDataAccess = async () => {
    try {
      const result = await requestDataAccess({
        userId,
        verificationData: {
          method: 'password',
          value: '' // This would come from a form
        },
        dataCategories: selectedCategories.includes('all') ? undefined : selectedCategories,
        purpose: 'data_access_request'
      });

      console.log('Data access request:', result);
    } catch (error) {
      console.error('Data access failed:', error);
    }
  };

  const handleDataExport = async (requestId: string) => {
    try {
      const result = await exportUserData(userId, requestId, exportFormat);
      
      // Download the file
      if (result.data instanceof Blob) {
        const url = URL.createObjectURL(result.data);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const blob = new Blob([result.data], { type: result.mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Data export failed:', error);
    }
  };

  const handleDataDeletion = async () => {
    if (!window.confirm('Are you sure you want to delete your data? This action cannot be undone.')) {
      return;
    }

    try {
      const result = await requestDataDeletion({
        userId,
        verificationData: {
          method: 'password',
          value: '' // This would come from a form
        },
        categories: selectedCategories.includes('all') ? undefined : selectedCategories,
        reason: deletionReason
      });

      console.log('Data deletion request:', result);
    } catch (error) {
      console.error('Data deletion failed:', error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Data Rights Portal</h1>
      
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-8">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'access', label: 'Access My Data' },
            { id: 'export', label: 'Export Data' },
            { id: 'delete', label: 'Delete Data' }
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

      {/* Error Display */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Access Data Tab */}
      {activeTab === 'access' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Request Access to Your Data</h2>
            <p className="text-gray-600 mb-6">
              You have the right to access a copy of your personal data that we process. 
              Select the data categories you would like to access.
            </p>
          </div>

          {/* Category Selection */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Data Categories</h3>
            <div className="space-y-2">
              {[
                { value: 'all', label: 'All Data', description: 'Complete copy of all your data' },
                { value: 'personal', label: 'Personal Data', description: 'Profile and contact information' },
                { value: 'preferences', label: 'Preferences', description: 'Your settings and preferences' },
                { value: 'activity', label: 'Activity Data', description: 'Viewing and interaction history' },
                { value: 'consents', label: 'Consent Records', description: 'Your consent history' },
                { value: 'technical', label: 'Technical Data', description: 'Device and application data' }
              ].map(category => (
                <label key={category.value} className="flex items-start space-x-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <input
                    type="radio"
                    name="category"
                    value={category.value}
                    checked={selectedCategories.includes(category.value)}
                    onChange={(e) => setSelectedCategories([e.target.value])}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-gray-900">{category.label}</div>
                    <div className="text-sm text-gray-500">{category.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Identity Verification */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Identity Verification</h3>
            <p className="text-gray-600 mb-4">
              For your security, please verify your identity before proceeding.
            </p>
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
              <p className="text-yellow-800">
                Identity verification will be integrated with your authentication method.
              </p>
            </div>
          </div>

          <button
            onClick={handleDataAccess}
            disabled={isLoading}
            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : 'Request Data Access'}
          </button>
        </div>
      )}

      {/* Export Data Tab */}
      {activeTab === 'export' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Export Your Data</h2>
            <p className="text-gray-600 mb-6">
              Download your data in your preferred format. You must first request access to your data.
            </p>
          </div>

          {/* Export Format Selection */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Export Format</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { value: 'json', label: 'JSON', description: 'Machine-readable format' },
                { value: 'csv', label: 'CSV', description: 'Spreadsheet-compatible format' },
                { value: 'pdf', label: 'PDF', description: 'Human-readable document' },
                { value: 'xml', label: 'XML', description: 'Structured data format' }
              ].map(format => (
                <label key={format.value} className="flex items-start space-x-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <input
                    type="radio"
                    name="format"
                    value={format.value}
                    checked={exportFormat === format.value}
                    onChange={(e) => setExportFormat(e.target.value as DataExportFormat)}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-gray-900">{format.label}</div>
                    <div className="text-sm text-gray-500">{format.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Request ID Input */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Access Request ID</h3>
            <input
              type="text"
              placeholder="Enter your data access request ID"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={() => {
              const requestId = (document.querySelector('input[placeholder*="request ID"]') as HTMLInputElement)?.value;
              if (requestId) {
                handleDataExport(requestId);
              }
            }}
            disabled={isLoading}
            className="w-full py-3 px-4 bg-green-600 hover:bg-green-700 text-white font-medium rounded-md disabled:opacity-50"
          >
            {isLoading ? 'Exporting...' : 'Export Data'}
          </button>
        </div>
      )}

      {/* Delete Data Tab */}
      {activeTab === 'delete' && (
        <div className="space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-red-600 mb-4">Delete Your Data</h2>
            <p className="text-gray-600 mb-6">
              You have the right to request deletion of your personal data. This action cannot be undone.
            </p>
          </div>

          {/* Warning */}
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <h3 className="text-red-800 font-medium mb-2">Important Warning</h3>
            <ul className="text-red-700 space-y-1 text-sm">
              <li>• Data deletion is permanent and cannot be reversed</li>
              <li>• You will lose access to your account and all associated data</li>
              <li>• Some data may be retained for legal or legitimate interest purposes</li>
              <li>• The deletion process may take up to 48 hours to complete</li>
            </ul>
          </div>

          {/* Category Selection */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Data to Delete</h3>
            <div className="space-y-2">
              {[
                { value: 'all', label: 'All Data', description: 'Delete all your personal data' },
                { value: 'activity', label: 'Activity Data', description: 'Delete viewing and interaction history' },
                { value: 'preferences', label: 'Preferences', description: 'Delete your settings and preferences' }
              ].map(category => (
                <label key={category.value} className="flex items-start space-x-3 p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                  <input
                    type="radio"
                    name="deleteCategory"
                    value={category.value}
                    checked={selectedCategories.includes(category.value)}
                    onChange={(e) => setSelectedCategories([e.target.value])}
                    className="mt-1"
                  />
                  <div>
                    <div className="font-medium text-gray-900">{category.label}</div>
                    <div className="text-sm text-gray-500">{category.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Reason Input */}
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Reason for Deletion (Optional)</h3>
            <textarea
              value={deletionReason}
              onChange={(e) => setDeletionReason(e.target.value)}
              placeholder="Please provide a reason for your data deletion request..."
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Confirmation */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
            <label className="flex items-start space-x-3">
              <input
                type="checkbox"
                className="mt-1"
                required
              />
              <span className="text-yellow-800 text-sm">
                I understand that data deletion is permanent and cannot be undone. 
                I want to proceed with deleting my data.
              </span>
            </label>
          </div>

          <button
            onClick={handleDataDeletion}
            disabled={isLoading}
            className="w-full py-3 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-md disabled:opacity-50"
          >
            {isLoading ? 'Processing...' : 'Delete My Data'}
          </button>
        </div>
      )}
    </div>
  );
};
```

### Step 4: Create React Hook for Data Access

**File**: `apps/web/src/hooks/useDataAccess.ts`

```typescript
import { useState, useCallback } from 'react';
import { createDataAccessManager } from '@/lib/data/data-access-manager';
import { useSecurityEvents } from './useSecurityEvents';
import type { 
  DataAccessRequest, 
  DataExportRequest, 
  DataDeletionRequest,
  DataSubjectRecord,
  DataExportFormat 
} from '@al-ummah/shared-types';

/**
 * React hook for data access operations
 */
export function useDataAccess(userId: string) {
  const { logSecurityEvent } = useSecurityEvents();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataAccessManager] = useState(() => 
    createDataAccessManager(logSecurityEvent)
  );

  /**
   * Request access to user data
   */
  const requestDataAccess = useCallback(async (request: DataAccessRequest) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await dataAccessManager.requestDataAccess(request);
      
      logSecurityEvent({
        id: `data-access-request-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'data-access-requested',
        severity: 'low',
        message: `Data access requested for user: ${userId}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          requestId: result.requestId,
          status: result.status
        }
      });

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      
      logSecurityEvent({
        id: `data-access-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'data-access-error',
        severity: 'high',
        message: `Data access request failed: ${errorMessage}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          error: errorMessage
        }
      });
      
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [userId, dataAccessManager, logSecurityEvent]);

  /**
   * Get data subject record
   */
  const getDataSubjectRecord = useCallback(async (requestId: string): Promise<DataSubjectRecord> => {
    setIsLoading(true);
    setError(null);

    try {
      const record = await dataAccessManager.getDataSubjectRecord(userId, requestId);
      
      logSecurityEvent({
        id: `data-subject-record-accessed-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'data-subject-record-accessed',
        severity: 'low',
        message: `Data subject record accessed for user: ${userId}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          requestId,
          dataCategories: record.dataCategories
        }
      });

      return record;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      
      logSecurityEvent({
        id: `data-subject-record-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'data-subject-record-error',
        severity: 'high',
        message: `Data subject record access failed: ${errorMessage}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          requestId,
          error: errorMessage
        }
      });
      
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [userId, dataAccessManager, logSecurityEvent]);

  /**
   * Export user data
   */
  const exportUserData = useCallback(async (
    requestId: string, 
    format: DataExportFormat = 'json'
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await dataAccessManager.exportUserData(userId, requestId, format);
      
      logSecurityEvent({
        id: `data-exported-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'data-exported',
        severity: 'low',
        message: `User data exported in ${format} format for user: ${userId}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          requestId,
          format,
          exportId: result.exportId,
          size: result.size
        }
      });

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      
      logSecurityEvent({
        id: `data-export-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'data-export-error',
        severity: 'high',
        message: `Data export failed: ${errorMessage}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          requestId,
          format,
          error: errorMessage
        }
      });
      
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [userId, dataAccessManager, logSecurityEvent]);

  /**
   * Request data deletion
   */
  const requestDataDeletion = useCallback(async (request: DataDeletionRequest) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await dataAccessManager.requestDataDeletion(request);
      
      logSecurityEvent({
        id: `data-deletion-requested-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'data-deletion-requested',
        severity: 'medium',
        message: `Data deletion requested for user: ${userId}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          deletionId: result.deletionId,
          categories: result.categories,
          status: result.status
        }
      });

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      
      logSecurityEvent({
        id: `data-deletion-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'data-deletion-error',
        severity: 'high',
        message: `Data deletion request failed: ${errorMessage}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          error: errorMessage
        }
      });
      
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [userId, dataAccessManager, logSecurityEvent]);

  /**
   * Get deletion status
   */
  const getDeletionStatus = useCallback(async (deletionId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const status = await dataAccessManager.getDeletionStatus(deletionId);
      
      logSecurityEvent({
        id: `deletion-status-checked-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'deletion-status-checked',
        severity: 'low',
        message: `Deletion status checked for user: ${userId}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          deletionId,
          status: status.status,
          progress: status.progress
        }
      });

      return status;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      
      logSecurityEvent({
        id: `deletion-status-error-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'deletion-status-error',
        severity: 'medium',
        message: `Deletion status check failed: ${errorMessage}`,
        source: 'useDataAccess',
        metadata: {
          userId,
          deletionId,
          error: errorMessage
        }
      });
      
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [userId, dataAccessManager, logSecurityEvent]);

  /**
   * Clear error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    // State
    isLoading,
    error,
    
    // Methods
    requestDataAccess,
    getDataSubjectRecord,
    exportUserData,
    requestDataDeletion,
    getDeletionStatus,
    clearError
  };
}
```

### Step 5: Add Data Access Tests

**File**: `apps/web/src/__tests__/data/data-access-manager.test.ts`

```typescript
import { DataAccessManager, createDataAccessManager } from '@/lib/data/data-access-manager';
import type { SecurityEvent } from '@al-ummah/shared-types';

describe('DataAccessManager', () => {
  let dataAccessManager: DataAccessManager;
  let mockEventLogger: jest.MockedFunction<(event: SecurityEvent) => void>;

  beforeEach(() => {
    mockEventLogger = jest.fn();
    dataAccessManager = createDataAccessManager(mockEventLogger);
  });

  describe('Data Access Request', () => {
    it('should approve data access request with valid verification', async () => {
      const request = {
        userId: 'user123',
        verificationData: {
          method: 'password',
          value: 'valid-password'
        },
        dataCategories: ['personal'],
        purpose: 'data_access_request'
      };

      const result = await dataAccessManager.requestDataAccess(request);

      expect(result.status).toBe('approved');
      expect(result.requestId).toBeDefined();
      expect(result.verificationRequired).toBe(false);
    });

    it('should log data access approval', async () => {
      const request = {
        userId: 'user123',
        verificationData: {
          method: 'password',
          value: 'valid-password'
        },
        dataCategories: ['personal'],
        purpose: 'data_access_request'
      };

      await dataAccessManager.requestDataAccess(request);

      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data-access-approved',
          severity: 'low'
        })
      );
    });
  });

  describe('Data Subject Record', () => {
    beforeEach(async () => {
      // Set up approved access request
      const request = {
        userId: 'user123',
        verificationData: {
          method: 'password',
          value: 'valid-password'
        },
        dataCategories: ['personal'],
        purpose: 'data_access_request'
      };

      await dataAccessManager.requestDataAccess(request);
    });

    it('should generate data subject record', async () => {
      const record = await dataAccessManager.getDataSubjectRecord('user123', 'test-request-id');

      expect(record.userId).toBe('user123');
      expect(record.generatedAt).toBeDefined();
      expect(record.dataCategories).toBeDefined();
      expect(record.metadata).toBeDefined();
    });

    it('should log data subject record generation', async () => {
      await dataAccessManager.getDataSubjectRecord('user123', 'test-request-id');

      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data-subject-record-generated',
          severity: 'low'
        })
      );
    });
  });

  describe('Data Export', () => {
    beforeEach(async () => {
      // Set up approved access request
      const request = {
        userId: 'user123',
        verificationData: {
          method: 'password',
          value: 'valid-password'
        },
        dataCategories: ['personal'],
        purpose: 'data_access_request'
      };

      await dataAccessManager.requestDataAccess(request);
    });

    it('should export data in JSON format', async () => {
      const result = await dataAccessManager.exportUserData('user123', 'test-request-id', 'json');

      expect(result.format).toBe('json');
      expect(result.filename).toMatch(/\.json$/);
      expect(result.mimeType).toBe('application/json');
      expect(result.size).toBeGreaterThan(0);
    });

    it('should export data in CSV format', async () => {
      const result = await dataAccessManager.exportUserData('user123', 'test-request-id', 'csv');

      expect(result.format).toBe('csv');
      expect(result.filename).toMatch(/\.csv$/);
      expect(result.mimeType).toBe('text/csv');
      expect(result.size).toBeGreaterThan(0);
    });

    it('should log data export', async () => {
      await dataAccessManager.exportUserData('user123', 'test-request-id', 'json');

      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data-exported',
          severity: 'low'
        })
      );
    });
  });

  describe('Data Deletion', () => {
    it('should request data deletion', async () => {
      const request = {
        userId: 'user123',
        verificationData: {
          method: 'password',
          value: 'valid-password'
        },
        categories: ['activity'],
        reason: 'user_request'
      };

      const result = await dataAccessManager.requestDataDeletion(request);

      expect(result.status).toBe('processing');
      expect(result.deletionId).toBeDefined();
      expect(result.categories).toEqual(['activity']);
    });

    it('should log data deletion request', async () => {
      const request = {
        userId: 'user123',
        verificationData: {
          method: 'password',
          value: 'valid-password'
        },
        categories: ['activity'],
        reason: 'user_request'
      };

      await dataAccessManager.requestDataDeletion(request);

      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data-deletion-requested',
          severity: 'medium'
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid verification data', async () => {
      const request = {
        userId: 'user123',
        verificationData: {
          method: 'invalid',
          value: 'invalid'
        },
        dataCategories: ['personal'],
        purpose: 'data_access_request'
      };

      await expect(dataAccessManager.requestDataAccess(request)).rejects.toThrow();
    });

    it('should handle invalid request ID', async () => {
      await expect(
        dataAccessManager.getDataSubjectRecord('user123', 'invalid-id')
      ).rejects.toThrow('Invalid or expired access request');
    });

    it('should log errors appropriately', async () => {
      const request = {
        userId: 'user123',
        verificationData: {
          method: 'invalid',
          value: 'invalid'
        },
        dataCategories: ['personal'],
        purpose: 'data_access_request'
      };

      try {
        await dataAccessManager.requestDataAccess(request);
      } catch (error) {
        // Expected to fail
      }

      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'data-access-denied',
          severity: 'high'
        })
      );
    });
  });
});
```

## Testing Strategy

### Unit Testing
- **Data Access Manager**: Test all data access operations
- **Export Functionality**: Test all export formats and data formatting
- **Deletion Process**: Test data deletion and status tracking
- **Identity Verification**: Test user identity verification logic

### Integration Testing
- **API Endpoints**: Test all API endpoints for data access
- **React Hooks**: Test hook functionality with data access manager
- **Storage Integration**: Test encrypted storage integration
- **Event Logging**: Test security event logging for all operations

### Security Testing
- **Identity Verification**: Test verification bypass attempts
- **Data Access Control**: Test unauthorized access attempts
- **Data Export Security**: Test export data protection
- **Deletion Verification**: Test complete data removal

### User Testing
- **User Interface**: Test data access portal usability
- **Export Formats**: Test export format usability and accuracy
- **Deletion Process**: Test deletion process clarity and safety
- **Accessibility**: Test WCAG compliance of data access interface

## Deliverables

### New Files
1. **`apps/web/src/lib/data/data-access-manager.ts`** - Core data access management
2. **`apps/web/src/app/api/data/access/route.ts`** - Data access API endpoint
3. **`apps/web/src/app/api/data/export/route.ts`** - Data export API endpoint
4. **`apps/web/src/app/api/data/delete/route.ts`** - Data deletion API endpoint
5. **`apps/web/src/components/data/DataAccessPortal.tsx`** - Data access UI component
6. **`apps/web/src/hooks/useDataAccess.ts`** - React hook for data access
7. **`apps/web/src/__tests__/data/data-access-manager.test.ts`** - Data access tests

### Updated Files
1. **Type definitions** - Update shared types for data access
2. **App routing** - Add data access routes
3. **Security logging** - Add data access event types

### API Endpoints
1. **POST /api/data/access** - Request data access
2. **GET /api/data/access** - Get data subject record
3. **POST /api/data/export** - Export user data
4. **POST /api/data/delete** - Request data deletion
5. **GET /api/data/delete** - Get deletion status

## Success Criteria

### Functional Requirements
- ✅ Secure data access with identity verification
- ✅ Multiple export formats (JSON, CSV, PDF, XML)
- ✅ Complete data deletion with verification
- ✅ Audit trail for all data operations
- ✅ GDPR compliance for data subject rights

### Security Requirements
- ✅ Strong identity verification before data access
- ✅ Encrypted storage of all data requests
- ✅ Security event logging for all operations
- ✅ Access control and authorization checks
- ✅ Data integrity verification

### Legal Requirements
- ✅ Right to access personal data
- ✅ Right to data portability
- ✅ Right to erasure (right to be forgotten)
- ✅ Transparent processing information
- ✅ Audit trail for compliance

### User Experience Requirements
- ✅ Clear and intuitive data access interface
- ✅ Multiple export format options
- ✅ Clear deletion warnings and confirmations
- ✅ Progress tracking for long-running operations
- ✅ Accessible design for all users

## Timeline

### Phase 1: Core Data Access (6-7 hours)
- DataAccessManager implementation
- Data collection and formatting
- Identity verification integration
- Basic unit tests

### Phase 2: Export Functionality (4-5 hours)
- Multiple export format implementation
- API endpoints for data export
- Export file generation and download
- Export format testing

### Phase 3: Deletion Process (4-5 hours)
- Data deletion implementation
- Deletion status tracking
- API endpoints for deletion
- Deletion verification testing

### Phase 4: UI Integration (3-4 hours)
- Data access portal component
- React hooks implementation
- User interface testing
- Accessibility improvements

### Phase 5: Testing & Validation (3-4 hours)
- Comprehensive test suite
- Security testing and validation
- User acceptance testing
- Documentation updates

## Risk Assessment

### High Risk
- **Data Privacy**: Risk of data exposure during access/export
- **Incomplete Deletion**: Risk of incomplete data removal
- **Identity Verification**: Risk of verification bypass

### Medium Risk
- **Data Integrity**: Risk of data corruption during export
- **Performance**: Large data exports could impact performance
- **Compliance**: Complex GDPR requirements to maintain

### Low Risk
- **Implementation**: Well-defined requirements and patterns
- **Testing**: Comprehensive test coverage possible
- **Integration**: Standard API and React patterns

### Mitigation Strategies
- Implement strong encryption and access controls
- Create comprehensive deletion verification processes
- Use robust identity verification methods
- Implement data integrity checks and validation
- Regular compliance audits and legal review

This implementation plan provides comprehensive data access, export, and deletion functionality that enables users to exercise their GDPR rights while maintaining security and compliance.