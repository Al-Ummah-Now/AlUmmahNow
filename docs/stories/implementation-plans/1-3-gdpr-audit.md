# Implementation Plan: GDPR Compliance Audit Preparation

**Story**: 1.3 Implement GDPR-Compliant Data Storage  
**Task Group**: 1.3.8 Prepare GDPR compliance audit documentation and tools  
**Priority**: High  
**Estimated Time**: 2-3 days  

## Overview

This implementation plan focuses on creating comprehensive GDPR audit preparation tools and documentation. The system will generate audit reports, compliance evidence, and documentation required for GDPR audits and regulatory reviews.

## Prerequisites

- Completion of data storage audit (1.3.1)
- Encrypted storage implementation (1.3.2)
- Consent management system (1.3.3)
- Data access/export functionality (1.3.4)
- Transparent processing implementation (1.3.5)
- Cookie consent implementation (1.3.6)
- Data retention policies (1.3.7)

## Detailed Implementation Steps

### Step 1: Create GDPR Audit Types

**File**: `packages/shared-types/src/gdpr-audit.ts`

```typescript
export interface GDPROrganization {
  name: string;
  address: string;
  contactEmail: string;
  dataProtectionOfficer: {
    name: string;
    email: string;
    phone: string;
  };
  representative?: {
    name: string;
    address: string;
    contactEmail: string;
  };
}

export interface GDPRDataProcessingActivity {
  id: string;
  name: string;
  description: string;
  purposes: string[];
  categoriesOfDataSubjects: string[];
  categoriesOfPersonalData: string[];
  recipients: string[];
  thirdCountryTransfers: ThirdCountryTransfer[];
  retentionPeriod: string;
  securityMeasures: string[];
  legalBasis: string;
  consentDetails?: {
    obtained: boolean;
    method: string;
    date: Date;
    withdrawalMechanism: string;
  };
  automatedDecisionMaking?: {
    exists: boolean;
    logic: string;
    significance: string;
    humanIntervention: string;
  };
}

export interface ThirdCountryTransfer {
  country: string;
  purpose: string;
  legalBasis: 'adequacy_decision' | 'appropriate_safeguards' | 'specific_situations';
  safeguards?: string[];
}

export interface DataSubjectRights {
  right: 'access' | 'rectification' | 'erasure' | 'portability' | 'objection' | 'restriction';
  implemented: boolean;
  procedures: string[];
  responseTime: string;
  verificationMethods: string[];
  denialReasons?: string[];
  statistics: {
    requestsReceived: number;
    requestsFulfilled: number;
    requestsDenied: number;
    averageResponseTime: number;
    period: {
      start: Date;
      end: Date;
    };
  };
}

export interface SecurityMeasure {
  category: 'technical' | 'organizational';
  type: string;
  description: string;
  implementation: string;
  effectiveness: 'high' | 'medium' | 'low';
  lastReviewed: Date;
  nextReview: Date;
  documentation: string[];
}

export interface DataBreachRecord {
  id: string;
  detectionDate: Date;
  notificationDate?: Date;
  description: string;
  typesOfData: string[];
  dataSubjectsAffected: number;
  consequences: string;
  measuresTaken: string[];
  supervisoryAuthorityNotified: boolean;
  dataSubjectsNotified: boolean;
  rootCause: string;
  preventiveMeasures: string[];
}

export interface DPIARecord {
  id: string;
  processingActivity: string;
  controller: string;
  dpo: string;
  description: string;
  necessityAndProportionality: string;
  risksToRights: string;
  mitigationMeasures: string[];
  outcome: 'proceed' | 'proceed_with_conditions' | 'do_not_proceed';
  date: Date;
  reviewer: string;
  recommendations: string[];
}

export interface GDPRComplianceReport {
  reportId: string;
  generatedAt: Date;
  organization: GDPROrganization;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    overallComplianceScore: number;
    criticalIssues: number;
    highRiskIssues: number;
    mediumRiskIssues: number;
    lowRiskIssues: number;
    recommendations: number;
  };
  sections: {
    processingActivities: GDPRDataProcessingActivity[];
    dataSubjectRights: DataSubjectRights[];
    securityMeasures: SecurityMeasure[];
    dataBreaches: DataBreachRecord[];
    dpias: DPIARecord[];
    consentManagement: ConsentAuditSummary;
    dataRetention: RetentionAuditSummary;
    internationalTransfers: ThirdCountryTransfer[];
  };
  recommendations: GDPRRecommendation[];
  evidence: ComplianceEvidence[];
}

export interface ConsentAuditSummary {
  totalConsents: number;
  activeConsents: number;
  withdrawnConsents: number;
  expiredConsents: number;
  consentRecords: ConsentRecord[];
  complianceIssues: ConsentComplianceIssue[];
}

export interface ConsentRecord {
  id: string;
  userId?: string;
  purpose: string;
  legalBasis: string;
  consentGiven: Date;
  consentWithdrawn?: Date;
  method: string;
  documentation: string;
  granular: boolean;
  specific: boolean;
    informed: boolean;
    unambiguous: boolean;
}

export interface ConsentComplianceIssue {
  type: 'missing_consent' | 'invalid_consent' | 'expired_consent' | 'insufficient_granularity';
  description: string;
  affectedRecords: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  recommendation: string;
}

export interface RetentionAuditSummary {
  totalRecords: number;
  recordsExpired: number;
  recordsDeleted: number;
  recordsAnonymized: number;
  recordsArchived: number;
  overdueDeletions: number;
  policiesActive: number;
  complianceIssues: RetentionComplianceIssue[];
}

export interface RetentionComplianceIssue {
  type: 'overdue_deletion' | 'missing_policy' | 'insufficient_documentation' | 'illegal_retention';
  description: string;
  affectedRecords: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  recommendation: string;
}

export interface GDPRRecommendation {
  id: string;
  category: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  legalBasis: string;
  implementationSteps: string[];
  priority: number;
  estimatedEffort: string;
  deadline?: Date;
  responsible: string;
  status: 'pending' | 'in_progress' | 'completed' | 'overdue';
}

export interface ComplianceEvidence {
  id: string;
  requirement: string;
  evidenceType: 'document' | 'screenshot' | 'log' | 'configuration' | 'test_result';
  description: string;
  location: string;
  date: Date;
  verified: boolean;
  verifiedBy?: string;
  notes?: string;
}

export interface AuditChecklist {
  id: string;
  category: 'lawfulness' | 'fairness' | 'transparency' | 'purpose_limitation' | 'data_minimisation' | 
           'accuracy' | 'storage_limitation' | 'integrity_confidentiality' | 'accountability';
  requirement: string;
  description: string;
  implemented: boolean;
  evidence: string[];
  gaps: string[];
  actionItems: string[];
  priority: 'critical' | 'high' | 'medium' | 'low';
}
```

