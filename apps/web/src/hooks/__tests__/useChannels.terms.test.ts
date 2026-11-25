/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { CREATOR_ERROR_CODES } from '@al-ummah/shared-types';
import { useChannels } from '../useChannels';

const mockCreateChannelResult = jest.fn();
const mockMarkCreatorTermsRequired = jest.fn();

jest.mock('@/lib/api/channels', () => ({
  listChannels: jest.fn().mockResolvedValue({ data: [] }),
  createChannelResult: (...args: unknown[]) => mockCreateChannelResult(...args),
  updateChannel: jest.fn(),
  deleteChannel: jest.fn(),
}));
jest.mock('@/hooks/useCreatorAccess', () => ({
  markCreatorTermsRequired: () => mockMarkCreatorTermsRequired(),
}));
jest.mock('@/lib/logger-client', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('useChannels creator terms handling', () => {
  beforeEach(() => {
    mockCreateChannelResult.mockReset();
    mockMarkCreatorTermsRequired.mockReset();
  });

  it('calls markCreatorTermsRequired and onTermsRequired without setting generic error on 403 terms_required', async () => {
    mockCreateChannelResult.mockResolvedValue({
      data: null,
      status: 403,
      errorBody: { success: false, code: CREATOR_ERROR_CODES.termsRequired },
    });
    const onTermsRequired = jest.fn();

    const { result } = renderHook(() =>
      useChannels({ channelId: 'u1', autoFetch: false, initialChannels: [], onTermsRequired }),
    );

    let ok = true;
    await act(async () => {
      ok = await result.current.createChannel({ name: 'Test Channel' });
    });

    expect(ok).toBe(false);
    expect(mockMarkCreatorTermsRequired).toHaveBeenCalledTimes(1);
    expect(onTermsRequired).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});
