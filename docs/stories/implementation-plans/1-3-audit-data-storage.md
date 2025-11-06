# Implementation Plan: Audit Existing Data Storage Practices

**Story**: 1.3 Implement GDPR-Compliant Data Storage  
**Task Group**: 1-3-audit-data-storage  
**Priority**: High  
**Estimated Time**: 8-12 hours  

## Overview

This implementation plan focuses on conducting a comprehensive audit of all data storage practices within the video player and web application. The audit will identify all localStorage usage, document data types, classify sensitivity levels, and assess current encryption implementation to establish a baseline for GDPR compliance improvements.

## Prerequisites

- Access to the complete codebase
- Understanding of GDPR data classification requirements
- Knowledge of web storage mechanisms (localStorage, sessionStorage, IndexedDB, cookies)
- Familiarity with the application's data flow and user interactions

## Implementation Steps

### Step 1: Create Data Storage Audit Framework

**File**: `apps/web/src/lib/audit/data-storage-auditor.ts`

```typescript
import type { 
  DataStorageAudit, 
  StorageLocation, 
  DataClassification, 
  SecurityAssessment 
} from '@al-ummah/shared-types';

/**
 * Comprehensive data storage audit framework
 */
export class DataStorageAuditor {
  private auditResults: DataStorageAudit;
  private scannedFiles: Set<string> = new Set();

  constructor() {
    this.auditResults = {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      summary: {
        totalStorageLocations: 0,
        encryptedLocations: 0,
        sensitiveDataLocations: 0,
        complianceScore: 0
      },
      storageLocations: [],
      dataFlows: [],
      securityAssessments: [],
      recommendations: [],
      gdprGaps: []
    };
  }

  /**
   * Perform comprehensive data storage audit
   */
  async performAudit(): Promise<DataStorageAudit> {
    console.log('🔍 Starting data storage audit...');

    // Scan codebase for storage usage
    await this.scanCodebase();

    // Analyze storage patterns
    this.analyzeStoragePatterns();

    // Assess security implementation
    this.assessSecurityImplementation();

    // Identify GDPR gaps
    this.identifyGDPRGaps();

    // Generate recommendations
    this.generateRecommendations();

    console.log('✅ Data storage audit completed');
    return this.auditResults;
  }

  /**
   * Scan codebase for storage usage patterns
   */
  private async scanCodebase(): Promise<void> {
    const storagePatterns = [
      // localStorage patterns
      /localStorage\.(get|set|remove)Item\(/g,
      /localStorage\[.*?\]/g,
      // sessionStorage patterns
      /sessionStorage\.(get|set|remove)Item\(/g,
      /sessionStorage\[.*?\]/g,
      // IndexedDB patterns
      /indexedDB\.(open|deleteDatabase)/g,
      /IDB(Factory|Database|Transaction)/g,
      // Cookie patterns
      /document\.cookie\s*=/g,
      /Cookies\.(get|set|remove)/g,
      // Storage utility patterns
      /storage\.(get|set|remove)/g,
      /useStorage/g,
      /useLocalStorage/g,
      /useSessionStorage/g
    ];

    // Scan key directories
    const directories = [
      'src/components',
      'src/lib',
      'src/hooks',
      'src/app',
      'src/utils'
    ];

    for (const directory of directories) {
      await this.scanDirectory(directory, storagePatterns);
    }
  }

  /**
   * Scan directory for storage usage
   */
  private async scanDirectory(directory: string, patterns: RegExp[]): Promise<void> {
    try {
      const files = await this.getFilesInDirectory(directory);
      
      for (const file of files) {
        if (this.shouldScanFile(file)) {
          await this.scanFile(file, patterns);
        }
      }
    } catch (error) {
      console.warn(`⚠️ Could not scan directory ${directory}:`, error);
    }
  }

  /**
   * Get all files in directory recursively
   */
  private async getFilesInDirectory(directory: string): Promise<string[]> {
    // This would be implemented based on the build system
    // For now, return common file patterns
    return [
      `${directory}/**/*.ts`,
      `${directory}/**/*.tsx`,
      `${directory}/**/*.js`,
      `${directory}/**/*.jsx`
    ];
  }

  /**
   * Check if file should be scanned
   */
  private shouldScanFile(filePath: string): boolean {
    const excludePatterns = [
      /\.test\./,
      /\.spec\./,
      /node_modules/,
      /\.next/,
      /dist/,
      /build/
    ];

    return !excludePatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Scan individual file for storage patterns
   */
  private async scanFile(filePath: string, patterns: RegExp[]): Promise<void> {
    try {
      const content = await this.readFileContent(filePath);
      
      for (const pattern of patterns) {
        const matches = content.match(pattern);
        if (matches) {
          this.recordStorageUsage(filePath, pattern, matches);
        }
      }

      this.scannedFiles.add(filePath);
    } catch (error) {
      console.warn(`⚠️ Could not scan file ${filePath}:`, error);
    }
  }

  /**
   * Read file content (implementation depends on environment)
   */
  private async readFileContent(filePath: string): Promise<string> {
    // This would be implemented based on the environment
    // For development, could use fs; for browser, could use fetch
    return '';
  }

  /**
   * Record storage usage found in file
   */
  private recordStorageUsage(filePath: string, pattern: RegExp, matches: string[]): void {
    const storageType = this.determineStorageType(pattern);
    
    const location: StorageLocation = {
      id: `storage-${this.auditResults.storageLocations.length + 1}`,
      filePath,
      storageType,
      pattern: pattern.source,
      occurrences: matches.length,
      codeSamples: matches.slice(0, 3), // Limit to first 3 examples
      dataTypes: this.extractDataTypes(matches),
      classification: this.classifyDataSensitivity(matches),
      encryption: this.assessEncryptionUsage(matches),
      retention: this.assessRetentionPolicy(matches),
      lastModified: new Date().toISOString()
    };

    this.auditResults.storageLocations.push(location);
  }

  /**
   * Determine storage type from pattern
   */
  private determineStorageType(pattern: RegExp): 'localStorage' | 'sessionStorage' | 'indexedDB' | 'cookies' | 'custom' {
    const patternStr = pattern.source.toLowerCase();
    
    if (patternStr.includes('localstorage')) return 'localStorage';
    if (patternStr.includes('sessionstorage')) return 'sessionStorage';
    if (patternStr.includes('indexeddb') || patternStr.includes('idb')) return 'indexedDB';
    if (patternStr.includes('cookie')) return 'cookies';
    
    return 'custom';
  }

  /**
   * Extract data types from code samples
   */
  private extractDataTypes(matches: string[]): string[] {
    const dataTypes: Set<string> = new Set();
    
    for (const match of matches) {
      // Look for common data patterns
      if (match.includes('token') || match.includes('auth')) dataTypes.add('authentication');
      if (match.includes('user') || match.includes('profile')) dataTypes.add('userProfile');
      if (match.includes('preference') || match.includes('setting')) dataTypes.add('preferences');
      if (match.includes('video') || match.includes('watch')) dataTypes.add('viewingHistory');
      if (match.includes('analytics') || match.includes('tracking')) dataTypes.add('analytics');
      if (match.includes('consent') || match.includes('cookie')) dataTypes.add('consent');
    }
    
    return Array.from(dataTypes);
  }

  /**
   * Classify data sensitivity
   */
  private classifyDataSensitivity(matches: string[]): DataClassification {
    const sensitiveKeywords = [
      'token', 'password', 'email', 'phone', 'address',
      'personal', 'private', 'secret', 'key', 'auth'
    ];

    const hasSensitiveData = matches.some(match => 
      sensitiveKeywords.some(keyword => match.toLowerCase().includes(keyword))
    );

    if (hasSensitiveData) {
      return {
        level: 'high',
        category: 'personal',
        gdprRelevant: true,
        specialCategories: this.identifySpecialCategories(matches)
      };
    }

    const personalKeywords = ['user', 'profile', 'preference', 'history'];
    const hasPersonalData = matches.some(match => 
      personalKeywords.some(keyword => match.toLowerCase().includes(keyword))
    );

    if (hasPersonalData) {
      return {
        level: 'medium',
        category: 'personal',
        gdprRelevant: true,
        specialCategories: []
      };
    }

    return {
      level: 'low',
      category: 'technical',
      gdprRelevant: false,
      specialCategories: []
    };
  }

  /**
   * Identify GDPR special categories
   */
  private identifySpecialCategories(matches: string[]): string[] {
    const specialCategories = [
      'health', 'biometric', 'genetic', 'racial', 'ethnic',
      'political', 'religious', 'philosophical', 'union', 'sexual'
    ];

    const found: string[] = [];
    for (const category of specialCategories) {
      if (matches.some(match => match.toLowerCase().includes(category))) {
        found.push(category);
      }
    }

    return found;
  }

  /**
   * Assess encryption usage
   */
  private assessEncryptionUsage(matches: string[]): boolean {
    const encryptionKeywords = [
      'encrypt', 'decrypt', 'cipher', 'crypto', 'aes', 'hash',
      'secure', 'protected', 'encoded', 'obfuscated'
    ];

    return matches.some(match => 
      encryptionKeywords.some(keyword => match.toLowerCase().includes(keyword))
    );
  }

  /**
   * Assess retention policy
   */
  private assessRetentionPolicy(matches: string[]): string | null {
    const retentionKeywords = [
      'expire', 'ttl', 'retention', 'cleanup', 'delete', 'remove',
      'max-age', 'expires', 'clear', 'purge'
    ];

    const hasRetention = matches.some(match => 
      retentionKeywords.some(keyword => match.toLowerCase().includes(keyword))
    );

    return hasRetention ? 'defined' : 'undefined';
  }

  /**
   * Analyze storage patterns and data flows
   */
  private analyzeStoragePatterns(): void {
    // Group storage locations by type
    const storageByType = this.groupStorageByType();
    
    // Identify data flows between storage locations
    this.identifyDataFlows(storageByType);
    
    // Analyze usage patterns
    this.analyzeUsagePatterns();
  }

  /**
   * Group storage locations by type
   */
  private groupStorageByType(): Record<string, StorageLocation[]> {
    const grouped: Record<string, StorageLocation[]> = {};
    
    for (const location of this.auditResults.storageLocations) {
      if (!grouped[location.storageType]) {
        grouped[location.storageType] = [];
      }
      grouped[location.storageType].push(location);
    }
    
    return grouped;
  }

  /**
   * Identify data flows between storage locations
   */
  private identifyDataFlows(storageByType: Record<string, StorageLocation[]>): void {
    // This would analyze how data moves between different storage types
    // For now, create basic flow entries
    for (const [storageType, locations] of Object.entries(storageByType)) {
      for (const location of locations) {
        this.auditResults.dataFlows.push({
          id: `flow-${this.auditResults.dataFlows.length + 1}`,
          source: storageType,
          destination: 'application',
          dataType: location.dataTypes.join(', '),
          frequency: 'unknown',
          purpose: this.inferPurpose(location),
          gdprBasis: this.inferGDPRBasis(location)
        });
      }
    }
  }

  /**
   * Infer purpose of data storage
   */
  private inferPurpose(location: StorageLocation): string {
    const dataTypes = location.dataTypes;
    
    if (dataTypes.includes('authentication')) return 'User authentication';
    if (dataTypes.includes('preferences')) return 'User preferences';
    if (dataTypes.includes('viewingHistory')) return 'Video viewing experience';
    if (dataTypes.includes('analytics')) return 'Analytics and improvement';
    if (dataTypes.includes('consent')) return 'Consent management';
    
    return 'Application functionality';
  }

  /**
   * Infer GDPR legal basis
   */
  private inferGDPRBasis(location: StorageLocation): string {
    const dataTypes = location.dataTypes;
    
    if (dataTypes.includes('authentication')) return 'Contractual necessity';
    if (dataTypes.includes('consent')) return 'Explicit consent';
    if (dataTypes.includes('analytics')) return 'Legitimate interest';
    if (dataTypes.includes('preferences')) return 'Consent';
    
    return 'Legitimate interest';
  }

  /**
   * Analyze usage patterns
   */
  private analyzeUsagePatterns(): void {
    // This would analyze frequency, timing, and patterns of storage usage
    // Implementation would depend on actual usage data
  }

  /**
   * Assess security implementation
   */
  private assessSecurityImplementation(): void {
    for (const location of this.auditResults.storageLocations) {
      const assessment: SecurityAssessment = {
        storageLocationId: location.id,
        encryptionLevel: location.encryption ? 'implemented' : 'none',
        accessControls: this.assessAccessControls(location),
        dataIntegrity: this.assessDataIntegrity(location),
        auditTrail: this.assessAuditTrail(location),
        vulnerabilityScore: this.calculateVulnerabilityScore(location),
        recommendations: this.generateSecurityRecommendations(location)
      };

      this.auditResults.securityAssessments.push(assessment);
    }
  }

  /**
   * Assess access controls
   */
  private assessAccessControls(location: StorageLocation): 'none' | 'basic' | 'comprehensive' {
    // Check for access control patterns in the code
    const accessControlPatterns = [
      'permission', 'authorization', 'access', 'role', 'scope'
    ];

    const hasAccessControls = location.codeSamples.some(sample =>
      accessControlPatterns.some(pattern => sample.toLowerCase().includes(pattern))
    );

    return hasAccessControls ? 'basic' : 'none';
  }

  /**
   * Assess data integrity measures
   */
  private assessDataIntegrity(location: StorageLocation): 'none' | 'basic' | 'comprehensive' {
    const integrityPatterns = [
      'checksum', 'hash', 'validate', 'verify', 'integrity'
    ];

    const hasIntegrityChecks = location.codeSamples.some(sample =>
      integrityPatterns.some(pattern => sample.toLowerCase().includes(pattern))
    );

    return hasIntegrityChecks ? 'basic' : 'none';
  }

  /**
   * Assess audit trail implementation
   */
  private assessAuditTrail(location: StorageLocation): 'none' | 'basic' | 'comprehensive' {
    const auditPatterns = [
      'log', 'audit', 'track', 'monitor', 'record'
    ];

    const hasAuditTrail = location.codeSamples.some(sample =>
      auditPatterns.some(pattern => sample.toLowerCase().includes(pattern))
    );

    return hasAuditTrail ? 'basic' : 'none';
  }

  /**
   * Calculate vulnerability score
   */
  private calculateVulnerabilityScore(location: StorageLocation): number {
    let score = 0;
    
    // Base score on data classification
    if (location.classification.level === 'high') score += 40;
    if (location.classification.level === 'medium') score += 20;
    
    // Add/subtract based on security measures
    if (!location.encryption) score += 30;
    if (location.retention === 'undefined') score += 20;
    
    // Cap at 100
    return Math.min(score, 100);
  }

  /**
   * Generate security recommendations
   */
  private generateSecurityRecommendations(location: StorageLocation): string[] {
    const recommendations: string[] = [];
    
    if (!location.encryption) {
      recommendations.push('Implement encryption for sensitive data');
    }
    
    if (location.classification.level === 'high' && !location.encryption) {
      recommendations.push('Immediate encryption required for high-sensitivity data');
    }
    
    if (location.retention === 'undefined') {
      recommendations.push('Define and implement data retention policies');
    }
    
    if (location.classification.gdprRelevant && !location.encryption) {
      recommendations.push('Implement GDPR-compliant data protection');
    }
    
    return recommendations;
  }

  /**
   * Identify GDPR compliance gaps
   */
  private identifyGDPRGaps(): void {
    const gaps: string[] = [];
    
    // Check for encryption gaps
    const unencryptedGDPRData = this.auditResults.storageLocations.filter(
      loc => loc.classification.gdprRelevant && !loc.encryption
    );
    
    if (unencryptedGDPRData.length > 0) {
      gaps.push(`${unencryptedGDPRData.length} locations store GDPR-relevant data without encryption`);
    }
    
    // Check for retention policy gaps
    const undefinedRetention = this.auditResults.storageLocations.filter(
      loc => loc.classification.gdprRelevant && loc.retention === 'undefined'
    );
    
    if (undefinedRetention.length > 0) {
      gaps.push(`${undefinedRetention.length} locations lack defined retention policies`);
    }
    
    // Check for consent management gaps
    const consentData = this.auditResults.storageLocations.filter(
      loc => loc.dataTypes.includes('consent')
    );
    
    if (consentData.length === 0) {
      gaps.push('No consent management system detected');
    }
    
    // Check for data access rights
    const accessRights = this.auditResults.storageLocations.filter(
      loc => loc.dataTypes.includes('access') || loc.dataTypes.includes('export')
    );
    
    if (accessRights.length === 0) {
      gaps.push('No data access/export functionality detected');
    }
    
    this.auditResults.gdprGaps = gaps;
  }

  /**
   * Generate comprehensive recommendations
   */
  private generateRecommendations(): void {
    const recommendations: string[] = [];
    
    // High priority recommendations
    recommendations.push('Implement AES-256 encryption for all GDPR-relevant data');
    recommendations.push('Establish comprehensive data retention policies');
    recommendations.push('Create consent management system with granular options');
    recommendations.push('Implement data access, export, and deletion mechanisms');
    
    // Medium priority recommendations
    recommendations.push('Add data integrity verification with HMAC');
    recommendations.push('Implement comprehensive audit logging');
    recommendations.push('Create data processing transparency documentation');
    
    // Low priority recommendations
    recommendations.push('Optimize storage usage and implement data minimization');
    recommendations.push('Regular security audits and penetration testing');
    
    this.auditResults.recommendations = recommendations;
    
    // Update summary
    this.updateAuditSummary();
  }

  /**
   * Update audit summary
   */
  private updateAuditSummary(): void {
    const summary = this.auditResults.summary;
    
    summary.totalStorageLocations = this.auditResults.storageLocations.length;
    summary.encryptedLocations = this.auditResults.storageLocations.filter(
      loc => loc.encryption
    ).length;
    summary.sensitiveDataLocations = this.auditResults.storageLocations.filter(
      loc => loc.classification.level === 'high'
    ).length;
    
    // Calculate compliance score
    const totalScore = 100;
    const deductions = this.auditResults.gdprGaps.length * 10;
    summary.complianceScore = Math.max(0, totalScore - deductions);
  }

  /**
   * Generate audit report
   */
  generateAuditReport(): string {
    const { summary, storageLocations, securityAssessments, gdprGaps, recommendations } = this.auditResults;
    
    return `
