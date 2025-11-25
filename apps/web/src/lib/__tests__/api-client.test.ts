/**
 * Tests for API Client
 */
import { APIClient, createAuthenticatedClient } from '@/lib/api/index';

describe('APIClient', () => {
  it('should create client without headers', () => {
    const client = new APIClient();
    expect(client.getHeaders()).toEqual({});
  });

  it('should create client with initial headers', () => {
    const client = new APIClient({
      channelId: 'channel-123',
      userId: 'user-456',
    });

    expect(client.getHeaders()).toEqual({
      channelId: 'channel-123',
      userId: 'user-456',
    });
  });

  it('should update headers', () => {
    const client = new APIClient();

    client.setHeaders({
      channelId: 'channel-789',
    });

    expect(client.getHeaders()).toEqual({
      channelId: 'channel-789',
    });
  });

  it('should merge headers when updating', () => {
    const client = new APIClient({
      userId: 'user-789',
    });

    client.setHeaders({
      channelId: 'channel-456',
    });

    expect(client.getHeaders()).toEqual({
      userId: 'user-789',
      channelId: 'channel-456',
    });
  });

  it('should provide videos API accessor', () => {
    const client = new APIClient();
    expect(client.videos).toBeDefined();
  });

  it('should provide profiles API accessor', () => {
    const client = new APIClient();
    expect(client.profiles).toBeDefined();
  });

  it('should provide channels API accessor', () => {
    const client = new APIClient();
    expect(client.channels).toBeDefined();
  });

  it('should provide playlists API accessor', () => {
    const client = new APIClient();
    expect(client.playlists).toBeDefined();
  });

  it('should provide analytics API accessor', () => {
    const client = new APIClient();
    expect(client.analytics).toBeDefined();
  });

  it('should provide moderation API accessor', () => {
    const client = new APIClient();
    expect(client.moderation).toBeDefined();
  });
});

describe('createAuthenticatedClient', () => {
  it('should create client with channelId and userId', () => {
    const client = createAuthenticatedClient('channel-123', 'user-456');

    expect(client.getHeaders()).toEqual({
      channelId: 'channel-123',
      userId: 'user-456',
    });
  });
});
