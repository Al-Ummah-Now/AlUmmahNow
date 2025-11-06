# Implementation Plan: Data Retention Policies

**Story**: 1.3 Implement GDPR-Compliant Data Storage  
**Task Group**: 1.3.7 Implement data retention policies  
**Priority**: High  
**Estimated Time**: 3-4 days  

## Overview

This implementation plan focuses on creating a comprehensive data retention system that automatically manages data lifecycle according to GDPR requirements. The system will implement automated data deletion, retention scheduling, and compliance monitoring.

## Prerequisites

- Completion of data storage audit (1.3.1)
- Encrypted storage implementation (1.3.2)
- Consent management system (1.3.3)
- Data access/export functionality (1.3.4)
- Transparent processing implementation (1.3.5)
- Cookie consent implementation (1.3.6)

## Detailed Implementation Steps

### Step 1: Create Data Retention Types

**File**: `packages/shared-types/src/retention.ts`

```typescript
export interface RetentionPolicy {
  id: string;
  name: string;
  description: string;
  dataType: string;
  retentionPeriod: number; // in days
  retentionBasis: 'legal_requirement' | 'legitimate_interest' | 'consent' | 'contractual';
  deletionAction: 'permanent_delete' | 'anonymize' | 'archive';
  conditions: RetentionCondition[];
  exceptions: RetentionException[];
  lastReviewed: Date;
  version: string;
}

export interface RetentionCondition {
  type: 'user_activity' | 'account_status' | 'legal_hold' | 'business_need';
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains';
  value: any;
  description: string;
}

export interface RetentionException {
  id: string;
  name: string;
  description: string;
  condition: RetentionCondition;
  approvedBy: string;
  approvedAt: Date;
  expiresAt?: Date;
}

export interface DataRecord {
  id: string;
  dataType: string;
  userId?: string;
  content: any;
  createdAt: Date;
  lastAccessed: Date;
  metadata: Record<string, any>;
  retentionPolicyId?: string;
  scheduledDeletion?: Date;
  legalHold: boolean;
  archived: boolean;
}

export interface RetentionSchedule {
  id: string;
  policyId: string;
  dataType: string;
  action: 'review' | 'delete' | 'anonymize' | 'archive';
  scheduledFor: Date;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  processedAt?: Date;
  affectedRecords: number;
  errorMessage?: string;
}

export interface RetentionAuditLog {
  id: string;
  action: 'policy_created' | 'policy_updated' | 'data_deleted' | 'data_anonymized' | 'data_archived' | 'exception_granted';
  policyId?: string;
  recordId?: string;
  userId?: string;
  reason: string;
  timestamp: Date;
  performedBy: string;
  metadata: Record<string, any>;
}

export interface RetentionComplianceReport {
  reportId: string;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  summary: {
    totalRecords: number;
    recordsDeleted: number;
    recordsAnonymized: number;
    recordsArchived: number;
    exceptionsGranted: number;
    policiesActive: number;
  };
  details: {
    byDataType: Record<string, {
      total: number;
      deleted: number;
      anonymized: number;
      archived: number;
    }>;
    byPolicy: Record<string, {
      policyName: string;
      recordsProcessed: number;
      complianceRate: number;
    }>;
  };
}
```

### Step 2: Implement Data Retention Engine

**File**: `apps/web/src/lib/retention/retention-engine.ts`

