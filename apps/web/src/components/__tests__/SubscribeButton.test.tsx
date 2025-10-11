/**
 * Tests for SubscribeButton component
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SubscribeButton } from '@/components/subscription/SubscribeButton';
import { ChannelsAPI } from '@/lib/api/channels';

// Mock dependencies
jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/hooks/useProfile', () => ({
  useProfile: jest.fn(),
}));

jest.mock('@/lib/api/channels', () => ({
  ChannelsAPI: {
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  },
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

import { useAuth } from '@/components/AuthProvider/authContext';
import { useProfile } from '@/hooks/useProfile';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseProfile = useProfile as jest.MockedFunction<typeof useProfile>;

describe('SubscribeButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render subscribe button for unauthenticated users', () => {
    mockUseAuth.mockReturnValue({ user: null } as any);
    mockUseProfile.mockReturnValue({ profile: null } as any);

    render(
      <SubscribeButton
        channelId="channel-123"
        channelName="Test Channel"
      />
    );

    expect(screen.getByText('Subscribe')).toBeInTheDocument();
  });

  it('should show subscribed state when initially subscribed', () => {
    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
    mockUseProfile.mockReturnValue({ 
      profile: { channels: ['channel-456'] } 
    } as any);

    render(
      <SubscribeButton
        channelId="channel-123"
        channelName="Test Channel"
        initialSubscribed={true}
        subscribersCount={100}
      />
    );

    expect(screen.getByText('Subscribed')).toBeInTheDocument();
    expect(screen.getByText('100 subscribers')).toBeInTheDocument();
  });

  it('should handle subscribe action', async () => {
    const mockSubscribe = jest.fn().mockResolvedValue({ success: true });
    (ChannelsAPI.subscribe as jest.Mock).mockImplementation(mockSubscribe);

    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
    mockUseProfile.mockReturnValue({ 
      profile: { channels: ['channel-456'] } 
    } as any);

    render(
      <SubscribeButton
        channelId="channel-789"
        channelName="Test Channel"
        subscribersCount={50}
      />
    );

    const subscribeButton = screen.getByText('Subscribe');
    fireEvent.click(subscribeButton);

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith(
        'channel-789',
        { notificationsEnabled: true },
        expect.objectContaining({
          userId: 'user-123',
          channelId: 'channel-456'
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Subscribed')).toBeInTheDocument();
      expect(screen.getByText('51 subscribers')).toBeInTheDocument();
    });
  });

  it('should handle unsubscribe action', async () => {
    const mockUnsubscribe = jest.fn().mockResolvedValue({ success: true });
    (ChannelsAPI.unsubscribe as jest.Mock).mockImplementation(mockUnsubscribe);

    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
    mockUseProfile.mockReturnValue({ 
      profile: { channels: ['channel-456'] } 
    } as any);

    render(
      <SubscribeButton
        channelId="channel-789"
        channelName="Test Channel"
        initialSubscribed={true}
        subscribersCount={100}
      />
    );

    const subscribeButton = screen.getByText('Subscribed');
    fireEvent.click(subscribeButton);

    await waitFor(() => {
      expect(mockUnsubscribe).toHaveBeenCalledWith(
        'channel-789',
        expect.objectContaining({
          userId: 'user-123',
          channelId: 'channel-456'
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Subscribe')).toBeInTheDocument();
      expect(screen.getByText('99 subscribers')).toBeInTheDocument();
    });
  });

  it('should show loading state during subscription toggle', async () => {
    const mockSubscribe = jest.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve({ success: true }), 100))
    );
    (ChannelsAPI.subscribe as jest.Mock).mockImplementation(mockSubscribe);

    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
    mockUseProfile.mockReturnValue({ 
      profile: { channels: ['channel-456'] } 
    } as any);

    render(
      <SubscribeButton
        channelId="channel-789"
        channelName="Test Channel"
      />
    );

    const subscribeButton = screen.getByText('Subscribe');
    fireEvent.click(subscribeButton);

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  it('should not update count below zero when unsubscribing', async () => {
    const mockUnsubscribe = jest.fn().mockResolvedValue({ success: true });
    (ChannelsAPI.unsubscribe as jest.Mock).mockImplementation(mockUnsubscribe);

    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
    mockUseProfile.mockReturnValue({ 
      profile: { channels: ['channel-456'] } 
    } as any);

    render(
      <SubscribeButton
        channelId="channel-789"
        channelName="Test Channel"
        initialSubscribed={true}
        subscribersCount={0}
      />
    );

    const subscribeButton = screen.getByText('Subscribed');
    fireEvent.click(subscribeButton);

    await waitFor(() => {
      const subscriberText = screen.queryByText(/-?\d+ subscribers/);
      expect(subscriberText).not.toBeInTheDocument();
    });
  });
});
