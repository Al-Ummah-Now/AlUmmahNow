import { keepFrameInView, stickyTopInset, theatreScrollDelta, THEATRE_SCROLL_GAP } from '../theatre-scroll';

describe('theatre keeps the player in view', () => {
  it('leaves a frame whose top shows below the top bar alone', () => {
    expect(theatreScrollDelta(80, 64, 800)).toBe(0);
    expect(theatreScrollDelta(64, 64, 800)).toBe(0);
  });

  it('scrolls a frame whose top went under the top bar or above the viewport back down to it', () => {
    // Firefox over WebDriver BiDi: the button centred before the click left the frame at -222
    expect(theatreScrollDelta(-222, 64, 800)).toBe(-222 - 64 - THEATRE_SCROLL_GAP);
    expect(theatreScrollDelta(30, 64, 800)).toBe(30 - 64 - THEATRE_SCROLL_GAP);
  });

  it('brings a frame below the viewport up', () => {
    expect(theatreScrollDelta(900, 64, 800)).toBe(900 - 64 - THEATRE_SCROLL_GAP);
  });

  it('measures the sticky top bar, and nothing for a static one', () => {
    const header = document.createElement('header');
    document.body.appendChild(header);
    header.getBoundingClientRect = () => ({ bottom: 64 } as DOMRect);
    header.style.position = 'sticky';
    expect(stickyTopInset(document)).toBe(64);
    header.style.position = 'static';
    expect(stickyTopInset(document)).toBe(0);
    header.remove();
    expect(stickyTopInset(document)).toBe(0);
  });

  it('scrolls the window by the delta, instantly', () => {
    const scrollBy = jest.fn();
    window.scrollBy = scrollBy as unknown as typeof window.scrollBy;
    const frame = document.createElement('div');
    frame.getBoundingClientRect = () => ({ top: -100 } as DOMRect);
    keepFrameInView(frame);
    expect(scrollBy).toHaveBeenCalledWith({ top: -100 - THEATRE_SCROLL_GAP, behavior: 'instant' });
    scrollBy.mockClear();
    frame.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
    keepFrameInView(frame);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
