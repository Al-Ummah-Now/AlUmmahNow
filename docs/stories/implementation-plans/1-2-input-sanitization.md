# Implementation Plan: Input Sanitization for Event Data

**Story**: 1.2 Remove Global Event Listener Security Vulnerabilities  
**Task Group**: 1-2-input-sanitization  
**Priority**: Critical  
**Estimated Time**: 14-18 hours  

## Overview

This implementation plan addresses the security vulnerability of unsanitized input data in global event listeners. Global event listeners can receive malicious data through event properties, custom events, or third-party integrations. Without proper sanitization, this can lead to XSS attacks, DOM manipulation, or data exfiltration.

## Prerequisites

- Event listener audit completed (Story 1.2 Task 1)
- Event listener validation middleware implemented (Story 1.2 Task 2)
- Security event logging system active (Story 1.2 Task 3)
- Security types defined in `@al-ummah/shared-types`

## Implementation Steps

### Step 1: Create Input Sanitization Utilities

**File**: `apps/web/src/lib/security/sanitizer.ts`

```typescript
import DOMPurify from 'dompurify';
import { z } from 'zod';
import type { 
  SanitizationConfig, 
  SanitizationResult, 
  SecurityEvent,
  SecuritySeverity 
} from '@al-ummah/shared-types';

/**
 * Comprehensive input sanitization utility
 */
export class InputSanitizer {
  private config: SanitizationConfig;
  private eventLogger: (event: SecurityEvent) => void;

  constructor(config: SanitizationConfig, eventLogger: (event: SecurityEvent) => void) {
    this.config = config;
    this.eventLogger = eventLogger;
    
    // Configure DOMPurify
    this.configureDOMPurify();
  }

  private configureDOMPurify(): void {
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      // Log suspicious attribute attempts
      if (data.attrName.startsWith('on') || data.attrName === 'javascript:') {
        this.logSecurityEvent({
          type: 'sanitization-blocked',
          severity: 'high',
          message: `Blocked dangerous attribute: ${data.attrName}`,
          metadata: {
            tagName: node.tagName,
            attributeName: data.attrName,
            attributeValue: data.attrValue
          }
        });
      }
    });
  }

  /**
   * Sanitize string input for HTML context
   */
  sanitizeHtml(input: string, context: string = 'default'): SanitizationResult {
    const startTime = Date.now();
    
    try {
      // Check against allowlist first
      if (this.isAllowlisted(input, context)) {
        return {
          sanitized: input,
          isModified: false,
          violations: [],
          metadata: {
            originalLength: input.length,
            sanitizedLength: input.length,
            processingTime: Date.now() - startTime,
            context
          }
        };
      }

      // Apply DOMPurify with context-specific config
      const config = this.getConfigForContext(context);
      const sanitized = DOMPurify.sanitize(input, config);
      
      const violations = this.detectViolations(input, sanitized);
      const isModified = input !== sanitized;

      if (violations.length > 0) {
        this.logSecurityEvent({
          type: 'sanitization-violations',
          severity: this.getSeverityFromViolations(violations),
          message: `Input sanitization detected ${violations.length} violations`,
          metadata: {
            context,
            violations,
            inputLength: input.length,
            sanitizedLength: sanitized.length
          }
        });
      }

      return {
        sanitized,
        isModified,
        violations,
        metadata: {
          originalLength: input.length,
          sanitizedLength: sanitized.length,
          processingTime: Date.now() - startTime,
          context
        }
      };
    } catch (error) {
      this.logSecurityEvent({
        type: 'sanitization-error',
        severity: 'high',
        message: `Sanitization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: {
          context,
          error: error instanceof Error ? error.stack : String(error)
        }
      });

      // Fail safe - return empty string
      return {
        sanitized: '',
        isModified: true,
        violations: [{ type: 'sanitization-error', severity: 'high', description: 'Sanitization process failed' }],
        metadata: {
          originalLength: input.length,
          sanitizedLength: 0,
          processingTime: Date.now() - startTime,
          context,
          error: true
        }
      };
    }
  }

  /**
   * Sanitize URL input
   */
  sanitizeUrl(input: string, allowedProtocols: string[] = ['https:', 'http:']): SanitizationResult {
    try {
      const url = new URL(input, window.location.origin);
      
      // Check protocol
      if (!allowedProtocols.includes(url.protocol)) {
        const violation = {
          type: 'invalid-protocol' as const,
          severity: 'high' as const,
          description: `Protocol ${url.protocol} not allowed`
        };

        this.logSecurityEvent({
          type: 'sanitization-violations',
          severity: 'high',
          message: `Blocked URL with invalid protocol: ${url.protocol}`,
          metadata: {
            url: input,
            protocol: url.protocol
          }
        });

        return {
          sanitized: '',
          isModified: true,
          violations: [violation],
          metadata: {
            originalLength: input.length,
            sanitizedLength: 0,
            processingTime: 0,
            context: 'url'
          }
        };
      }

      // Check for dangerous patterns
      const dangerousPatterns = [
        /javascript:/i,
        /data:/i,
        /vbscript:/i,
        /<script/i,
        /onload=/i,
        /onerror=/i
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(input)) {
          const violation = {
            type: 'dangerous-url-pattern' as const,
            severity: 'high' as const,
            description: `URL contains dangerous pattern: ${pattern.source}`
          };

          return {
            sanitized: '',
            isModified: true,
            violations: [violation],
            metadata: {
              originalLength: input.length,
              sanitizedLength: 0,
              processingTime: 0,
              context: 'url'
            }
          };
        }
      }

      return {
        sanitized: url.toString(),
        isModified: false,
        violations: [],
        metadata: {
          originalLength: input.length,
          sanitizedLength: url.toString().length,
          processingTime: 0,
          context: 'url'
        }
      };
    } catch (error) {
      return {
        sanitized: '',
        isModified: true,
        violations: [{
          type: 'invalid-url' as const,
          severity: 'medium' as const,
          description: 'Invalid URL format'
        }],
        metadata: {
          originalLength: input.length,
          sanitizedLength: 0,
          processingTime: 0,
          context: 'url'
        }
      };
    }
  }

  /**
   * Sanitize event data object
   */
  sanitizeEventData(eventData: unknown, context: string = 'event'): SanitizationResult {
    if (typeof eventData === 'string') {
      return this.sanitizeHtml(eventData, context);
    }

    if (typeof eventData === 'object' && eventData !== null) {
      return this.sanitizeObject(eventData, context);
    }

    if (typeof eventData === 'number' || typeof eventData === 'boolean') {
      return {
        sanitized: eventData,
        isModified: false,
        violations: [],
        metadata: {
          originalLength: String(eventData).length,
          sanitizedLength: String(eventData).length,
          processingTime: 0,
          context
        }
      };
    }

    // Unknown type - convert to string and sanitize
    return this.sanitizeHtml(String(eventData), context);
  }

  /**
   * Sanitize object properties recursively
   */
  private sanitizeObject(obj: any, context: string, depth: number = 0): SanitizationResult {
    const maxDepth = 10;
    if (depth > maxDepth) {
      const violation = {
        type: 'max-depth-exceeded' as const,
        severity: 'medium' as const,
        description: `Object depth exceeds maximum allowed depth of ${maxDepth}`
      };

      return {
        sanitized: null,
        isModified: true,
        violations: [violation],
        metadata: {
          originalLength: JSON.stringify(obj).length,
          sanitizedLength: 0,
          processingTime: 0,
          context,
          depth
        }
      };
    }

    try {
      const sanitized: any = {};
      const allViolations: any[] = [];
      let isModified = false;

      for (const [key, value] of Object.entries(obj)) {
        // Sanitize key name
        const sanitizedKey = this.sanitizeHtml(key, `${context}-key`);
        
        if (sanitizedKey.violations.length > 0) {
          allViolations.push(...sanitizedKey.violations.map(v => ({
            ...v,
            property: key
          })));
        }

        const finalKey = sanitizedKey.sanitized || `key_${Math.random().toString(36).substr(2, 9)}`;

        // Sanitize value based on type
        if (typeof value === 'string') {
          const sanitizedValue = this.sanitizeHtml(value, `${context}-${key}`);
          if (sanitizedValue.violations.length > 0) {
            allViolations.push(...sanitizedValue.violations.map(v => ({
              ...v,
              property: key
            })));
          }
          if (sanitizedValue.isModified) {
            isModified = true;
          }
          sanitized[finalKey] = sanitizedValue.sanitized;
        } else if (typeof value === 'object' && value !== null) {
          const sanitizedValue = this.sanitizeObject(value, `${context}-${key}`, depth + 1);
          if (sanitizedValue.violations.length > 0) {
            allViolations.push(...sanitizedValue.violations);
          }
          if (sanitizedValue.isModified) {
            isModified = true;
          }
          sanitized[finalKey] = sanitizedValue.sanitized;
        } else {
          sanitized[finalKey] = value;
        }
      }

      return {
        sanitized,
        isModified,
        violations: allViolations,
        metadata: {
          originalLength: JSON.stringify(obj).length,
          sanitizedLength: JSON.stringify(sanitized).length,
          processingTime: 0,
          context,
          depth
        }
      };
    } catch (error) {
      return {
        sanitized: null,
        isModified: true,
        violations: [{
          type: 'object-sanitization-error' as const,
          severity: 'high' as const,
          description: 'Failed to sanitize object'
        }],
        metadata: {
          originalLength: JSON.stringify(obj).length,
          sanitizedLength: 0,
          processingTime: 0,
          context,
          error: true
        }
      };
    }
  }

  private isAllowlisted(input: string, context: string): boolean {
    const allowlist = this.config.allowlist?.[context] || [];
    return allowlist.some(pattern => {
      if (typeof pattern === 'string') {
        return input === pattern;
      }
      return pattern.test(input);
    });
  }

  private getConfigForContext(context: string): any {
    const baseConfig = {
      ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'span', 'br'],
      ALLOWED_ATTR: ['class', 'id', 'data-*'],
      KEEP_CONTENT: true
    };

    const contextConfigs = {
      'user-input': {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: []
      },
      'rich-text': {
        ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'span', 'a'],
        ALLOWED_ATTR: ['href', 'title', 'class', 'data-*']
      },
      'attribute': {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: []
      }
    };

    return { ...baseConfig, ...contextConfigs[context] };
  }

  private detectViolations(original: string, sanitized: string): any[] {
    const violations: any[] = [];

    // Check for removed script tags
    if (/<script/i.test(original) && !/<script/i.test(sanitized)) {
      violations.push({
        type: 'script-tag-removed',
        severity: 'high',
        description: 'Script tag was removed during sanitization'
      });
    }

    // Check for removed event handlers
    const eventHandlerPattern = /on\w+\s*=/i;
    if (eventHandlerPattern.test(original) && !eventHandlerPattern.test(sanitized)) {
      violations.push({
        type: 'event-handler-removed',
        severity: 'high',
        description: 'Event handler attribute was removed during sanitization'
      });
    }

    // Check for removed javascript: URLs
    if (/javascript:/i.test(original) && !/javascript:/i.test(sanitized)) {
      violations.push({
        type: 'javascript-url-removed',
        severity: 'high',
        description: 'JavaScript URL was removed during sanitization'
      });
    }

    return violations;
  }

  private getSeverityFromViolations(violations: any[]): SecuritySeverity {
    if (violations.some(v => v.severity === 'high')) {
      return 'high';
    }
    if (violations.some(v => v.severity === 'medium')) {
      return 'medium';
    }
    return 'low';
  }

  private logSecurityEvent(event: Partial<SecurityEvent>): void {
    const securityEvent: SecurityEvent = {
      id: `sanitization-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: event.type || 'sanitization-event',
      severity: event.severity || 'medium',
      message: event.message || 'Input sanitization event',
      source: 'input-sanitizer',
      metadata: event.metadata || {}
    };

    this.eventLogger(securityEvent);
  }
}

/**
 * Default sanitization configuration
 */
export const defaultSanitizationConfig: SanitizationConfig = {
  allowlist: {
    'user-input': [],
    'rich-text': [],
    'attribute': [],
    'default': []
  },
  maxInputLength: 10000,
  strictMode: true
};

/**
 * Create a sanitizer instance with default configuration
 */
export function createInputSanitizer(eventLogger: (event: SecurityEvent) => void): InputSanitizer {
  return new InputSanitizer(defaultSanitizationConfig, eventLogger);
}
```

### Step 2: Create Event Data Sanitization Middleware

**File**: `apps/web/src/lib/security/event-sanitizer.ts`

```typescript
import type { EventListenerInfo, SecurityEvent } from '@al-ummah/shared-types';
import { InputSanitizer, createInputSanitizer } from './sanitizer';

/**
 * Event data sanitization middleware
 */
export class EventDataSanitizer {
  private sanitizer: InputSanitizer;
  private eventLogger: (event: SecurityEvent) => void;

  constructor(eventLogger: (event: SecurityEvent) => void) {
    this.eventLogger = eventLogger;
    this.sanitizer = createInputSanitizer(eventLogger);
  }

  /**
   * Sanitize event data before it reaches the event handler
   */
  sanitizeEventData(event: Event, listenerInfo: EventListenerInfo): Event {
    const startTime = Date.now();
    
    try {
      // Create a sanitized copy of the event
      const sanitizedEvent = this.createSanitizedEvent(event, listenerInfo);
      
      // Log sanitization if any modifications were made
      if (this.hasEventBeenModified(event, sanitizedEvent)) {
        this.logSanitizationEvent(event, sanitizedEvent, listenerInfo, Date.now() - startTime);
      }

      return sanitizedEvent;
    } catch (error) {
      this.logSanitizationError(event, listenerInfo, error);
      
      // Return a minimal safe event
      return this.createMinimalSafeEvent(event);
    }
  }

  /**
   * Create a sanitized version of the event
   */
  private createSanitizedEvent(event: Event, listenerInfo: EventListenerInfo): Event {
    // For different event types, create appropriate sanitized versions
    switch (event.type) {
      case 'input':
        return this.sanitizeInputEvent(event as InputEvent, listenerInfo);
      case 'change':
        return this.sanitizeChangeEvent(event as Event, listenerInfo);
      case 'keydown':
      case 'keyup':
      case 'keypress':
        return this.sanitizeKeyboardEvent(event as KeyboardEvent, listenerInfo);
      case 'click':
      case 'mousedown':
      case 'mouseup':
        return this.sanitizeMouseEvent(event as MouseEvent, listenerInfo);
      case 'message':
        return this.sanitizeMessageEvent(event as MessageEvent, listenerInfo);
      case 'custom':
        return this.sanitizeCustomEvent(event as CustomEvent, listenerInfo);
      default:
        return this.sanitizeGenericEvent(event, listenerInfo);
    }
  }

  /**
   * Sanitize input events
   */
  private sanitizeInputEvent(event: InputEvent, listenerInfo: EventListenerInfo): InputEvent {
    const sanitizedData = this.sanitizer.sanitizeEventData(
      event.data, 
      `${listenerInfo.context}-input-data`
    );

    // Create a new InputEvent with sanitized data
    const sanitizedInputEvent = new InputEvent(event.type, {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      composed: event.composed,
      data: sanitizedData.sanitized as string,
      inputType: event.inputType,
      isComposing: event.isComposing
    });

    // Copy safe properties
    this.copySafeProperties(event, sanitizedInputEvent);
    
    return sanitizedInputEvent;
  }

  /**
   * Sanitize change events
   */
  private sanitizeChangeEvent(event: Event, listenerInfo: EventListenerInfo): Event {
    const target = event.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    
    if (target && (target.value !== undefined)) {
      const sanitizedValue = this.sanitizer.sanitizeEventData(
        target.value,
        `${listenerInfo.context}-change-value`
      );

      // Update target value if it was modified
      if (sanitizedValue.isModified) {
        target.value = sanitizedValue.sanitized as string;
      }
    }

    return event;
  }

  /**
   * Sanitize keyboard events
   */
  private sanitizeKeyboardEvent(event: KeyboardEvent, listenerInfo: EventListenerInfo): KeyboardEvent {
    // Keyboard events are generally safe, but we should validate key codes
    const sanitizedKeyboardEvent = new KeyboardEvent(event.type, {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      composed: event.composed,
      key: event.key,
      code: event.code,
      location: event.location,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      repeat: event.repeat,
      isComposing: event.isComposing,
      charCode: event.charCode,
      keyCode: event.keyCode,
      which: event.which
    });

    this.copySafeProperties(event, sanitizedKeyboardEvent);
    return sanitizedKeyboardEvent;
  }

  /**
   * Sanitize mouse events
   */
  private sanitizeMouseEvent(event: MouseEvent, listenerInfo: EventListenerInfo): MouseEvent {
    // Mouse events are generally safe, but we should validate coordinates
    const sanitizedMouseEvent = new MouseEvent(event.type, {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      composed: event.composed,
      screenX: Math.max(0, event.screenX),
      screenY: Math.max(0, event.screenY),
      clientX: Math.max(0, event.clientX),
      clientY: Math.max(0, event.clientY),
      button: event.button,
      buttons: event.buttons,
      relatedTarget: event.relatedTarget,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    });

    this.copySafeProperties(event, sanitizedMouseEvent);
    return sanitizedMouseEvent;
  }

  /**
   * Sanitize message events (critical for security)
   */
  private sanitizeMessageEvent(event: MessageEvent, listenerInfo: EventListenerInfo): MessageEvent {
    const sanitizedData = this.sanitizer.sanitizeEventData(
      event.data,
      `${listenerInfo.context}-message-data`
    );

    const sanitizedMessageEvent = new MessageEvent(event.type, {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      composed: event.composed,
      data: sanitizedData.sanitized,
      origin: this.sanitizeOrigin(event.origin),
      lastEventId: event.lastEventId,
      source: event.source,
      ports: event.ports
    });

    this.copySafeProperties(event, sanitizedMessageEvent);
    return sanitizedMessageEvent;
  }

  /**
   * Sanitize custom events
   */
  private sanitizeCustomEvent(event: CustomEvent, listenerInfo: EventListenerInfo): CustomEvent {
    const sanitizedDetail = this.sanitizer.sanitizeEventData(
      event.detail,
      `${listenerInfo.context}-custom-detail`
    );

    const sanitizedCustomEvent = new CustomEvent(event.type, {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      composed: event.composed,
      detail: sanitizedDetail.sanitized
    });

    this.copySafeProperties(event, sanitizedCustomEvent);
    return sanitizedCustomEvent;
  }

  /**
   * Sanitize generic events
   */
  private sanitizeGenericEvent(event: Event, listenerInfo: EventListenerInfo): Event {
    const sanitizedEvent = new Event(event.type, {
      bubbles: event.bubbles,
      cancelable: event.cancelable,
      composed: event.composed
    });

    this.copySafeProperties(event, sanitizedEvent);
    return sanitizedEvent;
  }

  /**
   * Copy safe properties from original event to sanitized event
   */
  private copySafeProperties(original: Event, sanitized: Event): void {
    // Copy timestamp
    if (original.timeStamp) {
      Object.defineProperty(sanitized, 'timeStamp', {
        value: original.timeStamp,
        writable: false
      });
    }

    // Copy target if it's safe
    if (original.target && this.isSafeTarget(original.target)) {
      Object.defineProperty(sanitized, 'target', {
        value: original.target,
        writable: false
      });
    }

    // Copy currentTarget if it's safe
    if (original.currentTarget && this.isSafeTarget(original.currentTarget)) {
      Object.defineProperty(sanitized, 'currentTarget', {
        value: original.currentTarget,
        writable: false
      });
    }
  }

  /**
   * Check if a target is safe to copy
   */
  private isSafeTarget(target: any): boolean {
    // Only allow DOM elements
    if (!(target instanceof Element)) {
      return false;
    }

    // Check against dangerous tags
    const dangerousTags = ['script', 'iframe', 'object', 'embed', 'form'];
    return !dangerousTags.includes(target.tagName.toLowerCase());
  }

  /**
   * Sanitize origin URL for message events
   */
  private sanitizeOrigin(origin: string): string {
    try {
      const url = new URL(origin);
      // Only allow same origin or explicitly allowed origins
      const allowedOrigins = [
        window.location.origin,
        'https://alummahnow.net',
        'https://www.alummahnow.net',
        'https://api.alummahnow.net'
      ];

      if (allowedOrigins.includes(url.origin)) {
        return origin;
      }

      // Log blocked origin
      this.eventLogger({
        id: `origin-blocked-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: 'origin-blocked',
        severity: 'high',
        message: `Blocked message from unauthorized origin: ${origin}`,
        source: 'event-sanitizer',
        metadata: { origin, allowedOrigins }
      });

      return window.location.origin; // Fall back to current origin
    } catch {
      return window.location.origin;
    }
  }

  /**
   * Check if an event has been modified during sanitization
   */
  private hasEventBeenModified(original: Event, sanitized: Event): boolean {
    // Compare key properties
    if (original.type !== sanitized.type) return true;
    if (original.bubbles !== sanitized.bubbles) return true;
    if (original.cancelable !== sanitized.cancelable) return true;

    // For message events, check data
    if (original instanceof MessageEvent && sanitized instanceof MessageEvent) {
      return original.data !== sanitized.data;
    }

    // For custom events, check detail
    if (original instanceof CustomEvent && sanitized instanceof CustomEvent) {
      return original.detail !== sanitized.detail;
    }

    return false;
  }

  /**
   * Create a minimal safe event when sanitization fails
   */
  private createMinimalSafeEvent(originalEvent: Event): Event {
    return new Event(originalEvent.type, {
      bubbles: false,
      cancelable: false
    });
  }

  /**
   * Log sanitization events
   */
  private logSanitizationEvent(
    original: Event, 
    sanitized: Event, 
    listenerInfo: EventListenerInfo,
    processingTime: number
  ): void {
    this.eventLogger({
      id: `event-sanitized-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'event-sanitized',
      severity: 'medium',
      message: `Event data was sanitized for ${listenerInfo.eventType}`,
      source: 'event-sanitizer',
      metadata: {
        eventType: original.type,
        listenerId: listenerInfo.id,
        context: listenerInfo.context,
        processingTime,
        modifications: this.getModifications(original, sanitized)
      }
    });
  }

  /**
   * Log sanitization errors
   */
  private logSanitizationError(
    event: Event, 
    listenerInfo: EventListenerInfo, 
    error: any
  ): void {
    this.eventLogger({
      id: `sanitization-error-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'sanitization-error',
      severity: 'high',
      message: `Event sanitization failed for ${listenerInfo.eventType}: ${error.message}`,
      source: 'event-sanitizer',
      metadata: {
        eventType: event.type,
        listenerId: listenerInfo.id,
        context: listenerInfo.context,
        error: error.stack || String(error)
      }
    });
  }

  /**
   * Get list of modifications made during sanitization
   */
  private getModifications(original: Event, sanitized: Event): string[] {
    const modifications: string[] = [];

    if (original instanceof MessageEvent && sanitized instanceof MessageEvent) {
      if (original.data !== sanitized.data) {
        modifications.push('message-data-sanitized');
      }
    }

    if (original instanceof CustomEvent && sanitized instanceof CustomEvent) {
      if (original.detail !== sanitized.detail) {
        modifications.push('custom-detail-sanitized');
      }
    }

    return modifications;
  }
}