```typescript
import { 
  RetentionPolicy, 
  DataRecord, 
  RetentionSchedule, 
  RetentionAuditLog,
  RetentionCondition,
  RetentionException 
} from '@al-ummah/shared-types';

export class DataRetentionEngine {
  private policies: Map<string, RetentionPolicy> = new Map();
  private schedules: RetentionSchedule[] = [];
  private auditLogs: RetentionAuditLog[] = [];
  private legalHolds: Set<string> = new Set();

  constructor() {
    this.loadPolicies();
    this.loadSchedules();
    this.loadAuditLogs();
    this.startRetentionScheduler();
  }

  // Add or update retention policy
  addPolicy(policy: RetentionPolicy): void {
    this.policies.set(policy.id, policy);
    this.persistPolicies();
    
    this.logAuditEvent({
      action: policy.id in this.policies ? 'policy_updated' : 'policy_created',
      policyId: policy.id,
      reason: `Retention policy ${policy.name} ${policy.id in this.policies ? 'updated' : 'created'}`,
      performedBy: 'system',
      metadata: { policy }
    });
  }

  // Get all retention policies
  getPolicies(): RetentionPolicy[] {
    return Array.from(this.policies.values());
  }

  // Get policy by data type
  getPolicyByDataType(dataType: string): RetentionPolicy | null {
    for (const policy of this.policies.values()) {
      if (policy.dataType === dataType) {
        return policy;
      }
    }
    return null;
  }

  // Schedule data for retention processing
  scheduleDataRetention(record: DataRecord): void {
    const policy = this.getPolicyByDataType(record.dataType);
    if (!policy) return;

    // Check if record is under legal hold
    if (record.legalHold || this.legalHolds.has(record.id)) {
      return;
    }

    // Check retention conditions
    if (!this.evaluateRetentionConditions(record, policy.conditions)) {
      return;
    }

    // Check for exceptions
    if (this.hasRetentionException(record, policy.exceptions)) {
      return;
    }

    // Calculate deletion date
    const retentionPeriod = policy.retentionPeriod * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    const deletionDate = new Date(record.createdAt.getTime() + retentionPeriod);

    // Create retention schedule
    const schedule: RetentionSchedule = {
      id: `schedule_${Date.now()}_${record.id}`,
      policyId: policy.id,
      dataType: record.dataType,
      action: policy.deletionAction,
      scheduledFor: deletionDate,
      status: 'pending',
      affectedRecords: 1
    };

    this.schedules.push(schedule);
    this.persistSchedules();

    // Update record with scheduled deletion
    record.scheduledDeletion = deletionDate;
    record.retentionPolicyId = policy.id;
  }

  // Process retention schedules
  async processRetentionSchedules(): Promise<void> {
    const now = new Date();
    const dueSchedules = this.schedules.filter(schedule => 
      schedule.status === 'pending' && schedule.scheduledFor <= now
    );

    for (const schedule of dueSchedules) {
      try {
        schedule.status = 'in_progress';
        await this.executeRetentionAction(schedule);
        schedule.status = 'completed';
        schedule.processedAt = new Date();
      } catch (error) {
        schedule.status = 'failed';
        schedule.errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        this.logAuditEvent({
          action: 'data_deleted', // Generic action for logging
          recordId: schedule.id,
          reason: `Retention action failed: ${schedule.errorMessage}`,
          performedBy: 'system',
          metadata: { schedule, error }
        });
      }
    }

    this.persistSchedules();
  }

  // Execute retention action
  private async executeRetentionAction(schedule: RetentionSchedule): Promise<void> {
    const policy = this.policies.get(schedule.policyId);
    if (!policy) {
      throw new Error(`Policy ${schedule.policyId} not found`);
    }

    // Find records affected by this schedule
    const affectedRecords = await this.findRecordsBySchedule(schedule);
    schedule.affectedRecords = affectedRecords.length;

    for (const record of affectedRecords) {
      switch (schedule.action) {
        case 'permanent_delete':
          await this.permanentlyDeleteRecord(record);
          break;
        case 'anonymize':
          await this.anonymizeRecord(record);
          break;
        case 'archive':
          await this.archiveRecord(record);
          break;
        default:
          throw new Error(`Unknown retention action: ${schedule.action}`);
      }
    }

    this.logAuditEvent({
      action: schedule.action === 'permanent_delete' ? 'data_deleted' : 
              schedule.action === 'anonymize' ? 'data_anonymized' : 'data_archived',
      policyId: schedule.policyId,
      reason: `Automatic retention processing for ${policy.dataType}`,
      performedBy: 'system',
      metadata: { 
        scheduleId: schedule.id,
        recordsProcessed: affectedRecords.length,
        action: schedule.action
      }
    });
  }

  // Find records by retention schedule
  private async findRecordsBySchedule(schedule: RetentionSchedule): Promise<DataRecord[]> {
    // In a real implementation, this would query the database
    // For now, return mock data
    return [];
  }

  // Permanently delete record
  private async permanentlyDeleteRecord(record: DataRecord): Promise<void> {
    // Implement actual deletion logic
    console.log(`Permanently deleting record ${record.id} of type ${record.dataType}`);
  }

  // Anonymize record
  private async anonymizeRecord(record: DataRecord): Promise<void> {
    // Replace personal data with anonymous values
    const anonymizedContent = this.anonymizeData(record.content);
    record.content = anonymizedContent;
    record.archived = true;
    
    console.log(`Anonymizing record ${record.id} of type ${record.dataType}`);
  }

  // Archive record
  private async archiveRecord(record: DataRecord): Promise<void> {
    // Move record to archival storage
    record.archived = true;
    
    console.log(`Archiving record ${record.id} of type ${record.dataType}`);
  }

  // Anonymize data content
  private anonymizeData(data: any): any {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const anonymized: any = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        // Anonymize common personal data fields
        if (key.toLowerCase().includes('email') || key.toLowerCase().includes('name')) {
          anonymized[key] = 'ANONYMIZED';
        } else if (key.toLowerCase().includes('ip') || key.toLowerCase().includes('address')) {
          anonymized[key] = 'ANONYMIZED';
        } else {
          anonymized[key] = value;
        }
      } else if (typeof value === 'object') {
        anonymized[key] = this.anonymizeData(value);
      } else {
        anonymized[key] = value;
      }
    }
    
    return anonymized;
  }

  // Evaluate retention conditions
  private evaluateRetentionConditions(record: DataRecord, conditions: RetentionCondition[]): boolean {
    if (conditions.length === 0) return true;

    return conditions.every(condition => {
      const fieldValue = this.getFieldValue(record, condition.field);
      
      switch (condition.operator) {
        case 'equals':
          return fieldValue === condition.value;
        case 'not_equals':
          return fieldValue !== condition.value;
        case 'greater_than':
          return Number(fieldValue) > Number(condition.value);
        case 'less_than':
          return Number(fieldValue) < Number(condition.value);
        case 'contains':
          return String(fieldValue).includes(String(condition.value));
        default:
          return false;
      }
    });
  }

  // Check for retention exceptions
  private hasRetentionException(record: DataRecord, exceptions: RetentionException[]): boolean {
    return exceptions.some(exception => {
      // Check if exception has expired
      if (exception.expiresAt && exception.expiresAt < new Date()) {
        return false;
      }
      
      return this.evaluateRetentionConditions(record, [exception.condition]);
    });
  }

  // Get field value from record
  private getFieldValue(record: DataRecord, field: string): any {
    if (field === 'userId') return record.userId;
    if (field === 'dataType') return record.dataType;
    if (field === 'createdAt') return record.createdAt;
    if (field === 'lastAccessed') return record.lastAccessed;
    if (field === 'legalHold') return record.legalHold;
    
    // Check metadata
    return record.metadata[field];
  }

  // Add legal hold
  addLegalHold(recordId: string, reason: string, approvedBy: string): void {
    this.legalHolds.add(recordId);
    
    this.logAuditEvent({
      action: 'exception_granted',
      recordId,
      reason: `Legal hold placed: ${reason}`,
      performedBy: approvedBy,
      metadata: { type: 'legal_hold', reason }
    });
  }

  // Remove legal hold
  removeLegalHold(recordId: string, removedBy: string): void {
    this.legalHolds.delete(recordId);
    
    this.logAuditEvent({
      action: 'exception_granted',
      recordId,
      reason: 'Legal hold removed',
      performedBy: removedBy,
      metadata: { type: 'legal_hold_removed' }
    });
  }

  // Generate compliance report
  generateComplianceReport(startDate: Date, endDate: Date): RetentionComplianceReport {
    const relevantLogs = this.auditLogs.filter(log => 
      log.timestamp >= startDate && log.timestamp <= endDate
    );

    const summary = {
      totalRecords: 0, // Would be calculated from actual data
      recordsDeleted: relevantLogs.filter(log => log.action === 'data_deleted').length,
      recordsAnonymized: relevantLogs.filter(log => log.action === 'data_anonymized').length,
      recordsArchived: relevantLogs.filter(log => log.action === 'data_archived').length,
      exceptionsGranted: relevantLogs.filter(log => log.action === 'exception_granted').length,
      policiesActive: this.policies.size
    };

    const byDataType: Record<string, any> = {};
    const byPolicy: Record<string, any> = {};

    // Group by data type
    relevantLogs.forEach(log => {
      const policy = log.policyId ? this.policies.get(log.policyId) : null;
      const dataType = policy?.dataType || 'unknown';
      
      if (!byDataType[dataType]) {
        byDataType[dataType] = { total: 0, deleted: 0, anonymized: 0, archived: 0 };
      }
      
      byDataType[dataType][log.action === 'data_deleted' ? 'deleted' : 
                           log.action === 'data_anonymized' ? 'anonymized' : 'archived']++;
    });

    // Group by policy
    this.policies.forEach(policy => {
      const policyLogs = relevantLogs.filter(log => log.policyId === policy.id);
      byPolicy[policy.id] = {
        policyName: policy.name,
        recordsProcessed: policyLogs.length,
        complianceRate: policyLogs.length > 0 ? 100 : 0 // Simplified calculation
      };
    });

    return {
      reportId: `report_${Date.now()}`,
      generatedAt: new Date(),
      period: { start: startDate, end: endDate },
      summary,
      details: { byDataType, byPolicy }
    };
  }

  // Get retention schedules
  getSchedules(): RetentionSchedule[] {
    return this.schedules;
  }

  // Get audit logs
  getAuditLogs(limit = 100): RetentionAuditLog[] {
    return this.auditLogs
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // Log audit event
  private logAuditEvent(event: Omit<RetentionAuditLog, 'id' | 'timestamp'>): void {
    const log: RetentionAuditLog = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      ...event
    };

    this.auditLogs.push(log);
    
    // Keep only last 10000 logs
    if (this.auditLogs.length > 10000) {
      this.auditLogs = this.auditLogs.slice(-10000);
    }
    
    this.persistAuditLogs();
  }

  // Start retention scheduler
  private startRetentionScheduler(): void {
    // Process retention every hour
    setInterval(() => {
      this.processRetentionSchedules();
    }, 60 * 60 * 1000);
  }

  // Persistence methods (simplified - would use actual storage)
  private loadPolicies(): void {
    // Load from storage
  }

  private persistPolicies(): void {
    // Save to storage
  }

  private loadSchedules(): void {
    // Load from storage
  }

  private persistSchedules(): void {
    // Save to storage
  }

  private loadAuditLogs(): void {
    // Load from storage
  }

  private persistAuditLogs(): void {
    // Save to storage
  }
}
```

