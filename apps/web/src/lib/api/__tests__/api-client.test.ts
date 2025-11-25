/**
 * Unit Tests for API Client
 *
 * Tests the core API client utilities used for making authenticated
 * and unauthenticated requests to the backend API.
 */

import { apiRequestServer, buildApiUrl } from '../api-client';

// Mock fetch
global.fetch = jest.fn();

describe('API Client - buildApiUrl', () => {
  it('should concatenate base URL with path', () => {
    const url = buildApiUrl('/videos');
    expect(url).toBe('/videos'); // getApiUrl() returns '' in tests
  });

  it('should handle paths with leading slash', () => {
    const url = buildApiUrl('/api/videos');
    expect(url).toBe('/api/videos');
  });

  it('should handle paths without leading slash', () => {
    const url = buildApiUrl('api/videos');
    expect(url).toBe('api/videos');
  });

  it('should handle empty path', () => {
    const url = buildApiUrl('');
    expect(url).toBe('');
  });

  it('should handle query parameters in path', () => {
    const url = buildApiUrl('/videos?limit=10&offset=0');
    expect(url).toBe('/videos?limit=10&offset=0');
  });
});

describe('API Client - apiRequestServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should make successful GET request without auth', async () => {
    const mockResponse = { data: { id: '1', title: 'Test Video' } };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await apiRequestServer(
      {
        method: 'GET',
        url: 'http://localhost:8686/api/videos/1',
        functionName: 'getVideo',
      },
      async () => null,
      false
    );

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8686/api/videos/1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.any(Object),
      })
    );
  });

  it('should make successful POST request with body', async () => {
    const mockResponse = { success: true, id: '123' };
    const requestBody = { title: 'New Video', description: 'Test' };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => mockResponse,
    });

    const result = await apiRequestServer(
      {
        method: 'POST',
        url: 'http://localhost:8686/api/videos',
        body: requestBody,
        functionName: 'createVideo',
      },
      async () => null,
      false
    );

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:8686/api/videos',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(requestBody),
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('should include auth headers when authContext provided', async () => {
    const mockResponse = { data: {} };
    const authContext = {
      accessToken: 'test-access-token',
      
      channelId: 'channel-456',
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    await apiRequestServer(
      {
        method: 'GET',
        url: 'http://localhost:8686/api/videos',
        functionName: 'getVideos',
      },
      async () => authContext,
      true
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-access-token',
          'userId': 'user-123',
          'channelId': 'channel-456',
        }),
      })
    );
  });

  it('should return null when auth required but not provided', async () => {
    const result = await apiRequestServer(
      {
        method: 'GET',
        url: 'http://localhost:8686/api/videos',
        functionName: 'getVideos',
      },
      async () => null,
      true
    );

    expect(result).toBeNull();
  });

  it('should return null on 404 Not Found response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify({ error: 'Video not found' }),
    });

    const result = await apiRequestServer(
      {
        method: 'GET',
        url: 'http://localhost:8686/api/videos/999',
        functionName: 'getVideo',
      },
      async () => null,
      false
    );

    expect(result).toBeNull();
  });

  it('should return null on 401 Unauthorized response', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => JSON.stringify({ error: 'Invalid token' }),
    });

    const result = await apiRequestServer(
      {
        method: 'GET',
        url: 'http://localhost:8686/api/videos',
        functionName: 'getVideos',
      },
      async () => ({ accessToken: 'invalid-token' }),
      true
    );

    expect(result).toBeNull();
  });

  it('should return null on 500 Internal Server Error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: async () => JSON.stringify({ error: 'Server error' }),
    });

    const result = await apiRequestServer(
      {
        method: 'GET',
        url: 'http://localhost:8686/api/videos',
        functionName: 'getVideos',
      },
      async () => null,
      false
    );

    expect(result).toBeNull();
  });

  it('should return null on network errors', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    const result = await apiRequestServer(
      {
        method: 'GET',
        url: 'http://localhost:8686/api/videos',
        functionName: 'getVideos',
      },
      async () => null,
      false
    );

    expect(result).toBeNull();
  });

  it('should return null on non-JSON responses', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    const result = await apiRequestServer(
      {
        method: 'GET',
        url: 'http://localhost:8686/api/videos',
        functionName: 'getVideos',
      },
      async () => null,
      false
    );

    expect(result).toBeNull();
  });

  it('should include custom headers when provided', async () => {
    const mockResponse = { data: {} };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    await apiRequestServer(
      {
        method: 'GET',
        url: 'http://localhost:8686/api/videos',
        functionName: 'getVideos',
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Request-Id': 'req-123',
        },
      },
      async () => null,
      false
    );

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Custom-Header': 'custom-value',
          'X-Request-Id': 'req-123',
        }),
      })
    );
  });

  it('should handle DELETE requests', async () => {
    const mockResponse = { success: true };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await apiRequestServer(
      {
        method: 'DELETE',
        url: 'http://localhost:8686/api/videos/123',
        functionName: 'deleteVideo',
      },
      async () => ({ accessToken: 'test-token' }),
      true
    );

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'DELETE',
      })
    );
  });

  it('should handle PUT requests with body', async () => {
    const mockResponse = { success: true };
    const updateData = { title: 'Updated Title' };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    });

    const result = await apiRequestServer(
      {
        method: 'PUT',
        url: 'http://localhost:8686/api/videos/123',
        body: updateData,
        functionName: 'updateVideo',
      },
      async () => ({ accessToken: 'test-token' }),
      true
    );

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(updateData),
      })
    );
  });
});
