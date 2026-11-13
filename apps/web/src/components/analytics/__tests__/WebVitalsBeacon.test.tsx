import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { WebVitalsBeacon } from '../WebVitalsBeacon';

const reporters: Record<string, (m: { name: string; value: number }) => void> = {};
jest.mock('web-vitals', () => ({
  onLCP: (cb: never) => { reporters.LCP = cb; },
  onCLS: (cb: never) => { reporters.CLS = cb; },
  onINP: (cb: never) => { reporters.INP = cb; },
}));

const sendBeacon = jest.fn(() => true);

function hide() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}

describe('WebVitalsBeacon (#1207)', () => {
  beforeEach(() => {
    sendBeacon.mockClear();
    for (const k of Object.keys(reporters)) delete reporters[k];
    Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: sendBeacon });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    window.history.replaceState(null, '', '/ar/video/0174501b-cbc9-41b4-b386-93f9bb8429a7?t=30');
    document.documentElement.lang = 'ar';
  });
  afterEach(() => jest.restoreAllMocks());

  it('should send one anonymous beacon with page kind, device and locale when a sampled page is hidden', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.01);
    render(<WebVitalsBeacon />);
    await waitFor(() => expect(reporters.LCP).toBeDefined());
    reporters.LCP({ name: 'LCP', value: 2100 });
    reporters.CLS({ name: 'CLS', value: 0.02 });
    hide();
    hide();
    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, text] = sendBeacon.mock.calls[0] as unknown as [string, string];
    expect(url).toBe('/api/rum');
    const body = JSON.parse(text);
    expect(body).toEqual({ k: 'watch', d: 'desktop', l: 'ar', m: { LCP: 2100, CLS: 0.02 } });
    // Never the URL, its id or query
    expect(JSON.stringify(body)).not.toMatch(/0174501b|t=30|video\//);
  });

  it('should do nothing on a page load outside the sample', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.5);
    render(<WebVitalsBeacon />);
    await new Promise((r) => setTimeout(r, 0));
    expect(reporters.LCP).toBeUndefined();
    hide();
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});
