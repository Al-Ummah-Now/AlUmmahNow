# Implementation Plan: Transparent Consent-Based Processing

**Story**: 1.3 Implement GDPR-Compliant Data Storage  
**Task Group**: 1.3.5 Implement transparent consent-based processing  
**Priority**: High  
**Estimated Time**: 3-4 days  

## Overview

This implementation plan focuses on creating a transparent data processing system that clearly communicates to users what data is being collected, why it's being collected, and how it's being processed. The system will provide real-time consent management and granular control over data processing activities.

## Prerequisites

- Completion of data storage audit (1.3.1)
- Encrypted storage implementation (1.3.2)
- Consent management system (1.3.3)
- Data access/export functionality (1.3.4)

## Detailed Implementation Steps

### Step 1: Create Data Processing Registry

**File**: `packages/shared-types/src/processing.ts`

```typescript
export interface DataProcessingActivity {
  id: string;
  name: string;
  description: string;
  category: 'essential' | 'functional' | 'analytics' | 'marketing';
  dataTypes: string[];
  purpose: string;
  legalBasis: 'consent' | 'legitimate_interest' | 'contractual_necessity';
  retentionPeriod: number; // in days
  thirdParties: string[];
  automatedDecisionMaking: boolean;
  userRights: ('access' | 'rectification' | 'erasure' | 'portability' | 'objection')[];
  required: boolean;
  enabled: boolean;
}

export interface ProcessingRegistry {
  activities: DataProcessingActivity[];
  lastUpdated: Date;
  version: string;
}

export interface ConsentState {
  activityId: string;
  granted: boolean;
  timestamp: Date;
  ipAddress: string;
  userAgent: string;
  version: string;
}

export interface ProcessingAuditLog {
  id: string;
  activityId: string;
  userId?: string;
  action: 'data_processed' | 'data_accessed' | 'data_shared' | 'data_deleted';
  dataTypes: string[];
  purpose: string;
  legalBasis: string;
  timestamp: Date;
  metadata: Record<string, any>;
}
```

### Step 2: Implement Processing Transparency Engine

**File**: `apps/web/src/lib/processing/transparency-engine.ts`

