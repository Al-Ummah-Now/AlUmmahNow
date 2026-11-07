/**
 * Story 1.2 AC 4: the video player's document-level shortcut listener is scoped
 * to its own player; scoped listeners are removed on abort.
 */
import { addScopedListener, shouldHandleGlobalPlayerShortcut } from '../listener-scope';

/** jsdom cannot create trusted events (isTrusted is non-configurable), so use an event-shaped object. */
function trustedKeydown(target: EventTarget): KeyboardEvent {
  return { type: 'keydown', key: 'k', isTrusted: true, target } as unknown as KeyboardEvent;
}

describe('shouldHandleGlobalPlayerShortcut', () => {
  let player: HTMLElement;
  let otherPlayer: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="video-js" id="p1"><button id="inside">play</button></div>
      <div class="video-js" id="p2"><button id="inside2">play</button></div>
      <input id="comment" />
      <div role="dialog"><button id="dialog-btn">ok</button></div>
      <p id="text">text</p>`;
    player = document.getElementById('p1')!;
    otherPlayer = document.getElementById('p2')!;
  });

  it('handles keys aimed at the page body or plain content', () => {
    expect(shouldHandleGlobalPlayerShortcut(trustedKeydown(document.body), player)).toBe(true);
    expect(shouldHandleGlobalPlayerShortcut(trustedKeydown(document.getElementById('text')!), player)).toBe(true);
  });

  it('ignores synthetic (untrusted) events', () => {
    const event = new KeyboardEvent('keydown', { key: 'k' });
    expect(shouldHandleGlobalPlayerShortcut(event, player)).toBe(false);
  });

  it('ignores typing in inputs, dialogs and other players', () => {
    expect(shouldHandleGlobalPlayerShortcut(trustedKeydown(document.getElementById('comment')!), player)).toBe(false);
    expect(shouldHandleGlobalPlayerShortcut(trustedKeydown(document.getElementById('dialog-btn')!), player)).toBe(false);
    expect(shouldHandleGlobalPlayerShortcut(trustedKeydown(document.getElementById('inside2')!), player)).toBe(false);
    expect(otherPlayer).toBeTruthy();
  });

  it('does not double-handle events inside the player unless asked to', () => {
    const inside = document.getElementById('inside')!;
    expect(shouldHandleGlobalPlayerShortcut(trustedKeydown(inside), player)).toBe(false);
    expect(shouldHandleGlobalPlayerShortcut(trustedKeydown(inside), player, { handleEventsInsidePlayer: true })).toBe(true);
  });

  it('only the fullscreen player handles keys while fullscreen', () => {
    Object.defineProperty(document, 'fullscreenElement', { value: otherPlayer, configurable: true });
    expect(shouldHandleGlobalPlayerShortcut(trustedKeydown(document.body), player)).toBe(false);
    expect(shouldHandleGlobalPlayerShortcut(trustedKeydown(document.body), otherPlayer)).toBe(true);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });
});

describe('addScopedListener', () => {
  it('removes the listener via cleanup or when the parent signal aborts', () => {
    const target = new EventTarget();
    const handler = jest.fn();
    const cleanup = addScopedListener(target, 'ping', handler);
    target.dispatchEvent(new Event('ping'));
    cleanup();
    target.dispatchEvent(new Event('ping'));
    expect(handler).toHaveBeenCalledTimes(1);

    const parent = new AbortController();
    const handler2 = jest.fn();
    addScopedListener(target, 'ping', handler2, parent.signal);
    parent.abort();
    target.dispatchEvent(new Event('ping'));
    expect(handler2).not.toHaveBeenCalled();
  });
});
