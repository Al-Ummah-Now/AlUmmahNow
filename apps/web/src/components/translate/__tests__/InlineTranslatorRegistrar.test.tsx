/**
 * The Translate button beside title/description pairs exists only while it is switched on for the
 * signed-in visitor (GET /api/me/features `inlineTranslate`); a 404 feature_off reads the features
 * again (the button goes away) and says nothing.
 */
import React from 'react';
import { render, renderHook, act } from '@testing-library/react';

let mockUser: { id: string } | null = { id: 'u1' };
let mockFeatures: Record<string, boolean> = {};
const mockRefresh = jest.fn(async () => undefined);
const mockTranslate = jest.fn();
jest.mock('@/components/AuthProvider/authContext', () => ({ useOptionalAuth: () => ({ user: mockUser }) }));
jest.mock('@/hooks/useFeatures', () => ({ useFeatures: () => ({ ready: true, features: mockFeatures }), refreshFeatures: () => mockRefresh() }));
jest.mock('@/lib/api/translate', () => ({ translateTexts: (...a: unknown[]) => mockTranslate(...a) }));
jest.mock('@/lib/errors/reporter', () => ({ reportError: jest.fn() }));

import { InlineTranslatorRegistrar, apiTranslator } from '../InlineTranslatorRegistrar';
import { TranslateFailure, registerTranslator, useTranslator } from '@/lib/i18n/translate-text';

describe('InlineTranslatorRegistrar', () => {
  afterEach(() => act(() => registerTranslator(null)));

  it('registers no translator while the Translate button is off', () => {
    mockFeatures = {};
    render(<InlineTranslatorRegistrar />);
    expect(renderHook(() => useTranslator()).result.current).toBeNull();
  });

  it('registers it when on and signed in; signed out, none', () => {
    mockFeatures = { inlineTranslate: true };
    const { unmount } = render(<InlineTranslatorRegistrar />);
    expect(renderHook(() => useTranslator()).result.current).toBe(apiTranslator);
    unmount();
    mockUser = null;
    render(<InlineTranslatorRegistrar />);
    expect(renderHook(() => useTranslator()).result.current).toBeNull();
    mockUser = { id: 'u1' };
  });

  it('a 404 feature_off refreshes the features and fails quietly', async () => {
    mockTranslate.mockResolvedValue({ ok: false, status: 404, error: 'feature_off' });
    await expect(apiTranslator('hello', 'en', 'ar')).rejects.toEqual(new TranslateFailure('feature_off'));
    expect(mockRefresh).toHaveBeenCalled();
  });
});