```typescript
import { DataProcessingActivity, ProcessingRegistry, ConsentState, ProcessingAuditLog } from '@al-ummah/shared-types';

export class ProcessingTransparencyEngine {
  private registry: ProcessingRegistry;
  private consentStates: Map<string, ConsentState[]> = new Map();
  private auditLogs: ProcessingAuditLog[] = [];

  constructor(registry: ProcessingRegistry) {
    this.registry = registry;
  }

  // Get all processing activities
  getProcessingActivities(): DataProcessingActivity[] {
    return this.registry.activities;
  }

  // Get activities by category
  getActivitiesByCategory(category: DataProcessingActivity['category']): DataProcessingActivity[] {
    return this.registry.activities.filter(activity => activity.category === category);
  }

  // Get required activities (cannot be disabled)
  getRequiredActivities(): DataProcessingActivity[] {
    return this.registry.activities.filter(activity => activity.required);
  }

  // Get optional activities (require consent)
  getOptionalActivities(): DataProcessingActivity[] {
    return this.registry.activities.filter(activity => !activity.required);
  }

  // Check if user has consented to specific activity
  hasConsent(activityId: string, userId?: string): boolean {
    if (!userId) return false;
    
    const userConsents = this.consentStates.get(userId) || [];
    const consent = userConsents.find(c => c.activityId === activityId);
    
    if (!consent) return false;
    
    // Check if consent is still valid (not expired)
    const activity = this.registry.activities.find(a => a.id === activityId);
    if (!activity) return false;
    
    const consentAge = Date.now() - consent.timestamp.getTime();
    const maxAge = activity.retentionPeriod * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    
    return consent.granted && consentAge < maxAge;
  }

  // Update consent for processing activity
  updateConsent(
    activityId: string, 
    granted: boolean, 
    userId: string,
    ipAddress: string,
    userAgent: string
  ): void {
    const activity = this.registry.activities.find(a => a.id === activityId);
    if (!activity) {
      throw new Error(`Processing activity ${activityId} not found`);
    }

    if (activity.required && !granted) {
      throw new Error(`Cannot withdraw consent for required activity ${activityId}`);
    }

    const userConsents = this.consentStates.get(userId) || [];
    const existingConsentIndex = userConsents.findIndex(c => c.activityId === activityId);

    const newConsent: ConsentState = {
      activityId,
      granted,
      timestamp: new Date(),
      ipAddress,
      userAgent,
      version: this.registry.version
    };

    if (existingConsentIndex >= 0) {
      userConsents[existingConsentIndex] = newConsent;
    } else {
      userConsents.push(newConsent);
    }

    this.consentStates.set(userId, userConsents);

    // Log consent change
    this.logProcessingActivity({
      id: `consent_${Date.now()}`,
      activityId,
      userId,
      action: granted ? 'data_processed' : 'data_deleted',
      dataTypes: activity.dataTypes,
      purpose: activity.purpose,
      legalBasis: activity.legalBasis,
      timestamp: new Date(),
      metadata: {
        consentChange: true,
        previousState: existingConsentIndex >= 0 ? userConsents[existingConsentIndex].granted : null,
        newState: granted
      }
    });
  }

  // Get user's current consent states
  getUserConsents(userId: string): ConsentState[] {
    return this.consentStates.get(userId) || [];
  }

  // Get activities user has consented to
  getUserConsentedActivities(userId: string): DataProcessingActivity[] {
    const userConsents = this.getUserConsents(userId);
    const consentedIds = userConsents
      .filter(c => c.granted)
      .map(c => c.activityId);

    return this.registry.activities.filter(activity => 
      consentedIds.includes(activity.id) || activity.required
    );
  }

  // Log processing activity
  private logProcessingActivity(log: ProcessingAuditLog): void {
    this.auditLogs.push(log);
    
    // Keep only last 10000 logs per user
    if (this.auditLogs.length > 10000) {
      this.auditLogs = this.auditLogs.slice(-10000);
    }
  }

  // Get processing audit logs for user
  getUserAuditLogs(userId: string, limit = 100): ProcessingAuditLog[] {
    return this.auditLogs
      .filter(log => log.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  // Check if processing is allowed for specific data type
  canProcessDataType(dataType: string, userId?: string): boolean {
    const relevantActivities = this.registry.activities.filter(activity =>
      activity.dataTypes.includes(dataType)
    );

    return relevantActivities.every(activity => 
      activity.required || (userId && this.hasConsent(activity.id, userId))
    );
  }

  // Get data processing summary for user
  getProcessingSummary(userId: string): {
    totalActivities: number;
    consentedActivities: number;
    requiredActivities: number;
    optionalActivities: number;
    dataTypesProcessed: string[];
    recentActivity: ProcessingAuditLog[];
  } {
    const userConsents = this.getUserConsents(userId);
    const consentedActivities = this.getUserConsentedActivities(userId);
    const requiredActivities = this.getRequiredActivities();
    const optionalActivities = this.getOptionalActivities();
    const recentActivity = this.getUserAuditLogs(userId, 10);

    const dataTypesProcessed = new Set<string>();
    consentedActivities.forEach(activity => {
      activity.dataTypes.forEach(dataType => dataTypesProcessed.add(dataType));
    });

    return {
      totalActivities: this.registry.activities.length,
      consentedActivities: consentedActivities.length,
      requiredActivities: requiredActivities.length,
      optionalActivities: optionalActivities.length,
      dataTypesProcessed: Array.from(dataTypesProcessed),
      recentActivity
    };
  }
}
```

### Step 3: Create Processing Transparency UI Components

