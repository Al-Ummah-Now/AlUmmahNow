# Implementation Plan: Add Security Event Logging and Monitoring

**Story**: 1.2 - Remove Global Event Listener Security Vulnerabilities  
**Task Group**: Add security event logging and monitoring  
**Acceptance Criteria**: AC: 2 - Given suspicious event listeners are detected, when validation runs, then suspicious listeners are blocked and logged

## Overview

This implementation plan covers creating a comprehensive security event logging and monitoring system that captures, processes, and alerts on suspicious event listener activities in real-time.

## Prerequisites

- EventListenerValidator implemented
- WebSocket server accessible for logging
- Security event types defined
- Understanding of real-time monitoring patterns

## Implementation Steps

### Step 1: Implement SecurityEventLogger for Suspicious Activities

**Duration**: 4-6 hours  
**Files to Create**:
- `apps/web/src/lib/security/SecurityEventLogger.ts` - Main logging class
- `apps/web/src/lib/security/EventProcessor.ts` - Event processing
- `apps/web/src/types/security-events.ts` - Security event types

**Actions**:
1. Create security event type definitions:
   ```typescript
   // apps/web/src/types/security-events.ts
   export interface SecurityEvent {
     id: string;
     timestamp: string;
     type: SecurityEventType;
     severity: SecuritySeverity;
     source: EventSource;
     details: SecurityEventDetails;
     metadata: SecurityEventMetadata;
   }
   
   export type SecurityEventType = 
     | 'listener_blocked'
     | 'suspicious_activity'
     | 'validation_failed'
     | 'rate_limit_exceeded'
     | 'origin_violation'
     | 'xss_attempt'
     | 'injection_attempt'
     | 'unauthorized_access'
     | 'privilege_escalation';
   
   export type SecuritySeverity = 'low' | 'medium' | 'high' | 'critical';
   
   export interface EventSource {
     component: string;
     eventType: string;
     target: string;
     origin?: string;
     userAgent?: string;
     ipAddress?: string;
     sessionId?: string;
   }
   
   export interface SecurityEventDetails {
     reason: string;
     listenerCode?: string;
     validationRule?: string;
     blockedValue?: any;
     sanitizedValue?: any;
     stackTrace?: string;
     additionalContext?: Record<string, any>;
   }
   
   export interface SecurityEventMetadata {
     processedAt: string;
     acknowledged: boolean;
     acknowledgedBy?: string;
     acknowledgedAt?: string;
     resolved: boolean;
     resolvedBy?: string;
     resolvedAt?: string;
     falsePositive: boolean;
     tags: string[];
     correlationId?: string;
   }
   
   export interface SecurityEventFilter {
     type?: SecurityEventType[];
     severity?: SecuritySeverity[];
     component?: string[];
     dateRange?: {
       start: string;
       end: string;
     };
     tags?: string[];
     acknowledged?: boolean;
     resolved?: boolean;
   }
   
   export interface SecurityAlert {
     id: string;
     eventId: string;
     alertType: 'immediate' | 'aggregated' | 'trend';
     condition: AlertCondition;
     triggeredAt: string;
     message: string;
     actions: AlertAction[];
   }
   
   export interface AlertCondition {
     field: string;
     operator: 'gt' | 'lt' | 'eq' | 'contains' | 'rate';
     value: any;
     timeWindow?: number; // in minutes
   }
   
   export interface AlertAction {
     type: 'webhook' | 'email' | 'slack' | 'websocket';
     target: string;
     template?: string;
     enabled: boolean;
   }
   ```