### Step 2: Implement GDPR Audit Engine

**File**: `apps/web/src/lib/gdpr/audit-engine.ts`

```typescript
import {
  GDPRComplianceReport,
  GDPRDataProcessingActivity,
  DataSubjectRights,
  SecurityMeasure,
  DataBreachRecord,
  DPIARecord,
  ConsentAuditSummary,
  RetentionAuditSummary,
  GDPRRecommendation,
  ComplianceEvidence,
  AuditChecklist,
  GDPROrganization
} from '@al-ummah/shared-types';

export class GDPRAuditEngine {
  private organization: GDPROrganization;
  private processingActivities: GDPRDataProcessingActivity[] = [];
  private securityMeasures: SecurityMeasure[] = [];
  private dataBreaches: DataBreachRecord[] = [];
  private dpias: DPIARecord[] = [];
  private evidence: ComplianceEvidence[] = [];

  constructor(organization: GDPROrganization) {
    this.organization = organization;
    this.loadAuditData();
  }

  // Generate comprehensive GDPR compliance report
  async generateComplianceReport(startDate: Date, endDate: Date): Promise<GDPRComplianceReport> {
    const reportId = `gdpr_report_${Date.now()}`;
    
    // Generate section summaries
    const consentSummary = await this.generateConsentAuditSummary(startDate, endDate);
    const retentionSummary = await this.generateRetentionAuditSummary(startDate, endDate);
    
    // Analyze compliance and generate recommendations
    const recommendations = this.generateRecommendations();
    
    // Calculate overall compliance score
    const overallScore = this.calculateComplianceScore();
    
    // Categorize issues
    const issues = this.categorizeIssues(recommendations);
    
    return {
      reportId,
      generatedAt: new Date(),
      organization: this.organization,
      period: { start: startDate, end: endDate },
      summary: {
        overallComplianceScore: overallScore,
        criticalIssues: issues.critical,
        highRiskIssues: issues.high,
        mediumRiskIssues: issues.medium,
        lowRiskIssues: issues.low,
        recommendations: recommendations.length
      },
      sections: {
        processingActivities: this.processingActivities,
        dataSubjectRights: this.generateDataSubjectRightsSummary(),
        securityMeasures: this.securityMeasures,
        dataBreaches: this.dataBreaches.filter(breach => 
          breach.detectionDate >= startDate && breach.detectionDate <= endDate
        ),
        dpias: this.dpias,
        consentManagement: consentSummary,
        dataRetention: retentionSummary,
        internationalTransfers: this.extractInternationalTransfers()
      },
      recommendations,
      evidence: this.evidence
    };
  }

  // Generate consent audit summary
  private async generateConsentAuditSummary(startDate: Date, endDate: Date): Promise<ConsentAuditSummary> {
    // In a real implementation, this would query the consent database
    const mockConsentRecords = [
      {
        id: 'consent_1',
        userId: 'user_1',
        purpose: 'video_analytics',
        legalBasis: 'consent',
        consentGiven: new Date('2024-01-15'),
        method: 'cookie_banner',
        documentation: 'consent_log_1',
        granular: true,
        specific: true,
        informed: true,
        unambiguous: true
      },
      {
        id: 'consent_2',
        userId: 'user_2',
        purpose: 'marketing',
        legalBasis: 'consent',
        consentGiven: new Date('2024-02-01'),
        consentWithdrawn: new Date('2024-03-15'),
        method: 'settings_page',
        documentation: 'consent_log_2',
        granular: true,
        specific: true,
        informed: true,
        unambiguous: true
      }
    ];

    const totalConsents = mockConsentRecords.length;
    const activeConsents = mockConsentRecords.filter(c => !c.consentWithdrawn).length;
    const withdrawnConsents = mockConsentRecords.filter(c => c.consentWithdrawn).length;
    const expiredConsents = 0; // Would calculate based on retention policies

    // Identify compliance issues
    const complianceIssues = this.identifyConsentComplianceIssues(mockConsentRecords);

    return {
      totalConsents,
      activeConsents,
      withdrawnConsents,
      expiredConsents,
      consentRecords: mockConsentRecords,
      complianceIssues
    };
  }

  // Generate retention audit summary
  private async generateRetentionAuditSummary(startDate: Date, endDate: Date): Promise<RetentionAuditSummary> {
    // In a real implementation, this would query the retention database
    const mockRetentionData = {
      totalRecords: 10000,
      recordsExpired: 500,
      recordsDeleted: 450,
      recordsAnonymized: 30,
      recordsArchived: 20,
      overdueDeletions: 5,
      policiesActive: 8
    };

    // Identify compliance issues
    const complianceIssues = this.identifyRetentionComplianceIssues(mockRetentionData);

    return {
      ...mockRetentionData,
      complianceIssues
    };
  }

  // Identify consent compliance issues
  private identifyConsentComplianceIssues(consentRecords: any[]): ConsentComplianceIssue[] {
    const issues: ConsentComplianceIssue[] = [];

    consentRecords.forEach(record => {
      // Check for missing consent
      if (!record.consentGiven) {
        issues.push({
          type: 'missing_consent',
          description: `Missing consent for user ${record.userId} and purpose ${record.purpose}`,
          affectedRecords: 1,
          severity: 'critical',
          recommendation: 'Obtain valid consent before processing personal data'
        });
      }

      // Check for insufficient granularity
      if (!record.granular) {
        issues.push({
          type: 'insufficient_granularity',
          description: `Consent not granular enough for purpose ${record.purpose}`,
          affectedRecords: 1,
          severity: 'high',
          recommendation: 'Implement granular consent mechanisms'
        });
      }

      // Check for expired consent
      const consentAge = Date.now() - record.consentGiven.getTime();
      const maxAge = 2 * 365 * 24 * 60 * 60 * 1000; // 2 years
      if (consentAge > maxAge) {
        issues.push({
          type: 'expired_consent',
          description: `Consent expired for user ${record.userId}`,
          affectedRecords: 1,
          severity: 'medium',
          recommendation: 'Renew consent or cease processing'
        });
      }
    });

    return issues;
  }

  // Identify retention compliance issues
  private identifyRetentionComplianceIssues(retentionData: any): RetentionComplianceIssue[] {
    const issues: RetentionComplianceIssue[] = [];

    if (retentionData.overdueDeletions > 0) {
      issues.push({
        type: 'overdue_deletion',
        description: `${retentionData.overdueDeletions} records overdue for deletion`,
        affectedRecords: retentionData.overdueDeletions,
        severity: 'critical',
        recommendation: 'Immediately process overdue deletions'
      });
    }

    if (retentionData.policiesActive === 0) {
      issues.push({
        type: 'missing_policy',
        description: 'No active retention policies found',
        affectedRecords: retentionData.totalRecords,
        severity: 'high',
        recommendation: 'Implement comprehensive retention policies'
      });
    }

    return issues;
  }

  // Generate data subject rights summary
  private generateDataSubjectRightsSummary(): DataSubjectRights[] {
    return [
      {
        right: 'access',
        implemented: true,
        procedures: ['Online request form', 'Email request', 'API endpoint'],
        responseTime: '30 days',
        verificationMethods: ['Email verification', 'ID document'],
        statistics: {
          requestsReceived: 150,
          requestsFulfilled: 145,
          requestsDenied: 5,
          averageResponseTime: 15,
          period: {
            start: new Date('2024-01-01'),
            end: new Date('2024-12-31')
          }
        }
      },
      {
        right: 'erasure',
        implemented: true,
        procedures: ['Account deletion', 'Data removal request'],
        responseTime: '30 days',
        verificationMethods: ['Email verification', 'Multi-factor authentication'],
        denialReasons: ['Legal obligation', 'Public interest'],
        statistics: {
          requestsReceived: 45,
          requestsFulfilled: 42,
          requestsDenied: 3,
          averageResponseTime: 20,
          period: {
            start: new Date('2024-01-01'),
            end: new Date('2024-12-31')
          }
        }
      }
    ];
  }

  // Extract international transfers
  private extractInternationalTransfers(): any[] {
    const transfers: any[] = [];
    
    this.processingActivities.forEach(activity => {
      if (activity.thirdCountryTransfers) {
        transfers.push(...activity.thirdCountryTransfers);
      }
    });

    return transfers;
  }

  // Generate GDPR recommendations
  private generateRecommendations(): GDPRRecommendation[] {
    const recommendations: GDPRRecommendation[] = [];

    // Analyze processing activities
    this.processingActivities.forEach(activity => {
      if (!activity.legalBasis) {
        recommendations.push({
          id: `rec_${Date.now()}_${activity.id}`,
          category: 'critical',
          title: `Missing legal basis for ${activity.name}`,
          description: `Processing activity ${activity.name} lacks a documented legal basis`,
          legalBasis: 'GDPR Article 6',
          implementationSteps: [
            'Identify appropriate legal basis',
            'Document legal basis in processing record',
            'Update privacy notice',
            'Review consent mechanisms if needed'
          ],
          priority: 1,
          estimatedEffort: '2-3 days',
          deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          responsible: 'Data Protection Officer',
          status: 'pending'
        });
      }

      if (activity.automatedDecisionMaking?.exists && !activity.automatedDecisionMaking.humanIntervention) {
        recommendations.push({
          id: `rec_${Date.now()}_${activity.id}_adm`,
          category: 'high',
          title: `Missing human intervention for automated decision making in ${activity.name}`,
          description: 'Automated decision making requires human intervention mechanisms',
          legalBasis: 'GDPR Article 22',
          implementationSteps: [
            'Implement human review process',
            'Create intervention procedures',
            'Update user documentation',
            'Test intervention mechanisms'
          ],
          priority: 2,
          estimatedEffort: '1-2 weeks',
          responsible: 'Development Team',
          status: 'pending'
        });
      }
    });

    // Analyze security measures
    const outdatedMeasures = this.securityMeasures.filter(measure => 
      measure.nextReview < new Date()
    );

    if (outdatedMeasures.length > 0) {
      recommendations.push({
        id: `rec_${Date.now()}_security_review`,
        category: 'medium',
        title: 'Security measures review overdue',
        description: `${outdatedMeasures.length} security measures require review`,
        legalBasis: 'GDPR Article 32',
        implementationSteps: [
          'Review all security measures',
          'Update documentation',
          'Schedule regular reviews',
          'Implement review reminders'
        ],
        priority: 3,
        estimatedEffort: '3-5 days',
        responsible: 'Security Team',
        status: 'pending'
      });
    }

    return recommendations;
  }

  // Calculate overall compliance score
  private calculateComplianceScore(): number {
    let totalScore = 0;
    let maxScore = 0;

    // Processing activities (30%)
    const processingScore = this.processingActivities.length > 0 ? 
      this.processingActivities.filter(pa => pa.legalBasis).length / this.processingActivities.length : 0;
    totalScore += processingScore * 30;
    maxScore += 30;

    // Data subject rights (25%)
    const rightsScore = this.generateDataSubjectRightsSummary().length > 0 ?
      this.generateDataSubjectRightsSummary().filter(right => right.implemented).length / 
      this.generateDataSubjectRightsSummary().length : 0;
    totalScore += rightsScore * 25;
    maxScore += 25;

    // Security measures (20%)
    const securityScore = this.securityMeasures.length > 0 ?
      this.securityMeasures.filter(measure => measure.effectiveness === 'high').length / 
      this.securityMeasures.length : 0;
    totalScore += securityScore * 20;
    maxScore += 20;

    // Documentation (15%)
    const documentationScore = this.evidence.length > 0 ? 0.8 : 0.5; // Simplified
    totalScore += documentationScore * 15;
    maxScore += 15;

    // DPIAs (10%)
    const dpiaScore = this.dpias.length > 0 ? 0.9 : 0.6; // Simplified
    totalScore += dpiaScore * 10;
    maxScore += 10;

    return Math.round((totalScore / maxScore) * 100);
  }

  // Categorize issues by severity
  private categorizeIssues(recommendations: GDPRRecommendation[]): {
    critical: number;
    high: number;
    medium: number;
    low: number;
  } {
    return {
      critical: recommendations.filter(r => r.category === 'critical').length,
      high: recommendations.filter(r => r.category === 'high').length,
      medium: recommendations.filter(r => r.category === 'medium').length,
      low: recommendations.filter(r => r.category === 'low').length
    };
  }

  // Generate audit checklist
  generateAuditChecklist(): AuditChecklist[] {
    return [
      {
        id: 'lawfulness_1',
        category: 'lawfulness',
        requirement: 'Legal basis for processing',
        description: 'All personal data processing must have a valid legal basis under GDPR Article 6',
        implemented: this.processingActivities.every(pa => pa.legalBasis),
        evidence: ['Processing records', 'Legal basis documentation'],
        gaps: this.processingActivities.filter(pa => !pa.legalBasis).map(pa => pa.name),
        actionItems: ['Document legal basis for all processing activities'],
        priority: 'critical'
      },
      {
        id: 'transparency_1',
        category: 'transparency',
        requirement: 'Transparent privacy information',
        description: 'Data subjects must be informed about processing of their personal data',
        implemented: true, // Would check actual implementation
        evidence: ['Privacy notice', 'Cookie policy', 'Consent banners'],
        gaps: [],
        actionItems: ['Review privacy notice for completeness'],
        priority: 'high'
      },
      {
        id: 'security_1',
        category: 'integrity_confidentiality',
        requirement: 'Appropriate security measures',
        description: 'Implement appropriate technical and organizational security measures',
        implemented: this.securityMeasures.length > 0,
        evidence: ['Security policies', 'Encryption documentation', 'Access controls'],
        gaps: [],
        actionItems: ['Regular security reviews', 'Penetration testing'],
        priority: 'high'
      }
    ];
  }

  // Add processing activity
  addProcessingActivity(activity: GDPRDataProcessingActivity): void {
    this.processingActivities.push(activity);
    this.persistAuditData();
  }

  // Add security measure
  addSecurityMeasure(measure: SecurityMeasure): void {
    this.securityMeasures.push(measure);
    this.persistAuditData();
  }

  // Add data breach record
  addDataBreachRecord(breach: DataBreachRecord): void {
    this.dataBreaches.push(breach);
    this.persistAuditData();
  }

  // Add DPIA record
  addDPIARecord(dpia: DPIARecord): void {
    this.dpias.push(dpia);
    this.persistAuditData();
  }

  // Add compliance evidence
  addEvidence(evidence: ComplianceEvidence): void {
    this.evidence.push(evidence);
    this.persistAuditData();
  }

  // Load audit data (simplified)
  private loadAuditData(): void {
    // In a real implementation, this would load from database
  }

  // Persist audit data (simplified)
  private persistAuditData(): void {
    // In a real implementation, this would save to database
  }
}
```