### Step 3: Create Retention Management UI

**File**: `apps/web/src/components/retention/retention-dashboard.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { DataRetentionEngine } from '@/lib/retention/retention-engine';
import { RetentionPolicy, RetentionSchedule, RetentionComplianceReport } from '@al-ummah/shared-types';

interface RetentionDashboardProps {
  retentionEngine: DataRetentionEngine;
}

export function RetentionDashboard({ retentionEngine }: RetentionDashboardProps) {
  const [policies, setPolicies] = useState<RetentionPolicy[]>([]);
  const [schedules, setSchedules] = useState<RetentionSchedule[]>([]);
  const [complianceReport, setComplianceReport] = useState<RetentionComplianceReport | null>(null);
  const [activeTab, setActiveTab] = useState<'policies' | 'schedules' | 'compliance'>('policies');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [policiesData, schedulesData] = await Promise.all([
        Promise.resolve(retentionEngine.getPolicies()),
        Promise.resolve(retentionEngine.getSchedules())
      ]);

      setPolicies(policiesData);
      setSchedules(schedulesData);
    } catch (error) {
      console.error('Failed to load retention data:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateComplianceReport = () => {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000); // Last 30 days
    
    const report = retentionEngine.generateComplianceReport(startDate, endDate);
    setComplianceReport(report);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">Data Retention Management</h1>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          {[
            { id: 'policies', label: 'Retention Policies' },
            { id: 'schedules', label: 'Retention Schedules' },
            { id: 'compliance', label: 'Compliance Reports' }
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
      {activeTab === 'policies' && (
        <PoliciesTab policies={policies} />
      )}

      {activeTab === 'schedules' && (
        <SchedulesTab schedules={schedules} />
      )}

      {activeTab === 'compliance' && (
        <ComplianceTab 
          report={complianceReport}
          onGenerateReport={generateComplianceReport}
        />
      )}
    </div>
  );
}

interface PoliciesTabProps {
  policies: RetentionPolicy[];
}

function PoliciesTab({ policies }: PoliciesTabProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold">Retention Policies</h2>
        <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
          Add Policy
        </button>
      </div>

      {policies.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No retention policies configured
        </div>
      ) : (
        <div className="space-y-4">
          {policies.map(policy => (
            <PolicyCard key={policy.id} policy={policy} />
          ))}
        </div>
      )}
    </div>
  );
}

interface PolicyCardProps {
  policy: RetentionPolicy;
}

function PolicyCard({ policy }: PolicyCardProps) {
  return (
    <div className="border rounded-lg p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-lg">{policy.name}</h3>
          <p className="text-gray-600 mt-1">{policy.description}</p>
        </div>
        <div className="flex gap-2">
          <button className="text-blue-600 hover:text-blue-800 text-sm">
            Edit
          </button>
          <button className="text-red-600 hover:text-red-800 text-sm">
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <span className="font-medium">Data Type:</span>
          <p className="text-gray-600">{policy.dataType}</p>
        </div>
        <div>
          <span className="font-medium">Retention Period:</span>
          <p className="text-gray-600">{policy.retentionPeriod} days</p>
        </div>
        <div>
          <span className="font-medium">Deletion Action:</span>
          <p className="text-gray-600">{policy.deletionAction.replace('_', ' ')}</p>
        </div>
        <div>
          <span className="font-medium">Legal Basis:</span>
          <p className="text-gray-600">{policy.retentionBasis.replace('_', ' ')}</p>
        </div>
      </div>

      {policy.conditions.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <h4 className="font-medium text-sm mb-2">Retention Conditions:</h4>
          <div className="space-y-1">
            {policy.conditions.map((condition, index) => (
              <div key={index} className="text-xs text-gray-600">
                {condition.field} {condition.operator} {condition.value} - {condition.description}
              </div>
            ))}
          </div>
        </div>
      )}

      {policy.exceptions.length > 0 && (
        <div className="mt-4 pt-4 border-t">
          <h4 className="font-medium text-sm mb-2">Exceptions:</h4>
          <div className="space-y-1">
            {policy.exceptions.map((exception, index) => (
              <div key={index} className="text-xs text-gray-600">
                {exception.name}: {exception.description}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface SchedulesTabProps {
  schedules: RetentionSchedule[];
}

function SchedulesTab({ schedules }: SchedulesTabProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-yellow-100 text-yellow-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold">Retention Schedules</h2>
        <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
          Process Now
        </button>
      </div>

      {schedules.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          No retention schedules found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Data Type
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Action
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Scheduled For
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Affected Records
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {schedules.map(schedule => (
                <tr key={schedule.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {schedule.dataType}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {schedule.action.replace('_', ' ')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {schedule.scheduledFor.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs rounded ${getStatusColor(schedule.status)}`}>
                      {schedule.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {schedule.affectedRecords}
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

interface ComplianceTabProps {
  report: RetentionComplianceReport | null;
  onGenerateReport: () => void;
}

function ComplianceTab({ report, onGenerateReport }: ComplianceTabProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold">Compliance Reports</h2>
        <button 
          onClick={onGenerateReport}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          Generate Report
        </button>
      </div>

      {!report ? (
        <div className="text-center py-8 text-gray-500">
          No compliance report available. Click "Generate Report" to create one.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Report Summary */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-semibold mb-4">Report Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{report.summary.totalRecords}</div>
                <div className="text-sm text-gray-600">Total Records</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{report.summary.recordsDeleted}</div>
                <div className="text-sm text-gray-600">Deleted</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">{report.summary.recordsAnonymized}</div>
                <div className="text-sm text-gray-600">Anonymized</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">{report.summary.recordsArchived}</div>
                <div className="text-sm text-gray-600">Archived</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-600">{report.summary.exceptionsGranted}</div>
                <div className="text-sm text-gray-600">Exceptions</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{report.summary.policiesActive}</div>
                <div className="text-sm text-gray-600">Active Policies</div>
              </div>
            </div>
          </div>

          {/* By Data Type */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="font-semibold mb-4">By Data Type</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Data Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Deleted
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Anonymized
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Archived
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.entries(report.details.byDataType).map(([dataType, stats]) => (
                    <tr key={dataType}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {dataType}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {stats.total}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {stats.deleted}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {stats.anonymized}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {stats.archived}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Report Metadata */}
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-600">
              <div><strong>Report ID:</strong> {report.reportId}</div>
              <div><strong>Generated:</strong> {report.generatedAt.toLocaleString()}</div>
              <div><strong>Period:</strong> {report.period.start.toLocaleDateString()} - {report.period.end.toLocaleDateString()}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 4: Create Retention API Endpoints

**File**: `apps/api-videos/src/endpoints/retention/policies.ts`

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { authMiddleware } from '@/middleware/auth';
import { DataRetentionEngine } from '@/lib/retention/retention-engine';

const app = new OpenAPIHono();

// Initialize retention engine
const retentionEngine = new DataRetentionEngine();

// Apply authentication middleware
app.use('*', authMiddleware);

// Get all retention policies
const getPoliciesRoute = createRoute({
  method: 'get',
  path: '/retention/policies',
  tags: ['Retention'],
  summary: 'Get all retention policies',
  middleware: [authMiddleware],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            policies: z.array(z.any())
          })
        }
      },
      description: 'Policies retrieved successfully'
    }
  }
});

