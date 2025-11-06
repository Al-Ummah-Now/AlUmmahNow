# Implementation Plan: Implement Event Listener Validation Middleware

**Story**: 1.2 - Remove Global Event Listener Security Vulnerabilities  
**Task Group**: Implement event listener validation middleware  
**Acceptance Criteria**: AC: 1, 2 - Given video player is initialized, when scripts attempt to add global event listeners, then only authorized listeners are permitted; Given suspicious event listeners are detected, when validation runs, then suspicious listeners are blocked and logged

## Overview

This implementation plan covers creating a comprehensive event listener validation middleware that intercepts and validates all event listener registrations, ensuring only authorized listeners are permitted and suspicious activities are blocked and logged.

## Prerequisites

- Event listener audit completed with identified vulnerabilities
- Allowlist of authorized event listeners created
- Understanding of JavaScript event system and security patterns
- WebSocket server integration for real-time logging

## Implementation Steps

### Step 1: Create EventListenerValidator Utility Class

**Duration**: 5-7 hours  
**Files to Create**:
- `apps/web/src/lib/security/EventListenerValidator.ts` - Main validation class
- `apps/web/src/lib/security/EventValidationConfig.ts` - Configuration
- `apps/web/src/types/security.ts` - Security type definitions

**Actions**:
1. Create security type definitions:
   ```typescript
   // apps/web/src/types/security.ts
   export interface EventValidationRule {
     eventType: string;
     target: string | RegExp;
     component?: string;
     requireValidation: boolean;
     requireSanitization: boolean;
     maxListeners?: number;
     allowedOrigins?: string[];
     blockedOrigins?: string[];
     customValidator?: (event: Event, listener: Function) => boolean;
   }
   
   export interface EventValidationResult {
     isValid: boolean;
     reason?: string;
     riskLevel: 'low' | 'medium' | 'high' | 'critical';
     recommendations: string[];
     sanitizedData?: any;
   }
   
   export interface SecurityEvent {
     id: string;
     timestamp: string;
     type: 'listener_blocked' | 'suspicious_activity' | 'validation_failed';
     severity: 'low' | 'medium' | 'high' | 'critical';
     eventType: string;
     target: string;
     component?: string;
     reason: string;
     details: any;
     userAgent?: string;
     ipAddress?: string;
   }
   
   export interface EventListenerConfig {
     enabled: boolean;
     logLevel: 'debug' | 'info' | 'warn' | 'error';
     blockUnauthorized: boolean;
     allowGlobalListeners: boolean;
     maxGlobalListeners: number;
     validationRules: EventValidationRule[];
     excludedComponents: string[];
   }
   ```

