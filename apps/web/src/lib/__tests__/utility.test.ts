/**
 * Tests for utility functions
 */
import { Observable, assertIsNode, resolveUrl, removeUnwantedChars, createApiHeaders } from '../utility';

describe('Observable', () => {
  it('should initialize with a value', () => {
    const observable = new Observable<number>(5);
    expect(observable.get()).toBe(5);
  });

  it('should update value and notify listeners', () => {
    const observable = new Observable<number>(5);
    const listener = jest.fn();
    
    observable.subscribe(listener);
    observable.set(10);
    
    expect(observable.get()).toBe(10);
    expect(listener).toHaveBeenCalledWith(10);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('should not notify listeners if value is the same', () => {
    const observable = new Observable<number>(5);
    const listener = jest.fn();
    
    observable.subscribe(listener);
    observable.set(5);
    
    expect(listener).not.toHaveBeenCalled();
  });

  it('should allow multiple listeners', () => {
    const observable = new Observable<string>('initial');
    const listener1 = jest.fn();
    const listener2 = jest.fn();
    
    observable.subscribe(listener1);
    observable.subscribe(listener2);
    observable.set('updated');
    
    expect(listener1).toHaveBeenCalledWith('updated');
    expect(listener2).toHaveBeenCalledWith('updated');
  });

  it('should unsubscribe listeners', () => {
    const observable = new Observable<number>(0);
    const listener = jest.fn();
    
    const unsubscribe = observable.subscribe(listener);
    observable.set(1);
    expect(listener).toHaveBeenCalledTimes(1);
    
    unsubscribe();
    observable.set(2);
    expect(listener).toHaveBeenCalledTimes(1); // Still 1, not called again
  });
});

describe('assertIsNode', () => {
  it('should not throw for valid DOM nodes', () => {
    const div = document.createElement('div');
    expect(() => assertIsNode(div)).not.toThrow();
  });

  it('should throw for non-nodes', () => {
    expect(() => assertIsNode(null)).toThrow('Node expected');
    expect(() => assertIsNode({} as EventTarget)).toThrow('Node expected');
  });
});

describe('resolveUrl', () => {
  it('should return data URIs as-is', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgo=';
    expect(resolveUrl(dataUri)).toBe(dataUri);
  });

  it('should return fully qualified URLs as-is', () => {
    const url = 'https://example.com/image.png';
    expect(resolveUrl(url)).toBe(url);
  });

  it('should resolve relative URLs with base URL', () => {
    const relativeUrl = '/images/logo.png';
    const baseUrl = 'https://example.com';
    expect(resolveUrl(relativeUrl, baseUrl)).toBe('https://example.com/images/logo.png');
  });

  it('should handle protocol-relative URLs', () => {
    const url = 'http://cdn.example.com/file.js';
    expect(resolveUrl(url)).toBe(url);
  });
});

describe('removeUnwantedChars', () => {
  it('should remove file extensions', () => {
    const input = 'document.pdf';
    const result = removeUnwantedChars(input);
    expect(result).toBe('document');
  });

  it('should replace special slash character with dot', () => {
    const input = 'file⧸name';
    const result = removeUnwantedChars(input);
    expect(result).toBe('file.name');
  });

  it('should handle strings without extensions', () => {
    const input = 'filename';
    const result = removeUnwantedChars(input);
    expect(result).toBe('filename');
  });
});

describe('createApiHeaders', () => {
  it('should return undefined for null user', () => {
    expect(createApiHeaders(null)).toBeUndefined();
  });

  it('should return undefined for undefined user', () => {
    expect(createApiHeaders(undefined)).toBeUndefined();
  });

  it('should create headers with userId only', () => {
    const user = { id: 'user-123' };
    const headers = createApiHeaders(user);
    expect(headers).toEqual({ userId: 'user-123' });
  });

  it('should create headers with userId and channelId', () => {
    const user = { id: 'user-123' };
    const headers = createApiHeaders(user, 'channel-456');
    expect(headers).toEqual({ 
      userId: 'user-123',
      channelId: 'channel-456'
    });
  });
});