/**
 * Create event data sanitizer instance
 */
export function createEventDataSanitizer(eventLogger: (event: SecurityEvent) => void): EventDataSanitizer {
  return new EventDataSanitizer(eventLogger);
}
```

### Step 3: Integrate Sanitization with Event Listener Manager

**File**: `apps/web/src/lib/security/event-listener-manager.ts` (Update existing)

```typescript
import { EventDataSanitizer, createEventDataSanitizer } from './event-sanitizer';
import type { EventListenerInfo, SecurityEvent } from '@al-ummah/shared-types';

/**
 * Enhanced event listener manager with input sanitization
 */
export class SecureEventListenerManager {
  private listeners: Map<string, EventListenerInfo> = new Map();
  private eventLogger: (event: SecurityEvent) => void;
  private eventSanitizer: EventDataSanitizer;

  constructor(eventLogger: (event: SecurityEvent) => void) {
    this.eventLogger = eventLogger;
    this.eventSanitizer = createEventDataSanitizer(eventLogger);
  }

  /**
   * Add event listener with sanitization
   */
  addSecureEventListener(
    target: EventTarget,
    eventType: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
    context: string = 'default'
  ): string {
    const listenerId = this.generateListenerId();
    
    // Create wrapped handler with sanitization
    const wrappedHandler = (event: Event) => {
      const listenerInfo = this.listeners.get(listenerId);
      if (!listenerInfo) return;

      try {
        // Sanitize event data before calling the original handler
        const sanitizedEvent = this.eventSanitizer.sanitizeEventData(event, listenerInfo);
        
        // Call the original handler with sanitized event
        handler.call(target, sanitizedEvent);
      } catch (error) {
        this.eventLogger({
          id: `handler-error-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'event-handler-error',
          severity: 'high',
          message: `Event handler error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          source: 'event-listener-manager',
          metadata: {
            listenerId,
            eventType,
            context,
            error: error instanceof Error ? error.stack : String(error)
          }
        });
      }
    };

    // Store listener information
    const listenerInfo: EventListenerInfo = {
      id: listenerId,
      target,
      eventType,
      handler: wrappedHandler,
      originalHandler: handler,
      options,
      context,
      addedAt: Date.now(),
      isActive: true
    };

    this.listeners.set(listenerId, listenerInfo);

    // Add the actual event listener
    target.addEventListener(eventType, wrappedHandler, options);

    return listenerId;
  }