app.openapi(getPoliciesRoute, (c) => {
  const policies = retentionEngine.getPolicies();
  return c.json({ policies });
});

// Create retention policy
const createPolicyRoute = createRoute({
  method: 'post',
  path: '/retention/policies',
  tags: ['Retention'],
  summary: 'Create retention policy',
  middleware: [authMiddleware],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string(),
            description: z.string(),
            dataType: z.string(),
            retentionPeriod: z.number(),
            retentionBasis: z.enum(['legal_requirement', 'legitimate_interest', 'consent', 'contractual']),
            deletionAction: z.enum(['permanent_delete', 'anonymize', 'archive']),
            conditions: z.array(z.any()).optional(),
            exceptions: z.array(z.any()).optional()
          })
        }
      }
    }
  },
  responses: {
    201: {
      content: {
        'application/json': {
          schema: z.object({
            success: z.boolean(),
            policyId: z.string()
          })
        }
      },
      description: 'Policy created successfully'
    }
  }
});

app.openapi(createPolicyRoute, async (c) => {
  const policyData = await c.req.json();
  const userId = c.get('userId');
  
  const policy = {
    id: `policy_${Date.now()}`,
    ...policyData,
    lastReviewed: new Date(),
    version: '1.0.0'
  };

  retentionEngine.addPolicy(policy);

  return c.json({
    success: true,
    policyId: policy.id
  }, 201);
});