# Data Storage Audit Report

## Executive Summary
- **Total Storage Locations**: ${summary.totalStorageLocations}
- **Encrypted Locations**: ${summary.encryptedLocations}
- **Sensitive Data Locations**: ${summary.sensitiveDataLocations}
- **GDPR Compliance Score**: ${summary.complianceScore}/100

## Key Findings
${storageLocations.length > 0 ? `
### Storage Locations by Type
${this.groupStorageByTypeSummary()}

### Security Assessment
${this.securityAssessmentSummary()}

### GDPR Compliance Gaps
${gdprGaps.length > 0 ? gdprGaps.map(gap => `- ${gap}`).join('\n') : 'No critical gaps identified'}
` : 'No storage locations identified'}

## Recommendations
${recommendations.map((rec, index) => `${index + 1}. ${rec}`).join('\n')}

## Detailed Analysis
${this.detailedAnalysis()}

## Next Steps
1. Prioritize high-sensitivity data encryption
2. Implement consent management system
3. Establish data retention policies
4. Create data access mechanisms
5. Schedule regular security audits
    `.trim();
  }

  /**
   * Generate storage by type summary
   */
  private groupStorageByTypeSummary(): string {
    const grouped = this.groupStorageByType();
    return Object.entries(grouped)
      .map(([type, locations]) => `- **${type}**: ${locations.length} locations`)
      .join('\n');
  }

  /**
   * Generate security assessment summary
   */
  private securityAssessmentSummary(): string {
    const avgVulnerability = securityAssessments.reduce(
      (sum, assessment) => sum + assessment.vulnerabilityScore, 0
    ) / securityAssessments.length;

    return `- **Average Vulnerability Score**: ${avgVulnerability.toFixed(1)}/100
