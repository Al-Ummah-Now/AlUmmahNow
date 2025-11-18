/**
 * Tests for ProfileGuard component
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ProfileGuard from '@/components/ProfileGuard/index';
import { checkProfileExists } from '@/lib/api/profiles-client';
import type { Channel, ChannelCreateRequest } from '@al-ummah/shared-types';

// Multi-Account types (matching useMultiAccount.tsx)
interface ChannelInfo {
  id: string;
  userId: string;
  name: string;
  avatarUrl?: string;
  isMain: boolean;
}

interface UserInfo {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  channel: ChannelInfo | null;
  channels: ChannelInfo[];
}

interface AccountInfo {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  isActive: boolean;
}

interface MultiAccountContextValue {
  user: UserInfo | null;
  accounts: AccountInfo[];
  loading: boolean;
  error: string | null;
  addAccount: () => Promise<void>;
  switchAccount: (userId: string) => Promise<void>;
  removeAccount: (userId: string) => Promise<void>;
  switchToChannel: (channelId: string | null) => Promise<void>;
  createChannel: (data: ChannelCreateRequest) => Promise<Channel | null>;
  reloadChannels: () => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refresh: () => Promise<void>;
}

// Mock dependencies
jest.mock('@/hooks/useMultiAccount', () => ({
  useMultiAccount: jest.fn(),
}));

jest.mock('@/lib/api/profiles-client', () => ({
  checkProfileExists: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: jest.fn(),
}));

import { useMultiAccount } from '@/hooks/useMultiAccount';
import { usePathname } from 'next/navigation';

const mockUseMultiAccount = useMultiAccount as jest.MockedFunction<typeof useMultiAccount>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
const mockCheckProfileExists = checkProfileExists as jest.MockedFunction<typeof checkProfileExists>;

// Helper to create mock MultiAccountContextValue
const createMockContext = (partial: Partial<MultiAccountContextValue>): MultiAccountContextValue => ({
  user: null,
  accounts: [],
  loading: false,
  error: null,
  addAccount: jest.fn(),
  switchAccount: jest.fn(),
  removeAccount: jest.fn(),
  switchToChannel: jest.fn(),
  createChannel: jest.fn(),
  reloadChannels: jest.fn(),
  logout: jest.fn(),
  logoutAll: jest.fn(),
  refresh: jest.fn(),
  ...partial,
});

describe('ProfileGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/en/videos');
  });

  it('should render children when user is not authenticated', () => {
    mockUseMultiAccount.mockReturnValue(createMockContext({
      user: null,
      loading: false
    }));

    render(
      <ProfileGuard>
        <div>Protected Content</div>
      </ProfileGuard>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('should render children when on profile creation page', () => {
    mockUseMultiAccount.mockReturnValue(createMockContext({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        channel: null,
        channels: []
      },
      loading: false
    }));
    mockUsePathname.mockReturnValue('/en/profile/create');

    render(
      <ProfileGuard>
        <div>Profile Creation</div>
      </ProfileGuard>
    );

    expect(screen.getByText('Profile Creation')).toBeInTheDocument();
    expect(mockCheckProfileExists).not.toHaveBeenCalled();
  });

  it('should show loading state while checking profile', async () => {
    mockUseMultiAccount.mockReturnValue(createMockContext({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        channel: null,
        channels: []
      },
      loading: false
    }));
    mockCheckProfileExists.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(true), 100))
    );

    render(
      <ProfileGuard>
        <div>Protected Content</div>
      </ProfileGuard>
    );

    expect(screen.getByText('Checking profile...')).toBeInTheDocument();
  });

  it('should render children when profile exists', async () => {
    mockUseMultiAccount.mockReturnValue(createMockContext({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        channel: null,
        channels: []
      },
      loading: false
    }));
    mockCheckProfileExists.mockResolvedValue(true);

    render(
      <ProfileGuard>
        <div>Protected Content</div>
      </ProfileGuard>
    );

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  it('should redirect to profile creation when profile does not exist', async () => {
    mockUseMultiAccount.mockReturnValue(createMockContext({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        channel: null,
        channels: []
      },
      loading: false
    }));
    mockCheckProfileExists.mockResolvedValue(false);

    render(
      <ProfileGuard locale="en">
        <div>Protected Content</div>
      </ProfileGuard>
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/en/profile/create');
    });
  });

  it('should redirect to Arabic profile creation when locale is ar', async () => {
    mockUseMultiAccount.mockReturnValue(createMockContext({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        channel: null,
        channels: []
      },
      loading: false
    }));
    mockCheckProfileExists.mockResolvedValue(false);

    render(
      <ProfileGuard locale="ar">
        <div>Protected Content</div>
      </ProfileGuard>
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/ar/profile/create');
    });
  });

  it('should handle profile check errors gracefully', async () => {
    mockUseMultiAccount.mockReturnValue(createMockContext({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        channel: null,
        channels: []
      },
      loading: false
    }));
    mockCheckProfileExists.mockRejectedValue(new Error('Network error'));

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    render(
      <ProfileGuard>
        <div>Protected Content</div>
      </ProfileGuard>
    );

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error checking profile:',
      expect.any(Error)
    );

    consoleSpy.mockRestore();
  });

  it('should show Arabic loading message when locale is ar', async () => {
    mockUseMultiAccount.mockReturnValue(createMockContext({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        channel: null,
        channels: []
      },
      loading: false
    }));
    mockCheckProfileExists.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(true), 100))
    );

    render(
      <ProfileGuard locale="ar">
        <div>Protected Content</div>
      </ProfileGuard>
    );

    expect(screen.getByText('جاري التحقق من الملف الشخصي...')).toBeInTheDocument();
  });

  it('should skip check when account is loading', () => {
    mockUseMultiAccount.mockReturnValue(createMockContext({
      user: {
        id: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        channel: null,
        channels: []
      },
      loading: true
    }));

    render(
      <ProfileGuard>
        <div>Protected Content</div>
      </ProfileGuard>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(mockCheckProfileExists).not.toHaveBeenCalled();
  });
});
