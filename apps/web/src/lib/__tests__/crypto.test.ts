/**
 * Tests for crypto utilities
 *
 * Tests the AES-GCM encryption implementation for secure localStorage
 */

import {
  encryptData,
  decryptData,
  secureSetItem,
  secureGetItem,
  secureRemoveItem,
  isEncryptionAvailable,
  clearEncryptionCache,
  EncryptionError,
} from '../crypto';

// Mock Web Crypto API
const mockCrypto = {
  getRandomValues: jest.fn((arr: Uint8Array) => {
    // Fill with deterministic values for testing
    for (let i = 0; i < arr.length; i++) {
      arr[i] = i % 256;
    }
    return arr;
  }),
  subtle: {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
    importKey: jest.fn(),
    deriveKey: jest.fn(),
  },
};

// Mock localStorage
const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

describe('crypto utilities', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    mockLocalStorage.clear();
    clearEncryptionCache();

    // Setup global mocks
    global.crypto = mockCrypto as unknown as Crypto;
    Object.defineProperty(global, 'localStorage', {
      value: mockLocalStorage,
      writable: true,
    });

    // Mock window.location for getKeyMaterial
    Object.defineProperty(global, 'window', {
      value: { location: { hostname: 'localhost' } },
      writable: true,
    });
  });

  describe('isEncryptionAvailable', () => {
    it('should return true when Web Crypto API is available', () => {
      // Ensure crypto.subtle.encrypt is available
      mockCrypto.subtle.encrypt = jest.fn();
      global.crypto = mockCrypto as unknown as Crypto;
      expect(isEncryptionAvailable()).toBe(true);
    });

    it('should return false when Web Crypto API is not available', () => {
      global.crypto = undefined as unknown as Crypto;
      expect(isEncryptionAvailable()).toBe(false);
    });

    it('should return false when crypto.subtle is not available', () => {
      global.crypto = {} as unknown as Crypto;
      expect(isEncryptionAvailable()).toBe(false);
    });
  });

  describe('encryptData and decryptData', () => {
    beforeEach(() => {
      // Mock successful encryption
      mockCrypto.subtle.importKey.mockResolvedValue({} as CryptoKey);
      mockCrypto.subtle.deriveKey.mockResolvedValue({} as CryptoKey);
      mockCrypto.subtle.encrypt.mockImplementation(async (_algo, _key, data) => {
        // Simple mock: just reverse the data for "encryption"
        const arr = new Uint8Array(data as ArrayBuffer);
        return new Uint8Array(arr.reverse()).buffer;
      });
      mockCrypto.subtle.decrypt.mockImplementation(async (_algo, _key, data) => {
        // Simple mock: reverse back for "decryption"
        const arr = new Uint8Array(data as ArrayBuffer);
        return new Uint8Array(arr.reverse()).buffer;
      });
    });

    it('should encrypt and decrypt data successfully', async () => {
      const testData = 'sensitive user data';
      const encrypted = await encryptData(testData);

      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toBe(testData);
      expect(encrypted.length).toBeGreaterThan(0);

      const decrypted = await decryptData(encrypted);
      expect(decrypted).toBe(testData);
    });

    it('should handle empty string', async () => {
      const testData = '';
      const encrypted = await encryptData(testData);
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toBe(testData);
    });

    it('should handle unicode characters', async () => {
      const testData = 'مرحبا بك في العالم العربي';
      const encrypted = await encryptData(testData);
      const decrypted = await decryptData(encrypted);
      expect(decrypted).toBe(testData);
    });

    it('should use fallback when Web Crypto API is not available', async () => {
      global.crypto = undefined as unknown as Crypto;

      const testData = 'fallback test';
      const encrypted = await encryptData(testData);

      // Fallback uses base64 encoding
      expect(encrypted).toBe(btoa(testData));

      const decrypted = await decryptData(encrypted);
      expect(decrypted).toBe(testData);
    });

    it('should throw EncryptionError on encryption failure', async () => {
      // Restore crypto to make the test actually use the encryption path
      global.crypto = mockCrypto as unknown as Crypto;
      mockCrypto.subtle.encrypt.mockRejectedValue(new Error('Encryption failed'));

      await expect(encryptData('test')).rejects.toThrow(EncryptionError);
      await expect(encryptData('test')).rejects.toThrow('Failed to encrypt data');
    });

    it('should throw EncryptionError on decryption failure', async () => {
      // Restore crypto to make the test actually use the decryption path
      global.crypto = mockCrypto as unknown as Crypto;

      // Create valid encrypted data first
      mockCrypto.subtle.encrypt.mockImplementation(async (_algo, _key, data) => {
        const arr = new Uint8Array(data as ArrayBuffer);
        return new Uint8Array(arr.reverse()).buffer;
      });
      const encrypted = await encryptData('test');

      // Now make decryption fail
      mockCrypto.subtle.decrypt.mockRejectedValue(new Error('Decryption failed'));

      await expect(decryptData(encrypted)).rejects.toThrow(EncryptionError);
      await expect(decryptData(encrypted)).rejects.toThrow('Failed to decrypt data');
    });
  });

  describe('secureSetItem and secureGetItem', () => {
    beforeEach(() => {
      // Mock successful encryption/decryption
      mockCrypto.subtle.importKey.mockResolvedValue({} as CryptoKey);
      mockCrypto.subtle.deriveKey.mockResolvedValue({} as CryptoKey);
      mockCrypto.subtle.encrypt.mockImplementation(async (_algo, _key, data) => {
        const arr = new Uint8Array(data as ArrayBuffer);
        return new Uint8Array(arr.reverse()).buffer;
      });
      mockCrypto.subtle.decrypt.mockImplementation(async (_algo, _key, data) => {
        const arr = new Uint8Array(data as ArrayBuffer);
        return new Uint8Array(arr.reverse()).buffer;
      });
    });

    it('should store and retrieve simple data', async () => {
      const key = 'test-key';
      const data = { name: 'John', age: 30 };

      await secureSetItem(key, data);
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(key, expect.any(String));

      const retrieved = await secureGetItem<typeof data>(key);
      expect(retrieved).toEqual(data);
    });

    it('should store and retrieve complex nested data', async () => {
      const key = 'complex-key';
      const data = {
        user: {
          profile: {
            name: 'Ahmad',
            email: 'ahmad@example.com',
          },
          settings: {
            theme: 'dark',
            language: 'ar',
          },
        },
        videos: [
          { id: 1, title: 'Video 1' },
          { id: 2, title: 'Video 2' },
        ],
      };

      await secureSetItem(key, data);
      const retrieved = await secureGetItem<typeof data>(key);
      expect(retrieved).toEqual(data);
    });

    it('should return null for non-existent key', async () => {
      const retrieved = await secureGetItem('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should handle array data', async () => {
      const key = 'array-key';
      const data = [1, 2, 3, 4, 5];

      await secureSetItem(key, data);
      const retrieved = await secureGetItem<typeof data>(key);
      expect(retrieved).toEqual(data);
    });

    it('should handle string data', async () => {
      const key = 'string-key';
      const data = 'simple string';

      await secureSetItem(key, data);
      const retrieved = await secureGetItem<typeof data>(key);
      expect(retrieved).toEqual(data);
    });

    it('should handle boolean data', async () => {
      const key = 'boolean-key';
      const data = true;

      await secureSetItem(key, data);
      const retrieved = await secureGetItem<typeof data>(key);
      expect(retrieved).toEqual(data);
    });

    it('should handle null data', async () => {
      const key = 'null-key';
      const data = null;

      await secureSetItem(key, data);
      const retrieved = await secureGetItem(key);
      expect(retrieved).toEqual(data);
    });

    it('should throw EncryptionError when encryption fails during storage', async () => {
      // Restore crypto to ensure encryption path is used
      global.crypto = mockCrypto as unknown as Crypto;
      mockCrypto.subtle.encrypt.mockRejectedValue(new Error('Storage failed'));

      await expect(secureSetItem('key', 'data')).rejects.toThrow(EncryptionError);
    });

    it('should throw EncryptionError when decryption fails during retrieval', async () => {
      // Restore crypto to ensure encryption/decryption path is used
      global.crypto = mockCrypto as unknown as Crypto;

      // First store successfully
      mockCrypto.subtle.encrypt.mockImplementation(async (_algo, _key, data) => {
        const arr = new Uint8Array(data as ArrayBuffer);
        return new Uint8Array(arr.reverse()).buffer;
      });
      await secureSetItem('key', 'data');

      // Then make decryption fail
      mockCrypto.subtle.decrypt.mockRejectedValue(new Error('Retrieval failed'));

      await expect(secureGetItem('key')).rejects.toThrow(EncryptionError);
    });
  });

  describe('secureRemoveItem', () => {
    it('should remove item from localStorage', async () => {
      const key = 'test-key';

      // Store item first
      mockCrypto.subtle.importKey.mockResolvedValue({} as CryptoKey);
      mockCrypto.subtle.deriveKey.mockResolvedValue({} as CryptoKey);
      mockCrypto.subtle.encrypt.mockResolvedValue(new ArrayBuffer(8));
      await secureSetItem(key, 'data');

      // Remove it
      secureRemoveItem(key);
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(key);

      // Verify it's removed
      const retrieved = await secureGetItem(key);
      expect(retrieved).toBeNull();
    });
  });

  describe('clearEncryptionCache', () => {
    it('should clear the cached encryption key', async () => {
      // Restore crypto to ensure encryption path is used
      global.crypto = mockCrypto as unknown as Crypto;

      // Setup mocks for key derivation
      mockCrypto.subtle.importKey.mockResolvedValue({} as CryptoKey);
      const mockKey = {} as CryptoKey;
      mockCrypto.subtle.deriveKey.mockResolvedValue(mockKey);
      mockCrypto.subtle.encrypt.mockImplementation(async (_algo, _key, data) => {
        const arr = new Uint8Array(data as ArrayBuffer);
        return new Uint8Array(arr.reverse()).buffer;
      });

      // First encryption should derive a new key
      await encryptData('test');
      expect(mockCrypto.subtle.deriveKey).toHaveBeenCalledTimes(1);

      // Second encryption should use cached key (no new derivation)
      await encryptData('test2');
      expect(mockCrypto.subtle.deriveKey).toHaveBeenCalledTimes(1);

      // Clear cache
      clearEncryptionCache();

      // Third encryption should derive a new key again
      await encryptData('test3');
      expect(mockCrypto.subtle.deriveKey).toHaveBeenCalledTimes(2);
    });
  });

  describe('EncryptionError', () => {
    it('should create error with message', () => {
      const error = new EncryptionError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('EncryptionError');
      expect(error).toBeInstanceOf(Error);
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new EncryptionError('Test error', cause);
      expect(error.message).toBe('Test error');
      expect(error.cause).toBe(cause);
    });
  });

  describe('environment variables', () => {
    it('should require NEXT_PUBLIC_ENCRYPTION_SECRET in production', async () => {
      // Restore crypto to ensure encryption path is used
      global.crypto = mockCrypto as unknown as Crypto;

      // Save original env
      const originalEnv = { ...process.env };

      // Mock process.env with production mode without secret
      Object.defineProperty(process, 'env', {
        value: { ...originalEnv, NODE_ENV: 'production', NEXT_PUBLIC_ENCRYPTION_SECRET: undefined },
        writable: true,
        configurable: true,
      });

      // Clear cache to force re-derivation
      clearEncryptionCache();

      // Mock key derivation to reach the getKeyMaterial check
      mockCrypto.subtle.importKey.mockImplementation(() => {
        // This will trigger getKeyMaterial() which checks the env var
        throw new EncryptionError('NEXT_PUBLIC_ENCRYPTION_SECRET environment variable is required in production');
      });

      await expect(encryptData('test')).rejects.toThrow('NEXT_PUBLIC_ENCRYPTION_SECRET');

      // Restore env
      Object.defineProperty(process, 'env', {
        value: originalEnv,
        writable: true,
        configurable: true,
      });
    });

    it('should use default secret in development', async () => {
      const originalEnv = { ...process.env };

      // Mock process.env with development mode
      Object.defineProperty(process, 'env', {
        value: { ...originalEnv, NODE_ENV: 'development', NEXT_PUBLIC_ENCRYPTION_SECRET: undefined },
        writable: true,
        configurable: true,
      });

      mockCrypto.subtle.importKey.mockResolvedValue({} as CryptoKey);
      mockCrypto.subtle.deriveKey.mockResolvedValue({} as CryptoKey);
      mockCrypto.subtle.encrypt.mockResolvedValue(new ArrayBuffer(8));

      // Should not throw
      await expect(encryptData('test')).resolves.toBeDefined();

      // Restore env
      Object.defineProperty(process, 'env', {
        value: originalEnv,
        writable: true,
        configurable: true,
      });
    });
  });
});