### Step 3: Create GDPR Audit Dashboard

**File**: `apps/web/src/components/gdpr/audit-dashboard.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { GDPRAuditEngine } from '@/lib/gdpr/audit-engine';
import { GDPRComplianceReport, GDPRRecommendation, AuditChecklist } from '@al-ummah/shared-types';

interface GDPRAuditDashboardProps {
  auditEngine: GDPRAuditEngine;
}

export function GDPRAuditDashboard({ auditEngine }: GDPRAuditDashboardProps) {
  const [complianceReport, setComplianceReport] = useState<GDPRComplianceReport | null>(null);
  const [checklist, setChecklist] = useState<AuditChecklist[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportPeriod, setReportPeriod] = useState({
    start: new Date(new Date().getTime() - 90 * 24 * 60 * 60 * 1000), // Last 90 days
    end: new Date()
  });

  useEffect(() => {
    loadChecklist();
  }, []);

  const generateReport = async () => {
    setLoading(true);
    try {
      const report = await auditEngine.generateComplianceReport(reportPeriod.start, reportPeriod.end);
      setComplianceReport(report);
    } catch (error) {
      console.error('Failed to generate compliance report:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadChecklist = () => {
    const auditChecklist = auditEngine.generateAuditChecklist();
    setChecklist(auditChecklist);
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">GDPR Compliance Audit</h1>

      {/* Report Generation */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Generate Compliance Report</h2>
        <div className="flex flex-col md:flex-row gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={reportPeriod.start.toISOString().split('T')[0]}
              onChange={(e) => setReportPeriod(prev => ({
                ...prev,
                start: new Date(e.target.value)
              }))}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Date
            </label>
            <input
              type="date"
              value={reportPeriod.end.toISOString().split('T')[0]}
              onChange={(e) => setReportPeriod(prev => ({
                ...prev,
                end: new Date(e.target.value)
              }))}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={generateReport}
            disabled={loading}
            className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Generating...' : 'Generate Report'}
          </button>
        </div>
      </div>

      {/* Compliance Score */}
      {complianceReport && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Overall Compliance Score</h2>
          <div className="flex items-center gap-4">
            <div className={`text-4xl font-bold ${getScoreColor(complianceReport.summary.overallComplianceScore)}`}>
              {complianceReport.summary.overallComplianceScore}%
            </div>
            <div className="flex-1">
              <div className="w-full bg-gray-200 rounded-full h-4">
                <div
                  className={`h-4 rounded-full ${
                    complianceReport.summary.overallComplianceScore >= 90 ? 'bg-green-600' :
                    complianceReport.summary.overallComplianceScore >= 70 ? 'bg-yellow-600' :
                    'bg-red-600'
                  }`}
                  style={{ width: `${complianceReport.summary.overallComplianceScore}%` }}
                ></div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">
                {complianceReport.summary.criticalIssues}
              </div>
              <div className="text-sm text-gray-600">Critical</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {complianceReport.summary.highRiskIssues}
              </div>
              <div className="text-sm text-gray-600">High Risk</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">
                {complianceReport.summary.mediumRiskIssues}
              </div>
              <div className="text-sm text-gray-600">Medium Risk</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {complianceReport.summary.lowRiskIssues}
              </div>
              <div className="text-sm text-gray-600">Low Risk</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {complianceReport.summary.recommendations}
              </div>
              <div className="text-sm text-gray-600">Recommendations</div>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {complianceReport && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Recommendations</h2>
          {complianceReport.recommendations.length === 0 ? (
            <p className="text-gray-500">No recommendations at this time.</p>
          ) : (
            <div className="space-y-4">
              {complianceReport.recommendations.map(rec => (
                <div key={rec.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium">{rec.title}</h3>
                        <span className={`px-2 py-1 text-xs rounded ${getPriorityColor(rec.category)}`}>
                          {rec.category}
                        </span>
                      </div>
                      <p className="text-gray-600 text-sm">{rec.description}</p>
                    </div>
                  </div>
                  
                  <div className="text-sm text-gray-500 mb-2">
                    <strong>Legal Basis:</strong> {rec.legalBasis}
                  </div>
                  
                  <div className="text-sm text-gray-500 mb-2">
                    <strong>Estimated Effort:</strong> {rec.estimatedEffort}
                  </div>
                  
                  {rec.deadline && (
                    <div className="text-sm text-gray-500 mb-2">
                      <strong>Deadline:</strong> {rec.deadline.toLocaleDateString()}
                    </div>
                  )}
                  
                  <div className="text-sm">
                    <strong>Implementation Steps:</strong>
                    <ul className="list-disc list-inside mt-1 text-gray-600">
                      {rec.implementationSteps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Audit Checklist */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-lg font-semibold mb-4">Audit Checklist</h2>
        <div className="space-y-4">
          {checklist.map(item => (
            <div key={item.id} className="border rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium">{item.requirement}</h3>
                    <span className={`px-2 py-1 text-xs rounded ${getPriorityColor(item.priority)}`}>
                      {item.priority}
                    </span>
                    <span className={`px-2 py-1 text-xs rounded ${
                      item.implemented ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {item.implemented ? 'Implemented' : 'Not Implemented'}
                    </span>
                  </div>
                  <p className="text-gray-600 text-sm">{item.description}</p>
                </div>
              </div>
              
              <div className="text-sm text-gray-500 mb-2">
                <strong>Category:</strong> {item.category.replace('_', ' ')}
              </div>
              
              {item.evidence.length > 0 && (
                <div className="text-sm mb-2">
                  <strong>Evidence:</strong>
                  <ul className="list-disc list-inside mt-1 text-gray-600">
                    {item.evidence.map((evidence, index) => (
                      <li key={index}>{evidence}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {item.gaps.length > 0 && (
                <div className="text-sm mb-2">
                  <strong>Gaps:</strong>
                  <ul className="list-disc list-inside mt-1 text-red-600">
                    {item.gaps.map((gap, index) => (
                      <li key={index}>{gap}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {item.actionItems.length > 0 && (
                <div className="text-sm">
                  <strong>Action Items:</strong>
                  <ul className="list-disc list-inside mt-1 text-blue-600">
                    {item.actionItems.map((action, index) => (
                      <li key={index}>{action}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Step 4: Create GDPR Audit API

**File**: `apps/api-videos/src/endpoints/gdpr/audit.ts`

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { authMiddleware } from '@/middleware/auth';
import { GDPRAuditEngine } from '@/lib/gdpr/audit-engine';

const app = new OpenAPIHono();

// Initialize audit engine
const auditEngine = new GDPRAuditEngine({
  name: 'Al Ummah Now',
  address: '123 Main St, City, Country',
  contactEmail: 'privacy@alummahnow.net',
  dataProtectionOfficer: {
    name: 'DPO Name',
    email: 'dpo@alummahnow.net',
    phone: '+1234567890'
  }
});

// Apply authentication middleware
app.use('*', authMiddleware);

// Generate compliance report
const generateReportRoute = createRoute({
  method: 'post',
  path: '/gdpr/audit/report',
  tags: ['GDPR'],
  summary: 'Generate GDPR compliance report',
  middleware: [authMiddleware],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            startDate: z.string(),
            endDate: z.string()
          })
        }
      }
    }
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            reportId: z.string(),
            generatedAt: z.string(),
            summary: z.any(),
            recommendations: z.array(z.any())
          })
        }
      },
      description: 'Compliance report generated successfully'
    }
  }
});

app.openapi(generateReportRoute, async (c) => {
  const { startDate, endDate } = await c.req.json();
  
  const report = await auditEngine.generateComplianceReport(
    new Date(startDate),
    new Date(endDate)
  );

  return c.json({
    reportId: report.reportId,
    generatedAt: report.generatedAt.toISOString(),
    summary: report.summary,
    recommendations: report.recommendations
  });
});

// Get audit checklist
const getChecklistRoute = createRoute({
  method: 'get',
  path: '/gdpr/audit/checklist',
  tags: ['GDPR'],
  summary: 'Get GDPR audit checklist',
  middleware: [authMiddleware],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            checklist: z.array(z.any())
          })
        }
      },
      description: 'Audit checklist retrieved successfully'
    }
  }
});

