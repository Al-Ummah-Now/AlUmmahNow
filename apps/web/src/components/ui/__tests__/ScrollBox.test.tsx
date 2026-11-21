import { fireEvent, render, screen } from '@testing-library/react';
import { ScrollBox } from '../ScrollBox';

function sized(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => clientWidth });
}

afterEach(() => {
  delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

describe('ScrollBox', () => {
  it('looks like a plain box when the content fits', () => {
    sized(300, 300);
    render(<ScrollBox label="Top content" testId="box"><table /></ScrollBox>);
    const box = screen.getByTestId('box');
    expect(box).not.toHaveAttribute('role');
    expect(box).not.toHaveAttribute('tabindex');
    expect(box.style.maskImage).toBe('');
  });

  it('fades the end edge and takes the focus when the content is wider', () => {
    sized(420, 300);
    render(<ScrollBox label="Top content" testId="box"><table /></ScrollBox>);
    const box = screen.getByRole('region', { name: 'Top content' });
    expect(box).toHaveAttribute('tabindex', '0');
    expect(box).toHaveAttribute('data-scrolls', 'end');
    expect(box.style.maskImage).toContain('transparent');
  });

  it('moves the fade to the start edge once scrolled to the end (RTL scrollLeft is negative)', () => {
    sized(420, 300);
    render(<ScrollBox label="Top content" testId="box"><table /></ScrollBox>);
    const box = screen.getByTestId('box');
    box.scrollLeft = -120;
    Object.defineProperty(box, 'scrollLeft', { configurable: true, get: () => -120 });
    fireEvent.scroll(box);
    expect(box).toHaveAttribute('data-scrolls', 'start');
  });
});