**File**: `apps/web/src/components/processing/processing-dashboard.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { ProcessingTransparencyEngine } from '@/lib/processing/transparency-engine';
import { DataProcessingActivity, ConsentState } from '@al-ummah/shared-types';

interface ProcessingDashboardProps {
  userId: string;
  transparencyEngine: ProcessingTransparencyEngine;
}

export function ProcessingDashboard({ userId, transparencyEngine }: ProcessingDashboardProps) {
  const [activities, setActivities] = useState<DataProcessingActivity[]>([]);
  const [userConsents, setUserConsents] = useState<ConsentState[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [userId]);

  const loadData = async () => {
    try {
      const [activitiesData, consentsData, summaryData] = await Promise.all([
        Promise.resolve(transparencyEngine.getProcessingActivities()),
        Promise.resolve(transparencyEngine.getUserConsents(userId)),
        Promise.resolve(transparencyEngine.getProcessingSummary(userId))
      ]);

      setActivities(activitiesData);
      setUserConsents(consentsData);
      setSummary(summaryData);
    } catch (error) {
      console.error('Failed to load processing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConsentChange = async (activityId: string, granted: boolean) => {
    setSaving(true);
    try {
      // Get user's IP and user agent for consent tracking
      const response = await fetch('/api/user/info');
      const { ipAddress, userAgent } = await response.json();

      transparencyEngine.updateConsent(
        activityId,
        granted,
        userId,
        ipAddress,
        userAgent
      );

      await loadData();
    } catch (error) {
      console.error('Failed to update consent:', error);
    } finally {
      setSaving(false);
    }
  };

  const getActivityConsent = (activityId: string): boolean => {
    const consent = userConsents.find(c => c.activityId === activityId);
    return consent?.granted || false;
  };

  const groupedActivities = activities.reduce((groups, activity) => {
    const category = activity.category;
    if (!groups[category]) groups[category] = [];
    groups[category].push(activity);
    return groups;
  }, {} as Record<string, DataProcessingActivity[]>);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Summary Section */}
      {summary && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Data Processing Summary</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{summary.totalActivities}</div>
              <div className="text-sm text-gray-600">Total Activities</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{summary.consentedActivities}</div>
              <div className="text-sm text-gray-600">Consented</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{summary.requiredActivities}</div>
              <div className="text-sm text-gray-600">Required</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{summary.optionalActivities}</div>
              <div className="text-sm text-gray-600">Optional</div>
            </div>
          </div>
        </div>
      )}

      {/* Processing Activities by Category */}
      {Object.entries(groupedActivities).map(([category, categoryActivities]) => (
        <div key={category} className="bg-white rounded-lg shadow-md p-6">
          <h3 className="text-lg font-semibold mb-4 capitalize">
            {category.replace('_', ' ')} Activities
          </h3>
          <div className="space-y-4">
            {categoryActivities.map(activity => (
              <ProcessingActivityCard
                key={activity.id}
                activity={activity}
                hasConsent={getActivityConsent(activity.id)}
                onConsentChange={handleConsentChange}
                disabled={saving || activity.required}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface ProcessingActivityCardProps {
  activity: DataProcessingActivity;
  hasConsent: boolean;
  onConsentChange: (activityId: string, granted: boolean) => void;
  disabled: boolean;
}

function ProcessingActivityCard({ activity, hasConsent, onConsentChange, disabled }: ProcessingActivityCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium">{activity.name}</h4>
            {activity.required && (
              <span className="px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded">
                Required
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 mt-1">{activity.description}</p>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            {expanded ? 'Hide' : 'Details'}
          </button>
          
          {!activity.required && (
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={hasConsent}
                onChange={(e) => onConsentChange(activity.id, e.target.checked)}
                disabled={disabled}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium">Purpose:</span>
              <p className="text-gray-600">{activity.purpose}</p>
            </div>
            <div>
              <span className="font-medium">Legal Basis:</span>
              <p className="text-gray-600">{activity.legalBasis.replace('_', ' ')}</p>
            </div>
            <div>
              <span className="font-medium">Data Types:</span>
              <p className="text-gray-600">{activity.dataTypes.join(', ')}</p>
            </div>
            <div>
              <span className="font-medium">Retention:</span>
              <p className="text-gray-600">{activity.retentionPeriod} days</p>
            </div>
            {activity.thirdParties.length > 0 && (
              <div className="md:col-span-2">
                <span className="font-medium">Third Parties:</span>
                <p className="text-gray-600">{activity.thirdParties.join(', ')}</p>
              </div>
            )}
            {activity.automatedDecisionMaking && (
              <div className="md:col-span-2">
                <span className="font-medium text-orange-600">⚠️ Automated Decision Making</span>
                <p className="text-gray-600">This activity involves automated decision-making processes</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 4: Implement Real-Time Processing Notifications

**File**: `apps/web/src/components/processing/processing-notifications.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { ProcessingTransparencyEngine } from '@/lib/processing/transparency-engine';