- **High Risk Locations**: ${securityAssessments.filter(a => a.vulnerabilityScore > 70).length}
- **Medium Risk Locations**: ${securityAssessments.filter(a => a.vulnerabilityScore > 40 && a.vulnerabilityScore <= 70).length}
- **Low Risk Locations**: ${securityAssessments.filter(a => a.vulnerabilityScore <= 40).length}`;
  }

  /**
   * Generate detailed analysis
   */
  private detailedAnalysis(): string {
    return this.auditResults.storageLocations
      .map(location => `
### ${location.filePath}
- **Storage Type**: ${location.storageType}
- **Data Types**: ${location.dataTypes.join(', ') || 'None identified'}
- **Classification**: ${location.classification.level} (${location.classification.category})
- **Encryption**: ${location.encryption ? 'Implemented' : 'Not implemented'}
- **Retention Policy**: ${location.retention || 'Undefined'}
- **Occurrences**: ${location.occurrences}
      `.trim())
      .join('\n');
  }
}

/**
 * Create data storage auditor instance
 */
export function createDataStorageAuditor(): DataStorageAuditor {
  return new DataStorageAuditor();
}
```

### Step 2: Create Audit Report Generator

**File**: `apps/web/src/lib/audit/audit-report-generator.ts`

```typescript
import { DataStorageAuditor, createDataStorageAuditor } from './data-storage-auditor';
import type { DataStorageAudit } from '@al-ummah/shared-types';

/**
 * Audit report generator with multiple output formats
 */
export class AuditReportGenerator {
  private auditor: DataStorageAuditor;

  constructor() {
    this.auditor = createDataStorageAuditor();
  }

  /**
   * Generate complete audit report
   */
  async generateFullReport(): Promise<{
    audit: DataStorageAudit;
    markdown: string;
    json: string;
    csv: string;
  }> {
    console.log('📊 Generating comprehensive audit report...');

    // Perform audit
    const audit = await this.auditor.performAudit();

    // Generate different formats
    const markdown = this.generateMarkdownReport(audit);
    const json = this.generateJSONReport(audit);
    const csv = this.generateCSVReport(audit);

    console.log('✅ Audit report generation completed');

    return {
      audit,
      markdown,
      json,
      csv
    };
  }

  /**
   * Generate markdown report
   */
  private generateMarkdownReport(audit: DataStorageAudit): string {
    return this.auditor.generateAuditReport();
  }

  /**
   * Generate JSON report
   */
  private generateJSONReport(audit: DataStorageAudit): string {
    return JSON.stringify(audit, null, 2);
  }

  /**
   * Generate CSV report for storage locations
   */
  private generateCSVReport(audit: DataStorageAudit): string {
    const headers = [
      'File Path',
      'Storage Type',
      'Data Types',
      'Classification Level',
      'GDPR Relevant',
      'Encryption',
      'Retention Policy',
      'Occurrences',
      'Vulnerability Score'
    ];

    const rows = audit.storageLocations.map(location => {
      const assessment = audit.securityAssessments.find(
        a => a.storageLocationId === location.id
      );

      return [
        location.filePath,
        location.storageType,
        location.dataTypes.join('; '),
        location.classification.level,
        location.classification.gdprRelevant ? 'Yes' : 'No',
        location.encryption ? 'Yes' : 'No',
        location.retention || 'Undefined',
        location.occurrences.toString(),
        assessment?.vulnerabilityScore.toString() || 'N/A'
      ];
    });

    return [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
  }

  /**
   * Export report to file (Node.js environment)
   */
  async exportToFile(reportData: any, filename: string): Promise<void> {
    // This would be implemented based on the environment
    // For Node.js, could use fs.writeFileSync
    console.log(`📁 Report exported to ${filename}`);
  }

  /**
   * Generate executive summary
   */
  generateExecutiveSummary(audit: DataStorageAudit): string {
    const { summary, gdprGaps, recommendations } = audit;

    return `