2. Create EventListenerValidator class:
   ```typescript
   // apps/web/src/lib/security/EventListenerValidator.ts
   import { EventValidationRule, EventValidationResult, SecurityEvent, EventListenerConfig } from '../../types/security';
   import { SecurityEventLogger } from './SecurityEventLogger';
   
   export class EventListenerValidator {
     private static instance: EventListenerValidator;
     private config: EventListenerConfig;
     private originalAddEventListener: typeof EventTarget.prototype.addEventListener;
     private originalRemoveEventListener: typeof EventTarget.prototype.removeEventListener;
     private listenerRegistry: Map<string, Array<{ listener: Function; options?: EventListenerOptions; addedAt: number }>> = new Map();
     private securityEvents: SecurityEvent[] = [];
     
     private constructor() {
       this.config = this.loadConfig();
       this.initializeValidation();
     }
     
     static getInstance(): EventListenerValidator {
       if (!EventListenerValidator.instance) {
         EventListenerValidator.instance = new EventListenerValidator();
       }
       return EventListenerValidator.instance;
     }
     
     private loadConfig(): EventListenerConfig {
       return {
         enabled: process.env.NODE_ENV !== 'test',
         logLevel: 'warn',
         blockUnauthorized: true,
         allowGlobalListeners: false,
         maxGlobalListeners: 10,
         validationRules: [
           // Authorized video player events
           {
             eventType: 'keydown',
             target: /video-player|document/,
             component: 'KeyboardShortcuts',
             requireValidation: true,
             requireSanitization: true,
             maxListeners: 1
           },
           {
             eventType: 'keyup',
             target: /video-player|document/,
             component: 'KeyboardShortcuts',
             requireValidation: true,
             requireSanitization: true,
             maxListeners: 1
           },
           {
             eventType: 'click',
             target: /video-player|progress-bar|volume-control/,
             requireValidation: false,
             requireSanitization: false
           },
           {
             eventType: 'touchstart',
             target: /video-player/,
             component: 'MobileTouch',
             requireValidation: true,
             requireSanitization: true
           },
           {
             eventType: 'touchend',
             target: /video-player/,
             component: 'MobileTouch',
             requireValidation: true,
             requireSanitization: true
           },
           {
             eventType: 'touchmove',
             target: /video-player/,
             component: 'MobileTouch',
             requireValidation: true,
             requireSanitization: true
           },
           {
             eventType: 'input',
             target: /volume-slider|quality-selector/,
             requireValidation: true,
             requireSanitization: true
           },
           {
             eventType: 'change',
             target: /volume-slider|quality-selector/,
             requireValidation: true,
             requireSanitization: true
           },
           {
             eventType: 'resize',
             target: 'window',
             component: 'VideoPlayer',
             requireValidation: false,
             requireSanitization: false,
             maxListeners: 1
           },
           {
             eventType: 'fullscreenchange',
             target: 'document',
             component: 'VideoPlayer',
             requireValidation: false,
             requireSanitization: false,
             maxListeners: 1
           },
           {
             eventType: 'visibilitychange',
             target: 'document',
             component: 'VideoPlayer',
             requireValidation: false,
             requireSanitization: false,
             maxListeners: 1
           },
           // Restricted events requiring special validation
           {
             eventType: 'message',
             target: 'window',
             requireValidation: true,
             requireSanitization: true,
             allowedOrigins: [window.location.origin],
             customValidator: this.validateMessageEvent
           },
           {
             eventType: 'error',
             target: 'window',
             requireValidation: true,
             requireSanitization: true,
             customValidator: this.validateErrorEvent
           },
           {
             eventType: 'unhandledrejection',
             target: 'window',
             requireValidation: true,
             requireSanitization: true,
             customValidator: this.validateUnhandledRejection
           },
           // Blocked events
           {
             eventType: 'storage',
             target: 'window',
             requireValidation: true,
             requireSanitization: true,
             customValidator: () => false // Always block storage events
           },
           {
             eventType: 'hashchange',
             target: 'window',
             requireValidation: true,
             requireSanitization: true,
             customValidator: () => false // Block hashchange events
           },
           {
             eventType: 'popstate',
             target: 'window',
             requireValidation: true,
             requireSanitization: true,
             customValidator: () => false // Block popstate events
           }
         ],
         excludedComponents: ['ThirdPartyAnalytics', 'ExternalWidget']
       };
     }
     
     private initializeValidation(): void {
       if (!this.config.enabled) {
         return;
       }
       
       // Store original methods
       this.originalAddEventListener = EventTarget.prototype.addEventListener;
       this.originalRemoveEventListener = EventTarget.prototype.removeEventListener;
       
       // Override addEventListener
       EventTarget.prototype.addEventListener = (
         type: string,
         listener: Function,
         options?: EventListenerOptions | boolean
       ): void => {
         this.interceptAddEventListener(this, type, listener, options);
       };
       
       // Override removeEventListener
       EventTarget.prototype.removeEventListener = (
         type: string,
         listener: Function,
         options?: EventListenerOptions | boolean
       ): void => {
         this.interceptRemoveEventListener(this, type, listener, options);
       };
     }
     
     private interceptAddEventListener(
       validator: EventListenerValidator,
       type: string,
       listener: Function,
       options?: EventListenerOptions | boolean
     ): void {
       const target = this.determineTarget(this);
       const targetKey = this.getTargetKey(target, type);
       
       // Validate the event listener
       const validation = validator.validateEventListener(type, target, listener, options);
       
       if (!validation.isValid) {
         // Block the listener and log the security event
         validator.logSecurityEvent({
           id: this.generateEventId(),
           timestamp: new Date().toISOString(),
           type: 'listener_blocked',
           severity: validation.riskLevel,
           eventType: type,
           target: targetKey,
           reason: validation.reason || 'Unauthorized event listener',
           details: {
             validation,
             listenerString: listener.toString(),
             options
           }
         });
         
         if (validator.config.blockUnauthorized) {
           throw new Error(`Event listener validation failed: ${validation.reason}`);
         }
       }
       
       // Register the listener
       if (!validator.listenerRegistry.has(targetKey)) {
         validator.listenerRegistry.set(targetKey, []);
       }
       
       validator.listenerRegistry.get(targetKey)!.push({
         listener,
         options: typeof options === 'boolean' ? { capture: options } : options,
         addedAt: Date.now()
       });
       
       // Call the original addEventListener
       return validator.originalAddEventListener.call(this, type, listener, options);
     }
     
     private interceptRemoveEventListener(
       validator: EventListenerValidator,
       type: string,
       listener: Function,
       options?: EventListenerOptions | boolean
     ): void {
       const target = this.determineTarget(this);
       const targetKey = this.getTargetKey(target, type);
       
       // Remove from registry
       const listeners = validator.listenerRegistry.get(targetKey);
       if (listeners) {
         const index = listeners.findIndex(l => l.listener === listener);
         if (index !== -1) {
           listeners.splice(index, 1);
         }
       }
       
       // Call the original removeEventListener
       return validator.originalRemoveEventListener.call(this, type, listener, options);
     }
     
     private determineTarget(context: any): string {
       if (context === window) return 'window';
       if (context === document) return 'document';
       
       // Check if it's a video player element
       if (context.closest && context.closest('[data-component="video-player"]')) {
         return 'video-player';
       }
       
       // Check for specific video player components
       const element = context as Element;
       if (element) {
         if (element.closest('.progress-bar')) return 'progress-bar';
         if (element.closest('.volume-control')) return 'volume-control';
         if (element.closest('.video-controls')) return 'video-controls';
         if (element.matches('[data-component]')) {
           return element.getAttribute('data-component') || 'unknown';
         }
       }
       
       return 'unknown';
     }
     
     private getTargetKey(target: string, type: string): string {
       return `${target}:${type}`;
     }
     
     validateEventListener(
       type: string,
       target: string,
       listener: Function,
       options?: EventListenerOptions | boolean
     ): EventValidationResult {
       // Check if this is a global listener
       const isGlobal = target === 'window' || target === 'document';
       
       if (isGlobal && !this.config.allowGlobalListeners) {
         return {
           isValid: false,
           reason: 'Global event listeners are not allowed',
           riskLevel: 'high',
           recommendations: ['Use event delegation to specific elements', 'Scope listeners to video player component']
         };
       }
       
       // Find matching validation rule
       const rule = this.findValidationRule(type, target);
       
       if (!rule) {
         return {
           isValid: false,
           reason: `No validation rule found for ${type} event on ${target}`,
           riskLevel: 'medium',
           recommendations: ['Add validation rule for this event type', 'Verify if this event listener is necessary']
         };
       }
       
       // Check max listeners limit
       if (rule.maxListeners) {
         const targetKey = this.getTargetKey(target, type);
         const currentListeners = this.listenerRegistry.get(targetKey)?.length || 0;
         
         if (currentListeners >= rule.maxListeners) {
           return {
             isValid: false,
             reason: `Maximum number of listeners (${rule.maxListeners}) exceeded for ${type} on ${target}`,
             riskLevel: 'medium',
             recommendations: ['Remove unused listeners', 'Use event delegation instead of multiple listeners']
           };
         }
       }
       
       // Run custom validator if present
       if (rule.customValidator) {
         try {
           const isValid = rule.customValidator({ type, target } as Event, listener);
           if (!isValid) {
             return {
               isValid: false,
               reason: `Custom validation failed for ${type} event`,
               riskLevel: 'high',
               recommendations: ['Check custom validator logic', 'Verify event data format']
             };
           }
         } catch (error) {
           return {
             isValid: false,
             reason: `Custom validator error: ${error}`,
             riskLevel: 'high',
             recommendations: ['Fix custom validator implementation', 'Add error handling']
           };
         }
       }
       
       // Validate listener function
       if (rule.requireValidation) {
         const listenerValidation = this.validateListenerFunction(listener);
         if (!listenerValidation.isValid) {
           return listenerValidation;
         }
       }
       
       return {
         isValid: true,
         riskLevel: 'low',
         recommendations: []
       };
     }
     
     private findValidationRule(eventType: string, target: string): EventValidationRule | null {
       return this.config.validationRules.find(rule => {
         if (rule.eventType !== eventType) return false;
         
         if (typeof rule.target === 'string') {
           return rule.target === target;
         } else if (rule.target instanceof RegExp) {
           return rule.target.test(target);
         }
         
         return false;
       }) || null;
     }
     
     private validateListenerFunction(listener: Function): EventValidationResult {
       const listenerString = listener.toString();
       
       // Check for dangerous patterns
       const dangerousPatterns = [
         { pattern: /eval\s*\(/, risk: 'critical', desc: 'eval() usage detected' },
         { pattern: /Function\s*\(/, risk: 'critical', desc: 'Function constructor usage detected' },
         { pattern: /document\.write\s*\(/, risk: 'high', desc: 'document.write() usage detected' },
         { pattern: /innerHTML\s*=/, risk: 'high', desc: 'innerHTML assignment detected' },
         { pattern: /outerHTML\s*=/, risk: 'high', desc: 'outerHTML assignment detected' },
         { pattern: /setTimeout\s*\(/, risk: 'medium', desc: 'setTimeout() usage detected' },
         { pattern: /setInterval\s*\(/, risk: 'medium', desc: 'setInterval() usage detected' }
       ];
       
       for (const { pattern, risk, desc } of dangerousPatterns) {
         if (pattern.test(listenerString)) {
           return {
             isValid: false,
             reason: desc,
             riskLevel: risk as any,
             recommendations: [
               'Use safer alternatives (textContent, createElement, etc.)',
               'Implement proper input sanitization',
               'Use event delegation instead of dynamic code execution'
             ]
           };
         }
       }
       
       return {
         isValid: true,
         riskLevel: 'low',
         recommendations: []
       };
     }
     
     private static validateMessageEvent(event: MessageEvent): boolean {
       // Validate message origin
       if (event.origin !== window.location.origin) {
         return false;
       }
       
       // Validate message data
       if (typeof event.data !== 'object' || event.data === null) {
         return false;
       }
       
       // Check for suspicious properties
       const suspiciousProps = ['script', 'javascript:', 'eval', 'function'];
       const dataString = JSON.stringify(event.data);
       
       return !suspiciousProps.some(prop => dataString.includes(prop));
     }
     
     private static validateErrorEvent(event: ErrorEvent): boolean {
       // Filter out sensitive error information
       if (event.error && event.error.stack) {
         // Remove file paths and line numbers from stack traces
         event.error.stack = event.error.stack.replace(/\/[^:]+:\d+:\d+/g, '[filtered]');
       }
       
       return true;
     }
     
     private static validateUnhandledRejection(event: PromiseRejectionEvent): boolean {
       // Validate rejection reason
       if (event.reason && typeof event.reason === 'object') {
         // Sanitize object to prevent data leakage
         try {
           event.reason = JSON.parse(JSON.stringify(event.reason, (key, value) => {
             // Filter out sensitive keys
             if (typeof key === 'string' && key.toLowerCase().includes('password')) {
               return '[FILTERED]';
             }
             return value;
           });
         } catch {
           // If sanitization fails, block the event
           return false;
         }
       }
       
       return true;
     }
     
     private logSecurityEvent(event: SecurityEvent): void {
       this.securityEvents.push(event);
       
       // Log to console
       const logMethod = this.config.logLevel === 'debug' ? 'debug' :
                       this.config.logLevel === 'info' ? 'info' :
                       this.config.logLevel === 'warn' ? 'warn' : 'error';
       
       console[logMethod]('Security Event:', event);
       
       // Send to security event logger
       SecurityEventLogger.logEvent(event);
     }
     
     private generateEventId(): string {
       return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
     }
     
     // Public API methods
     getSecurityEvents(): SecurityEvent[] {
       return [...this.securityEvents];
     }
     
     getListenerRegistry(): Map<string, Array<{ listener: Function; options?: EventListenerOptions; addedAt: number }>> {
       return new Map(this.listenerRegistry);
     }
     
     updateConfig(newConfig: Partial<EventListenerConfig>): void {
       this.config = { ...this.config, ...newConfig };
     }
     
     // Cleanup method for testing
     destroy(): void {
       EventTarget.prototype.addEventListener = this.originalAddEventListener;
       EventTarget.prototype.removeEventListener = this.originalRemoveEventListener;
       this.listenerRegistry.clear();
       this.securityEvents = [];
     }
   }
   ```

