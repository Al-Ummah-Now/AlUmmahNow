/**
 * Tests for profile helper functions
 */
import { shouldRedirectToProfileCreation, getProfileCreationPath } from '../profile-helpers';
import { checkProfileExists } from '@/lib/api/profiles-client';

jest.mock('@/lib/api/profiles', () => ({
  checkProfileExists: jest.fn(),
}));

const mockCheckProfileExists = checkProfileExists as jest.MockedFunction<typeof checkProfileExists>;

describe('Profile Helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('shouldRedirectToProfileCreation', () => {
    it('should not redirect when user is null', async () => {
      const result = await shouldRedirectToProfileCreation(null);

      expect(result.shouldRedirect).toBe(false);
      expect(result.redirectPath).toBeNull();
    });

    it('should redirect when profile does not exist', async () => {
      const user = { id: 'user-123', email: 'test@example.com' };
      mockCheckProfileExists.mockResolvedValue(false);

      const result = await shouldRedirectToProfileCreation(user);

      expect(result.shouldRedirect).toBe(true);
      expect(result.redirectPath).toBe('/en/profile/create');
    });

    it('should not redirect when profile exists', async () => {
      const user = { id: 'user-123', email: 'test@example.com' };
      mockCheckProfileExists.mockResolvedValue(true);

      const result = await shouldRedirectToProfileCreation(user);

      expect(result.shouldRedirect).toBe(false);
      expect(result.redirectPath).toBeNull();
    });

    it('should not redirect on error', async () => {
      const user = { id: 'user-123', email: 'test@example.com' };
      mockCheckProfileExists.mockRejectedValue(new Error('Network error'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const result = await shouldRedirectToProfileCreation(user);

      expect(result.shouldRedirect).toBe(false);
      expect(result.redirectPath).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Error checking profile status:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getProfileCreationPath', () => {
    it('should return English profile creation path by default', () => {
      expect(getProfileCreationPath()).toBe('/en/profile/create');
    });

    it('should return English profile creation path when en is specified', () => {
      expect(getProfileCreationPath('en')).toBe('/en/profile/create');
    });

    it('should return Arabic profile creation path when ar is specified', () => {
      expect(getProfileCreationPath('ar')).toBe('/ar/profile/create');
    });
  });
});
