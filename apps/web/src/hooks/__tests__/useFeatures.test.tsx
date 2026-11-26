import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

let activeUserId: string | null = 'u1';
let token: string | null = 'tok-1';
jest.mock('@/hooks/useMultiAccount', () => ({ useActiveUserId: () => activeUserId }));
jest.mock('@/lib/auth/client-token', () => ({ fetchClientAuthInfo: async () => ({ accessToken: token, channelId: null }) }));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import { fetchFeatures, resetFeaturesCache, useFeatures } from '../useFeatures';

const answer = (features: Record<string, unknown>, status = 200) =>
  Promise.resolve({ ok: status < 300, status, json: async () => ({ success: true, version: 1, features }) });

function Probe({ channelId }: { channelId?: string }) {
  const { ready, features } = useFeatures(channelId);
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      {features.live && <span data-testid="live">Go live</span>}
      {features.upload && <span data-testid="upload">Upload</span>}
    </div>
  );
}

describe('useFeatures', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    resetFeaturesCache();
    activeUserId = 'u1';
    token = 'tok-1';
    fetchMock = jest.fn(() => answer({ live: true, upload: true }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('hides everything until the answer arrives, then shows only what is true', async () => {
    render(<Probe />);
    expect(screen.getByTestId('ready').textContent).toBe('false');
    expect(screen.queryByTestId('live')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('live')).toBeTruthy());
    expect(screen.getByTestId('upload')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/me/features', expect.objectContaining({ headers: { Authorization: 'Bearer tok-1' }, cache: 'no-store' }));
  });

  it('asks about a channel with ?channelId=, shared by every caller', async () => {
    render(
      <>
        <Probe channelId="ch 1" />
        <Probe channelId="ch 1" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByTestId('live')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/me/features?channelId=ch%201');
  });

  it('fails closed except for player credits', async () => {
    fetchMock.mockImplementation(() => answer({ live: 'yes', somethingNew: true }));
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('ready').textContent).toBe('true'));
    expect(screen.queryByTestId('live')).toBeNull();
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')));
    const { playerCredits, ...features } = await fetchFeatures(null);
    expect(playerCredits).toBe(true);
    expect(Object.values(features).every((v) => v === false)).toBe(true);
    fetchMock.mockImplementation(() => answer({}, 500));
    expect(await fetchFeatures(null)).toMatchObject({ live: false, playerCredits: true });
  });

  it('signed out: asks without a token (viewer-facing features only)', async () => {
    token = null;
    await fetchFeatures(null);
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/api/me/features', expect.objectContaining({ headers: {} }));
  });

  it('switching accounts drops the previous answer and reads the new one', async () => {
    const { rerender } = render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('live')).toBeTruthy());
    fetchMock.mockImplementation(() => answer({ live: false, upload: true }));
    activeUserId = 'u2';
    rerender(<Probe />);
    // The previous account's answer is gone at once, then the new one shows
    expect(screen.queryByTestId('live')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('upload')).toBeTruthy());
    expect(screen.queryByTestId('live')).toBeNull();
  });

  it('reads again when the tab regains focus (a tier assigned meanwhile shows)', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    render(<Probe />);
    await waitFor(() => expect(screen.getByTestId('live')).toBeTruthy());
    fetchMock.mockImplementation(() => answer({ live: false }));
    now.mockReturnValue(1_010_000);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(screen.queryByTestId('live')).toBeNull());
    now.mockRestore();
  });
});