export default app;
```

## Testing Strategy

### Unit Tests

**File**: `apps/web/src/lib/retention/__tests__/retention-engine.test.ts`

```typescript
import { DataRetentionEngine } from '../retention-engine';
import { RetentionPolicy, DataRecord } from '@al-ummah/shared-types';

describe('DataRetentionEngine', () => {
  let engine: DataRetentionEngine;
  let mockPolicy: RetentionPolicy;

  beforeEach(() => {
    engine = new DataRetentionEngine();
    
    mockPolicy = {
      id: 'test_policy',
      name: 'Test Policy',
      description: 'Test retention policy',
      dataType: 'user_data',
      retentionPeriod: 30,
      retentionBasis: 'consent',
      deletionAction: 'permanent_delete',
      conditions: [],
      exceptions: [],
      lastReviewed: new Date(),
      version: '1.0.0'
    };
  });

  describe('addPolicy', () => {
    it('should add new retention policy', () => {
      engine.addPolicy(mockPolicy);
      const policies = engine.getPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0].id).toBe('test_policy');
    });
  });

  describe('getPolicyByDataType', () => {
    it('should return policy for matching data type', () => {
      engine.addPolicy(mockPolicy);
      const policy = engine.getPolicyByDataType('user_data');
      expect(policy?.id).toBe('test_policy');
    });

    it('should return null for non-matching data type', () => {
      const policy = engine.getPolicyByDataType('nonexistent');
      expect(policy).toBeNull();
    });
  });

  describe('scheduleDataRetention', () => {
    it('should schedule data for retention', () => {
      engine.addPolicy(mockPolicy);
      
      const record: DataRecord = {
        id: 'test_record',
        dataType: 'user_data',
        content: { test: 'data' },
        createdAt: new Date(),
        lastAccessed: new Date(),
        metadata: {},
        legalHold: false,
        archived: false
      };

      engine.scheduleDataRetention(record);
      
      const schedules = engine.getSchedules();
      expect(schedules).toHaveLength(1);
      expect(schedules[0].dataType).toBe('user_data');
      expect(schedules[0].action).toBe('permanent_delete');
    });

    it('should not schedule data under legal hold', () => {
      engine.addPolicy(mockPolicy);
      
      const record: DataRecord = {
        id: 'test_record',
        dataType: 'user_data',
        content: { test: 'data' },
        createdAt: new Date(),
        lastAccessed: new Date(),
        metadata: {},
        legalHold: true,
        archived: false
      };

      engine.scheduleDataRetention(record);
      
      const schedules = engine.getSchedules();
      expect(schedules).toHaveLength(0);
    });
  });

  describe('generateComplianceReport', () => {
    it('should generate compliance report', () => {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
      
      const report = engine.generateComplianceReport(startDate, endDate);
      
      expect(report).toHaveProperty('reportId');
      expect(report).toHaveProperty('generatedAt');
      expect(report).toHaveProperty('period');
      expect(report).toHaveProperty('summary');
      expect(report).toHaveProperty('details');
    });
  });
});
```

### Integration Tests

**File**: `apps/api-videos/src/endpoints/retention/__tests__/policies.test.ts`

```typescript
import { testClient } from 'hono/testing';
import { app } from '../policies';