  // ... rest of the existing methods ...

  private generateListenerId(): string {
    return `listener-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
```

### Step 4: Create React Hook for Sanitization

**File**: `apps/web/src/hooks/useInputSanitization.ts`

```typescript
import { useCallback, useRef } from 'react';
import { InputSanitizer, createInputSanitizer } from '@/lib/security/sanitizer';
import { useSecurityEvents } from './useSecurityEvents';
import type { SecurityEvent, SanitizationResult } from '@al-ummah/shared-types';

/**
 * React hook for input sanitization
 */
export function useInputSanitization(context: string = 'default') {
  const { logSecurityEvent } = useSecurityEvents();
  const sanitizerRef = useRef<InputSanitizer | null>(null);

  // Initialize sanitizer on first use
  if (!sanitizerRef.current) {
    sanitizerRef.current = createInputSanitizer(logSecurityEvent);
  }

  /**
   * Sanitize HTML input
   */
  const sanitizeHtml = useCallback((input: string): SanitizationResult => {
    if (!sanitizerRef.current) {
      throw new Error('Sanitizer not initialized');
    }
    return sanitizerRef.current.sanitizeHtml(input, context);
  }, [context]);

  /**
   * Sanitize URL input
   */
  const sanitizeUrl = useCallback((input: string, allowedProtocols?: string[]): SanitizationResult => {
    if (!sanitizerRef.current) {
      throw new Error('Sanitizer not initialized');
    }
    return sanitizerRef.current.sanitizeUrl(input, allowedProtocols);
  }, []);

  /**
   * Sanitize event data
   */
  const sanitizeEventData = useCallback((eventData: unknown): SanitizationResult => {
    if (!sanitizerRef.current) {
      throw new Error('Sanitizer not initialized');
    }
    return sanitizerRef.current.sanitizeEventData(eventData, context);
  }, [context]);

  /**
   * Sanitize form data
   */
  const sanitizeFormData = useCallback((formData: FormData): Record<string, any> => {
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of formData.entries()) {
      const result = sanitizeHtml(value.toString());
      sanitized[key] = result.sanitized;
      
      if (result.violations.length > 0) {
        logSecurityEvent({
          id: `form-sanitization-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'form-data-sanitized',
          severity: 'medium',
          message: `Form field '${key}' contained violations`,
          source: 'useInputSanitization',
          metadata: {
            fieldName: key,
            violations: result.violations,
            context
          }
        });
      }
    }
    
    return sanitized;
  }, [sanitizeHtml, logSecurityEvent, context]);

  return {
    sanitizeHtml,
    sanitizeUrl,
    sanitizeEventData,
    sanitizeFormData
  };
}