# Executive Summary - Data Storage Audit

## Key Metrics
- **Total Storage Locations**: ${summary.totalStorageLocations}
- **Encryption Coverage**: ${((summary.encryptedLocations / summary.totalStorageLocations) * 100).toFixed(1)}%
- **GDPR Compliance Score**: ${summary.complianceScore}/100
- **Critical Issues**: ${gdprGaps.length}

## Risk Assessment
${this.assessOverallRisk(audit)}

## Immediate Actions Required
${this.prioritizeActions(recommendations, gdprGaps)}

## Compliance Status
${this.assessComplianceStatus(summary.complianceScore)}
    `.trim();
  }

  /**
   * Assess overall risk level
   */
  private assessOverallRisk(audit: DataStorageAudit): string {
    const highRiskLocations = audit.securityAssessments.filter(
      a => a.vulnerabilityScore > 70
    ).length;

    if (highRiskLocations > 0) {
      return `🔴 **HIGH RISK**: ${highRiskLocations} locations identified with high vulnerability scores`;
    }

    const mediumRiskLocations = audit.securityAssessments.filter(
      a => a.vulnerabilityScore > 40 && a.vulnerabilityScore <= 70
    ).length;

    if (mediumRiskLocations > 0) {
      return `🟡 **MEDIUM RISK**: ${mediumRiskLocations} locations require attention`;
    }

    return `🟢 **LOW RISK**: Storage practices are generally secure`;
  }

  /**
   * Prioritize immediate actions
   */
  private prioritizeActions(recommendations: string[], gaps: string[]): string {
    const priorityActions = [
      ...gaps.slice(0, 3).map(gap => `- **URGENT**: ${gap}`),
      ...recommendations.slice(0, 3).map(rec => `- **HIGH**: ${rec}`)
    ];

    return priorityActions.join('\n');
  }

  /**
   * Assess compliance status
   */
  private assessComplianceStatus(score: number): string {
    if (score >= 90) return '✅ **COMPLIANT**: Strong GDPR compliance';
    if (score >= 70) return '⚠️ **PARTIALLY COMPLIANT**: Some improvements needed';
    if (score >= 50) return '🟡 **NEEDS IMPROVEMENT**: Significant gaps identified';
    return '🔴 **NON-COMPLIANT**: Immediate action required';
  }
}

/**
 * Create audit report generator instance
 */
export function createAuditReportGenerator(): AuditReportGenerator {
  return new AuditReportGenerator();
}
```

