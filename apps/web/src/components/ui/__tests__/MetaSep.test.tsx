/**
 * MetaSep: the meta-line separator as an element. Arabic shows «، » hugging the word before it in a
 * gapped row, one space after; English keeps its dot with no offset; screen readers never hear it.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { MetaSep } from '../MetaSep';

const sep = (container: HTMLElement) => container.querySelector('[data-meta-sep]') as HTMLElement;

describe('MetaSep', () => {
  it('Arabic in a gapped row: cancels the gap both sides and carries «، », like a text-joined line', () => {
    const { container } = render(<MetaSep lang="ar" gap="0.5rem" />);
    const el = sep(container);
    expect(el.textContent).toBe('، ');
    expect(el.style.marginInlineStart).toBe('calc(-1 * 0.5rem)');
    expect(el.style.marginInlineEnd).toBe('calc(-1 * 0.5rem)');
    // The trailing space survives at the end of the flex item
    expect(el.style.whiteSpace).toBe('pre');
  });

  it('Arabic leading an item with a tighter row: cancels each side by its own gap, so one space follows «،»', () => {
    const el = sep(render(<MetaSep lang="ar" gap="0.5rem" gapEnd="0.25rem" />).container);
    expect(el.style.marginInlineStart).toBe('calc(-1 * 0.5rem)');
    expect(el.style.marginInlineEnd).toBe('calc(-1 * 0.25rem)');
  });

  it('Arabic without a gap: no offset', () => {
    const { container } = render(<MetaSep lang="ar" />);
    expect(sep(container).textContent).toBe('،');
    expect(sep(container).getAttribute('style')).toBeNull();
  });

  it('English: its dot, never offset, even in a gapped row', () => {
    const { container } = render(<MetaSep lang="en" gap="0.5rem" />);
    expect(sep(container).textContent).toBe('•');
    expect(sep(container).getAttribute('style')).toBeNull();
    const { container: mid } = render(<MetaSep lang="en" en="·" gap="6px" />);
    expect(sep(mid).textContent).toBe('·');
    expect(sep(mid).getAttribute('style')).toBeNull();
  });

  it('spaced, for text: carries its own spacing', () => {
    expect(sep(render(<MetaSep lang="ar" spaced />).container).textContent).toBe('، ');
    expect(sep(render(<MetaSep lang="en" en="·" spaced />).container).textContent).toBe(' · ');
  });

  it('is hidden from screen readers and keeps its class', () => {
    const { container } = render(<MetaSep lang="ar" gap="6px" className="bil-dot" />);
    expect(sep(container)).toHaveAttribute('aria-hidden', 'true');
    expect(sep(container)).toHaveClass('bil-dot');
  });
});