2. Create SecurityEventLogger class:
   ```typescript
   // apps/web/src/lib/security/SecurityEventLogger.ts
   import { SecurityEvent, SecurityEventType, SecuritySeverity, SecurityAlert, AlertCondition } from '../../types/security-events';
   
   export class SecurityEventLogger {
     private static instance: SecurityEventLogger;
     private eventQueue: SecurityEvent[] = [];
     private websocket: WebSocket | null = null;
     private isProcessing = false;
     private batchSize = 10;
     private flushInterval = 5000; // 5 seconds
     private reconnectAttempts = 0;
     private maxReconnectAttempts = 5;
     private reconnectDelay = 1000;
     
     private constructor() {
       this.initializeWebSocket();
       this.startBatchProcessor();
     }
     
     static getInstance(): SecurityEventLogger {
       if (!SecurityEventLogger.instance) {
         SecurityEventLogger.instance = new SecurityEventLogger();
       }
       return SecurityEventLogger.instance;
     }
     
     static logEvent(eventData: Partial<SecurityEvent>): void {
       const logger = SecurityEventLogger.getInstance();
       logger.addEvent(eventData);
     }
     
     private addEvent(eventData: Partial<SecurityEvent>): void {
       const event: SecurityEvent = {
         id: this.generateEventId(),
         timestamp: new Date().toISOString(),
         type: eventData.type || 'suspicious_activity',
         severity: eventData.severity || 'medium',
         source: {
           component: eventData.source?.component || 'unknown',
           eventType: eventData.source?.eventType || 'unknown',
           target: eventData.source?.target || 'unknown',
           origin: window.location.origin,
           userAgent: navigator.userAgent,
           sessionId: this.getSessionId()
         },
         details: eventData.details || { reason: 'Unknown' },
         metadata: {
           processedAt: new Date().toISOString(),
           acknowledged: false,
           resolved: false,
           falsePositive: false,
           tags: eventData.metadata?.tags || [],
           correlationId: eventData.metadata?.correlationId
         }
       };
       
       this.eventQueue.push(event);
       
       // Immediately process critical events
       if (event.severity === 'critical') {
         this.flushEvents();
       }
       
       // Log to console for development
       this.logToConsole(event);
     }
     
     private initializeWebSocket(): void {
       try {
         const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'wss://ws.alummahnow.net';
         this.websocket = new WebSocket(`${wsUrl}/security-events`);
         
         this.websocket.onopen = () => {
           console.log('Security event logger connected to WebSocket');
           this.reconnectAttempts = 0;
           this.flushEvents(); // Flush any queued events
         };
         
         this.websocket.onmessage = (event) => {
           this.handleWebSocketMessage(event);
         };
         
         this.websocket.onclose = () => {
           console.warn('Security event logger disconnected from WebSocket');
           this.scheduleReconnect();
         };
         
         this.websocket.onerror = (error) => {
           console.error('Security event logger WebSocket error:', error);
         };
         
       } catch (error) {
         console.error('Failed to initialize security event WebSocket:', error);
         // Fallback to HTTP-based logging
         this.initializeHttpLogging();
       }
     }
     
     private initializeHttpLogging(): void {
       console.warn('Using HTTP fallback for security event logging');
       // Implement HTTP-based logging as fallback
     }
     
     private scheduleReconnect(): void {
       if (this.reconnectAttempts < this.maxReconnectAttempts) {
         this.reconnectAttempts++;
         const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
         
         setTimeout(() => {
           console.log(`Attempting to reconnect security event logger (attempt ${this.reconnectAttempts})`);
           this.initializeWebSocket();
         }, delay);
       } else {
         console.error('Max reconnection attempts reached for security event logger');
       }
     }
     
     private startBatchProcessor(): void {
       setInterval(() => {
         if (this.eventQueue.length > 0) {
           this.flushEvents();
         }
       }, this.flushInterval);
     }
     
     private flushEvents(): void {
       if (this.isProcessing || this.eventQueue.length === 0) {
         return;
       }
       
       this.isProcessing = true;
       
       try {
         const eventsToSend = this.eventQueue.splice(0, this.batchSize);
         
         if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
           this.websocket.send(JSON.stringify({
             type: 'security_events',
             events: eventsToSend,
             timestamp: new Date().toISOString()
           }));
         } else {
           // Fallback to HTTP or local storage
           this.fallbackLogEvents(eventsToSend);
         }
         
         // Check for alert conditions
         this.checkAlertConditions(eventsToSend);
         
       } catch (error) {
         console.error('Error flushing security events:', error);
       } finally {
         this.isProcessing = false;
       }
     }
     
     private fallbackLogEvents(events: SecurityEvent[]): void {
       // Store events in localStorage as fallback
       try {
         const existingEvents = JSON.parse(localStorage.getItem('security_events') || '[]');
         const updatedEvents = [...existingEvents, ...events];
         
         // Keep only last 1000 events to prevent storage overflow
         const trimmedEvents = updatedEvents.slice(-1000);
         
         localStorage.setItem('security_events', JSON.stringify(trimmedEvents));
         
         // Also try to send via HTTP
         this.sendViaHttp(events);
         
       } catch (error) {
         console.error('Failed to store security events in fallback:', error);
       }
     }
     
     private sendViaHttp(events: SecurityEvent[]): void {
       try {
         fetch('/api/security/events', {
           method: 'POST',
           headers: {
             'Content-Type': 'application/json',
           },
           body: JSON.stringify({
             events,
             timestamp: new Date().toISOString()
           })
         }).catch(error => {
           console.error('Failed to send security events via HTTP:', error);
         });
       } catch (error) {
         console.error('Error in HTTP fallback logging:', error);
       }
     }
     
     private handleWebSocketMessage(event: MessageEvent): void {
       try {
         const data = JSON.parse(event.data);
         
         switch (data.type) {
           case 'acknowledgment':
             this.handleEventAcknowledgment(data.eventIds);
             break;
           case 'alert':
             this.handleIncomingAlert(data.alert);
             break;
           case 'config_update':
             this.handleConfigUpdate(data.config);
             break;
           default:
             console.warn('Unknown WebSocket message type:', data.type);
         }
       } catch (error) {
         console.error('Error handling WebSocket message:', error);
       }
     }
     
     private handleEventAcknowledgment(eventIds: string[]): void {
       // Mark events as acknowledged in local storage
       try {
         const events = JSON.parse(localStorage.getItem('security_events') || '[]');
         const updatedEvents = events.map((event: SecurityEvent) => {
           if (eventIds.includes(event.id)) {
             return {
               ...event,
               metadata: {
                 ...event.metadata,
                 acknowledged: true,
                 acknowledgedAt: new Date().toISOString()
               }
             };
           }
           return event;
         });
         
         localStorage.setItem('security_events', JSON.stringify(updatedEvents));
       } catch (error) {
         console.error('Error handling event acknowledgment:', error);
       }
     }
     
     private handleIncomingAlert(alert: SecurityAlert): void {
       // Display alert to user if appropriate
       if (alert.alertType === 'immediate' && alert.severity === 'critical') {
         this.showSecurityAlert(alert);
       }
     }
     
     private handleConfigUpdate(config: any): void {
       // Update logging configuration
       if (config.batchSize) {
         this.batchSize = config.batchSize;
       }
       if (config.flushInterval) {
         this.flushInterval = config.flushInterval;
       }
     }
     
     private checkAlertConditions(events: SecurityEvent[]): void {
       // Check for various alert conditions
       
       // High rate of security events
       const recentEvents = events.filter(e => 
         new Date(e.timestamp).getTime() > Date.now() - 60000 // Last minute
       );
       
       if (recentEvents.length >= 10) {
         this.triggerAlert({
           id: this.generateAlertId(),
           eventId: events[0].id,
           alertType: 'aggregated',
           condition: {
             field: 'event_count',
             operator: 'rate',
             value: 10,
             timeWindow: 1
           },
           triggeredAt: new Date().toISOString(),
           message: `High rate of security events detected: ${recentEvents.length} in the last minute`,
           actions: [{
             type: 'websocket',
             target: 'security_team',
             enabled: true
           }]
         });
       }
       
       // Critical events
       const criticalEvents = events.filter(e => e.severity === 'critical');
       if (criticalEvents.length > 0) {
         criticalEvents.forEach(event => {
           this.triggerAlert({
             id: this.generateAlertId(),
             eventId: event.id,
             alertType: 'immediate',
             condition: {
               field: 'severity',
               operator: 'eq',
               value: 'critical'
             },
             triggeredAt: new Date().toISOString(),
             message: `Critical security event: ${event.details.reason}`,
             actions: [{
               type: 'websocket',
               target: 'security_team',
               enabled: true
             }]
           });
         });
       }
     }
     
     private triggerAlert(alert: SecurityAlert): void {
       // Send alert via WebSocket
       if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
         this.websocket.send(JSON.stringify({
           type: 'security_alert',
           alert,
           timestamp: new Date().toISOString()
         }));
       }
       
       // Also log alert locally
       console.warn('SECURITY ALERT:', alert.message);
     }
     
     private showSecurityAlert(alert: SecurityAlert): void {
       // Create a user-facing security alert
       if (typeof document !== 'undefined') {
         const alertElement = document.createElement('div');
         alertElement.className = 'security-alert';
         alertElement.innerHTML = `
           <div class="security-alert-content">
             <h3>⚠️ Security Alert</h3>
             <p>${alert.message}</p>
             <button onclick="this.parentElement.parentElement.remove()">Dismiss</button>
           </div>
         `;
         
         // Add styles
         alertElement.style.cssText = `
           position: fixed;
           top: 20px;
           right: 20px;
           background: #ff4444;
           color: white;
           padding: 16px;
           border-radius: 8px;
           box-shadow: 0 4px 12px rgba(0,0,0,0.3);
           z-index: 10000;
           max-width: 400px;
         `;
         
         document.body.appendChild(alertElement);
         
         // Auto-remove after 10 seconds
         setTimeout(() => {
           if (alertElement.parentElement) {
             alertElement.remove();
           }
         }, 10000);
       }
     }
     
     private logToConsole(event: SecurityEvent): void {
       const logMethod = event.severity === 'critical' ? 'error' :
                        event.severity === 'high' ? 'error' :
                        event.severity === 'medium' ? 'warn' : 'info';
       
       console[logMethod](`Security Event [${event.type}]:`, {
         id: event.id,
         severity: event.severity,
         component: event.source.component,
         reason: event.details.reason,
         timestamp: event.timestamp
       });
     }
     
     private generateEventId(): string {
       return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
     }
     
     private generateAlertId(): string {
       return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
     }
     
     private getSessionId(): string {
       // Generate or retrieve session ID
       let sessionId = sessionStorage.getItem('security_session_id');
       if (!sessionId) {
         sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
         sessionStorage.setItem('security_session_id', sessionId);
       }
       return sessionId;
     }
     
     // Public API methods
     getQueuedEvents(): SecurityEvent[] {
       return [...this.eventQueue];
     }
     
     clearQueuedEvents(): void {
       this.eventQueue = [];
     }
     
     getConnectionStatus(): 'connected' | 'disconnected' | 'connecting' {
       if (!this.websocket) return 'disconnected';
       
       switch (this.websocket.readyState) {
         case WebSocket.OPEN: return 'connected';
         case WebSocket.CONNECTING: return 'connecting';
         default: return 'disconnected';
       }
     }
     
     // Cleanup method
     destroy(): void {
       if (this.websocket) {
         this.websocket.close();
         this.websocket = null;
       }
       
       this.eventQueue = [];
       this.isProcessing = false;
     }
   }
   ```