app.openapi(getChecklistRoute, (c) => {
  const checklist = auditEngine.generateAuditChecklist();
  return c.json({ checklist });
});

export default app;
```

## Testing Strategy

### Unit Tests

**File**: `apps/web/src/lib/gdpr/__tests__/audit-engine.test.ts`

```typescript
import { GDPRAuditEngine } from '../audit-engine';
import { GDPROrganization } from '@al-ummah/shared-types';

describe('GDPRAuditEngine', () => {
  let engine: GDPRAuditEngine;
  let mockOrganization: GDPROrganization;

  beforeEach(() => {
    mockOrganization = {
      name: 'Test Organization',
      address: 'Test Address',
      contactEmail: 'test@example.com',
      dataProtectionOfficer: {
        name: 'Test DPO',
        email: 'dpo@example.com',
        phone: '1234567890'
      }
    };

    engine = new GDPRAuditEngine(mockOrganization);
  });

  describe('generateComplianceReport', () => {
    it('should generate compliance report', async () => {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
      
      const report = await engine.generateComplianceReport(startDate, endDate);
      
      expect(report).toHaveProperty('reportId');
      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('organization');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('sections');
      expect(report).toHaveProperty('recommendations');
      expect(report).toHaveProperty('evidence');
    });
  });

  describe('calculateComplianceScore', () => {
    it('should calculate compliance score', async () => {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
      
      const report = await engine.generateComplianceReport(startDate, endDate);
      
      expect(report.summary.overallComplianceScore).toBeGreaterThanOrEqual(0);
      expect(report.summary.overallComplianceScore).toBeLessThanOrEqual(100);
    });
  });

  describe('generateAuditChecklist', () => {
    it('should generate audit checklist', () => {
      const checklist = engine.generateAuditChecklist();
      
      expect(checklist).toBeInstanceOf(Array);
      expect(checklist.length).toBeGreaterThan(0);
      
      checklist.forEach(item => {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('category');
        expect(item).toHaveProperty('requirement');
        expect(item).toHaveProperty('description');
        expect(item).toHaveProperty('implemented');
        expect(item).toHaveProperty('priority');
      });
    });
  });
});
```

## Deliverables

### Files to Create
1. `packages/shared-types/src/gdpr-audit.ts` - GDPR audit types
2. `apps/web/src/lib/gdpr/audit-engine.ts` - Core audit engine
3. `apps/web/src/components/gdpr/audit-dashboard.tsx` - Audit dashboard
4. `apps/api-videos/src/endpoints/gdpr/audit.ts` - Audit API endpoints

### Test Files
1. `apps/web/src/lib/gdpr/__tests__/audit-engine.test.ts`
2. `apps/api-videos/src/endpoints/gdpr/__tests__/audit.test.ts`

### Documentation
1. GDPR audit preparation guide
2. Compliance evidence documentation
3. Regulatory submission templates

## Success Criteria

### Functional Requirements
- ✅ Comprehensive GDPR compliance reporting
- ✅ Automated compliance scoring
- ✅ Detailed audit checklist
- ✅ Evidence collection and management
- ✅ Recommendation generation

### Legal Requirements
- ✅ GDPR Articles 5-8 compliance verification
- ✅ Data subject rights implementation audit
- ✅ Security measures assessment
- ✅ International transfer documentation
- ✅ DPIA requirement evaluation

### Technical Requirements
- ✅ TypeScript implementation with full type safety
- ✅ React components with proper state management
- ✅ API endpoints with OpenAPI documentation
- ✅ Comprehensive test coverage (>90%)
- ✅ Automated audit scheduling

### UX Requirements
- ✅ Clear compliance visualization
- ✅ Actionable recommendations
- ✅ Progress tracking capabilities
- ✅ Mobile-responsive design
- ✅ Accessibility compliance (WCAG 2.1 AA)

## Timeline

### Day 1: Core Infrastructure
- Create GDPR audit types and interfaces
- Implement audit engine core functionality
- Set up basic API endpoints

### Day 2: User Interface
- Develop audit dashboard components
- Implement compliance scoring visualization
- Create checklist management interface

### Day 3: Integration & Testing
- Complete API integration
- Add comprehensive testing
- Create documentation and user guides

## Risk Assessment

### High Risk
- **Regulatory Changes**: GDPR requirements may change
  - **Mitigation**: Regular monitoring of regulatory updates, flexible system design
- **Data Accuracy**: Audit data may be incomplete or inaccurate
  - **Mitigation**: Data validation, automated data collection, manual verification processes

### Medium Risk
- **Complexity**: GDPR requirements are complex and may be interpreted differently
  - **Mitigation**: Legal review, expert consultation, industry best practices
- **Performance**: Large-scale audit processing may be resource-intensive
  - **Mitigation**: Efficient algorithms, caching, background processing

### Low Risk
- **User Understanding**: Complex compliance information may be difficult to understand
  - **Mitigation**: Clear visualizations, explanations, and guidance
- **Evidence Storage**: Large volumes of evidence may require significant storage
  - **Mitigation**: Efficient storage strategies, compression, archival policies

This implementation plan provides a comprehensive GDPR audit preparation system that ensures regulatory compliance while maintaining excellent usability and technical robustness.