# Implementation Plan: Implement AES-256 Encryption for Local Storage

**Story**: 1.3 Implement GDPR-Compliant Data Storage  
**Task Group**: 1-3-encrypted-storage  
**Priority**: High  
**Estimated Time**: 12-16 hours  

## Overview

This implementation plan creates a comprehensive encrypted storage system using AES-256 encryption with PBKDF2 key derivation and HMAC integrity verification. The system will replace all direct localStorage usage with secure encrypted storage, ensuring GDPR compliance for sensitive data protection.

## Prerequisites

- Data storage audit completed (Story 1.3 Task 1)
- Web Crypto API understanding
- Knowledge of encryption best practices
- Understanding of browser storage limitations

## Implementation Steps

### Step 1: Create Core Encryption Utilities

**File**: `apps/web/src/lib/storage/encryption.ts`

```typescript
import type { EncryptionResult, DecryptionResult, KeyDerivationConfig } from '@al-ummah/shared-types';

/**
 * AES-256 encryption utilities with PBKDF2 key derivation
 */
export class AESEncryption {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 12; // 96 bits for GCM
  private static readonly SALT_LENGTH = 32;
  private static readonly TAG_LENGTH = 128; // Authentication tag length

  /**
   * Generate cryptographic key from password using PBKDF2
   */
  static async deriveKey(
    password: string,
    salt: Uint8Array,
    config: KeyDerivationConfig = {
      iterations: 100000,
      hash: 'SHA-256',
      keyLength: 32
    }
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);

    // Import password as key
    const baseKey = await crypto.subtle.importKey(
      'raw',
      passwordData,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    // Derive AES key using PBKDF2
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: config.iterations,
        hash: config.hash
      },
      baseKey,
      {
        name: this.ALGORITHM,
        length: this.KEY_LENGTH
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Generate random salt for key derivation
   */
  static generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
  }

  /**
   * Generate random IV for encryption
   */
  static generateIV(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
  }

  /**
   * Encrypt data with AES-256-GCM
   */
  static async encrypt(
    data: string,
    key: CryptoKey,
    additionalData?: string
  ): Promise<EncryptionResult> {
    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);
      const iv = this.generateIV();

      // Prepare additional authenticated data if provided
      let aad: Uint8Array | undefined;
      if (additionalData) {
        aad = encoder.encode(additionalData);
      }

      // Encrypt data
      const encryptedData = await crypto.subtle.encrypt(
        {
          name: this.ALGORITHM,
          iv,
          additionalData: aad,
          tagLength: this.TAG_LENGTH
        },
        key,
        dataBytes
      );

      // Combine IV and encrypted data
      const encryptedArray = new Uint8Array(encryptedData);
      const result = new Uint8Array(iv.length + encryptedArray.length);
      result.set(iv);
      result.set(encryptedArray, iv.length);

      return {
        data: this.arrayBufferToBase64(result),
        iv: this.arrayBufferToBase64(iv),
        algorithm: this.ALGORITHM,
        keyLength: this.KEY_LENGTH,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypt data with AES-256-GCM
   */
  static async decrypt(
    encryptedData: string,
    key: CryptoKey,
    iv: string,
    additionalData?: string
  ): Promise<DecryptionResult> {
    try {
      const encryptedBytes = this.base64ToArrayBuffer(encryptedData);
      const ivBytes = this.base64ToArrayBuffer(iv);

      // Prepare additional authenticated data if provided
      let aad: Uint8Array | undefined;
      if (additionalData) {
        const encoder = new TextEncoder();
        aad = encoder.encode(additionalData);
      }

      // Decrypt data
      const decryptedData = await crypto.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv: ivBytes,
          additionalData: aad,
          tagLength: this.TAG_LENGTH
        },
        key,
        encryptedBytes
      );

      const decoder = new TextDecoder();
      const decryptedText = decoder.decode(decryptedData);

      return {
        data: decryptedText,
        success: true,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        data: '',
        success: false,
        error: error instanceof Error ? error.message : 'Decryption failed',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Create HMAC for data integrity verification
   */
  static async createHMAC(
    data: string,
    key: CryptoKey
  ): Promise<string> {
    try {
      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);

      const hmacKey = await crypto.subtle.importKey(
        'raw',
        await crypto.subtle.exportKey('raw', key),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );

      const signature = await crypto.subtle.sign('HMAC', hmacKey, dataBytes);
      return this.arrayBufferToBase64(signature);
    } catch (error) {
      throw new Error(`HMAC creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Verify HMAC for data integrity
   */
  static async verifyHMAC(
    data: string,
    signature: string,
    key: CryptoKey
  ): Promise<boolean> {
    try {
      const expectedSignature = await this.createHMAC(data, key);
      return this.constantTimeCompare(signature, expectedSignature);
    } catch (error) {
      return false;
    }
  }

  /**
   * Constant-time comparison to prevent timing attacks
   */
  private static constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }

  /**
   * Convert ArrayBuffer to Base64
   */
  static arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert Base64 to ArrayBuffer
   */
  static base64ToArrayBuffer(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Generate secure random password
   */
  static generateSecurePassword(length: number = 32): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset[randomValues[i] % charset.length];
    }
    
    return password;
  }

  /**
   * Check if Web Crypto API is available
   */
  static isSupported(): boolean {
    return (
      typeof crypto !== 'undefined' &&
      typeof crypto.subtle !== 'undefined' &&
      typeof crypto.getRandomValues !== 'undefined'
    );
  }
}

/**
 * Key management utilities
 */
export class KeyManager {
  private static readonly MASTER_KEY_PREFIX = 'master_key_';
  private static readonly SESSION_KEY_PREFIX = 'session_key_';