/**
 * Hook for auto-sanitizing input fields
 */
export function useAutoSanitizedInput(context: string = 'default') {
  const { sanitizeHtml } = useInputSanitization(context);

  /**
   * Create onChange handler with sanitization
   */
  const createSanitizedOnChange = useCallback((
    originalOnChange: (value: string) => void
  ) => {
    return (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const result = sanitizeHtml(event.target.value);
      
      // Update the input field with sanitized value
      event.target.value = result.sanitized;
      
      // Call the original onChange with sanitized value
      originalOnChange(result.sanitized);
    };
  }, [sanitizeHtml]);

  /**
   * Create onBlur handler with validation
   */
  const createSanitizedOnBlur = useCallback((
    originalOnBlur?: (value: string, violations: any[]) => void
  ) => {
    return (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const result = sanitizeHtml(event.target.value);
      
      if (originalOnBlur) {
        originalOnBlur(result.sanitized, result.violations);
      }
      
      // Update the input field with sanitized value
      event.target.value = result.sanitized;
    };
  }, [sanitizeHtml]);

  return {
    createSanitizedOnChange,
    createSanitizedOnBlur
  };
}
```

### Step 5: Add Sanitization to Form Components

**File**: `apps/web/src/components/forms/sanitized-input.tsx`

```typescript
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { useAutoSanitizedInput } from '@/hooks/useInputSanitization';
import type { SanitizationResult } from '@al-ummah/shared-types';

