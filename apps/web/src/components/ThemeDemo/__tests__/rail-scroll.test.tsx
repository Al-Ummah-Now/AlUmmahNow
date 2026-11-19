import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { hasMoreBelow, useMoreBelow } from '../rail-scroll';

/**
 * The side rail's list scrolls with no visible scrollbar, so on a short window its last item was cut off with
 * nothing saying more was below (#1620). The list carries data-more-below while items are below the visible
 * area; system.css then shades the edge strip under the list (never over it) and shows a thin scrollbar on hover/focus.
 */
describe('side rail scroll hint', () => {
  it('hasMoreBelow: true until the end is in view (sub-pixel slack)', () => {
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 700, scrollHeight: 900 })).toBe(true);
    expect(hasMoreBelow({ scrollTop: 199, clientHeight: 700, scrollHeight: 900 })).toBe(false);
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 900, scrollHeight: 900 })).toBe(false);
  });

  function List() {
    const ref = useMoreBelow<HTMLDivElement>();
    return <div ref={ref} data-testid="list" />;
  }

  function size(el: HTMLElement, scrollTop: number, clientHeight: number, scrollHeight: number) {
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
    el.scrollTop = scrollTop;
  }

  it('marks the list while items are below, and clears it at the end', () => {
    render(<List />);
    const list = screen.getByTestId('list');
    size(list, 0, 700, 900);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(list).toHaveAttribute('data-more-below');
    size(list, 200, 700, 900);
    fireEvent.scroll(list);
    expect(list).not.toHaveAttribute('data-more-below');
    // A taller window that fits everything: no hint
    size(list, 0, 900, 900);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(list).not.toHaveAttribute('data-more-below');
  });

  it('system.css: the edge strip below the list shades only while more is below, never over the list; thin scrollbar on hover/focus', () => {
    const css = readFileSync(join(__dirname, '../../../theme/system.css'), 'utf8');
    // Outside the scroll box: its own 14px strip with a line, shadow and chevron, only when the list before it is marked
    expect(css).toMatch(/\.nv-edge\{position:relative;flex:none;height:14px;/);
    expect(css).toMatch(/\.nv-scroll\[data-more-below\]\+\.nv-edge::after\{[^}]*background:var\(--fanous-c-drawer-icon\)/);
    expect(css).toMatch(/\.nv-scroll\[data-more-below\]\+\.nv-edge\{[^}]*box-shadow:inset/);
    // Nothing dims the list's own text (no mask on the list)
    expect(css).not.toMatch(/\.nv-scroll[^{]*\{[^}]*mask-image/);
    expect(css).toMatch(/\.nv-scroll\{scrollbar-width:thin;scrollbar-color:transparent transparent;scrollbar-gutter:stable\}/);
    expect(css).toMatch(/\.nv-scroll:hover,\.nv-scroll:focus-within\{scrollbar-color:var\(--fanous-c-drawer-icon\) transparent\}/);
    expect(css).not.toMatch(/\.nv-scroll\{scrollbar-width:none\}/);
  });
});