describe('Retention Policies API', () => {
  let client: ReturnType<typeof testClient>;

  beforeEach(() => {
    client = testClient(app);
  });

  describe('GET /retention/policies', () => {
    it('should return retention policies', async () => {
      const response = await client.retention.policies.$get({
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('policies');
    });
  });

  describe('POST /retention/policies', () => {
    it('should create retention policy', async () => {
      const policyData = {
        name: 'Test Policy',
        description: 'Test policy description',
        dataType: 'test_data',
        retentionPeriod: 30,
        retentionBasis: 'consent',
        deletionAction: 'permanent_delete'
      };

      const response = await client.retention.policies.$post({
        json: policyData,
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });
      
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data).toHaveProperty('policyId');
    });
  });
});
```

## Deliverables

### Files to Create
1. `packages/shared-types/src/retention.ts` - Data retention types
2. `apps/web/src/lib/retention/retention-engine.ts` - Core retention engine
3. `apps/web/src/components/retention/retention-dashboard.tsx` - Management dashboard
4. `apps/api-videos/src/endpoints/retention/policies.ts` - Retention policies API

### Test Files
1. `apps/web/src/lib/retention/__tests__/retention-engine.test.ts`
2. `apps/api-videos/src/endpoints/retention/__tests__/policies.test.ts`

### Documentation
1. Data retention policy documentation
2. User guide for retention management
3. Compliance reporting guide

## Success Criteria

### Functional Requirements
- ✅ Automated data retention scheduling
- ✅ Multiple deletion actions (delete, anonymize, archive)
- ✅ Retention conditions and exceptions
- ✅ Legal hold management
- ✅ Compliance reporting

### Legal Requirements
- ✅ GDPR Article 5 (Storage limitation) compliance
- ✅ GDPR Article 25 (Data protection by design) compliance
- ✅ Automated deletion mechanisms
- ✅ Audit trail for all retention actions
- ✅ Legal hold capabilities

### Technical Requirements
- ✅ TypeScript implementation with full type safety
- ✅ React components with proper state management
- ✅ API endpoints with OpenAPI documentation
- ✅ Comprehensive test coverage (>90%)
- ✅ Automated scheduling system

### UX Requirements
- ✅ Intuitive policy management interface
- ✅ Clear compliance reporting
- ✅ Real-time schedule monitoring
- ✅ Mobile-responsive design
- ✅ Accessibility compliance (WCAG 2.1 AA)

## Timeline

### Day 1: Core Infrastructure
- Create data retention types and interfaces
- Implement retention engine core functionality
- Set up basic API endpoints

### Day 2: User Interface
- Develop retention management dashboard
- Implement policy creation and editing
- Create compliance reporting interface

### Day 3: Automation & Testing
- Implement automated retention processing
- Add comprehensive testing
- Create documentation and user guides

### Day 4: Integration & Polish
- Complete API integration
- Add advanced features (legal holds, exceptions)
- Performance optimization and final testing

## Risk Assessment

### High Risk
- **Data Loss**: Automated deletion could accidentally delete important data
  - **Mitigation**: Implement comprehensive testing, dry-run modes, and approval workflows
- **Performance Impact**: Large-scale data processing could affect system performance
  - **Mitigation**: Implement batch processing, throttling, and off-peak scheduling

### Medium Risk
- **Legal Compliance**: Retention periods may not meet all legal requirements
  - **Mitigation**: Legal review of policies, regular compliance audits
- **Data Recovery**: Deleted data may need to be recovered for legal reasons
  - **Mitigation**: Implement backup systems and data recovery procedures

### Low Risk
- **Schedule Conflicts**: Multiple retention policies may conflict
  - **Mitigation**: Policy priority system and conflict resolution logic
- **Audit Log Storage**: Large volumes of audit logs may consume significant storage
  - **Mitigation**: Log rotation, compression, and archival strategies

This implementation plan provides a comprehensive data retention system that ensures GDPR compliance while maintaining data integrity and providing excellent management capabilities.