interface SanitizedInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'onBlur'> {
  onSanitizedChange?: (value: string, result: SanitizationResult) => void;
  onValidationBlur?: (value: string, violations: any[]) => void;
  sanitizationContext?: string;
  showViolations?: boolean;
}

export const SanitizedInput = forwardRef<HTMLInputElement, SanitizedInputProps>(
  (
    {
      onSanitizedChange,
      onValidationBlur,
      sanitizationContext = 'form-input',
      showViolations = false,
      defaultValue,
      value,
      ...props
    },
    ref
  ) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { createSanitizedOnChange, createSanitizedOnBlur } = useAutoSanitizedInput(sanitizationContext);

    // Expose input methods to parent ref
    useImperativeHandle(ref, () => inputRef.current!, []);

    const handleChange = createSanitizedOnChange((sanitizedValue) => {
      if (onSanitizedChange) {
        // Get the full sanitization result
        const { sanitizeHtml } = useAutoSanitizedInput(sanitizationContext);
        const result = sanitizeHtml(sanitizedValue);
        onSanitizedChange(sanitizedValue, result);
      }
    });

    const handleBlur = createSanitizedOnBlur((sanitizedValue, violations) => {
      if (onValidationBlur) {
        onValidationBlur(sanitizedValue, violations);
      }
    });

    return (
      <div className="sanitized-input-container">
        <input
          ref={inputRef}
          {...props}
          defaultValue={defaultValue}
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
        />
        {showViolations && (
          <SanitizationViolationsDisplay
            violations={[]} // Will be populated by the sanitization result
          />
        )}
      </div>
    );
  }
);