### Step 2: Create Logging Integration with WebSocket Server

**Duration**: 3-4 hours  
**Files to Create**:
- `apps/websocket-server/src/security-events.ts` - WebSocket server security events handler
- `apps/websocket-server/src/SecurityEventProcessor.ts` - Event processing on server
- `apps/api-videos/src/endpoints/security/events.ts` - HTTP API endpoint

**Actions**:
1. Create WebSocket server security events handler:
   ```typescript
   // apps/websocket-server/src/security-events.ts
   import { DurableObject } from 'cloudflare-workers';
   import { SecurityEvent, SecurityAlert } from '../../../apps/web/src/types/security-events';
   
   export interface SecurityEventEnv {
     SECURITY_EVENTS_DO: DurableObjectNamespace;
     SECURITY_ALERTS_DO: DurableObjectNamespace;
     KV: KVNamespace;
   }
   
   export class SecurityEventsHandler {
     private env: SecurityEventEnv;
     private connections: Map<string, WebSocket> = new Map();
     private subscriptions: Map<string, Set<string>> = new Map();
     
     constructor(env: SecurityEventEnv) {
       this.env = env;
     }
     
     async handleConnection(ws: WebSocket, requestId: string): Promise<void> {
       this.connections.set(requestId, ws);
       
       ws.addEventListener('message', async (event) => {
         try {
           const data = JSON.parse(event.data as string);
           await this.handleMessage(requestId, data);
         } catch (error) {
           console.error('Error handling security event message:', error);
           ws.send(JSON.stringify({
             type: 'error',
             message: 'Invalid message format'
           }));
         }
       });
       
       ws.addEventListener('close', () => {
         this.connections.delete(requestId);
         this.cleanupSubscriptions(requestId);
       });
       
       // Send initial configuration
       ws.send(JSON.stringify({
         type: 'config_update',
         config: {
           batchSize: 10,
           flushInterval: 5000
         }
       }));
     }
     
     private async handleMessage(connectionId: string, data: any): Promise<void> {
       switch (data.type) {
         case 'security_events':
           await this.processSecurityEvents(data.events);
           break;
         case 'security_alert':
           await this.processSecurityAlert(data.alert);
           break;
         case 'subscribe':
           await this.handleSubscription(connectionId, data.channel);
           break;
         case 'unsubscribe':
           await this.handleUnsubscription(connectionId, data.channel);
           break;
         default:
           console.warn('Unknown message type:', data.type);
       }
     }
     
     private async processSecurityEvents(events: SecurityEvent[]): Promise<void> {
       const securityEventsDO = this.env.SECURITY_EVENTS_DO.idFromName('events');
       const stub = this.env.SECURITY_EVENTS_DO.get(securityEventsDO);
       
       // Store events
       await stub.fetch('https://security-events.internal/store', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ events })
       });
       
       // Check for alert conditions
       await this.checkAlertConditions(events);
       
       // Broadcast to subscribers
       this.broadcastToSubscribers('security_events', {
         type: 'events_received',
         count: events.length,
         timestamp: new Date().toISOString()
       });
     }
     
     private async processSecurityAlert(alert: SecurityAlert): Promise<void> {
       const securityAlertsDO = this.env.SECURITY_ALERTS_DO.idFromName('alerts');
       const stub = this.env.SECURITY_ALERTS_DO.get(securityAlertsDO);
       
       // Store alert
       await stub.fetch('https://security-alerts.internal/store', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ alert })
       });
       
       // Send immediate notifications
       await this.sendAlertNotifications(alert);
       
       // Broadcast to subscribers
       this.broadcastToSubscribers('security_alerts', {
         type: 'alert_triggered',
         alert,
         timestamp: new Date().toISOString()
       });
     }
     
     private async checkAlertConditions(events: SecurityEvent[]): Promise<void> {
       // Implement various alert conditions
       
       // High rate of blocked listeners
       const blockedListeners = events.filter(e => e.type === 'listener_blocked');
       if (blockedListeners.length >= 5) {
         await this.triggerRateLimitAlert(blockedListeners);
       }
       
       // Critical security events
       const criticalEvents = events.filter(e => e.severity === 'critical');
       for (const event of criticalEvents) {
         await this.triggerCriticalEventAlert(event);
       }
       
       // Repeated violations from same component
       const violationsByComponent = events.reduce((groups, event) => {
         const component = event.source.component;
         if (!groups[component]) groups[component] = [];
         groups[component].push(event);
         return groups;
       }, {} as Record<string, SecurityEvent[]>);
       
       for (const [component, componentEvents] of Object.entries(violationsByComponent)) {
         if (componentEvents.length >= 3) {
           await this.triggerComponentAlert(component, componentEvents);
         }
       }
     }
     
     private async triggerRateLimitAlert(events: SecurityEvent[]): Promise<void> {
       const alert: SecurityAlert = {
         id: `rate_${Date.now()}`,
         eventId: events[0].id,
         alertType: 'aggregated',
         condition: {
           field: 'blocked_listeners',
           operator: 'rate',
           value: 5,
           timeWindow: 1
         },
         triggeredAt: new Date().toISOString(),
         message: `High rate of blocked event listeners: ${events.length} in recent period`,
         actions: [
           {
             type: 'webhook',
             target: process.env.SECURITY_WEBHOOK_URL || '',
             enabled: true
           },
           {
             type: 'slack',
             target: process.env.SECURITY_SLACK_WEBHOOK || '',
             enabled: true
           }
         ]
       };
       
       await this.processSecurityAlert(alert);
     }
     
     private async triggerCriticalEventAlert(event: SecurityEvent): Promise<void> {
       const alert: SecurityAlert = {
         id: `critical_${event.id}`,
         eventId: event.id,
         alertType: 'immediate',
         condition: {
           field: 'severity',
           operator: 'eq',
           value: 'critical'
         },
         triggeredAt: new Date().toISOString(),
         message: `Critical security event: ${event.details.reason}`,
         actions: [
           {
             type: 'email',
             target: process.env.SECURITY_EMAIL || '',
             enabled: true
           },
           {
             type: 'slack',
             target: process.env.SECURITY_SLACK_WEBHOOK || '',
             enabled: true
           }
         ]
       };
       
       await this.processSecurityAlert(alert);
     }
     
     private async triggerComponentAlert(component: string, events: SecurityEvent[]): Promise<void> {
       const alert: SecurityAlert = {
         id: `component_${component}_${Date.now()}`,
         eventId: events[0].id,
         alertType: 'aggregated',
         condition: {
           field: 'component_violations',
           operator: 'gte',
           value: 3
         },
         triggeredAt: new Date().toISOString(),
         message: `Multiple security violations from component: ${component}`,
         actions: [
           {
             type: 'webhook',
             target: process.env.SECURITY_WEBHOOK_URL || '',
             enabled: true
           }
         ]
       };
       
       await this.processSecurityAlert(alert);
     }
     
     private async sendAlertNotifications(alert: SecurityAlert): Promise<void> {
       for (const action of alert.actions) {
         if (!action.enabled) continue;
         
         try {
           switch (action.type) {
             case 'webhook':
               await this.sendWebhookNotification(alert, action.target);
               break;
             case 'email':
               await this.sendEmailNotification(alert, action.target);
               break;
             case 'slack':
               await this.sendSlackNotification(alert, action.target);
               break;
           }
         } catch (error) {
           console.error(`Failed to send ${action.type} notification:`, error);
         }
       }
     }
     
     private async sendWebhookNotification(alert: SecurityAlert, url: string): Promise<void> {
       if (!url) return;
       
       await fetch(url, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           alert,
           timestamp: new Date().toISOString(),
           service: 'video-player-security'
         })
       });
     }
     
     private async sendEmailNotification(alert: SecurityAlert, email: string): Promise<void> {
       if (!email) return;
       
       // Implementation would depend on email service
       console.log(`Email alert sent to ${email}: ${alert.message}`);
     }
     
     private async sendSlackNotification(alert: SecurityAlert, webhookUrl: string): Promise<void> {
       if (!webhookUrl) return;
       
       await fetch(webhookUrl, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({
           text: `🚨 Security Alert: ${alert.message}`,
           attachments: [{
             color: alert.severity === 'critical' ? 'danger' : 'warning',
             fields: [
               { title: 'Alert ID', value: alert.id, short: true },
               { title: 'Severity', value: alert.severity, short: true },
               { title: 'Time', value: alert.triggeredAt, short: true }
             ]
           }]
         })
       });
     }
     
     private async handleSubscription(connectionId: string, channel: string): Promise<void> {
       if (!this.subscriptions.has(channel)) {
         this.subscriptions.set(channel, new Set());
       }
       this.subscriptions.get(channel)!.add(connectionId);
     }
     
     private async handleUnsubscription(connectionId: string, channel: string): Promise<void> {
       const channelSubscriptions = this.subscriptions.get(channel);
       if (channelSubscriptions) {
         channelSubscriptions.delete(connectionId);
         if (channelSubscriptions.size === 0) {
           this.subscriptions.delete(channel);
         }
       }
     }
     
     private cleanupSubscriptions(connectionId: string): void {
       for (const [channel, subscribers] of this.subscriptions) {
         subscribers.delete(connectionId);
         if (subscribers.size === 0) {
           this.subscriptions.delete(channel);
         }
       }
     }
     
     private broadcastToSubscribers(channel: string, message: any): void {
       const subscribers = this.subscriptions.get(channel);
       if (!subscribers) return;
       
       const messageStr = JSON.stringify(message);
       
       for (const connectionId of subscribers) {
         const ws = this.connections.get(connectionId);
         if (ws && ws.readyState === WebSocket.OPEN) {
           try {
             ws.send(messageStr);
           } catch (error) {
             console.error(`Failed to send message to connection ${connectionId}:`, error);
           }
         }
       }
     }
   }
   ```