### Step 3: Create Audit CLI Tool

**File**: `apps/web/scripts/audit-data-storage.ts`

```typescript
#!/usr/bin/env ts-node

/**
 * CLI tool for running data storage audits
 */

import { createAuditReportGenerator } from '../src/lib/audit/audit-report-generator';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface AuditOptions {
  output?: string;
  format?: 'markdown' | 'json' | 'csv' | 'all';
  verbose?: boolean;
}

async function runAudit(options: AuditOptions = {}): Promise<void> {
  console.log('🚀 Starting Data Storage Audit CLI');
  console.log('=====================================');

  try {
    // Create report generator
    const generator = createAuditReportGenerator();

    // Generate full report
    const reportData = await generator.generateFullReport();

    // Set output directory
    const outputDir = options.output || './audit-reports';
    mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Export based on format
    if (options.format === 'all' || !options.format) {
      // Export all formats
      writeFileSync(
        join(outputDir, `data-storage-audit-${timestamp}.md`),
        reportData.markdown
      );
      
      writeFileSync(
        join(outputDir, `data-storage-audit-${timestamp}.json`),
        reportData.json
      );
      
      writeFileSync(
        join(outputDir, `data-storage-audit-${timestamp}.csv`),
        reportData.csv
      );
      
      console.log(`✅ All report formats exported to ${outputDir}/`);
    } else {
      // Export specific format
      const filename = `data-storage-audit-${timestamp}.${options.format}`;
      const content = reportData[options.format];
      
      writeFileSync(join(outputDir, filename), content);
      console.log(`✅ ${options.format.toUpperCase()} report exported to ${outputDir}/${filename}`);
    }

    // Show summary if verbose
    if (options.verbose) {
      console.log('\n📊 Executive Summary:');
      console.log(generator.generateExecutiveSummary(reportData.audit));
    }

    // Show compliance score
    console.log(`\n🎯 GDPR Compliance Score: ${reportData.audit.summary.complianceScore}/100`);
    
    if (reportData.audit.gdprGaps.length > 0) {
      console.log(`⚠️ ${reportData.audit.gdprGaps.length} GDPR compliance gaps identified`);
    }

  } catch (error) {
    console.error('❌ Audit failed:', error);
    process.exit(1);
  }
}

// Parse command line arguments
function parseArgs(): AuditOptions {
  const args = process.argv.slice(2);
  const options: AuditOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--format':
      case '-f':
        options.format = args[++i] as any;
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        showHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        showHelp();
        process.exit(1);
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
Data Storage Audit CLI Tool

Usage: ts-node audit-data-storage.ts [options]

Options:
  -o, --output <dir>     Output directory (default: ./audit-reports)
  -f, --format <format>  Output format: markdown, json, csv, all (default: all)
  -v, --verbose          Show detailed summary
  -h, --help             Show this help message

Examples:
  ts-node audit-data-storage.ts
  ts-node audit-data-storage.ts --format json --verbose
  ts-node audit-data-storage.ts --output ./reports --format markdown
  ts-node audit-data-storage.ts -o ./reports -f all -v
  `);
}

