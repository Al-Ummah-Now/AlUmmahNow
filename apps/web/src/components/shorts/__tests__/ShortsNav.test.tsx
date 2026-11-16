import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';

let pathname = '/en/shorts/a';
const back = jest.fn();
const push = jest.fn();
jest.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ back, push }) }));
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, locale: 'en' }),
}));
jest.mock('@/lib/runtime-config', () => ({ getApiUrl: () => 'https://api.test' }));
jest.mock('@/lib/logger-client', () => ({ logger: { warn: jest.fn() } }));

import { ShortsNav } from '../ShortsNav';

describe('ShortsNav previous', () => {
  beforeEach(() => {
    pathname = '/en/shorts/a';
    back.mockReset();
  });

  it('is disabled on the first Short and enabled once the tab moved to the next one', () => {
    const { rerender } = render(<ShortsNav />);
    expect(screen.getByTestId('shorts-prev')).toBeDisabled();
    pathname = '/en/shorts/b';
    act(() => rerender(<ShortsNav />));
    expect(screen.getByTestId('shorts-prev')).toBeEnabled();
    fireEvent.click(screen.getByTestId('shorts-prev'));
    expect(back).toHaveBeenCalledTimes(1);
    pathname = '/en/shorts/a';
    act(() => rerender(<ShortsNav />));
    expect(screen.getByTestId('shorts-prev')).toBeDisabled();
  });

  it('a downward swipe goes back once the tab moved forward', () => {
    const { rerender } = render(<ShortsNav />);
    pathname = '/en/shorts/b';
    act(() => rerender(<ShortsNav />));
    const touch = (type: string, y: number) => {
      const event = new Event(type) as Event & { touches: unknown; changedTouches: unknown };
      Object.defineProperty(event, 'touches', { value: type === 'touchstart' ? [{ clientX: 100, clientY: y }] : [] });
      Object.defineProperty(event, 'changedTouches', { value: [{ clientX: 100, clientY: y }] });
      act(() => { window.dispatchEvent(event); });
    };
    touch('touchstart', 200);
    touch('touchend', 400);
    expect(back).toHaveBeenCalledTimes(1);
  });
});

describe('ShortsNav over the comments', () => {
  let callback: IntersectionObserverCallback | null = null;
  beforeEach(() => {
    pathname = '/en/shorts/a';
    callback = null;
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      constructor(cb: IntersectionObserverCallback) { callback = cb; }
      observe() {}
      disconnect() {}
    };
    document.body.innerHTML = '<section id="video-player"></section>';
  });
  afterEach(() => {
    delete (globalThis as unknown as { IntersectionObserver?: unknown }).IntersectionObserver;
  });

  const ratio = (r: number) => act(() => callback?.([{ intersectionRatio: r } as IntersectionObserverEntry], {} as IntersectionObserver));

  it('hides the ↑/↓ buttons once the player scrolls away (they would sit on the comment box) and shows them again', () => {
    render(<ShortsNav />, { container: document.body.appendChild(document.createElement('div')) });
    expect(screen.getByTestId('shorts-nav')).toBeInTheDocument();
    ratio(0.1);
    expect(screen.queryByTestId('shorts-nav')).toBeNull();
    ratio(0.9);
    expect(screen.getByTestId('shorts-nav')).toBeInTheDocument();
  });

  it('keys still move to the next Short while the buttons are hidden', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [{ id: 'b' }] }) }) as unknown as typeof fetch;
    render(<ShortsNav />, { container: document.body.appendChild(document.createElement('div')) });
    ratio(0);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' })); });
    expect(push).toHaveBeenCalledWith('/en/shorts/b');
  });
});