### Step 3: Add Real-Time Security Event Monitoring

**Duration**: 3-4 hours  
**Files to Create**:
- `apps/web/src/components/security/SecurityMonitor.tsx` - Real-time monitor UI
- `apps/web/src/lib/security/SecurityDashboard.ts` - Dashboard logic
- `apps/web/src/hooks/useSecurityEvents.ts` - React hook for security events

**Actions**:
1. Create React hook for security events:
   ```typescript
   // apps/web/src/hooks/useSecurityEvents.ts
   import { useState, useEffect, useCallback } from 'react';
   import { SecurityEvent, SecurityEventFilter } from '../types/security-events';
   import { SecurityEventLogger } from '../lib/security/SecurityEventLogger';
   
   export interface UseSecurityEventsOptions {
     autoRefresh?: boolean;
     refreshInterval?: number;
     filter?: SecurityEventFilter;
   }
   
   export interface SecurityEventsState {
     events: SecurityEvent[];
     loading: boolean;
     error: string | null;
     connectionStatus: 'connected' | 'disconnected' | 'connecting';
     stats: {
       total: number;
       critical: number;
       high: number;
       medium: number;
       low: number;
       lastHour: number;
       lastDay: number;
     };
   }
   
   export const useSecurityEvents = (options: UseSecurityEventsOptions = {}): SecurityEventsState & {
     refresh: () => void;
     acknowledgeEvent: (eventId: string) => void;
     resolveEvent: (eventId: string) => void;
     markFalsePositive: (eventId: string) => void;
   } => {
     const [events, setEvents] = useState<SecurityEvent[]>([]);
     const [loading, setLoading] = useState(false);
     const [error, setError] = useState<string | null>(null);
     const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'connecting'>('connecting');
     
     const { autoRefresh = true, refreshInterval = 30000, filter } = options;
     
     const calculateStats = useCallback((eventList: SecurityEvent[]) => {
       const now = Date.now();
       const oneHourAgo = now - 60 * 60 * 1000;
       const oneDayAgo = now - 24 * 60 * 60 * 1000;
       
       return {
         total: eventList.length,
         critical: eventList.filter(e => e.severity === 'critical').length,
         high: eventList.filter(e => e.severity === 'high').length,
         medium: eventList.filter(e => e.severity === 'medium').length,
         low: eventList.filter(e => e.severity === 'low').length,
         lastHour: eventList.filter(e => new Date(e.timestamp).getTime() > oneHourAgo).length,
         lastDay: eventList.filter(e => new Date(e.timestamp).getTime() > oneDayAgo).length
       };
     }, []);
     
     const filterEvents = useCallback((eventList: SecurityEvent[], filterCriteria?: SecurityEventFilter) => {
       if (!filterCriteria) return eventList;
       
       return eventList.filter(event => {
         // Filter by type
         if (filterCriteria.type && !filterCriteria.type.includes(event.type)) {
           return false;
         }
         
         // Filter by severity
         if (filterCriteria.severity && !filterCriteria.severity.includes(event.severity)) {
           return false;
         }
         
         // Filter by component
         if (filterCriteria.component && !filterCriteria.component.includes(event.source.component)) {
           return false;
         }
         
         // Filter by date range
         if (filterCriteria.dateRange) {
           const eventTime = new Date(event.timestamp).getTime();
           const startTime = new Date(filterCriteria.dateRange.start).getTime();
           const endTime = new Date(filterCriteria.dateRange.end).getTime();
           
           if (eventTime < startTime || eventTime > endTime) {
             return false;
           }
         }
         
         // Filter by tags
         if (filterCriteria.tags && filterCriteria.tags.length > 0) {
           const hasTag = filterCriteria.tags.some(tag => 
             event.metadata.tags.includes(tag)
           );
           if (!hasTag) return false;
         }
         
         // Filter by acknowledgment status
         if (filterCriteria.acknowledged !== undefined && 
             event.metadata.acknowledged !== filterCriteria.acknowledged) {
           return false;
         }
         
         // Filter by resolution status
         if (filterCriteria.resolved !== undefined && 
             event.metadata.resolved !== filterCriteria.resolved) {
           return false;
         }
         
         return true;
       });
     }, []);
     
     const refresh = useCallback(async () => {
       setLoading(true);
       setError(null);
       
       try {
         // Fetch events from API or WebSocket
         const response = await fetch('/api/security/events');
         
         if (!response.ok) {
           throw new Error(`HTTP ${response.status}: ${response.statusText}`);
         }
         
         const data = await response.json();
         const filteredEvents = filterEvents(data.events, filter);
         
         setEvents(filteredEvents);
       } catch (err) {
         setError(err instanceof Error ? err.message : 'Unknown error');
       } finally {
         setLoading(false);
       }
     }, [filter, filterEvents]);
     
     const acknowledgeEvent = useCallback(async (eventId: string) => {
       try {
         await fetch(`/api/security/events/${eventId}/acknowledge`, {
           method: 'POST'
         });
         
         setEvents(prevEvents => 
           prevEvents.map(event => 
             event.id === eventId 
               ? {
                   ...event,
                   metadata: {
                     ...event.metadata,
                     acknowledged: true,
                     acknowledgedAt: new Date().toISOString(),
                     acknowledgedBy: 'current_user' // Would get from auth context
                   }
                 }
               : event
           )
         );
       } catch (error) {
         setError('Failed to acknowledge event');
       }
     }, []);
     
     const resolveEvent = useCallback(async (eventId: string) => {
       try {
         await fetch(`/api/security/events/${eventId}/resolve`, {
           method: 'POST'
         });
         
         setEvents(prevEvents => 
           prevEvents.map(event => 
             event.id === eventId 
               ? {
                   ...event,
                   metadata: {
                     ...event.metadata,
                     resolved: true,
                     resolvedAt: new Date().toISOString(),
                     resolvedBy: 'current_user'
                   }
                 }
               : event
           )
         );
       } catch (error) {
         setError('Failed to resolve event');
       }
     }, []);
     
     const markFalsePositive = useCallback(async (eventId: string) => {
       try {
         await fetch(`/api/security/events/${eventId}/false-positive`, {
           method: 'POST'
         });
         
         setEvents(prevEvents => 
           prevEvents.map(event => 
             event.id === eventId 
               ? {
                   ...event,
                   metadata: {
                     ...event.metadata,
                     falsePositive: true,
                     resolved: true,
                     resolvedAt: new Date().toISOString(),
                     resolvedBy: 'current_user'
                   }
                 }
               : event
           )
         );
       } catch (error) {
         setError('Failed to mark event as false positive');
       }
     }, []);
     
     // Monitor connection status
     useEffect(() => {
       const logger = SecurityEventLogger.getInstance();
       
       const checkConnection = () => {
         setConnectionStatus(logger.getConnectionStatus());
       };
       
       const interval = setInterval(checkConnection, 5000);
       checkConnection(); // Initial check
       
       return () => clearInterval(interval);
     }, []);
     
     // Auto-refresh
     useEffect(() => {
       if (!autoRefresh) return;
       
       const interval = setInterval(refresh, refreshInterval);
       return () => clearInterval(interval);
     }, [autoRefresh, refreshInterval, refresh]);
     
     // Initial load
     useEffect(() => {
       refresh();
     }, [refresh]);
     
     const stats = calculateStats(events);
     
     return {
       events,
       loading,
       error,
       connectionStatus,
       stats,
       refresh,
       acknowledgeEvent,
       resolveEvent,
       markFalsePositive
     };
   };
   ```