// Run audit if called directly
if (require.main === module) {
  const options = parseArgs();
  runAudit(options);
}

export { runAudit };
```

### Step 4: Add Audit Tests

**File**: `apps/web/src/__tests__/audit/data-storage-auditor.test.ts`

```typescript
import { DataStorageAuditor, createDataStorageAuditor } from '@/lib/audit/data-storage-auditor';
import type { DataStorageAudit, StorageLocation } from '@al-ummah/shared-types';

describe('DataStorageAuditor', () => {
  let auditor: DataStorageAuditor;

  beforeEach(() => {
    auditor = createDataStorageAuditor();
  });

  describe('Audit Execution', () => {
    it('should perform complete audit', async () => {
      const audit = await auditor.performAudit();

      expect(audit).toBeDefined();
      expect(audit.timestamp).toBeDefined();
      expect(audit.version).toBe('1.0.0');
      expect(audit.summary).toBeDefined();
      expect(audit.storageLocations).toBeDefined();
      expect(audit.dataFlows).toBeDefined();
      expect(audit.securityAssessments).toBeDefined();
      expect(audit.recommendations).toBeDefined();
      expect(audit.gdprGaps).toBeDefined();
    });

    it('should generate audit report', async () => {
      await auditor.performAudit();
      const report = auditor.generateAuditReport();

      expect(report).toContain('Data Storage Audit Report');
      expect(report).toContain('Executive Summary');
      expect(report).toContain('Key Findings');
      expect(report).toContain('Recommendations');
    });
  });

  describe('Storage Classification', () => {
    it('should classify sensitive data correctly', () => {
      const matches = [
        'localStorage.setItem("authToken", token)',
        'localStorage.setItem("userEmail", email)'
      ];

      const classification = auditor['classifyDataSensitivity'](matches);

      expect(classification.level).toBe('high');
      expect(classification.category).toBe('personal');
      expect(classification.gdprRelevant).toBe(true);
    });

    it('should classify non-sensitive data correctly', () => {
      const matches = [
        'localStorage.setItem("theme", "dark")',
        'localStorage.setItem("language", "en")'
      ];

      const classification = auditor['classifyDataSensitivity'](matches);

      expect(classification.level).toBe('low');
      expect(classification.category).toBe('technical');
      expect(classification.gdprRelevant).toBe(false);
    });

    it('should identify special GDPR categories', () => {
      const matches = [
        'localStorage.setItem("healthData", data)',
        'localStorage.setItem("biometricId", id)'
      ];

      const classification = auditor['classifyDataSensitivity'](matches);

      expect(classification.specialCategories).toContain('health');
      expect(classification.specialCategories).toContain('biometric');
    });
  });

  describe('Security Assessment', () => {
    it('should assess encryption usage', () => {
      const encryptedMatches = [
        'localStorage.setItem("encrypted", encrypt(data))'
      ];

      const unencryptedMatches = [
        'localStorage.setItem("plain", data)'
      ];

      expect(auditor['assessEncryptionUsage'](encryptedMatches)).toBe(true);
      expect(auditor['assessEncryptionUsage'](unencryptedMatches)).toBe(false);
    });

    it('should calculate vulnerability scores', () => {
      const highRiskLocation: StorageLocation = {
        id: 'test-1',
        filePath: '/test/file.ts',
        storageType: 'localStorage',
        pattern: 'localStorage',
        occurrences: 5,
        codeSamples: ['localStorage.setItem("token", token)'],
        dataTypes: ['authentication'],
        classification: {
          level: 'high',
          category: 'personal',
          gdprRelevant: true,
          specialCategories: []
        },
        encryption: false,
        retention: 'undefined',
        lastModified: new Date().toISOString()
      };

      const score = auditor['calculateVulnerabilityScore'](highRiskLocation);
      expect(score).toBeGreaterThan(70);
    });
  });

  describe('GDPR Compliance', () => {
    it('should identify GDPR gaps', async () => {
      const audit = await auditor.performAudit();

      // Should identify gaps if unencrypted GDPR data exists
      if (audit.gdprGaps.length > 0) {
        expect(audit.gdprGaps[0]).toContain('GDPR');
      }
    });

    it('should generate compliance recommendations', async () => {
      const audit = await auditor.performAudit();

      expect(audit.recommendations.length).toBeGreaterThan(0);
      expect(audit.recommendations.some(r => r.includes('encryption'))).toBe(true);
    });
  });

  describe('Report Generation', () => {
    it('should generate comprehensive report', async () => {
      await auditor.performAudit();
      const report = auditor.generateAuditReport();

      expect(report).toContain('# Data Storage Audit Report');
      expect(report).toContain('## Executive Summary');
      expect(report).toContain('## Key Findings');
      expect(report).toContain('## Recommendations');
    });

    it('should include storage location details', async () => {
      await auditor.performAudit();
      const report = auditor.generateAuditReport();

      // Should contain detailed analysis section
      expect(report).toContain('## Detailed Analysis');
    });
  });
});
```

### Step 5: Create Package.json Scripts

**File**: `apps/web/package.json` (Update existing)

```json
{
  "scripts": {
    "audit:storage": "ts-node scripts/audit-data-storage.ts",
    "audit:storage:json": "ts-node scripts/audit-data-storage.ts --format json",
    "audit:storage:markdown": "ts-node scripts/audit-data-storage.ts --format markdown",
    "audit:storage:verbose": "ts-node scripts/audit-data-storage.ts --verbose"
  }
}
```

## Testing Strategy

### Unit Testing
- **Auditor Logic**: Test storage pattern detection and classification
- **Security Assessment**: Test vulnerability scoring and recommendations
- **Report Generation**: Test markdown, JSON, and CSV output formats
- **GDPR Compliance**: Test gap identification and compliance scoring

### Integration Testing
- **Codebase Scanning**: Test actual codebase scanning functionality
- **File Processing**: Test file reading and pattern matching
- **Report Export**: Test file export functionality

### Manual Testing
- **CLI Tool**: Test command-line interface with various options
- **Report Quality**: Review generated reports for accuracy and completeness
- **GDPR Assessment**: Validate GDPR compliance assessment accuracy

## Deliverables

### New Files
1. **`apps/web/src/lib/audit/data-storage-auditor.ts`** - Core audit framework
2. **`apps/web/src/lib/audit/audit-report-generator.ts`** - Report generation utilities
3. **`apps/web/scripts/audit-data-storage.ts`** - CLI audit tool
4. **`apps/web/src/__tests__/audit/data-storage-auditor.test.ts`** - Unit tests

### Updated Files
1. **`apps/web/package.json`** - Add audit scripts
2. **`apps/web/tsconfig.json`** - Include scripts directory

### Generated Outputs
1. **Audit Reports** - Markdown, JSON, and CSV format reports
2. **Executive Summary** - High-level compliance overview
3. **Security Assessment** - Detailed vulnerability analysis

## Success Criteria

### Functional Requirements
- ✅ Complete scan of all storage locations in codebase
- ✅ Accurate classification of data sensitivity levels
- ✅ Comprehensive security vulnerability assessment
- ✅ GDPR compliance gap identification
- ✅ Actionable recommendations generation

### Technical Requirements
- ✅ Support for multiple storage mechanisms (localStorage, sessionStorage, IndexedDB, cookies)
- ✅ Pattern-based detection of storage usage
- ✅ Automated report generation in multiple formats
- ✅ CLI tool for easy execution
- ✅ Comprehensive test coverage

### Compliance Requirements
- ✅ GDPR data classification accuracy
- ✅ Security vulnerability identification
- ✅ Retention policy assessment
- ✅ Encryption implementation verification
- ✅ Consent mechanism detection

### Usability Requirements
- ✅ Clear, actionable audit reports
- ✅ Executive summary for stakeholders
- ✅ Technical details for developers
- ✅ CLI tool for automation
- ✅ Multiple output formats for different audiences

## Timeline

### Phase 1: Core Audit Framework (4-5 hours)
- DataStorageAuditor implementation
- Pattern detection and classification logic
- Basic security assessment

### Phase 2: Report Generation (2-3 hours)
- AuditReportGenerator implementation
- Multiple output format support
- Executive summary generation

### Phase 3: CLI Tool (1-2 hours)
- Command-line interface implementation
- File export functionality
- Help and documentation

### Phase 4: Testing & Validation (2-3 hours)
- Comprehensive unit tests
- Integration testing
- Manual validation of reports
- Documentation updates

## Risk Assessment

### Medium Risk
- **Pattern Accuracy**: Storage patterns might be missed or misclassified
- **False Positives**: Non-sensitive data might be flagged as sensitive
- **Code Coverage**: Complex code patterns might evade detection

### Low Risk
- **Implementation Complexity**: Well-defined requirements and patterns
- **Performance**: Audit runs offline, no performance impact on application
- **Dependencies**: Minimal external dependencies

### Mitigation Strategies
- Use comprehensive pattern matching with regular expressions
- Implement manual review process for critical findings
- Create extensible pattern library for easy updates
- Validate results against known storage locations

This implementation plan provides a comprehensive audit framework that will identify all data storage practices, assess security implementation, and identify GDPR compliance gaps, forming the foundation for implementing proper data protection measures.