### Step 2: Implement Allowlist Checking for New Event Listeners

**Duration**: 3-4 hours  
**Files to Create**:
- `apps/web/src/lib/security/EventAllowlist.ts` - Allowlist management
- `apps/web/src/lib/security/AllowlistManager.ts` - Allowlist operations

**Actions**:
1. Create allowlist management system:
   ```typescript
   // apps/web/src/lib/security/EventAllowlist.ts
   export interface AllowlistEntry {
     id: string;
     eventType: string;
     targetPattern: string;
     component?: string;
     description: string;
     allowedOrigins?: string[];
     restrictions: {
       maxListeners: number;
       requireValidation: boolean;
       requireSanitization: boolean;
       allowedMethods?: string[];
       blockedMethods?: string[];
     };
     metadata: {
       addedAt: string;
       addedBy: string;
       lastReviewed: string;
       reviewedBy: string;
       version: string;
     };
   }
   
   export class EventAllowlist {
     private static readonly DEFAULT_ALLOWLIST: AllowlistEntry[] = [
       {
         id: 'video-keyboard-controls',
         eventType: 'keydown',
         targetPattern: 'document|video-player',
         component: 'KeyboardShortcuts',
         description: 'Keyboard shortcuts for video player controls',
         restrictions: {
           maxListeners: 1,
           requireValidation: true,
           requireSanitization: true,
           allowedMethods: ['handleKeyDown'],
           blockedMethods: ['eval', 'Function']
         },
         metadata: {
           addedAt: new Date().toISOString(),
           addedBy: 'Security Team',
           lastReviewed: new Date().toISOString(),
           reviewedBy: 'Security Team',
           version: '1.0.0'
         }
       },
       {
         id: 'video-touch-controls',
         eventType: 'touchstart',
         targetPattern: 'video-player',
         component: 'MobileTouch',
         description: 'Touch controls for mobile video interaction',
         restrictions: {
           maxListeners: 3,
           requireValidation: true,
           requireSanitization: true
         },
         metadata: {
           addedAt: new Date().toISOString(),
           addedBy: 'Security Team',
           lastReviewed: new Date().toISOString(),
           reviewedBy: 'Security Team',
           version: '1.0.0'
         }
       },
       {
         id: 'video-progress-interaction',
         eventType: 'click',
         targetPattern: 'progress-bar',
         description: 'Click interaction on video progress bar',
         restrictions: {
           maxListeners: 2,
           requireValidation: false,
           requireSanitization: false
         },
         metadata: {
           addedAt: new Date().toISOString(),
           addedBy: 'Security Team',
           lastReviewed: new Date().toISOString(),
           reviewedBy: 'Security Team',
           version: '1.0.0'
         }
       },
       {
         id: 'window-resize-handler',
         eventType: 'resize',
         targetPattern: 'window',
         component: 'VideoPlayer',
         description: 'Window resize handling for responsive video player',
         restrictions: {
           maxListeners: 1,
           requireValidation: false,
           requireSanitization: false
         },
         metadata: {
           addedAt: new Date().toISOString(),
           addedBy: 'Security Team',
           lastReviewed: new Date().toISOString(),
           reviewedBy: 'Security Team',
           version: '1.0.0'
         }
       },
       {
         id: 'fullscreen-change-handler',
         eventType: 'fullscreenchange',
         targetPattern: 'document',
         component: 'VideoPlayer',
         description: 'Fullscreen mode change handling',
         restrictions: {
           maxListeners: 1,
           requireValidation: false,
           requireSanitization: false
         },
         metadata: {
           addedAt: new Date().toISOString(),
           addedBy: 'Security Team',
           lastReviewed: new Date().toISOString(),
           reviewedBy: 'Security Team',
           version: '1.0.0'
         }
       }
     ];
     
     private static allowlist: AllowlistEntry[] = [...this.DEFAULT_ALLOWLIST];
     
     static isAllowed(
       eventType: string,
       target: string,
       component?: string
     ): {
       isAllowed: boolean;
       entry?: AllowlistEntry;
       reason?: string;
     } {
       const entry = this.findMatchingEntry(eventType, target, component);
       
       if (!entry) {
         return {
           isAllowed: false,
           reason: `No allowlist entry found for ${eventType} on ${target}`
         };
       }
       
       // Check if component is excluded
       if (component && this.isComponentExcluded(component)) {
         return {
           isAllowed: false,
           reason: `Component ${component} is excluded from event listener registration`
         };
       }
       
       return {
         isAllowed: true,
         entry
       };
     }
     
     private static findMatchingEntry(
       eventType: string,
       target: string,
       component?: string
     ): AllowlistEntry | null {
       return this.allowlist.find(entry => {
         // Match event type
         if (entry.eventType !== eventType) return false;
         
         // Match target pattern
         const targetRegex = new RegExp(entry.targetPattern);
         if (!targetRegex.test(target)) return false;
         
         // Match component if specified
         if (entry.component && component && entry.component !== component) {
           return false;
         }
         
         return true;
       }) || null;
     }
     
     private static isComponentExcluded(component: string): boolean {
       const excludedComponents = ['ThirdPartyAnalytics', 'ExternalWidget', 'UnknownScript'];
       return excludedComponents.includes(component);
     }
     
     static addEntry(entry: AllowlistEntry): void {
       // Validate entry
       if (!this.validateEntry(entry)) {
         throw new Error('Invalid allowlist entry');
       }
       
       // Check for duplicates
       const existing = this.findMatchingEntry(entry.eventType, entry.targetPattern, entry.component);
       if (existing) {
         throw new Error(`Allowlist entry already exists: ${existing.id}`);
       }
       
       this.allowlist.push(entry);
     }
     
     static removeEntry(id: string): boolean {
       const index = this.allowlist.findIndex(entry => entry.id === id);
       if (index !== -1) {
         this.allowlist.splice(index, 1);
         return true;
       }
       return false;
     }
     
     static updateEntry(id: string, updates: Partial<AllowlistEntry>): boolean {
       const index = this.allowlist.findIndex(entry => entry.id === id);
       if (index !== -1) {
         this.allowlist[index] = { ...this.allowlist[index], ...updates };
         return true;
       }
       return false;
     }
     
     static getAllEntries(): AllowlistEntry[] {
         return [...this.allowlist];
     }
     
     static getEntriesByComponent(component: string): AllowlistEntry[] {
       return this.allowlist.filter(entry => entry.component === component);
     }
     
     static getEntriesByEventType(eventType: string): AllowlistEntry[] {
       return this.allowlist.filter(entry => entry.eventType === eventType);
     }
     
     private static validateEntry(entry: AllowlistEntry): boolean {
       return !!(
         entry.id &&
         entry.eventType &&
         entry.targetPattern &&
         entry.description &&
         entry.restrictions &&
         entry.metadata
       );
     }
     
     static exportAllowlist(): string {
       return JSON.stringify(this.allowlist, null, 2);
     }
     
     static importAllowlist(data: string): void {
       try {
         const imported = JSON.parse(data) as AllowlistEntry[];
         
         // Validate all entries
         if (!imported.every(entry => this.validateEntry(entry))) {
           throw new Error('Invalid allowlist data');
         }
         
         this.allowlist = imported;
       } catch (error) {
         throw new Error(`Failed to import allowlist: ${error}`);
       }
     }
   }
   ```