## Testing Strategy

### Unit Testing
- Test SecurityEventLogger with various event types
- Test WebSocket connection and reconnection logic
- Test event batching and flushing
- Test alert condition checking

### Integration Testing
- Test end-to-end event flow from client to server
- Test real-time monitoring dashboard
- Test alert notifications
- Test fallback mechanisms

### Performance Testing
- Test with high volume of security events
- Test WebSocket connection under load
- Test memory usage and cleanup
- Test impact on video player performance

## Deliverables

1. **SecurityEventLogger Class** (`apps/web/src/lib/security/SecurityEventLogger.ts`)
2. **Security Event Types** (`apps/web/src/types/security-events.ts`)
3. **WebSocket Server Handler** (`apps/websocket-server/src/security-events.ts`)
4. **React Hook** (`apps/web/src/hooks/useSecurityEvents.ts`)
5. **Security Monitor UI** (`apps/web/src/components/security/SecurityMonitor.tsx`)
6. **API Endpoints** (`apps/api-videos/src/endpoints/security/events.ts`)
7. **Test Suites** (Multiple test files for client and server)

## Success Criteria

- ✅ All security events are logged and transmitted
- ✅ Real-time monitoring dashboard displays events
- ✅ Alert conditions trigger notifications
- ✅ WebSocket connection handles failures gracefully
- ✅ Fallback mechanisms work when WebSocket unavailable
- ✅ Performance impact is minimal (<2% overhead)

## Estimated Timeline

**Total Duration**: 10-14 hours  
**Dependencies**: EventListenerValidator implemented  
**Risks**: Medium - WebSocket connectivity and scaling considerations

## Next Steps

After implementing security event logging:
1. Proceed to "Implement input sanitization for event data" task
2. Test real-time monitoring with simulated security events
3. Configure alert notifications for production
4. Document monitoring procedures for security team