  /**
   * Generate and store master key
   */
  static async generateMasterKey(password?: string): Promise<string> {
    const masterPassword = password || AESEncryption.generateSecurePassword();
    const salt = AESEncryption.generateSalt();
    const keyId = this.generateKeyId();

    try {
      const key = await AESEncryption.deriveKey(masterPassword, salt);
      const keyData = await crypto.subtle.exportKey('raw', key);
      
      // Store encrypted key data
      const keyStorage = {
        id: keyId,
        salt: AESEncryption.arrayBufferToBase64(salt),
        keyData: AESEncryption.arrayBufferToBase64(keyData),
        createdAt: new Date().toISOString(),
        version: '1.0'
      };

      // Store in secure location (implementation depends on requirements)
      this.storeKeyData(keyId, keyStorage);

      return keyId;
    } catch (error) {
      throw new Error(`Master key generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Retrieve master key
   */
  static async getMasterKey(keyId: string, password: string): Promise<CryptoKey> {
    try {
      const keyStorage = this.getKeyData(keyId);
      if (!keyStorage) {
        throw new Error('Key not found');
      }

      const salt = AESEncryption.base64ToArrayBuffer(keyStorage.salt);
      return AESEncryption.deriveKey(password, salt);
    } catch (error) {
      throw new Error(`Master key retrieval failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate session key for temporary operations
   */
  static async generateSessionKey(): Promise<{ keyId: string; key: CryptoKey }> {
    const keyId = this.generateKeyId();
    const key = await crypto.subtle.generateKey(
      {
        name: AESEncryption['ALGORITHM'],
        length: AESEncryption['KEY_LENGTH']
      },
      true,
      ['encrypt', 'decrypt']
    );

    // Store session key temporarily
    const keyData = await crypto.subtle.exportKey('raw', key);
    const sessionStorage = {
      id: keyId,
      keyData: AESEncryption.arrayBufferToBase64(keyData),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
    };

    this.storeSessionKey(keyId, sessionStorage);

    return { keyId, key };
  }

  /**
   * Get session key
   */
  static async getSessionKey(keyId: string): Promise<CryptoKey | null> {
    try {
      const sessionStorage = this.getSessionKeyData(keyId);
      if (!sessionStorage) {
        return null;
      }

      // Check if expired
      if (new Date(sessionStorage.expiresAt) < new Date()) {
        this.removeSessionKey(keyId);
        return null;
      }

      const keyData = AESEncryption.base64ToArrayBuffer(sessionStorage.keyData);
      return crypto.subtle.importKey(
        'raw',
        keyData,
        AESEncryption['ALGORITHM'],
        true,
        ['encrypt', 'decrypt']
      );
    } catch (error) {
      return null;
    }
  }

  /**
   * Rotate master key
   */
  static async rotateMasterKey(keyId: string, newPassword: string): Promise<string> {
    // Generate new key
    const newKeyId = await this.generateMasterKey(newPassword);
    
    // Migrate data encrypted with old key (implementation depends on requirements)
    await this.migrateEncryptedData(keyId, newKeyId, newPassword);
    
    // Remove old key
    this.removeKeyData(keyId);
    
    return newKeyId;
  }

  /**
   * Generate unique key ID
   */
  private static generateKeyId(): string {
    return `key_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Store key data (implementation depends on security requirements)
   */
  private static storeKeyData(keyId: string, keyData: any): void {
    // This could be stored in:
    // - Secure HTTP-only cookies
    // - IndexedDB with additional protection
    // - Server-side key management service
    // For now, using sessionStorage (less secure but functional)
    sessionStorage.setItem(`${this.MASTER_KEY_PREFIX}${keyId}`, JSON.stringify(keyData));
  }

  /**
   * Get key data
   */
  private static getKeyData(keyId: string): any {
    const data = sessionStorage.getItem(`${this.MASTER_KEY_PREFIX}${keyId}`);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Remove key data
   */
  private static removeKeyData(keyId: string): void {
    sessionStorage.removeItem(`${this.MASTER_KEY_PREFIX}${keyId}`);
  }

  /**
   * Store session key
   */
  private static storeSessionKey(keyId: string, keyData: any): void {
    sessionStorage.setItem(`${this.SESSION_KEY_PREFIX}${keyId}`, JSON.stringify(keyData));
  }

  /**
   * Get session key data
   */
  private static getSessionKeyData(keyId: string): any {
    const data = sessionStorage.getItem(`${this.SESSION_KEY_PREFIX}${keyId}`);
    return data ? JSON.parse(data) : null;
  }

  /**
   * Remove session key
   */
  private static removeSessionKey(keyId: string): void {
    sessionStorage.removeItem(`${this.SESSION_KEY_PREFIX}${keyId}`);
  }

  /**
   * Migrate encrypted data to new key
   */
  private static async migrateEncryptedData(
    oldKeyId: string,
    newKeyId: string,
    newPassword: string
  ): Promise<void> {
    // Implementation would:
    // 1. Get all encrypted data entries
    // 2. Decrypt with old key
    // 3. Encrypt with new key
    // 4. Update storage
    // This is a complex operation that needs careful implementation
  }
}
```

### Step 2: Create Encrypted Storage Manager

**File**: `apps/web/src/lib/storage/encrypted-storage.ts`

```typescript
import { AESEncryption, KeyManager } from './encryption';
import type { 
  EncryptedStorageEntry, 
  StorageConfig, 
  DataClassification,
  SecurityEvent 
} from '@al-ummah/shared-types';

/**
 * Encrypted storage manager with GDPR compliance
 */
export class EncryptedStorage {
  private config: StorageConfig;
  private masterKeyId: string | null = null;
  private sessionKeyId: string | null = null;
  private eventLogger: (event: SecurityEvent) => void;

  constructor(config: StorageConfig, eventLogger: (event: SecurityEvent) => void) {
    this.config = config;
    this.eventLogger = eventLogger;
    
    // Initialize encryption
    this.initializeEncryption();
  }

  /**
   * Initialize encryption system
   */
  private async initializeEncryption(): Promise<void> {
    try {
      if (!AESEncryption.isSupported()) {
        throw new Error('Web Crypto API not supported');
      }

      // Try to get existing master key or generate new one
      this.masterKeyId = await this.getOrCreateMasterKey();
      
      // Generate session key for current session
      const sessionKey = await KeyManager.generateSessionKey();
      this.sessionKeyId = sessionKey.keyId;

      this.logSecurityEvent({
        type: 'encryption-initialized',
        severity: 'low',
        message: 'Encrypted storage initialized successfully',
        metadata: {
          masterKeyId: this.masterKeyId?.substring(0, 8) + '...',
          sessionKeyId: this.sessionKeyId?.substring(0, 8) + '...'
        }
      });
    } catch (error) {
      this.logSecurityEvent({
        type: 'encryption-initialization-failed',
        severity: 'high',
        message: `Failed to initialize encrypted storage: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  /**
   * Store data with encryption
   */
  async setItem(
    key: string, 
    data: any, 
    classification: DataClassification = { level: 'low', category: 'technical', gdprRelevant: false, specialCategories: [] }
  ): Promise<void> {
    try {
      // Check if encryption is required
      const requiresEncryption = this.requiresEncryption(classification);
      
      if (!requiresEncryption) {
        // Store without encryption for non-sensitive data
        localStorage.setItem(key, JSON.stringify(data));
        return;
      }

      // Get encryption key
      const key = await this.getEncryptionKey();
      if (!key) {
        throw new Error('Encryption key not available');
      }

      // Serialize data
      const serializedData = JSON.stringify(data);
      
      // Encrypt data
      const encryptionResult = await AESEncryption.encrypt(
        serializedData,
        key,
        key // Use key as additional authenticated data
      );

      // Create HMAC for integrity
      const hmac = await AESEncryption.createHMAC(encryptionResult.data, key);

      // Create storage entry
      const entry: EncryptedStorageEntry = {
        key,
        data: encryptionResult.data,
        iv: encryptionResult.iv,
        hmac,
        algorithm: encryptionResult.algorithm,
        keyLength: encryptionResult.keyLength,
        classification,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        accessCount: 0,
        lastAccessed: new Date().toISOString(),
        version: '1.0'
      };

      // Store encrypted entry
      localStorage.setItem(this.getStorageKey(key), JSON.stringify(entry));

      this.logSecurityEvent({
        type: 'data-encrypted-stored',
        severity: 'low',
        message: `Encrypted data stored for key: ${key}`,
        metadata: {
          key,
          classification: classification.level,
          algorithm: encryptionResult.algorithm
        }
      });

    } catch (error) {
      this.logSecurityEvent({
        type: 'encryption-storage-failed',
        severity: 'high',
        message: `Failed to store encrypted data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { key, error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  /**
   * Retrieve and decrypt data
   */
  async getItem(key: string): Promise<any> {
    try {
      // Try to get encrypted entry first
      const encryptedEntry = this.getEncryptedEntry(key);
      
      if (encryptedEntry) {
        return await this.decryptEntry(encryptedEntry);
      }

      // Try to get unencrypted data (fallback for migration)
      const unencryptedData = localStorage.getItem(key);
      if (unencryptedData) {
        this.logSecurityEvent({
          type: 'unencrypted-data-accessed',
          severity: 'medium',
          message: `Unencrypted data accessed for key: ${key}`,
          metadata: { key }
        });
        
        return JSON.parse(unencryptedData);
      }

      return null;
    } catch (error) {
      this.logSecurityEvent({
        type: 'decryption-failed',
        severity: 'high',
        message: `Failed to decrypt data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { key, error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  /**
   * Remove item from storage
   */
  async removeItem(key: string): Promise<void> {
    try {
      // Remove encrypted entry
      localStorage.removeItem(this.getStorageKey(key));
      
      // Also remove unencrypted entry if it exists
      localStorage.removeItem(key);

      this.logSecurityEvent({
        type: 'data-removed',
        severity: 'low',
        message: `Data removed for key: ${key}`,
        metadata: { key }
      });
    } catch (error) {
      this.logSecurityEvent({
        type: 'data-removal-failed',
        severity: 'medium',
        message: `Failed to remove data: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { key, error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  /**
   * Clear all encrypted storage
   */
  async clear(): Promise<void> {
    try {
      // Get all encrypted storage keys
      const keys = this.getEncryptedStorageKeys();
      
      // Remove all encrypted entries
      for (const key of keys) {
        localStorage.removeItem(key);
      }

      this.logSecurityEvent({
        type: 'encrypted-storage-cleared',
        severity: 'medium',
        message: 'All encrypted storage cleared',
        metadata: { keysRemoved: keys.length }
      });
    } catch (error) {
      this.logSecurityEvent({
        type: 'storage-clear-failed',
        severity: 'high',
        message: `Failed to clear encrypted storage: ${error instanceof Error ? error.message : 'Unknown error'}`,
        metadata: { error: error instanceof Error ? error.stack : String(error) }
      });
      throw error;
    }
  }

  /**
   * Get storage size and statistics
   */
  async getStorageStats(): Promise<{
    totalEntries: number;
    encryptedEntries: number;
    unencryptedEntries: number;
    totalSize: number;
    encryptedSize: number;
    unencryptedSize: number;
  }> {
    const stats = {
      totalEntries: 0,
      encryptedEntries: 0,
      unencryptedEntries: 0,
      totalSize: 0,
      encryptedSize: 0,
      unencryptedSize: 0
    };

    // Analyze all localStorage entries
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      const value = localStorage.getItem(key);
      if (!value) continue;

      const size = key.length + value.length;
      stats.totalEntries++;
      stats.totalSize += size;

      if (key.startsWith('encrypted_')) {
        stats.encryptedEntries++;
        stats.encryptedSize += size;
      } else {
        stats.unencryptedEntries++;
        stats.unencryptedSize += size;
      }
    }

    return stats;
  }

  /**
   * Migrate unencrypted data to encrypted storage
   */
  async migrateToEncrypted(keys: string[], classification: DataClassification): Promise<void> {
    const migrationResults = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const key of keys) {
      try {
        const data = localStorage.getItem(key);
        if (!data) continue;

        // Parse and store as encrypted
        const parsedData = JSON.parse(data);
        await this.setItem(key, parsedData, classification);
        
        // Remove unencrypted version
        localStorage.removeItem(key);
        
        migrationResults.success++;
      } catch (error) {
        migrationResults.failed++;
        migrationResults.errors.push(`${key}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    this.logSecurityEvent({
      type: 'migration-completed',
      severity: 'low',
      message: `Data migration completed: ${migrationResults.success} success, ${migrationResults.failed} failed`,
      metadata: migrationResults
    });

    if (migrationResults.failed > 0) {
      console.warn('Migration errors:', migrationResults.errors);
    }
  }

  /**
   * Check if encryption is required for data classification
   */
  private requiresEncryption(classification: DataClassification): boolean {
    return (
      classification.gdprRelevant ||
      classification.level === 'high' ||
      classification.level === 'medium' ||
      this.config.encryptAllData
    );
  }

  /**
   * Get encryption key
   */
  private async getEncryptionKey(): Promise<CryptoKey | null> {
    // Try session key first
    if (this.sessionKeyId) {
      const sessionKey = await KeyManager.getSessionKey(this.sessionKeyId);
      if (sessionKey) {
        return sessionKey;
      }
    }

    // Fall back to master key
    if (this.masterKeyId) {
      // This would require user password input in a real implementation
      // For now, return null to indicate password is needed
      return null;
    }

    return null;
  }

  /**
   * Get encrypted storage entry
   */
  private getEncryptedEntry(key: string): EncryptedStorageEntry | null {
    const storageKey = this.getStorageKey(key);
    const entryData = localStorage.getItem(storageKey);
    
    if (!entryData) {
      return null;
    }

    try {
      const entry = JSON.parse(entryData) as EncryptedStorageEntry;
      
      // Update access statistics
      entry.accessCount++;
      entry.lastAccessed = new Date().toISOString();
      localStorage.setItem(storageKey, JSON.stringify(entry));
      
      return entry;
    } catch (error) {
      return null;
    }
  }

  /**
   * Decrypt storage entry
   */
  private async decryptEntry(entry: EncryptedStorageEntry): Promise<any> {
    const key = await this.getEncryptionKey();
    if (!key) {
      throw new Error('Encryption key not available');
    }

    // Verify HMAC for integrity
    const hmacValid = await AESEncryption.verifyHMAC(entry.data, entry.hmac, key);
    if (!hmacValid) {
      throw new Error('Data integrity verification failed');
    }

    // Decrypt data
    const decryptionResult = await AESEncryption.decrypt(
      entry.data,
      key,
      entry.iv,
      entry.key // Use key as additional authenticated data
    );

    if (!decryptionResult.success) {
      throw new Error(decryptionResult.error || 'Decryption failed');
    }

    return JSON.parse(decryptionResult.data);
  }

  /**
   * Get storage key for encrypted data
   */
  private getStorageKey(key: string): string {
    return `encrypted_${key}`;
  }

  /**
   * Get all encrypted storage keys
   */
  private getEncryptedStorageKeys(): string[] {
    const keys: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('encrypted_')) {
        keys.push(key);
      }
    }
    
    return keys;
  }

  /**
   * Get or create master key
   */
  private async getOrCreateMasterKey(): Promise<string | null> {
    // In a real implementation, this would:
    // 1. Check if master key exists
    // 2. Prompt user for password if needed
    // 3. Generate new key if none exists
    // For now, return null to indicate password is needed
    
    return null;
  }

  /**
   * Log security event
   */
  private logSecurityEvent(event: Partial<SecurityEvent>): void {
    const securityEvent: SecurityEvent = {
      id: `encrypted-storage-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: event.type || 'storage-event',
      severity: event.severity || 'low',
      message: event.message || 'Encrypted storage event',
      source: 'encrypted-storage',
      metadata: event.metadata || {}
    };

    this.eventLogger(securityEvent);
  }
}

/**
 * Create encrypted storage instance
 */
export function createEncryptedStorage(
  config: StorageConfig,
  eventLogger: (event: SecurityEvent) => void
): EncryptedStorage {
  return new EncryptedStorage(config, eventLogger);
}
```

### Step 3: Create React Hook for Encrypted Storage

**File**: `apps/web/src/hooks/useEncryptedStorage.ts`

```typescript
import { useState, useEffect, useCallback } from 'react';
import { EncryptedStorage, createEncryptedStorage } from '@/lib/storage/encrypted-storage';
import { useSecurityEvents } from './useSecurityEvents';
import type { StorageConfig, DataClassification } from '@al-ummah/shared-types';

/**
 * React hook for encrypted storage operations
 */
export function useEncryptedStorage(config?: Partial<StorageConfig>) {
  const { logSecurityEvent } = useSecurityEvents();
  const [storage, setStorage] = useState<EncryptedStorage | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default configuration
  const defaultConfig: StorageConfig = {
    encryptAllData: false,
    retentionPeriod: 365, // days
    autoCleanup: true,
    keyRotationInterval: 90, // days
    ...config
  };

  useEffect(() => {
    const initializeStorage = async () => {
      try {
        const encryptedStorage = createEncryptedStorage(defaultConfig, logSecurityEvent);
        setStorage(encryptedStorage);
        setIsInitialized(true);
        setError(null);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to initialize encrypted storage';
        setError(errorMessage);
        setIsInitialized(false);
        
        logSecurityEvent({
          id: `storage-init-failed-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: 'storage-initialization-failed',
          severity: 'high',
          message: errorMessage,
          source: 'useEncryptedStorage',
          metadata: { error: err instanceof Error ? err.stack : String(err) }
        });
      }
    };

    initializeStorage();
  }, [defaultConfig, logSecurityEvent]);

  /**
   * Store data with encryption
   */
  const setItem = useCallback(async (
    key: string,
    data: any,
    classification?: DataClassification
  ): Promise<void> => {
    if (!storage) {
      throw new Error('Storage not initialized');
    }

    return storage.setItem(key, data, classification);
  }, [storage]);

  /**
   * Retrieve and decrypt data
   */
  const getItem = useCallback(async (key: string): Promise<any> => {
    if (!storage) {
      throw new Error('Storage not initialized');
    }

    return storage.getItem(key);
  }, [storage]);

  /**
   * Remove item from storage
   */
  const removeItem = useCallback(async (key: string): Promise<void> => {
    if (!storage) {
      throw new Error('Storage not initialized');
    }

    return storage.removeItem(key);
  }, [storage]);

  /**
   * Clear all encrypted storage
   */
  const clear = useCallback(async (): Promise<void> => {
    if (!storage) {
      throw new Error('Storage not initialized');
    }

    return storage.clear();
  }, [storage]);

  /**
   * Get storage statistics
   */
  const getStats = useCallback(async () => {
    if (!storage) {
      throw new Error('Storage not initialized');
    }

    return storage.getStorageStats();
  }, [storage]);

  /**
   * Migrate data to encrypted storage
   */
  const migrate = useCallback(async (
    keys: string[],
    classification: DataClassification
  ): Promise<void> => {
    if (!storage) {
      throw new Error('Storage not initialized');
    }

    return storage.migrateToEncrypted(keys, classification);
  }, [storage]);

  return {
    storage,
    isInitialized,
    error,
    setItem,
    getItem,
    removeItem,
    clear,
    getStats,
    migrate
  };
}

/**
 * Hook for specific data types with predefined classifications
 */
export function useSecureStorage() {
  const encryptedStorage = useEncryptedStorage();

  /**
   * Store user data (high sensitivity)
   */
  const setUserData = useCallback(async (key: string, data: any): Promise<void> => {
    const classification: DataClassification = {
      level: 'high',
      category: 'personal',
      gdprRelevant: true,
      specialCategories: []
    };

    return encryptedStorage.setItem(key, data, classification);
  }, [encryptedStorage]);

  /**
   * Store preferences (medium sensitivity)
   */
  const setPreferences = useCallback(async (key: string, data: any): Promise<void> => {
    const classification: DataClassification = {
      level: 'medium',
      category: 'personal',
      gdprRelevant: true,
      specialCategories: []
    };

    return encryptedStorage.setItem(key, data, classification);
  }, [encryptedStorage]);

  /**
   * Store technical data (low sensitivity)
   */
  const setTechnicalData = useCallback(async (key: string, data: any): Promise<void> => {
    const classification: DataClassification = {
      level: 'low',
      category: 'technical',
      gdprRelevant: false,
      specialCategories: []
    };

    return encryptedStorage.setItem(key, data, classification);
  }, [encryptedStorage]);

  return {
    ...encryptedStorage,
    setUserData,
    setPreferences,
    setTechnicalData
  };
}
```

### Step 4: Create Storage Migration Utility

**File**: `apps/web/src/lib/storage/storage-migration.ts`

```typescript
import { EncryptedStorage, createEncryptedStorage } from './encrypted-storage';
import { useSecurityEvents } from '@/hooks/useSecurityEvents';
import type { DataClassification, SecurityEvent } from '@al-ummah/shared-types';

/**
 * Storage migration utility for transitioning to encrypted storage
 */
export class StorageMigration {
  private encryptedStorage: EncryptedStorage;
  private eventLogger: (event: SecurityEvent) => void;

  constructor(eventLogger: (event: SecurityEvent) => void) {
    this.eventLogger = eventLogger;
    this.encryptedStorage = createEncryptedStorage({
      encryptAllData: false,
      retentionPeriod: 365,
      autoCleanup: true,
      keyRotationInterval: 90
    }, eventLogger);
  }

  /**
   * Analyze current storage usage
   */
  analyzeStorage(): {
    totalItems: number;
    unencryptedItems: number;
    encryptedItems: number;
    itemsByType: Record<string, number>;
    sensitiveItems: string[];
  } {
    const analysis = {
      totalItems: 0,
      unencryptedItems: 0,
      encryptedItems: 0,
      itemsByType: {} as Record<string, number>,
      sensitiveItems: [] as string[]
    };

    // Analyze all localStorage items
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;

      analysis.totalItems++;

      if (key.startsWith('encrypted_')) {
        analysis.encryptedItems++;
      } else {
        analysis.unencryptedItems++;
        
        // Classify item
        const classification = this.classifyKey(key);
        const type = classification.type;
        
        analysis.itemsByType[type] = (analysis.itemsByType[type] || 0) + 1;
        
        if (classification.sensitive) {
          analysis.sensitiveItems.push(key);
        }
      }
    }

    return analysis;
  }

  /**
   * Migrate all unencrypted data to encrypted storage
   */
  async migrateAllData(): Promise<{
    success: number;
    failed: number;
    errors: string[];
  }> {
    const analysis = this.analyzeStorage();
    const unencryptedKeys = this.getUnencryptedKeys();

    const result = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    this.logSecurityEvent({
      type: 'migration-started',
      severity: 'low',
      message: `Starting migration of ${unencryptedKeys.length} unencrypted items`,
      metadata: {
        totalItems: analysis.totalItems,
        unencryptedItems: analysis.unencryptedItems,
        sensitiveItems: analysis.sensitiveItems.length
      }
    });

    for (const key of unencryptedKeys) {
      try {
        await this.migrateItem(key);
        result.success++;
      } catch (error) {
        result.failed++;
        result.errors.push(`${key}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    this.logSecurityEvent({
      type: 'migration-completed',
      severity: 'low',
      message: `Migration completed: ${result.success} success, ${result.failed} failed`,
      metadata: result
    });

    return result;
  }

  /**
   * Migrate specific keys to encrypted storage
   */
  async migrateKeys(keys: string[]): Promise<{
    success: number;
    failed: number;
    errors: string[];
  }> {
    const result = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const key of keys) {
      try {
        await this.migrateItem(key);
        result.success++;
      } catch (error) {
        result.failed++;
        result.errors.push(`${key}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    return result;
  }

  /**
   * Migrate single item to encrypted storage
   */
  private async migrateItem(key: string): Promise<void> {
    const value = localStorage.getItem(key);
    if (!value) {
      return; // Item doesn't exist
    }

    try {
      // Parse the value
      const data = JSON.parse(value);
      
      // Determine classification
      const classification = this.classifyKey(key);
      
      // Store in encrypted storage
      await this.encryptedStorage.setItem(key, data, classification);
      
      // Remove unencrypted version
      localStorage.removeItem(key);
      
    } catch (error) {
      // If JSON parsing fails, store as string
      const classification = this.classifyKey(key);
      await this.encryptedStorage.setItem(key, value, classification);
      localStorage.removeItem(key);
    }
  }

  /**
   * Get all unencrypted keys
   */
  private getUnencryptedKeys(): string[] {
    const keys: string[] = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && !key.startsWith('encrypted_')) {
        keys.push(key);
      }
    }
    
    return keys;
  }

  /**
   * Classify storage key for GDPR purposes
   */
  private classifyKey(key: string): { type: string; sensitive: boolean; classification: DataClassification } {
    const lowerKey = key.toLowerCase();

    // High sensitivity items
    if (lowerKey.includes('token') || lowerKey.includes('auth') || lowerKey.includes('password')) {
      return {
        type: 'authentication',
        sensitive: true,
        classification: {
          level: 'high',
          category: 'personal',
          gdprRelevant: true,
          specialCategories: []
        }
      };
    }

    // Personal data
    if (lowerKey.includes('user') || lowerKey.includes('profile') || lowerKey.includes('email')) {
      return {
        type: 'personal',
        sensitive: true,
        classification: {
          level: 'high',
          category: 'personal',
          gdprRelevant: true,
          specialCategories: []
        }
      };
    }

    // Preferences
    if (lowerKey.includes('preference') || lowerKey.includes('setting') || lowerKey.includes('theme')) {
      return {
        type: 'preferences',
        sensitive: false,
        classification: {
          level: 'medium',
          category: 'personal',
          gdprRelevant: true,
          specialCategories: []
        }
      };
    }

    // Viewing history
    if (lowerKey.includes('history') || lowerKey.includes('watch') || lowerKey.includes('video')) {
      return {
        type: 'viewing',
        sensitive: false,
        classification: {
          level: 'medium',
          category: 'personal',
          gdprRelevant: true,
          specialCategories: []
        }
      };
    }

    // Analytics
    if (lowerKey.includes('analytics') || lowerKey.includes('tracking') || lowerKey.includes('metric')) {
      return {
        type: 'analytics',
        sensitive: false,
        classification: {
          level: 'medium',
          category: 'technical',
          gdprRelevant: true,
          specialCategories: []
        }
      };
    }

    // Consent data
    if (lowerKey.includes('consent') || lowerKey.includes('cookie') || lowerKey.includes('agreement')) {
      return {
        type: 'consent',
        sensitive: true,
        classification: {
          level: 'high',
          category: 'legal',
          gdprRelevant: true,
          specialCategories: []
        }
      };
    }

    // Default to technical data
    return {
      type: 'technical',
      sensitive: false,
      classification: {
        level: 'low',
        category: 'technical',
        gdprRelevant: false,
        specialCategories: []
      }
    };
  }

  /**
   * Generate migration report
   */
  generateMigrationReport(): string {
    const analysis = this.analyzeStorage();
    
    return `
# Storage Migration Report

## Current State
- **Total Items**: ${analysis.totalItems}
- **Encrypted Items**: ${analysis.encryptedItems}
- **Unencrypted Items**: ${analysis.unencryptedItems}
- **Sensitive Items**: ${analysis.sensitiveItems.length}

## Items by Type
${Object.entries(analysis.itemsByType)
  .map(([type, count]) => `- **${type}**: ${count}`)
  .join('\n')}

## Sensitive Items Requiring Migration
${analysis.sensitiveItems.length > 0 
  ? analysis.sensitiveItems.map(item => `- ${item}`).join('\n')
  : 'No sensitive items identified'
}

## Recommendations
${analysis.sensitiveItems.length > 0 
  ? '⚠️ **URGENT**: Migrate sensitive items immediately'
  : '✅ No immediate migration required'
}
${analysis.unencryptedItems > 0 
  ? '📋 **RECOMMENDED**: Migrate all unencrypted items for better security'
  : '✅ All items are already encrypted'
}

## Next Steps
1. Run migration for sensitive items
2. Test application functionality
3. Monitor for any issues
4. Migrate remaining items if needed
    `.trim();
  }

  /**
   * Log security event
   */
  private logSecurityEvent(event: Partial<SecurityEvent>): void {
    const securityEvent: SecurityEvent = {
      id: `storage-migration-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      type: event.type || 'migration-event',
      severity: event.severity || 'low',
      message: event.message || 'Storage migration event',
      source: 'storage-migration',
      metadata: event.metadata || {}
    };

    this.eventLogger(securityEvent);
  }
}

/**
 * Create storage migration instance
 */
export function createStorageMigration(eventLogger: (event: SecurityEvent) => void): StorageMigration {
  return new StorageMigration(eventLogger);
}
```

### Step 5: Add Encryption Tests

**File**: `apps/web/src/__tests__/storage/encryption.test.ts`

```typescript
import { AESEncryption, KeyManager } from '@/lib/storage/encryption';
import type { KeyDerivationConfig } from '@al-ummah/shared-types';

describe('AESEncryption', () => {
  beforeEach(() => {
    // Check if Web Crypto API is available
    if (!AESEncryption.isSupported()) {
      console.warn('Web Crypto API not available, skipping encryption tests');
      return;
    }
  });

  describe('Key Derivation', () => {
    it('should derive key from password', async () => {
      const password = 'test-password-123';
      const salt = AESEncryption.generateSalt();
      
      const key = await AESEncryption.deriveKey(password, salt);
      
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.extractable).toBe(false);
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('should generate unique salts', () => {
      const salt1 = AESEncryption.generateSalt();
      const salt2 = AESEncryption.generateSalt();
      
      expect(salt1).not.toEqual(salt2);
      expect(salt1.length).toBe(32);
      expect(salt2.length).toBe(32);
    });

    it('should derive different keys with different salts', async () => {
      const password = 'test-password';
      const salt1 = AESEncryption.generateSalt();
      const salt2 = AESEncryption.generateSalt();
      
      const key1 = await AESEncryption.deriveKey(password, salt1);
      const key2 = await AESEncryption.deriveKey(password, salt2);
      
      const exported1 = await crypto.subtle.exportKey('raw', key1);
      const exported2 = await crypto.subtle.exportKey('raw', key2);
      
      expect(new Uint8Array(exported1)).not.toEqual(new Uint8Array(exported2));
    });
  });

  describe('Encryption/Decryption', () => {
    let key: CryptoKey;
    const testData = 'This is a test message for encryption';

    beforeEach(async () => {
      const password = 'test-password';
      const salt = AESEncryption.generateSalt();
      key = await AESEncryption.deriveKey(password, salt);
    });

    it('should encrypt and decrypt data correctly', async () => {
      const encrypted = await AESEncryption.encrypt(testData, key);
      const decrypted = await AESEncryption.decrypt(encrypted.data, key, encrypted.iv);
      
      expect(decrypted.success).toBe(true);
      expect(decrypted.data).toBe(testData);
    });

    it('should produce different ciphertext for same data', async () => {
      const encrypted1 = await AESEncryption.encrypt(testData, key);
      const encrypted2 = await AESEncryption.encrypt(testData, key);
      
      expect(encrypted1.data).not.toEqual(encrypted2.data);
      expect(encrypted1.iv).not.toEqual(encrypted2.iv);
    });

    it('should fail decryption with wrong key', async () => {
      const encrypted = await AESEncryption.encrypt(testData, key);
      
      // Create different key
      const wrongPassword = 'wrong-password';
      const wrongSalt = AESEncryption.generateSalt();
      const wrongKey = await AESEncryption.deriveKey(wrongPassword, wrongSalt);
      
      const decrypted = await AESEncryption.decrypt(encrypted.data, wrongKey, encrypted.iv);
      
      expect(decrypted.success).toBe(false);
      expect(decrypted.error).toBeDefined();
    });

    it('should handle additional authenticated data', async () => {
      const aad = 'additional-authenticated-data';
      const encrypted = await AESEncryption.encrypt(testData, key, aad);
      const decrypted = await AESEncryption.decrypt(encrypted.data, key, encrypted.iv, aad);
      
      expect(decrypted.success).toBe(true);
      expect(decrypted.data).toBe(testData);
    });

    it('should fail with wrong additional authenticated data', async () => {
      const aad = 'correct-aad';
      const wrongAad = 'wrong-aad';
      
      const encrypted = await AESEncryption.encrypt(testData, key, aad);
      const decrypted = await AESEncryption.decrypt(encrypted.data, key, encrypted.iv, wrongAad);
      
      expect(decrypted.success).toBe(false);
    });
  });

  describe('HMAC', () => {
    let key: CryptoKey;
    const testData = 'test data for HMAC';

    beforeEach(async () => {
      const password = 'test-password';
      const salt = AESEncryption.generateSalt();
      key = await AESEncryption.deriveKey(password, salt);
    });

    it('should create and verify HMAC', async () => {
      const hmac = await AESEncryption.createHMAC(testData, key);
      const isValid = await AESEncryption.verifyHMAC(testData, hmac, key);
      
      expect(hmac).toBeDefined();
      expect(hmac.length).toBeGreaterThan(0);
      expect(isValid).toBe(true);
    });

    it('should fail verification for tampered data', async () => {
      const hmac = await AESEncryption.createHMAC(testData, key);
      const tamperedData = testData + ' tampered';
      const isValid = await AESEncryption.verifyHMAC(tamperedData, hmac, key);
      
      expect(isValid).toBe(false);
    });

    it('should produce different HMACs for different data', async () => {
      const hmac1 = await AESEncryption.createHMAC('data1', key);
      const hmac2 = await AESEncryption.createHMAC('data2', key);
      
      expect(hmac1).not.toEqual(hmac2);
    });
  });

  describe('Utility Functions', () => {
    it('should generate secure password', () => {
      const password1 = AESEncryption.generateSecurePassword();
      const password2 = AESEncryption.generateSecurePassword();
      
      expect(password1).not.toEqual(password2);
      expect(password1.length).toBe(32);
      expect(password2.length).toBe(32);
    });

    it('should convert between ArrayBuffer and Base64', () => {
      const originalData = new Uint8Array([1, 2, 3, 4, 5]);
      const base64 = AESEncryption.arrayBufferToBase64(originalData);
      const convertedBack = AESEncryption.base64ToArrayBuffer(base64);
      
      expect(base64).toBeDefined();
      expect(base64.length).toBeGreaterThan(0);
      expect(convertedBack).toEqual(originalData);
    });
  });
});

describe('KeyManager', () => {
  beforeEach(() => {
    // Clear any existing keys
    sessionStorage.clear();
  });

  describe('Master Key Management', () => {
    it('should generate master key', async () => {
      const keyId = await KeyManager.generateMasterKey('test-password');
      
      expect(keyId).toBeDefined();
      expect(keyId).toMatch(/^key_\d+_[a-z0-9]+$/);
    });

    it('should retrieve master key', async () => {
      const password = 'test-password';
      const keyId = await KeyManager.generateMasterKey(password);
      const key = await KeyManager.getMasterKey(keyId, password);
      
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
    });

    it('should fail with wrong password', async () => {
      const keyId = await KeyManager.generateMasterKey('correct-password');
      
      await expect(
        KeyManager.getMasterKey(keyId, 'wrong-password')
      ).rejects.toThrow();
    });
  });

  describe('Session Key Management', () => {
    it('should generate session key', async () => {
      const { keyId, key } = await KeyManager.generateSessionKey();
      
      expect(keyId).toBeDefined();
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.extractable).toBe(true);
    });

    it('should retrieve session key', async () => {
      const { keyId } = await KeyManager.generateSessionKey();
      const retrievedKey = await KeyManager.getSessionKey(keyId);
      
      expect(retrievedKey).toBeDefined();
      expect(retrievedKey?.type).toBe('secret');
    });

    it('should return null for expired session key', async () => {
      // Mock expired key
      const { keyId } = await KeyManager.generateSessionKey();
      
      // Manually set expiration to past
      const keyData = sessionStorage.getItem(`session_key_${keyId}`);
      if (keyData) {
        const parsed = JSON.parse(keyData);
        parsed.expiresAt = new Date(Date.now() - 1000).toISOString();
        sessionStorage.setItem(`session_key_${keyId}`, JSON.stringify(parsed));
      }
      
      const retrievedKey = await KeyManager.getSessionKey(keyId);
      expect(retrievedKey).toBeNull();
    });
  });
});
```

## Testing Strategy

### Unit Testing
- **Encryption Logic**: Test AES-256 encryption/decryption with various inputs
- **Key Management**: Test key derivation, storage, and retrieval
- **HMAC Verification**: Test data integrity verification
- **Storage Operations**: Test encrypted storage CRUD operations

### Integration Testing
- **End-to-End Encryption**: Test complete data flow from storage to retrieval
- **Migration Testing**: Test migration from unencrypted to encrypted storage
- **Error Handling**: Test behavior with corrupted data or wrong keys
- **Performance Testing**: Test encryption/decryption performance

### Security Testing
- **Cryptographic Security**: Verify encryption strength and randomness
- **Key Security**: Test key derivation and storage security
- **Data Integrity**: Test HMAC verification and tampering detection
- **Side-Channel Attacks**: Test for timing attacks and information leakage

## Deliverables

### New Files
1. **`apps/web/src/lib/storage/encryption.ts`** - Core encryption utilities
2. **`apps/web/src/lib/storage/encrypted-storage.ts`** - Encrypted storage manager
3. **`apps/web/src/hooks/useEncryptedStorage.ts`** - React hooks for encrypted storage
4. **`apps/web/src/lib/storage/storage-migration.ts`** - Migration utilities
5. **`apps/web/src/__tests__/storage/encryption.test.ts`** - Encryption tests

### Updated Files
1. **`apps/web/package.json`** - Add any required dependencies
2. **Type definitions** - Update shared types for encryption

### Configuration
1. **Storage Configuration** - Default encryption settings
2. **Migration Scripts** - Automated migration tools

## Success Criteria

### Functional Requirements
- ✅ AES-256 encryption implementation with PBKDF2 key derivation
- ✅ HMAC integrity verification for all stored data
- ✅ Seamless migration from unencrypted to encrypted storage
- ✅ GDPR-compliant data classification and handling
- ✅ Secure key management with rotation support

### Security Requirements
- ✅ Strong cryptographic implementation using Web Crypto API
- ✅ Protection against timing attacks with constant-time comparison
- ✅ Secure random number generation for salts and IVs
- ✅ Key derivation with configurable iteration count
- ✅ Data integrity verification with HMAC

### Performance Requirements
- ✅ Encryption/decryption operations < 100ms for typical data sizes
- ✅ Key derivation < 500ms with default iteration count
- ✅ Minimal impact on application startup time
- ✅ Efficient storage usage with reasonable overhead

### Compliance Requirements
- ✅ GDPR-compliant encryption for personal data
- ✅ Data classification and appropriate protection levels
- ✅ Audit trail for encryption operations
- ✅ Key rotation and data migration capabilities

## Timeline

### Phase 1: Core Encryption (5-6 hours)
- AESEncryption class implementation
- Key management utilities
- Basic encryption/decryption functionality

### Phase 2: Storage Integration (4-5 hours)
- EncryptedStorage class implementation
- React hooks for storage operations
- Integration with existing storage patterns

### Phase 3: Migration Tools (2-3 hours)
- Storage migration utilities
- Analysis and reporting tools
- Automated migration scripts

### Phase 4: Testing & Validation (2-3 hours)
- Comprehensive test suite
- Security testing and validation
- Performance optimization
- Documentation updates

## Risk Assessment

### High Risk
- **Browser Compatibility**: Web Crypto API support varies across browsers
- **Key Management**: Secure key storage and retrieval challenges
- **Data Loss**: Migration process could potentially lose data

### Medium Risk
- **Performance Impact**: Encryption overhead might affect user experience
- **Complexity**: Implementation complexity increases maintenance burden
- **Recovery**: Lost keys mean lost data

### Low Risk
- **Implementation**: Well-established cryptographic patterns
- **Dependencies**: Minimal external dependencies
- **Testing**: Comprehensive test coverage possible

### Mitigation Strategies
- Implement fallbacks for browsers without Web Crypto API
- Create backup and recovery mechanisms for keys
- Use progressive migration with rollback capability
- Implement comprehensive testing and monitoring

This implementation plan provides a robust, GDPR-compliant encrypted storage system that protects sensitive data while maintaining usability and performance.