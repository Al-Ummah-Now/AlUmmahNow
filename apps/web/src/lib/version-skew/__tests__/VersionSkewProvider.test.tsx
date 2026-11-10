import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { VersionSkewProvider } from '../VersionSkewProvider';
import { holdReload, recoverFromVersionSkew } from '../recovery';

jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const INCIDENT = 'Server Action "78646d3443f3ead05cf55e694bd687a28c5d43ae66" was not found on the server.';

function rejection(reason: unknown) {
  const event = new Event('unhandledrejection', { cancelable: true }) as PromiseRejectionEvent;
  Object.defineProperty(event, 'reason', { value: reason });
  Object.defineProperty(event, 'promise', { value: Promise.resolve() });
  return event;
}

describe('VersionSkewProvider', () => {
  let reload: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    window.sessionStorage.clear();
    reload = jest.fn();
  });
  afterEach(() => jest.useRealTimers());

  it('renders nothing until a skew error happens', () => {
    render(<VersionSkewProvider reload={reload} />);
    expect(screen.queryByTestId('version-skew-notice')).toBeNull();
    act(() => void window.dispatchEvent(rejection(new Error('ordinary failure'))));
    expect(screen.queryByTestId('version-skew-notice')).toBeNull();
  });

  it('shows the themed notice (never the raw message) and reloads', () => {
    render(<VersionSkewProvider reload={reload} />);
    const event = rejection(new Error(INCIDENT));
    act(() => void window.dispatchEvent(event));
    const notice = screen.getByTestId('version-skew-notice');
    expect(notice).toHaveAttribute('data-state', 'reloading');
    expect(notice).toHaveTextContent('A new version is available');
    expect(notice.textContent).not.toContain('Server Action');
    expect(event.defaultPrevented).toBe(true);
    act(() => void jest.advanceTimersByTime(2000));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps an upload going and reloads after it finishes', () => {
    render(<VersionSkewProvider reload={reload} />);
    const release = holdReload();
    act(() => void recoverFromVersionSkew(new Error(INCIDENT), 'caught'));
    expect(screen.getByTestId('version-skew-notice')).toHaveAttribute('data-state', 'waiting-for-uploads');
    act(() => void jest.advanceTimersByTime(60_000));
    expect(reload).not.toHaveBeenCalled();
    act(() => release());
    expect(screen.getByTestId('version-skew-notice')).toHaveAttribute('data-state', 'reloading');
    act(() => void jest.advanceTimersByTime(2000));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('speaks Arabic on Arabic pages', () => {
    document.documentElement.lang = 'ar';
    render(<VersionSkewProvider reload={reload} />);
    act(() => void window.dispatchEvent(rejection(new Error(INCIDENT))));
    expect(screen.getByTestId('version-skew-notice')).toHaveTextContent('يتوفر إصدار جديد');
    document.documentElement.lang = 'en';
  });
});

const answer = (status: number, headers: Record<string, string> = {}) =>
  ({ status, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } }) as unknown as Response;

describe('VersionSkewProvider: Server Action answers', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('recovers even when the caller catches the failed action', async () => {
    jest.useFakeTimers();
    window.sessionStorage.clear();
    const reload = jest.fn();
    global.fetch = jest.fn(async () => answer(404, { 'x-nextjs-action-not-found': '1' })) as unknown as typeof fetch;
    const { unmount } = render(<VersionSkewProvider reload={reload} />);
    await act(async () => {
      const res = await window.fetch('/en/videos', { method: 'POST', headers: { 'next-action': 'old' } });
      expect(res.status).toBe(404); // the caller still gets its answer
    });
    expect(screen.getByTestId('version-skew-notice')).toHaveAttribute('data-state', 'reloading');
    act(() => void jest.advanceTimersByTime(2000));
    expect(reload).toHaveBeenCalledTimes(1);
    unmount();
    expect(window.fetch).not.toBe(realFetch); // restores the fetch it replaced (the mock)
  });

  it('ignores ordinary answers', async () => {
    global.fetch = jest.fn(async () => answer(500)) as unknown as typeof fetch;
    render(<VersionSkewProvider reload={jest.fn()} />);
    await act(async () => void (await window.fetch('/api/x')));
    expect(screen.queryByTestId('version-skew-notice')).toBeNull();
  });
});