interface ProcessingNotification {
  id: string;
  type: 'info' | 'warning' | 'success';
  title: string;
  message: string;
  timestamp: Date;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ProcessingNotificationsProps {
  userId: string;
  transparencyEngine: ProcessingTransparencyEngine;
}

export function ProcessingNotifications({ userId, transparencyEngine }: ProcessingNotificationsProps) {
  const [notifications, setNotifications] = useState<ProcessingNotification[]>([]);

  useEffect(() => {
    // Check for processing activities that need user attention
    checkProcessingStatus();
    
    // Set up periodic checks
    const interval = setInterval(checkProcessingStatus, 60000); // Every minute
    
    return () => clearInterval(interval);
  }, [userId]);

  const checkProcessingStatus = async () => {
    const newNotifications: ProcessingNotification[] = [];
    
    // Check for activities that need consent
    const activities = transparencyEngine.getProcessingActivities();
    const userConsents = transparencyEngine.getUserConsents(userId);
    
    activities.forEach(activity => {
      if (!activity.required) {
        const hasConsent = userConsents.some(c => c.activityId === activity.id && c.granted);
        
        if (!hasConsent) {
          newNotifications.push({
            id: `consent_needed_${activity.id}`,
            type: 'info',
            title: 'Consent Required',
            message: `${activity.name} requires your consent to process ${activity.dataTypes.join(', ')}.`,
            timestamp: new Date(),
            action: {
              label: 'Review Settings',
              onClick: () => {
                // Navigate to processing dashboard
                window.location.href = '/settings/processing';
              }
            }
          });
        }
      }
    });

    // Check for recent processing activity
    const recentLogs = transparencyEngine.getUserAuditLogs(userId, 5);
    recentLogs.forEach(log => {
      const timeDiff = Date.now() - log.timestamp.getTime();
      if (timeDiff < 300000) { // Last 5 minutes
        newNotifications.push({
          id: `recent_activity_${log.id}`,
          type: 'success',
          title: 'Data Processed',
          message: `Your ${log.dataTypes.join(', ')} data was processed for ${log.purpose}.`,
          timestamp: log.timestamp
        });
      }
    });

    setNotifications(newNotifications);
  };

  const dismissNotification = (id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  };

  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {notifications.map(notification => (
        <div
          key={notification.id}
          className={`p-4 rounded-lg shadow-lg border ${
            notification.type === 'warning' ? 'bg-yellow-50 border-yellow-200' :
            notification.type === 'success' ? 'bg-green-50 border-green-200' :
            'bg-blue-50 border-blue-200'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h4 className="font-medium text-sm">{notification.title}</h4>
              <p className="text-xs text-gray-600 mt-1">{notification.message}</p>
              {notification.action && (
                <button
                  onClick={notification.action.onClick}
                  className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-800"
                >
                  {notification.action.label}
                </button>
              )}
            </div>
            <button
              onClick={() => dismissNotification(notification.id)}
              className="ml-2 text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

### Step 5: Create Processing API Endpoints

**File**: `apps/api-videos/src/endpoints/processing/registry.ts`

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { ProcessingRegistry, DataProcessingActivity } from '@al-ummah/shared-types';

const app = new OpenAPIHono();

// Mock processing registry - in production, this would come from a database
const processingRegistry: ProcessingRegistry = {
  activities: [
    {
      id: 'video_watch_history',
      name: 'Video Watch History',
      description: 'Track which videos you have watched and your progress',
      category: 'functional',
      dataTypes: ['video_id', 'watch_time', 'progress', 'timestamp'],
      purpose: 'Provide personalized video recommendations and resume playback',
      legalBasis: 'consent',
      retentionPeriod: 365,
      thirdParties: [],
      automatedDecisionMaking: true,
      userRights: ['access', 'rectification', 'erasure', 'portability', 'objection'],
      required: false,
      enabled: true
    },
    {
      id: 'video_analytics',
      name: 'Video Analytics',
      description: 'Analyze video engagement and performance metrics',
      category: 'analytics',
      dataTypes: ['video_id', 'watch_duration', 'interaction_events', 'device_info'],
      purpose: 'Improve content quality and user experience',
      legalBasis: 'consent',
      retentionPeriod: 180,
      thirdParties: [],
      automatedDecisionMaking: true,
      userRights: ['access', 'erasure', 'objection'],
      required: false,
      enabled: true
    },
    {
      id: 'user_authentication',
      name: 'User Authentication',
      description: 'Authenticate users and manage access to the platform',
      category: 'essential',
      dataTypes: ['user_id', 'email', 'authentication_tokens', 'login_timestamp'],
      purpose: 'Provide secure access to user accounts',
      legalBasis: 'contractual_necessity',
      retentionPeriod: 1095, // 3 years
      thirdParties: ['auth.alummahnow.net'],
      automatedDecisionMaking: false,
      userRights: ['access', 'rectification', 'erasure'],
      required: true,
      enabled: true
    }
  ],
  lastUpdated: new Date(),
  version: '1.0.0'
};

// Get processing registry
const getRegistryRoute = createRoute({
  method: 'get',
  path: '/processing/registry',
  tags: ['Processing'],
  summary: 'Get data processing registry',
  description: 'Retrieve the complete registry of data processing activities',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            activities: z.array(z.any()),
            lastUpdated: z.string(),
            version: z.string()
          })
        }
      },
      description: 'Processing registry retrieved successfully'
    }
  }
});

app.openapi(getRegistryRoute, (c) => {
  return c.json({
    ...processingRegistry,
    lastUpdated: processingRegistry.lastUpdated.toISOString()
  });
});

// Get processing activities by category
const getActivitiesByCategoryRoute = createRoute({
  method: 'get',
  path: '/processing/activities/{category}',
  tags: ['Processing'],
  summary: 'Get processing activities by category',
  parameters: [
    {
      name: 'category',
      in: 'path',
      required: true,
      schema: z.enum(['essential', 'functional', 'analytics', 'marketing'])
    }
  ],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            activities: z.array(z.any())
          })
        }
      },
      description: 'Activities retrieved successfully'
    }
  }
});

app.openapi(getActivitiesByCategoryRoute, (c) => {
  const category = c.req.param('category') as DataProcessingActivity['category'];
  const activities = processingRegistry.activities.filter(
    activity => activity.category === category
  );
  
  return c.json({ activities });
});

export default app;
```

**File**: `apps/api-videos/src/endpoints/processing/consent.ts`

```typescript
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { authMiddleware } from '@/middleware/auth';
import { ProcessingTransparencyEngine } from '@/lib/processing/transparency-engine';

const app = new OpenAPIHono();

// Initialize transparency engine
const transparencyEngine = new ProcessingTransparencyEngine({
  activities: [], // Will be loaded from registry
  lastUpdated: new Date(),
  version: '1.0.0'
});

// Apply authentication middleware
app.use('*', authMiddleware);

// Update consent
const updateConsentRoute = createRoute({
  method: 'post',
  path: '/processing/consent',
  tags: ['Processing'],
  summary: 'Update consent for processing activity',
  middleware: [authMiddleware],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            activityId: z.string(),
            granted: z.boolean()
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
            success: z.boolean(),
            message: z.string()
          })
        }
      },
      description: 'Consent updated successfully'
    },
    400: {
      description: 'Invalid request or activity not found'
    },
    403: {
      description: 'Cannot withdraw consent for required activity'
    }
  }
});

app.openapi(updateConsentRoute, async (c) => {
  const userId = c.get('userId');
  const { activityId, granted } = await c.req.json();
  
  // Get client IP and user agent
  const ipAddress = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
  const userAgent = c.req.header('user-agent') || 'unknown';

  try {
    transparencyEngine.updateConsent(
      activityId,
      granted,
      userId,
      ipAddress,
      userAgent
    );

    return c.json({
      success: true,
      message: `Consent ${granted ? 'granted' : 'withdrawn'} for activity ${activityId}`
    });
  } catch (error) {
    if (error instanceof Error) {
      return c.json({ 
        success: false, 
        message: error.message 
      }, 400);
    }
    return c.json({ 
      success: false, 
      message: 'Internal server error' 
    }, 500);
  }
});

// Get user consents
const getUserConsentsRoute = createRoute({
  method: 'get',
  path: '/processing/consent',
  tags: ['Processing'],
  summary: 'Get user consent states',
  middleware: [authMiddleware],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            consents: z.array(z.any()),
            summary: z.any()
          })
        }
      },
      description: 'User consents retrieved successfully'
    }
  }
});

app.openapi(getUserConsentsRoute, (c) => {
  const userId = c.get('userId');
  
  const consents = transparencyEngine.getUserConsents(userId);
  const summary = transparencyEngine.getProcessingSummary(userId);

  return c.json({
    consents,
    summary
  });
});

export default app;
```

## Testing Strategy

### Unit Tests

**File**: `apps/web/src/lib/processing/__tests__/transparency-engine.test.ts`

```typescript
import { ProcessingTransparencyEngine } from '../transparency-engine';
import { ProcessingRegistry, DataProcessingActivity } from '@al-ummah/shared-types';

describe('ProcessingTransparencyEngine', () => {
  let engine: ProcessingTransparencyEngine;
  let mockRegistry: ProcessingRegistry;

  beforeEach(() => {
    mockRegistry = {
      activities: [
        {
          id: 'test_activity',
          name: 'Test Activity',
          description: 'Test processing activity',
          category: 'functional',
          dataTypes: ['email', 'name'],
          purpose: 'Test purpose',
          legalBasis: 'consent',
          retentionPeriod: 30,
          thirdParties: [],
          automatedDecisionMaking: false,
          userRights: ['access', 'erasure'],
          required: false,
          enabled: true
        },
        {
          id: 'required_activity',
          name: 'Required Activity',
          description: 'Required processing activity',
          category: 'essential',
          dataTypes: ['user_id'],
          purpose: 'Authentication',
          legalBasis: 'contractual_necessity',
          retentionPeriod: 365,
          thirdParties: [],
          automatedDecisionMaking: false,
          userRights: ['access'],
          required: true,
          enabled: true
        }
      ],
      lastUpdated: new Date(),
      version: '1.0.0'
    };

    engine = new ProcessingTransparencyEngine(mockRegistry);
  });

  describe('getProcessingActivities', () => {
    it('should return all processing activities', () => {
      const activities = engine.getProcessingActivities();
      expect(activities).toHaveLength(2);
      expect(activities[0].id).toBe('test_activity');
    });
  });

  describe('hasConsent', () => {
    it('should return false for non-existent user', () => {
      expect(engine.hasConsent('test_activity', 'nonexistent')).toBe(false);
    });

    it('should return false for activity without consent', () => {
      expect(engine.hasConsent('test_activity', 'user123')).toBe(false);
    });

    it('should return true for granted consent', () => {
      engine.updateConsent('test_activity', true, 'user123', '127.0.0.1', 'test-agent');
      expect(engine.hasConsent('test_activity', 'user123')).toBe(true);
    });
  });

  describe('updateConsent', () => {
    it('should update consent for optional activity', () => {
      engine.updateConsent('test_activity', true, 'user123', '127.0.0.1', 'test-agent');
      const consents = engine.getUserConsents('user123');
      expect(consents).toHaveLength(1);
      expect(consents[0].granted).toBe(true);
    });

    it('should throw error for required activity consent withdrawal', () => {
      expect(() => {
        engine.updateConsent('required_activity', false, 'user123', '127.0.0.1', 'test-agent');
      }).toThrow('Cannot withdraw consent for required activity');
    });

    it('should throw error for non-existent activity', () => {
      expect(() => {
        engine.updateConsent('nonexistent', true, 'user123', '127.0.0.1', 'test-agent');
      }).toThrow('Processing activity nonexistent not found');
    });
  });

  describe('canProcessDataType', () => {
    it('should return true for required activity data types', () => {
      expect(engine.canProcessDataType('user_id', 'user123')).toBe(true);
    });

    it('should return false for optional activity without consent', () => {
      expect(engine.canProcessDataType('email', 'user123')).toBe(false);
    });

    it('should return true for optional activity with consent', () => {
      engine.updateConsent('test_activity', true, 'user123', '127.0.0.1', 'test-agent');
      expect(engine.canProcessDataType('email', 'user123')).toBe(true);
    });
  });
});
```

### Integration Tests

**File**: `apps/api-videos/src/endpoints/processing/__tests__/consent.test.ts`

```typescript
import { testClient } from 'hono/testing';
import { app } from '../consent';

describe('Processing Consent API', () => {
  let client: ReturnType<typeof testClient>;

  beforeEach(() => {
    client = testClient(app);
  });

  describe('POST /processing/consent', () => {
    it('should update consent successfully', async () => {
      const response = await client.processing.consent.$post({
        json: {
          activityId: 'test_activity',
          granted: true
        },
        headers: {
          'Authorization': 'Bearer valid-token',
          'X-Forwarded-For': '127.0.0.1',
          'User-Agent': 'test-agent'
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    it('should reject consent withdrawal for required activity', async () => {
      const response = await client.processing.consent.$post({
        json: {
          activityId: 'required_activity',
          granted: false
        },
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });

      expect(response.status).toBe(403);
    });
  });

  describe('GET /processing/consent', () => {
    it('should return user consents', async () => {
      const response = await client.processing.consent.$get({
        headers: {
          'Authorization': 'Bearer valid-token'
        }
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('consents');
      expect(data).toHaveProperty('summary');
    });
  });
});
```

### User Testing

1. **Consent Management Testing**:
   - Test granting and withdrawing consent
   - Verify required activities cannot be disabled
   - Test consent persistence across sessions

2. **Transparency Testing**:
   - Verify all processing activities are clearly described
   - Test data type and purpose explanations
   - Validate retention period information

3. **Real-time Notifications Testing**:
   - Test consent requirement notifications
   - Verify processing activity notifications
   - Test notification dismissal functionality

## Deliverables

### Files to Create
1. `packages/shared-types/src/processing.ts` - Processing activity types
2. `apps/web/src/lib/processing/transparency-engine.ts` - Core transparency engine
3. `apps/web/src/components/processing/processing-dashboard.tsx` - User dashboard
4. `apps/web/src/components/processing/processing-notifications.tsx` - Real-time notifications
5. `apps/api-videos/src/endpoints/processing/registry.ts` - Processing registry API
6. `apps/api-videos/src/endpoints/processing/consent.ts` - Consent management API

### Test Files
1. `apps/web/src/lib/processing/__tests__/transparency-engine.test.ts`
2. `apps/api-videos/src/endpoints/processing/__tests__/consent.test.ts`

### Documentation
1. Processing transparency user guide
2. API documentation for consent endpoints
3. GDPR compliance documentation

## Success Criteria

### Functional Requirements
- ✅ Complete processing activity registry
- ✅ Granular consent management system
- ✅ Real-time processing notifications
- ✅ User-friendly dashboard interface
- ✅ Comprehensive audit logging

### Legal Requirements
- ✅ GDPR Article 6 (Lawfulness of processing) compliance
- ✅ GDPR Article 7 (Conditions for consent) compliance
- ✅ GDPR Article 13 (Information to be provided) compliance
- ✅ GDPR Article 15 (Right of access) compliance
- ✅ GDPR Article 21 (Right to object) compliance

### Technical Requirements
- ✅ TypeScript implementation with full type safety
- ✅ React components with proper state management
- ✅ API endpoints with OpenAPI documentation
- ✅ Comprehensive test coverage (>90%)
- ✅ Performance optimized for real-time updates

### UX Requirements
- ✅ Intuitive consent management interface
- ✅ Clear processing activity descriptions
- ✅ Real-time notification system
- ✅ Mobile-responsive design
- ✅ Accessibility compliance (WCAG 2.1 AA)

## Timeline

### Day 1: Core Infrastructure
- Create processing activity types and interfaces
- Implement transparency engine core functionality
- Set up basic API endpoints

### Day 2: User Interface
- Develop processing dashboard component
- Implement consent management UI
- Create real-time notification system

### Day 3: API Integration
- Complete consent management API
- Implement processing registry API
- Add comprehensive error handling

### Day 4: Testing & Documentation
- Write comprehensive unit and integration tests
- Create user documentation
- Perform security and compliance testing

## Risk Assessment

### High Risk
- **Consent Management Complexity**: Granular consent system may be complex for users
  - **Mitigation**: Provide clear explanations and simplified defaults
- **Real-time Performance**: Real-time notifications may impact performance
  - **Mitigation**: Implement efficient batching and throttling

### Medium Risk
- **API Rate Limiting**: Consent updates may be rate-limited
  - **Mitigation**: Implement client-side batching and retry logic
- **Cross-browser Compatibility**: Notification system may have browser differences
  - **Mitigation**: Comprehensive cross-browser testing

### Low Risk
- **User Interface Complexity**: Dashboard may become cluttered with many activities
  - **Mitigation**: Implement progressive disclosure and search functionality
- **Data Consistency**: Consent states may become inconsistent
  - **Mitigation**: Implement transactional updates and validation

This implementation plan provides a comprehensive transparent consent-based processing system that gives users full control over their data while maintaining GDPR compliance and providing an excellent user experience.