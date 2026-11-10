/**
 * useActionRowFit keeps the watch page's action row on one line: it picks the
 * widest layout (full labels, icon-only pills, tight) whose content fits.
 */
import React, { useRef } from 'react';
import { render, act } from '@testing-library/react';
import { useActionRowFit, type ActionRowFit } from '../useActionRowFit';

/** Content width of the row in each layout. */
const CONTENT: Record<ActionRowFit, number> = { full: 620, icons: 340, tight: 280 };

let clientWidth = 1000;
let observerCallback: (() => void) | null = null;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      const fit = this.dataset.fit as ActionRowFit | undefined;
      return Math.max(clientWidth, fit ? CONTENT[fit] : 0);
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
  (global as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(cb: () => void) {
      observerCallback = cb;
    }
    observe() {}
    disconnect() {}
  };
});

function Row() {
  const ref = useRef<HTMLDivElement>(null);
  useActionRowFit(ref);
  return <div ref={ref} data-testid="row"><button type="button">a</button></div>;
}

const fitAt = (width: number, row: HTMLElement) => {
  clientWidth = width;
  act(() => observerCallback?.());
  return row.dataset.fit;
};

describe('useActionRowFit', () => {
  it('uses the widest layout that fits, and steps back up when the row grows', () => {
    clientWidth = 1000;
    const { getByTestId } = render(<Row />);
    const row = getByTestId('row');
    expect(row.dataset.fit).toBe('full');
    expect(fitAt(500, row)).toBe('icons');
    expect(fitAt(300, row)).toBe('tight');
    expect(fitAt(340, row)).toBe('icons');
    expect(fitAt(620, row)).toBe('full');
  });

  it('stays at tight when nothing fits', () => {
    clientWidth = 200;
    const { getByTestId } = render(<Row />);
    expect(getByTestId('row').dataset.fit).toBe('tight');
  });
});