### Step 3: Add Blocking Mechanism for Unauthorized Listeners

**Duration**: 4-5 hours  
**Files to Create**:
- `apps/web/src/lib/security/EventBlocker.ts` - Blocking mechanism
- `apps/web/src/lib/security/BlockingStrategy.ts` - Blocking strategies

**Actions**:
1. Create event blocking mechanism:
   ```typescript
   // apps/web/src/lib/security/EventBlocker.ts
   export interface BlockingStrategy {
     name: string;
     shouldBlock: (event: any, context: any) => boolean;
     blockAction: (event: any, context: any) => void;
     logAction: (event: any, context: any, reason: string) => void;
   }
   
   export interface BlockingResult {
     blocked: boolean;
     strategy?: string;
     reason?: string;
     originalEvent?: any;
     sanitizedEvent?: any;
   }
   
   export class EventBlocker {
     private static strategies: Map<string, BlockingStrategy> = new Map();
     private static blockedEvents: Map<string, any[]> = new Map();
     
     static initialize(): void {
       this.registerDefaultStrategies();
     }
     
     private static registerDefaultStrategies(): void {
       // Strategy 1: Completely block dangerous events
       this.registerStrategy({
         name: 'complete_block',
         shouldBlock: (event, context) => {
           const dangerousEvents = ['storage', 'hashchange', 'popstate'];
           return dangerousEvents.includes(event.type);
         },
         blockAction: (event, context) => {
           // Prevent the event from being added
           throw new Error(`Event type "${event.type}" is blocked for security reasons`);
         },
         logAction: (event, context, reason) => {
           console.error(`Blocked dangerous event: ${event.type} - ${reason}`);
         }
       });
       
       // Strategy 2: Validate and sanitize message events
       this.registerStrategy({
         name: 'message_validation',
         shouldBlock: (event, context) => {
           return event.type === 'message';
         },
         blockAction: (event, context) => {
           // Create a sanitized version of the event
           const sanitizedEvent = this.sanitizeMessageEvent(event);
           
           // Only proceed if sanitization succeeded
           if (sanitizedEvent) {
             // Replace the original event with sanitized version
             Object.assign(event, sanitizedEvent);
             return; // Allow the sanitized event
           }
           
           // Block if sanitization failed
           throw new Error('Message event failed security validation');
         },
         logAction: (event, context, reason) => {
           console.warn(`Message event validation: ${reason}`);
         }
       });
       
       // Strategy 3: Rate limiting for frequent events
       this.registerStrategy({
         name: 'rate_limiting',
         shouldBlock: (event, context) => {
           const highFrequencyEvents = ['mousemove', 'scroll', 'resize'];
           return highFrequencyEvents.includes(event.type);
         },
         blockAction: (event, context) => {
           const key = `${context.target}:${event.type}`;
           const now = Date.now();
           const events = this.blockedEvents.get(key) || [];
           
           // Clean old events (older than 1 second)
           const recentEvents = events.filter(timestamp => now - timestamp < 1000);
           
           // Check rate limit (max 100 events per second)
           if (recentEvents.length >= 100) {
             throw new Error(`Rate limit exceeded for ${event.type} events`);
           }
           
           // Add current event and update
           recentEvents.push(now);
           this.blockedEvents.set(key, recentEvents);
         },
         logAction: (event, context, reason) => {
           console.warn(`Rate limiting: ${reason}`);
         }
       });
       
       // Strategy 4: Origin validation for global events
       this.registerStrategy({
         name: 'origin_validation',
         shouldBlock: (event, context) => {
           const globalTargets = ['window', 'document'];
           return globalTargets.includes(context.target);
         },
         blockAction: (event, context) => {
           // Check if the listener is being added from an allowed origin
           const currentOrigin = window.location.origin;
           const allowedOrigins = [currentOrigin];
           
           // In a real implementation, you'd check the call stack
           // For now, we'll use a simple heuristic
           const callerOrigin = this.getCallerOrigin();
           
           if (!allowedOrigins.includes(callerOrigin)) {
             throw new Error(`Event listener origin "${callerOrigin}" is not allowed`);
           }
         },
         logAction: (event, context, reason) => {
           console.error(`Origin validation failed: ${reason}`);
         }
       });
     }
     
     static registerStrategy(strategy: BlockingStrategy): void {
       this.strategies.set(strategy.name, strategy);
     }
     
     static shouldBlockEvent(event: any, context: any): BlockingResult {
       for (const [name, strategy] of this.strategies) {
         if (strategy.shouldBlock(event, context)) {
           return {
             blocked: true,
             strategy: name,
             reason: `Blocked by ${name} strategy`,
             originalEvent: event
           };
         }
       }
       
       return { blocked: false };
     }
     
     static executeBlocking(
       result: BlockingResult,
       event: any,
       context: any
     ): void {
       if (!result.blocked || !result.strategy) {
         return;
       }
       
       const strategy = this.strategies.get(result.strategy);
       if (strategy) {
         try {
           strategy.blockAction(event, context);
         } catch (error) {
           strategy.logAction(event, context, error.message);
           throw error;
         }
       }
     }
     
     private static sanitizeMessageEvent(event: MessageEvent): MessageEvent | null {
       try {
         // Validate origin
         if (event.origin !== window.location.origin) {
           return null;
         }
         
         // Validate data structure
         if (!event.data || typeof event.data !== 'object') {
           return null;
         }
         
         // Sanitize data
         const sanitized = this.sanitizeObject(event.data);
         
         // Create new event with sanitized data
         return new MessageEvent('message', {
           data: sanitized,
           origin: event.origin,
           lastEventId: event.lastEventId,
           source: event.source,
           ports: event.ports
         });
       } catch (error) {
         console.error('Message event sanitization failed:', error);
         return null;
       }
     }
     
     private static sanitizeObject(obj: any): any {
       if (obj === null || typeof obj !== 'object') {
         return obj;
       }
       
       if (obj instanceof Array) {
         return obj.map(item => this.sanitizeObject(item));
       }
       
       const sanitized: any = {};
       const dangerousKeys = ['script', 'javascript', 'eval', 'function', 'constructor'];
       
       for (const [key, value] of Object.entries(obj)) {
         // Skip dangerous keys
         if (dangerousKeys.some(dangerous => key.toLowerCase().includes(dangerous))) {
           continue;
         }
         
         // Recursively sanitize nested objects
         sanitized[key] = this.sanitizeObject(value);
       }
       
       return sanitized;
     }
     
     private static getCallerOrigin(): string {
       // In a real implementation, you'd analyze the call stack
       // For now, return current origin as fallback
       return window.location.origin;
     }
     
     static getBlockedEventsCount(): number {
       let total = 0;
       for (const events of this.blockedEvents.values()) {
         total += events.length;
       }
       return total;
     }
     
     static clearBlockedEvents(): void {
       this.blockedEvents.clear();
     }
   }
   ```

