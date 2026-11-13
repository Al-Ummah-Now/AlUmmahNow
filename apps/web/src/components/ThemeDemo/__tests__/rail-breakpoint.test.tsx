import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderHook } from '@testing-library/react';
import { RAIL_DESKTOP_QUERY, RAIL_MOTION_MS, useRailMotion } from '../rail-breakpoint';

/**
 * The rail, the phone drawer and the page padding animate only while the menu is toggled, never
 * when the layout crosses the breakpoint (a rotation, a foldable unfolding): on WebKit a
 * breakpoint-change guard came too late and the page slid under a tap (#1130).
 */
describe('side rail motion', () => {
  const root = document.documentElement;

  beforeEach(() => {
    jest.useFakeTimers();
    delete root.dataset.railMoving;
  });

  afterEach(() => jest.useRealTimers());

  it('does not animate the page as it first lays out', () => {
    renderHook(({ open }) => useRailMotion(open), { initialProps: { open: false } });
    expect(root.dataset.railMoving).toBeUndefined();
  });

  it('animates while the menu opens or closes, then stops', () => {
    const { rerender } = renderHook(({ open }) => useRailMotion(open), { initialProps: { open: false } });
    rerender({ open: true });
    expect(root.dataset.railMoving).toBe('');
    jest.advanceTimersByTime(RAIL_MOTION_MS - 1);
    expect(root.dataset.railMoving).toBe('');
    jest.advanceTimersByTime(1);
    expect(root.dataset.railMoving).toBeUndefined();

    rerender({ open: false });
    expect(root.dataset.railMoving).toBe('');
    jest.advanceTimersByTime(RAIL_MOTION_MS);
    expect(root.dataset.railMoving).toBeUndefined();
  });

  it('a quick second toggle keeps animating for the full time', () => {
    const { rerender } = renderHook(({ open }) => useRailMotion(open), { initialProps: { open: false } });
    rerender({ open: true });
    jest.advanceTimersByTime(RAIL_MOTION_MS - 50);
    rerender({ open: false });
    jest.advanceTimersByTime(RAIL_MOTION_MS - 1);
    expect(root.dataset.railMoving).toBe('');
    jest.advanceTimersByTime(1);
    expect(root.dataset.railMoving).toBeUndefined();
  });

  it('clears the flag on unmount', () => {
    const { rerender, unmount } = renderHook(({ open }) => useRailMotion(open), { initialProps: { open: false } });
    rerender({ open: true });
    unmount();
    expect(root.dataset.railMoving).toBeUndefined();
  });

  it('the shell CSS transitions the rail, drawer and padding only under the flag', () => {
    const css = readFileSync(join(__dirname, '../../../theme/system.css'), 'utf8');
    expect(css).toContain('@media(min-width:1024px){#page-content{padding-inline-start:var(--rail)}');
    expect(RAIL_DESKTOP_QUERY).toBe('(min-width: 1024px)');
    expect(css).toContain('html[data-rail-moving] .nv-panel{transition:width 220ms');
    expect(css).toContain('html[data-rail-moving] #page-content{transition:padding 220ms');
    expect(css).toContain('html[data-rail-moving] .nv-panel{transition:transform 240ms');
    // No rule outside the flag transitions them (a breakpoint change must not animate)
    const unflagged = css.replace(/html\[data-rail-moving\] [^{]+\{[^}]*\}/g, '');
    expect(unflagged).not.toMatch(/(\.nv-panel|#page-content)\{[^}]*transition:/);
  });
});
