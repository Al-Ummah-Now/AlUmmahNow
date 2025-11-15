/**
 * Tests for ProfileGuard component
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import ProfileGuard from '@/components/ProfileGuard/index';
import { checkProfileExists } from '@/lib/api/profiles-client';

// Mock dependencies
jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/lib/api/profiles', () => ({
  checkProfileExists: jest.fn(),
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: jest.fn(),
}));

import { useAuth } from '@/components/AuthProvider/authContext';
import { usePathname } from 'next/navigation';

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
const mockCheckProfileExists = checkProfileExists as jest.MockedFunction<typeof checkProfileExists>;

describe('ProfileGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePathname.mockReturnValue('/en/videos');
  });

  it('should render children when user is not authenticated', () => {
    mockUseAuth.mockReturnValue({ user: null } as any);

    render(
      <ProfileGuard>
        <div>Protected Content</div>
      </ProfileGuard>
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });

  it('should render children when on profile creation page', () => {
    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
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
    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
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
    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
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
    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
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
    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
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
    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
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
    mockUseAuth.mockReturnValue({ 
      user: { id: 'user-123' } 
    } as any);
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
});