## Testing Strategy

### Unit Testing
- Test EventListenerValidator with various event types
- Test allowlist validation logic
- Test blocking mechanism effectiveness
- Test security event logging

### Integration Testing
- Test with actual video player components
- Test event listener registration and removal
- Test security event logging to WebSocket server
- Test performance impact of validation

### Security Testing
- Attempt to register unauthorized event listeners
- Test XSS injection attempts
- Test message event spoofing
- Test rate limiting effectiveness

## Deliverables

1. **EventListenerValidator Class** (`apps/web/src/lib/security/EventListenerValidator.ts`)
2. **Security Type Definitions** (`apps/web/src/types/security.ts`)
3. **EventAllowlist System** (`apps/web/src/lib/security/EventAllowlist.ts`)
4. **EventBlocker System** (`apps/web/src/lib/lib/security/EventBlocker.ts`)
5. **Integration Tests** (`apps/web/src/__tests__/security/EventListenerValidator.test.ts`)
6. **Security Documentation** (`docs/security/event-listener-validation.md`)
7. **Configuration Files** (`apps/web/src/lib/security/EventValidationConfig.ts`)

## Success Criteria

- ✅ Only authorized event listeners are permitted
- ✅ Suspicious listeners are blocked and logged
- ✅ Security events are sent to WebSocket server
- ✅ Performance impact is minimal (<5% overhead)
- ✅ All existing video player functionality works
- ✅ Comprehensive test coverage (>95%)

## Estimated Timeline

**Total Duration**: 12-16 hours  
**Dependencies**: Event listener audit completed  
**Risks**: Medium - May break existing functionality if not carefully implemented

## Next Steps

After implementing event listener validation:
1. Proceed to "Add security event logging and monitoring" task
2. Test with existing video player components
3. Monitor security events in production
4. Fine-tune validation rules based on real-world usage