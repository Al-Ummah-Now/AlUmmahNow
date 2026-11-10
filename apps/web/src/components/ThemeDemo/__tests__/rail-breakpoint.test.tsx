import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { RAIL_DESKTOP_QUERY, useRailBreakpointStill } from '../rail-breakpoint';

describe('side rail across the desktop breakpoint', () => {
  let listeners: Array<() => void>;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    listeners = [];
    frames = [];
    (window.matchMedia as jest.Mock).mockImplementation((media: string) => ({
      matches: true,
      media,
      addEventListener: (_type: string, cb: () => void) => listeners.push(cb),
      removeEventListener: (_type: string, cb: () => void) => {
        listeners = listeners.filter((l) => l !== cb);
      },
    }));
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    delete document.documentElement.dataset.railStill;
  });

  afterEach(() => jest.restoreAllMocks());

  const nextFrame = () => frames.shift()?.(0);

  it('turns the panel and padding transitions off while the layout changes, then back on', () => {
    renderHook(() => useRailBreakpointStill());
    expect(window.matchMedia).toHaveBeenCalledWith(RAIL_DESKTOP_QUERY);
    expect(document.documentElement.dataset.railStill).toBeUndefined();

    listeners.forEach((l) => l()); // phone → desktop
    expect(document.documentElement.dataset.railStill).toBe('');
    nextFrame();
    expect(document.documentElement.dataset.railStill).toBe(''); // still off while the new layout paints
    nextFrame();
    expect(document.documentElement.dataset.railStill).toBeUndefined(); // the menu toggle animates again
  });

  it('stops listening and clears the flag on unmount', () => {
    const { unmount } = renderHook(() => useRailBreakpointStill());
    listeners.forEach((l) => l());
    unmount();
    expect(listeners).toHaveLength(0);
    expect(document.documentElement.dataset.railStill).toBeUndefined();
  });

  it('uses the same breakpoint as the shell CSS, which drops the transitions under the flag', () => {
    const css = readFileSync(join(__dirname, '../../../theme/system.css'), 'utf8');
    expect(css).toContain('@media(min-width:1024px){#page-content{padding-inline-start:var(--rail)');
    expect(RAIL_DESKTOP_QUERY).toBe('(min-width: 1024px)');
    expect(css).toMatch(/html\[data-rail-still\] \.nv-panel,html\[data-rail-still\] #page-content\{transition:none!important\}/);
  });
});