SanitizedInput.displayName = 'SanitizedInput';

/**
 * Component to display sanitization violations
 */
interface SanitizationViolationsDisplayProps {
  violations: any[];
}

function SanitizationViolationsDisplay({ violations }: SanitizationViolationsDisplayProps) {
  if (violations.length === 0) return null;

  return (
    <div className="mt-1 text-sm text-red-600">
      <ul className="list-disc list-inside">
        {violations.map((violation, index) => (
          <li key={index}>
            {violation.description}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Step 6: Add Sanitization Tests

**File**: `apps/web/src/__tests__/security/sanitizer.test.ts`

```typescript
import { InputSanitizer, createInputSanitizer } from '@/lib/security/sanitizer';
import type { SecurityEvent } from '@al-ummah/shared-types';

describe('InputSanitizer', () => {
  let sanitizer: InputSanitizer;
  let mockEventLogger: jest.MockedFunction<(event: SecurityEvent) => void>;

  beforeEach(() => {
    mockEventLogger = jest.fn();
    sanitizer = createInputSanitizer(mockEventLogger);
  });

  describe('HTML Sanitization', () => {
    it('should remove script tags', () => {
      const input = '<script>alert("xss")</script><p>Safe content</p>';
      const result = sanitizer.sanitizeHtml(input);

      expect(result.sanitized).not.toContain('<script>');
      expect(result.sanitized).toContain('<p>Safe content</p>');
      expect(result.isModified).toBe(true);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].type).toBe('script-tag-removed');
    });

    it('should remove event handlers', () => {
      const input = '<div onclick="alert(\'xss\')" onload="malicious()">Content</div>';
      const result = sanitizer.sanitizeHtml(input);

      expect(result.sanitized).not.toContain('onclick');
      expect(result.sanitized).not.toContain('onload');
      expect(result.isModified).toBe(true);
      expect(result.violations.some(v => v.type === 'event-handler-removed')).toBe(true);
    });

    it('should remove javascript: URLs', () => {
      const input = '<a href="javascript:alert(\'xss\')">Link</a>';
      const result = sanitizer.sanitizeHtml(input);

      expect(result.sanitized).not.toContain('javascript:');
      expect(result.isModified).toBe(true);
      expect(result.violations.some(v => v.type === 'javascript-url-removed')).toBe(true);
    });

    it('should allow safe HTML in rich text context', () => {
      const input = '<p><strong>Bold</strong> and <em>italic</em> text</p>';
      const result = sanitizer.sanitizeHtml(input, 'rich-text');

      expect(result.sanitized).toContain('<strong>Bold</strong>');
      expect(result.sanitized).toContain('<em>italic</em>');
      expect(result.isModified).toBe(false);
      expect(result.violations).toHaveLength(0);
    });

    it('should remove all HTML in user input context', () => {
      const input = '<p>User <strong>input</strong> with <script>alert("xss")</script></p>';
      const result = sanitizer.sanitizeHtml(input, 'user-input');

      expect(result.sanitized).toBe('User input with ');
      expect(result.isModified).toBe(true);
    });
  });

  describe('URL Sanitization', () => {
    it('should allow safe HTTPS URLs', () => {
      const input = 'https://example.com/path?query=value';
      const result = sanitizer.sanitizeUrl(input);

      expect(result.sanitized).toBe(input);
      expect(result.isModified).toBe(false);
      expect(result.violations).toHaveLength(0);
    });

    it('should block javascript: URLs', () => {
      const input = 'javascript:alert("xss")';
      const result = sanitizer.sanitizeUrl(input);

      expect(result.sanitized).toBe('');
      expect(result.isModified).toBe(true);
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0].type).toBe('invalid-protocol');
    });

    it('should block data: URLs', () => {
      const input = 'data:text/html,<script>alert("xss")</script>';
      const result = sanitizer.sanitizeUrl(input);

      expect(result.sanitized).toBe('');
      expect(result.isModified).toBe(true);
      expect(result.violations[0].type).toBe('invalid-protocol');
    });

    it('should handle malformed URLs gracefully', () => {
      const input = 'not-a-url';
      const result = sanitizer.sanitizeUrl(input);

      expect(result.sanitized).toBe('');
      expect(result.isModified).toBe(true);
      expect(result.violations[0].type).toBe('invalid-url');
    });
  });

  describe('Object Sanitization', () => {
    it('should sanitize object properties recursively', () => {
      const input = {
        safe: 'safe value',
        dangerous: '<script>alert("xss")</script>',
        nested: {
          alsoDangerous: 'javascript:alert("xss")',
          safe: 'safe nested value'
        }
      };

      const result = sanitizer.sanitizeEventData(input, 'test-object');

      expect(result.sanitized.safe).toBe('safe value');
      expect(result.sanitized.dangerous).not.toContain('<script>');
      expect(result.sanitized.nested.alsoDangerous).not.toContain('javascript:');
      expect(result.sanitized.nested.safe).toBe('safe nested value');
      expect(result.isModified).toBe(true);
    });

    it('should handle maximum depth protection', () => {
      // Create deeply nested object
      let deep: any = {};
      let current = deep;
      for (let i = 0; i < 15; i++) {
        current.nested = {};
        current = current.nested;
      }
      current.value = 'deep value';

      const result = sanitizer.sanitizeEventData(deep, 'deep-object');

      expect(result.sanitized).toBeNull();
      expect(result.isModified).toBe(true);
      expect(result.violations.some(v => v.type === 'max-depth-exceeded')).toBe(true);
    });
  });

  describe('Security Event Logging', () => {
    it('should log security events for violations', () => {
      const input = '<script>alert("xss")</script>';
      sanitizer.sanitizeHtml(input);

      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sanitization-violations',
          severity: 'high',
          message: expect.stringContaining('violations')
        })
      );
    });

    it('should log sanitization errors', () => {
      // Mock DOMPurify to throw an error
      const originalSanitize = require('dompurify').sanitize;
      require('dompurify').sanitize = jest.fn(() => {
        throw new Error('Sanitization failed');
      });

      const input = 'test input';
      sanitizer.sanitizeHtml(input);

      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sanitization-error',
          severity: 'high',
          message: expect.stringContaining('failed')
        })
      );

      // Restore original function
      require('dompurify').sanitize = originalSanitize;
    });
  });
});
```

**File**: `apps/web/src/__tests__/security/event-sanitizer.test.ts`

```typescript
import { EventDataSanitizer, createEventDataSanitizer } from '@/lib/security/event-sanitizer';
import type { EventListenerInfo, SecurityEvent } from '@al-ummah/shared-types';

describe('EventDataSanitizer', () => {
  let eventSanitizer: EventDataSanitizer;
  let mockEventLogger: jest.MockedFunction<(event: SecurityEvent) => void>;

  beforeEach(() => {
    mockEventLogger = jest.fn();
    eventSanitizer = createEventDataSanitizer(mockEventLogger);
  });

  describe('Input Event Sanitization', () => {
    it('should sanitize input event data', () => {
      const maliciousData = '<script>alert("xss")</script>';
      const inputEvent = new InputEvent('input', {
        data: maliciousData,
        inputType: 'insertText'
      });

      const listenerInfo: EventListenerInfo = {
        id: 'test-listener',
        target: document.body,
        eventType: 'input',
        handler: jest.fn(),
        originalHandler: jest.fn(),
        context: 'test-input',
        addedAt: Date.now(),
        isActive: true
      };

      const sanitizedEvent = eventSanitizer.sanitizeEventData(inputEvent, listenerInfo);

      expect((sanitizedEvent as InputEvent).data).not.toContain('<script>');
      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event-sanitized',
          severity: 'medium'
        })
      );
    });
  });

  describe('Message Event Sanitization', () => {
    it('should sanitize message event data', () => {
      const maliciousData = {
        message: '<script>alert("xss")</script>',
        url: 'javascript:alert("xss")'
      };

      const messageEvent = new MessageEvent('message', {
        data: maliciousData,
        origin: 'https://malicious.com'
      });

      const listenerInfo: EventListenerInfo = {
        id: 'test-listener',
        target: window,
        eventType: 'message',
        handler: jest.fn(),
        originalHandler: jest.fn(),
        context: 'test-message',
        addedAt: Date.now(),
        isActive: true
      };

      const sanitizedEvent = eventSanitizer.sanitizeEventData(messageEvent, listenerInfo);

      const sanitizedData = (sanitizedEvent as MessageEvent).data as any;
      expect(sanitizedData.message).not.toContain('<script>');
      expect(sanitizedData.url).not.toContain('javascript:');
    });

    it('should block unauthorized origins', () => {
      const messageEvent = new MessageEvent('message', {
        data: 'test message',
        origin: 'https://malicious.com'
      });

      const listenerInfo: EventListenerInfo = {
        id: 'test-listener',
        target: window,
        eventType: 'message',
        handler: jest.fn(),
        originalHandler: jest.fn(),
        context: 'test-message',
        addedAt: Date.now(),
        isActive: true
      };

      const sanitizedEvent = eventSanitizer.sanitizeEventData(messageEvent, listenerInfo);

      expect((sanitizedEvent as MessageEvent).origin).toBe(window.location.origin);
      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'origin-blocked',
          severity: 'high'
        })
      );
    });
  });

  describe('Custom Event Sanitization', () => {
    it('should sanitize custom event detail', () => {
      const maliciousDetail = {
        payload: '<script>alert("xss")</script>',
        metadata: 'safe metadata'
      };

      const customEvent = new CustomEvent('custom', {
        detail: maliciousDetail
      });

      const listenerInfo: EventListenerInfo = {
        id: 'test-listener',
        target: document.body,
        eventType: 'custom',
        handler: jest.fn(),
        originalHandler: jest.fn(),
        context: 'test-custom',
        addedAt: Date.now(),
        isActive: true
      };

      const sanitizedEvent = eventSanitizer.sanitizeEventData(customEvent, listenerInfo);

      const sanitizedDetail = (sanitizedEvent as CustomEvent).detail as any;
      expect(sanitizedDetail.payload).not.toContain('<script>');
      expect(sanitizedDetail.metadata).toBe('safe metadata');
    });
  });

  describe('Error Handling', () => {
    it('should handle sanitization errors gracefully', () => {
      // Create a problematic event
      const problematicEvent = new Event('test');
      Object.defineProperty(problematicEvent, 'target', {
        value: null,
        writable: false
      });

      const listenerInfo: EventListenerInfo = {
        id: 'test-listener',
        target: null as any,
        eventType: 'test',
        handler: jest.fn(),
        originalHandler: jest.fn(),
        context: 'test-error',
        addedAt: Date.now(),
        isActive: true
      };

      const sanitizedEvent = eventSanitizer.sanitizeEventData(problematicEvent, listenerInfo);

      expect(sanitizedEvent).toBeDefined();
      expect(sanitizedEvent.type).toBe('test');
      expect(mockEventLogger).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sanitization-error',
          severity: 'high'
        })
      );
    });
  });
});
```

## Testing Strategy

### Unit Testing
- **Input Sanitization**: Test all HTML, URL, and object sanitization scenarios
- **Event Sanitization**: Test event type-specific sanitization logic
- **Security Event Logging**: Verify proper event logging for violations
- **Error Handling**: Test graceful failure scenarios

### Integration Testing
- **Form Integration**: Test sanitized input components with real forms
- **Event Listener Integration**: Test sanitization with actual event listeners
- **React Hook Integration**: Test hooks with component lifecycle

### Security Testing
- **XSS Prevention**: Verify all XSS attack vectors are blocked
- **Injection Prevention**: Test various injection attacks
- **Origin Validation**: Test message event origin filtering
- **Depth Protection**: Test object depth limits

### Performance Testing
- **Large Input Handling**: Test performance with large inputs
- **High Frequency Events**: Test performance with rapid event firing
- **Memory Usage**: Monitor memory consumption during sanitization

## Deliverables

### New Files
1. **`apps/web/src/lib/security/sanitizer.ts`** - Core input sanitization utilities
2. **`apps/web/src/lib/security/event-sanitizer.ts`** - Event data sanitization middleware
3. **`apps/web/src/hooks/useInputSanitization.ts`** - React hooks for sanitization
4. **`apps/web/src/components/forms/sanitized-input.tsx`** - Sanitized input components
5. **`apps/web/src/__tests__/security/sanitizer.test.ts`** - Sanitization unit tests
6. **`apps/web/src/__tests__/security/event-sanitizer.test.ts`** - Event sanitization tests

### Updated Files
1. **`apps/web/src/lib/security/event-listener-manager.ts`** - Integration with sanitization
2. **`apps/web/package.json`** - Add DOMPurify dependency

### Dependencies
```json
{
  "dompurify": "^3.0.5",
  "@types/dompurify": "^3.0.2"
}
```

## Success Criteria

### Functional Requirements
- ✅ All HTML inputs are sanitized before processing
- ✅ Event data is sanitized before reaching handlers
- ✅ URLs are validated and dangerous protocols blocked
- ✅ Object properties are sanitized recursively
- ✅ Security events are logged for all violations

### Security Requirements
- ✅ XSS attacks are prevented through input sanitization
- ✅ Message events from unauthorized origins are blocked
- ✅ Object depth limits prevent stack overflow attacks
- ✅ All sanitization failures are logged and handled gracefully

### Performance Requirements
- ✅ Sanitization processing time < 50ms for typical inputs
- ✅ Memory usage remains stable during high-frequency events
- ✅ No impact on application responsiveness

### Testing Requirements
- ✅ Unit test coverage > 95% for sanitization logic
- ✅ Integration tests for all event types
- ✅ Security tests for common attack vectors
- ✅ Performance tests under load conditions

## Timeline

### Phase 1: Core Sanitization (6-8 hours)
- InputSanitizer class implementation
- HTML, URL, and object sanitization methods
- Basic unit tests

### Phase 2: Event Integration (4-5 hours)
- EventDataSanitizer implementation
- Event type-specific sanitization
- Integration with event listener manager

### Phase 3: React Integration (3-4 hours)
- React hooks implementation
- Sanitized input components
- Component integration tests

### Phase 4: Testing & Validation (3-4 hours)
- Comprehensive test suite
- Security testing
- Performance validation
- Documentation updates

## Risk Assessment

### High Risk
- **Performance Impact**: Sanitization overhead might affect user experience
- **False Positives**: Over-sanitization might break legitimate functionality

### Medium Risk
- **Integration Complexity**: Integration with existing event system
- **Testing Coverage**: Ensuring all attack vectors are covered

### Low Risk
- **Dependency Management**: DOMPurify is well-maintained and widely used
- **Backward Compatibility**: Sanitization is additive and non-breaking

### Mitigation Strategies
- Implement performance monitoring and optimization
- Create comprehensive allowlists for legitimate content
- Use established libraries (DOMPurify) with proven security records
- Implement gradual rollout with monitoring

This implementation plan provides comprehensive input sanitization for all event data, protecting against XSS attacks and other security vulnerabilities while maintaining application performance and user experience.